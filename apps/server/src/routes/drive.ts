import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { readAuthSession } from "../services/auth.service.js";
import {
  createDriveClient,
  ensureDriveFileExtension,
  GoogleDriveClient,
} from "../services/googleDrive.service.js";
import {
  copyAssetRelationships,
  getAsset,
  listAssetIdsByTag,
  listTags,
  searchAssets,
  uploadAsset,
  uploadAssetStream,
  tagAsset,
  tagAssets,
  updateAsset,
  type ImmichAsset,
} from "../infra/ImmichClient.js";
import { getUploadConfig } from "../services/uploadConfig.service.js";
import { prepareAudioAsVideo } from "../services/audioToVideo.service.js";
import { parseImmichDuration } from "../services/audioAsset.service.js";
import { UPLOAD_LIMITS } from "../services/uploadLimits.js";

const router = Router();
const DRIVE_SOURCE_TAG_PREFIX = "source:drive:";

function driveSourceTag(fileId: string) {
  return `${DRIVE_SOURCE_TAG_PREFIX}${fileId}`;
}

function normalizeFilename(value: string) {
  return value.trim().toLocaleLowerCase();
}

function tagValues(asset: ImmichAsset) {
  return (asset.tags ?? [])
    .flatMap((tag) => [tag.name, tag.value])
    .map((value) => value.trim())
    .filter(Boolean);
}

function assetHasTagNames(asset: ImmichAsset, requiredTagNames: string[]) {
  const assetTags = new Set(tagValues(asset).map((value) => value.toLocaleLowerCase()));
  return requiredTagNames.every((name) => assetTags.has(name.toLocaleLowerCase()));
}

async function waitForAssetTags(
  assetId: string,
  requiredTagNames: string[],
  options?: { requireAudioDuration?: boolean },
) {
  const retries = options?.requireAudioDuration ? 120 : 20;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const asset = await getAsset(assetId);
    const hasAudioDuration =
      !options?.requireAudioDuration || parseImmichDuration(asset.duration) > 0;
    if (assetHasTagNames(asset, requiredTagNames) && hasAudioDuration) return asset;
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    options?.requireAudioDuration
      ? "Immich did not make the imported audio duration available in time. The previous asset was left unchanged."
      : "Immich did not make the imported asset tags available in time. The previous asset was left unchanged.",
  );
}

function assetDriveSourceId(asset: ImmichAsset) {
  const sourceTags = tagValues(asset).filter((value) =>
    value.toLocaleLowerCase().startsWith(DRIVE_SOURCE_TAG_PREFIX),
  );
  const ids = Array.from(new Set(sourceTags.map((value) => value.slice(DRIVE_SOURCE_TAG_PREFIX.length))));
  if (ids.length > 1) {
    throw new Error("This asset has multiple Google Drive source tags and cannot be safely reimported.");
  }
  return ids[0] || null;
}

function assetPlacementId(asset: ImmichAsset) {
  const placementIds = Array.from(new Set(
    tagValues(asset)
      .map((value) => value.match(/^placement:(\d+)$/i)?.[1])
      .filter((value): value is string => Boolean(value)),
  ));
  if (placementIds.length > 1) {
    throw new Error("This asset has multiple placement tags and cannot be safely matched to Google Drive.");
  }
  return placementIds[0] ? Number(placementIds[0]) : null;
}

function assetActivityId(asset: ImmichAsset) {
  const activityIds = Array.from(new Set(
    tagValues(asset)
      .map((value) => value.match(/^activity:(\d+)$/i)?.[1])
      .filter((value): value is string => Boolean(value)),
  ));
  return activityIds.length === 1 ? Number(activityIds[0]) : null;
}

/**
 * Middleware to extract and validate Drive client from auth session
 */
function getDriveClient(req: Request): GoogleDriveClient {
  const session = readAuthSession(req);
  if (!session) {
    throw new Error("Not authenticated");
  }
  if (!session.refreshToken) {
    throw new Error(
      "Google Drive access not configured. Please sign in again."
    );
  }

  const client = createDriveClient(session.refreshToken);
  if (!client) {
    throw new Error("Failed to initialize Drive client");
  }

  return client;
}

type DriveBulkLookupResult = {
  assetId: string;
  fileName: string;
  status: "linked" | "not-found" | "ambiguous" | "skipped" | "failed";
  fileId?: string;
  driveFileName?: string;
  error?: string;
};

type DriveBulkLookupSummary = {
  scanned: number;
  candidates: number;
  linked: number;
  notFound: number;
  ambiguous: number;
  skipped: number;
  failed: number;
  results: DriveBulkLookupResult[];
};

type DriveBulkLookupJob = {
  status: "running" | "completed" | "failed";
  summary?: DriveBulkLookupSummary;
  error?: string;
};

const driveBulkLookupJobs = new Map<string, DriveBulkLookupJob>();
let activeDriveBulkLookupJobId: string | null = null;

async function searchAllAssetsForDriveLookup() {
  const byId = new Map<string, Awaited<ReturnType<typeof searchAssets>>["assets"]["items"][number]>();
  for (const type of ["IMAGE", "VIDEO"] as const) {
    for (const visibility of ["timeline", "archive"] as const) {
      let page = 1;
      for (;;) {
        const result = await searchAssets({ page, size: 100, type, visibility });
        for (const asset of result.assets.items) byId.set(asset.id, asset);
        if (!result.assets.nextPage || result.assets.items.length < 100) break;
        page += 1;
      }
    }
  }
  return Array.from(byId.values());
}

/** Link every unlinked admin asset to a unique matching file in its site's Drive tree. */
async function runBulkDriveLookup(client: GoogleDriveClient): Promise<DriveBulkLookupSummary> {
    const [assets, config] = await Promise.all([
      searchAllAssetsForDriveLookup(),
      getUploadConfig(),
    ]);
    const placementsById = new Map(
      config.placements.map((placement) => [placement.placement_id, placement]),
    );
    const results: DriveBulkLookupResult[] = [];
    const groupedCandidates = new Map<
      string,
      { folderId: string; asset: ImmichAsset }[]
    >();
    let candidates = 0;

    for (const listedAsset of assets) {
      let asset = listedAsset;
      if (!Array.isArray(asset.tags)) {
        asset = await getAsset(asset.id);
      }

      try {
        if (assetDriveSourceId(asset)) continue;
      } catch (err) {
        results.push({
          assetId: asset.id,
          fileName: asset.originalFileName,
          status: "skipped",
          error: (err as Error).message,
        });
        continue;
      }

      let placementId: number | null;
      try {
        placementId = assetPlacementId(asset);
      } catch (err) {
        results.push({
          assetId: asset.id,
          fileName: asset.originalFileName,
          status: "skipped",
          error: (err as Error).message,
        });
        continue;
      }
      if (placementId == null) {
        results.push({
          assetId: asset.id,
          fileName: asset.originalFileName,
          status: "skipped",
          error: "Asset is not assigned to an Artasia site.",
        });
        continue;
      }
      const folderId = placementsById.get(placementId)?.google_drive_folder_id?.trim();
      if (!folderId) {
        results.push({
          assetId: asset.id,
          fileName: asset.originalFileName,
          status: "skipped",
          error: "The asset's Artasia site does not have a Google Drive folder configured.",
        });
        continue;
      }

      candidates += 1;
      const group = groupedCandidates.get(folderId) ?? [];
      group.push({ folderId, asset });
      groupedCandidates.set(folderId, group);
    }

    for (const [folderId, group] of groupedCandidates) {
      let lookups: Array<{ filename: string; file?: { id: string; name: string }; matchCount: number }>;
      try {
        lookups = await client.findUniqueFilesInFolderTree(
          folderId,
          group.map(({ asset }) => asset.originalFileName),
        );
      } catch (err) {
        for (const { asset } of group) {
          results.push({
            assetId: asset.id,
            fileName: asset.originalFileName,
            status: "failed",
            error: (err as Error).message,
          });
        }
        continue;
      }

      const lookupByFilename = new Map(lookups.map((lookup) => [lookup.filename, lookup]));
      for (const { asset } of group) {
        const lookup = lookupByFilename.get(asset.originalFileName.trim()) ?? {
          filename: asset.originalFileName.trim(),
          file: undefined,
          matchCount: 0,
        };
        if (lookup.matchCount === 0) {
          results.push({
            assetId: asset.id,
            fileName: asset.originalFileName,
            status: "not-found",
          });
          continue;
        }
        if (!lookup.file) {
          results.push({
            assetId: asset.id,
            fileName: asset.originalFileName,
            status: "ambiguous",
            error: `Found ${lookup.matchCount} matching files in the site's Google Drive folder.`,
          });
          continue;
        }

        try {
          const sourceTag = driveSourceTag(lookup.file.id);
          await tagAsset(asset.id, [sourceTag]);
          await waitForAssetTags(asset.id, [sourceTag]);
          results.push({
            assetId: asset.id,
            fileName: asset.originalFileName,
            status: "linked",
            fileId: lookup.file.id,
            driveFileName: lookup.file.name,
          });
        } catch (err) {
          results.push({
            assetId: asset.id,
            fileName: asset.originalFileName,
            status: "failed",
            error: (err as Error).message,
          });
        }
      }
    }

    const summary = {
      scanned: assets.length,
      candidates,
      linked: results.filter((result) => result.status === "linked").length,
      notFound: results.filter((result) => result.status === "not-found").length,
      ambiguous: results.filter((result) => result.status === "ambiguous").length,
      skipped: results.filter((result) => result.status === "skipped").length,
      failed: results.filter((result) => result.status === "failed").length,
      results,
    };
    return summary;
}

router.post("/assets/lookup-missing", async (req: Request, res: Response) => {
  try {
    const client = getDriveClient(req);
    if (activeDriveBulkLookupJobId) {
      res.status(409).json({
        error: "A Drive maintenance lookup is already running.",
        jobId: activeDriveBulkLookupJobId,
      });
      return;
    }

    const jobId = randomUUID();
    const job: DriveBulkLookupJob = { status: "running" };
    driveBulkLookupJobs.set(jobId, job);
    activeDriveBulkLookupJobId = jobId;
    void runBulkDriveLookup(client)
      .then((summary) => {
        job.status = "completed";
        job.summary = summary;
      })
      .catch((err) => {
        job.status = "failed";
        job.error = (err as Error).message;
      })
      .finally(() => {
        activeDriveBulkLookupJobId = null;
        setTimeout(() => driveBulkLookupJobs.delete(jobId), 15 * 60_000);
      });

    res.status(202).json({ jobId, status: job.status });
  } catch (err) {
    res
      .status(err instanceof Error && err.message.includes("Not authenticated") ? 401 : 500)
      .json({ error: (err as Error).message });
  }
});

router.get("/assets/lookup-missing/:jobId", (req: Request, res: Response) => {
  if (!readAuthSession(req)) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const jobId = (Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId).trim();
  const job = driveBulkLookupJobs.get(jobId);
  if (!job) {
    res.status(404).json({ error: "Drive maintenance lookup was not found or has expired." });
    return;
  }
  res.json({ jobId, ...job });
});

/**
 * GET /api/v1/drive/folders?driveType=myDrive&parentId=root&driveId=...
 * List folders with support for hierarchy and Shared Drives
 * Query params:
 *   - driveType: "myDrive" (default) or "sharedDrives"
 *   - parentId: folder ID to list children from (default "root")
 *   - driveId: Shared Drive ID (when navigating within a Shared Drive)
 */
router.get("/folders", async (req: Request, res: Response) => {
  try {
    const client = getDriveClient(req);
    const driveType = typeof req.query.driveType === "string" ? req.query.driveType : "myDrive";
    const parentId = typeof req.query.parentId === "string" ? req.query.parentId : "root";
    const driveId = typeof req.query.driveId === "string" ? req.query.driveId : undefined;

    let folders;

    if (driveType === "sharedDrives" && !driveId) {
      // Get all Shared Drives (first level)
      folders = await client.getSharedDrives();
      res.json({ folders });
      return;
    }

    if (driveType === "sharedDrives" && driveId) {
      // Get subfolders within a Shared Drive
      folders = await client.getFoldersInFolder(parentId, driveId);
      res.json({ folders, driveId });
      return;
    }

    // My Drive navigation
    if (parentId === "root") {
      // Return "My Drive" as the root with its immediate children as subfolders
      const myDrive = await client.getMyDriveInfo();
      const subfolders = await client.getFoldersInFolder("root");
      res.json({ myDrive, subfolders });
      return;
    } else {
      // Get subfolders of a specific folder in My Drive
      folders = await client.getFoldersInFolder(parentId);
      res.json({ folders });
      return;
    }
  } catch (err) {
    res
      .status(err instanceof Error && err.message.includes("Not authenticated") ? 401 : 500)
      .json({ error: (err as Error).message });
  }
});

interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  isFolder: boolean;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
}

interface DriveListResponse {
  files: DriveFileInfo[];
  nextPageToken?: string;
}

/**
 * GET /api/v1/drive/files?folderId=...&pageToken=...&driveId=...
 * List files/folders in a specific folder
 * Query params:
 *   - folderId: folder ID (default "root")
 *   - pageToken: for pagination
 *   - driveId: Shared Drive ID (when querying within a Shared Drive)
 */
router.get("/files", async (req: Request, res: Response) => {
  try {
    const client = getDriveClient(req);
    const folderId =
      typeof req.query.folderId === "string"
        ? req.query.folderId
        : "root";
    const pageToken =
      typeof req.query.pageToken === "string"
        ? req.query.pageToken
        : undefined;
    const driveId =
      typeof req.query.driveId === "string"
        ? req.query.driveId
        : undefined;

    const { files, nextPageToken } = await client.listFiles(
      folderId,
      pageToken,
      driveId
    );

    const result: DriveListResponse = {
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size ? String(file.size) : undefined,
        modifiedTime: file.modifiedTime,
        thumbnailLink: file.thumbnailLink,
        isFolder: GoogleDriveClient.isFolder(file.mimeType),
        isImage: GoogleDriveClient.isImage(file.mimeType),
        isVideo: GoogleDriveClient.isVideo(file.mimeType),
        isAudio: GoogleDriveClient.isAudio(file.mimeType),
      })),
      nextPageToken,
    };

    res.json(result);
  } catch (err) {
    res
      .status(err instanceof Error && err.message.includes("Not authenticated") ? 401 : 500)
      .json({ error: (err as Error).message });
  }
});

interface DriveSyncRequest {
  fileIds: string[];
  placementId?: number | null;
  activityId?: number | null;
}

router.get("/folders/:folderId", async (req: Request, res: Response) => {
  try {
    const folderId = Array.isArray(req.params.folderId)
      ? String(req.params.folderId[0])
      : req.params.folderId;
    const path = await getDriveClient(req).getFolderPath(folderId);
    res.json({ folder: path[path.length - 1], path });
  } catch (err) {
    res
      .status(err instanceof Error && err.message.includes("Not authenticated") ? 401 : 500)
      .json({ error: (err as Error).message });
  }
});

interface DriveSyncResult {
  fileId: string;
  fileName: string;
  status: "success" | "failed";
  assetId?: string;
  replacedAssetId?: string;
  error?: string;
}

async function getAssetsForTag(tagId: string) {
  const ids = await listAssetIdsByTag(tagId);
  return Promise.all(ids.map((id) => getAsset(id)));
}

async function findDriveImportReplacement(params: {
  fileId: string;
  filename: string;
  placementId?: number | null;
}): Promise<ImmichAsset | null> {
  const tags = await listTags();
  const sourceTagName = driveSourceTag(params.fileId).toLocaleLowerCase();
  const sourceTag = tags.find(
    (tag) =>
      tag.name.trim().toLocaleLowerCase() === sourceTagName ||
      tag.value.trim().toLocaleLowerCase() === sourceTagName,
  );
  if (sourceTag) {
    const matches = (await getAssetsForTag(sourceTag.id)).filter(
      (asset) => !asset.isArchived && !asset.isTrashed,
    );
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) {
      throw new Error(
        `Cannot replace Google Drive file because ${matches.length} active assets share its source tag. Resolve the duplicates first.`,
      );
    }
  }

  if (params.placementId == null) return null;
  const placementTagName = `placement:${params.placementId}`;
  const placementTag = tags.find(
    (tag) =>
      tag.name.trim().toLocaleLowerCase() === placementTagName ||
      tag.value.trim().toLocaleLowerCase() === placementTagName,
  );
  if (!placementTag) return null;

  const filename = normalizeFilename(params.filename);
  const matches = (await getAssetsForTag(placementTag.id)).filter(
    (asset) =>
      !asset.isArchived &&
      !asset.isTrashed &&
      normalizeFilename(asset.originalFileName) === filename,
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(
      `Cannot safely replace "${params.filename}" because multiple assets with that name exist at this placement.`,
    );
  }
  return null;
}

async function archiveReplacedAsset(source: ImmichAsset, targetAssetId: string) {
  if (source.id === targetAssetId) return;

  await copyAssetRelationships(source.id, targetAssetId);
  const sourceTagIds = (source.tags ?? []).map((tag) => tag.id);
  if (sourceTagIds.length > 0) await tagAssets([targetAssetId], sourceTagIds);
  const latitude = source.exifInfo?.latitude;
  const longitude = source.exifInfo?.longitude;
  await updateAsset(targetAssetId, {
    description: source.exifInfo?.description ?? "",
    isFavorite: source.isFavorite,
    ...(typeof latitude === "number" && Number.isFinite(latitude) &&
    typeof longitude === "number" && Number.isFinite(longitude)
      ? { latitude, longitude }
      : {}),
    dateTimeOriginal: source.fileCreatedAt,
    visibility: "timeline",
  });
  await updateAsset(source.id, { visibility: "archive" });
}

async function importDriveFile(params: {
  client: GoogleDriveClient;
  fileId: string;
  placementId?: number | null;
  placementTags: string[];
  activityTags: string[];
}): Promise<DriveSyncResult> {
  let fileName = "Unknown";
  try {
    const fileInfo = await params.client.getFileInfo(params.fileId);
    fileName = fileInfo.name;
    const uploadFileName = ensureDriveFileExtension(fileInfo.name, fileInfo.mimeType);
    if (!fileInfo.isSupported) {
      return { fileId: params.fileId, fileName, status: "failed", error: `Unsupported file type: ${fileInfo.mimeType}` };
    }
    if (fileInfo.isAudio && fileInfo.size && fileInfo.size > UPLOAD_LIMITS.maxFileBytes) {
      return { fileId: params.fileId, fileName, status: "failed", error: `Audio file exceeds the ${Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))}MB limit` };
    }
    if (fileInfo.size && fileInfo.size > 10 * 1024 * 1024 * 1024) {
      return { fileId: params.fileId, fileName, status: "failed", error: "File exceeds 10GB limit" };
    }

    const stream = await params.client.downloadFile(params.fileId);
    const deviceAssetId = `artasia-galaxy:drive:${params.fileId}`;
    const fileDate = fileInfo.modifiedTime ? new Date(fileInfo.modifiedTime) : undefined;
    let uploadResult;
    let replacement: ImmichAsset | null = null;
    if (fileInfo.isAudio) {
      console.log(`[Drive] converting audio file ${params.fileId} to MP4`);
      const prepared = await prepareAudioAsVideo({ stream, originalName: fileInfo.name });
      try {
        replacement = await findDriveImportReplacement({
          fileId: params.fileId,
          filename: prepared.filename,
          placementId: params.placementId,
        });
        console.log(`[Drive] converted audio file ${params.fileId}: ${Math.round(prepared.durationSeconds)}s, ${prepared.outputBytes} bytes`);
        uploadResult = await uploadAsset({
          filePath: prepared.filePath,
          filename: prepared.filename,
          mimeType: prepared.mimeType,
          deviceAssetId,
          createdAt: fileDate,
          modifiedAt: fileDate,
        });
      } finally {
        await prepared.cleanup().catch((err) => {
          console.warn(`[Drive] failed to clean up audio conversion for ${params.fileId}: ${(err as Error).message}`);
        });
      }
    } else {
      replacement = await findDriveImportReplacement({
        fileId: params.fileId,
        filename: uploadFileName,
        placementId: params.placementId,
      });
      uploadResult = await uploadAssetStream({
        stream,
        filename: uploadFileName,
        mimeType: fileInfo.mimeType,
        deviceAssetId,
        createdAt: fileDate,
        modifiedAt: fileDate,
      });
    }

    if (!uploadResult.id) {
      return { fileId: params.fileId, fileName, status: "failed", error: "Failed to upload to Immich" };
    }
    const allTags = [
      ...params.placementTags,
      ...params.activityTags,
      driveSourceTag(params.fileId),
      ...(fileInfo.isAudio ? ["media:audio"] : []),
    ];
    await tagAsset(uploadResult.id, allTags);
    await waitForAssetTags(uploadResult.id, allTags, {
      requireAudioDuration: fileInfo.isAudio,
    });
    if (replacement) await archiveReplacedAsset(replacement, uploadResult.id);
    return {
      fileId: params.fileId,
      fileName,
      status: "success",
      assetId: uploadResult.id,
      ...(replacement && replacement.id !== uploadResult.id ? { replacedAssetId: replacement.id } : {}),
    };
  } catch (err) {
    return { fileId: params.fileId, fileName, status: "failed", error: (err as Error).message };
  }
}

/** Link a legacy Immich asset to its uniquely matching file in its placement's Drive folder. */
router.post("/assets/:assetId/lookup", async (req: Request, res: Response) => {
  try {
    const client = getDriveClient(req);
    const assetId = Array.isArray(req.params.assetId) ? req.params.assetId[0] : req.params.assetId;
    const asset = await getAsset(assetId.trim());
    const existingSourceId = assetDriveSourceId(asset);
    if (existingSourceId) {
      res.json({ status: "already-linked", fileId: existingSourceId });
      return;
    }

    const placementId = assetPlacementId(asset);
    if (placementId == null) {
      res.status(400).json({ error: "Assign this asset to one Artasia site before looking it up in Google Drive." });
      return;
    }
    const config = await getUploadConfig();
    const placement = config.placements.find((candidate) => candidate.placement_id === placementId);
    const folderId = placement?.google_drive_folder_id?.trim();
    if (!folderId) {
      res.status(400).json({ error: "This Artasia site does not have a Google Drive folder configured." });
      return;
    }

    const lookup = await client.findUniqueFileInFolderTree(folderId, asset.originalFileName);
    if (lookup.matchCount === 0) {
      res.json({ status: "not-found" });
      return;
    }
    if (!lookup.file) {
      res.status(409).json({
        error: `Found ${lookup.matchCount} matching files in this site's Google Drive folder. The asset was not linked.`,
      });
      return;
    }

    const sourceTag = driveSourceTag(lookup.file.id);
    await tagAsset(asset.id, [sourceTag]);
    await waitForAssetTags(asset.id, [sourceTag]);
    res.json({ status: "linked", fileId: lookup.file.id, fileName: lookup.file.name });
  } catch (err) {
    res
      .status(err instanceof Error && err.message.includes("Not authenticated") ? 401 : 500)
      .json({ error: (err as Error).message });
  }
});

/** Reimport one Drive-linked asset, preserving its relationships and archiving its old copy. */
router.post("/assets/:assetId/reimport", async (req: Request, res: Response) => {
  try {
    const client = getDriveClient(req);
    const assetId = Array.isArray(req.params.assetId) ? req.params.assetId[0] : req.params.assetId;
    const asset = await getAsset(assetId.trim());
    const fileId = assetDriveSourceId(asset);
    if (!fileId) {
      res.status(400).json({ error: "This asset is not linked to a Google Drive file yet." });
      return;
    }
    const placementId = assetPlacementId(asset);
    if (placementId == null) {
      res.status(400).json({ error: "Assign this asset to one Artasia site before reimporting it." });
      return;
    }
    const config = await getUploadConfig();
    const placement = config.placements.find((candidate) => candidate.placement_id === placementId);
    if (!placement) {
      res.status(400).json({ error: "This asset's Artasia site is no longer configured." });
      return;
    }
    const activityId = assetActivityId(asset);
    const activity = activityId == null
      ? null
      : config.activities.find((candidate) => candidate.id === activityId) ?? null;
    const result = await importDriveFile({
      client,
      fileId,
      placementId,
      placementTags: [`placement:${placementId}`, placement.placement_name],
      activityTags: activity ? [`activity:${activity.id}`, activity.label] : [],
    });
    if (result.status === "failed") {
      res.status(502).json({ error: result.error ?? "Google Drive reimport failed." });
      return;
    }
    res.json({ result });
  } catch (err) {
    res
      .status(err instanceof Error && err.message.includes("Not authenticated") ? 401 : 500)
      .json({ error: (err as Error).message });
  }
});

/**
 * POST /api/v1/drive/sync
 * Download and import selected files from Google Drive
 * Body: { fileIds: string[], placementId?: number, activityId?: number }
 */
router.post("/sync", async (req: Request, res: Response) => {
  try {
    const session = readAuthSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const client = getDriveClient(req);
    const config = await getUploadConfig();

    const { fileIds, placementId, activityId } = req.body as DriveSyncRequest;

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      res.status(400).json({ error: "No files specified" });
      return;
    }

    if (fileIds.length > 20) {
      res.status(400).json({ error: "Maximum 20 files per import" });
      return;
    }

    // Validate placement and activity if specified
    let placementTags: string[] = [];
    let activityTags: string[] = [];
    let placementConfig: (typeof config.placements)[number] | undefined;

    if (placementId !== null && placementId !== undefined) {
      placementConfig = config.placements.find(
        (p) => p.placement_id === placementId
      );
      if (!placementConfig) {
        res.status(400).json({ error: "Invalid placement ID" });
        return;
      }
      placementTags = [
        `placement:${placementId}`,
        placementConfig.placement_name,
      ];
    }

    if (activityId !== null && activityId !== undefined) {
      const activity = config.activities.find((a) => a.id === activityId);
      if (!activity) {
        res.status(400).json({ error: "Invalid activity ID" });
        return;
      }
      activityTags = [`activity:${activityId}`, activity.label];
    }

    const results: DriveSyncResult[] = [];
    for (const fileId of fileIds) {
      results.push(await importDriveFile({
        client,
        fileId,
        placementId,
        placementTags,
        activityTags,
      }));
    }

    res.json({ results });
  } catch (err) {
    res
      .status(err instanceof Error && err.message.includes("Not authenticated") ? 401 : 500)
      .json({ error: (err as Error).message });
  }
});

export default router;
