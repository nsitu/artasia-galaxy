import { Router, type Request, type Response } from "express";
import { randomUUID } from "node:crypto";
import { readAuthSession } from "../services/auth.service.js";
import {
  createDriveClient,
  driveSourceSearchFilename,
  ensureDriveFileExtension,
  GoogleDriveClient,
  inferActivityFromDriveFolders,
  type DriveFile,
  type DriveFolder,
} from "../services/googleDrive.service.js";
import {
  copyAssetRelationships,
  deleteAssets,
  getAsset,
  listAssetIdsByTag,
  listTags,
  searchAssets,
  uploadAsset,
  uploadAssetStream,
  tagAsset,
  tagAssets,
  untagAssets,
  updateAsset,
  type ImmichAsset,
} from "../infra/ImmichClient.js";
import {
  getUploadConfig,
  type ActivityConfig,
} from "../services/uploadConfig.service.js";
import { prepareAudioAsVideo } from "../services/audioToVideo.service.js";
import { isAudioAsset, parseImmichDuration } from "../services/audioAsset.service.js";
import { UPLOAD_LIMITS } from "../services/uploadLimits.js";

const router = Router();
const DRIVE_SOURCE_TAG_PREFIX = "source:drive:";

function driveSourceTag(fileId: string) {
  return `${DRIVE_SOURCE_TAG_PREFIX}${fileId}`;
}

function reportedDriveMatches(matches: DriveFile[]) {
  return matches.map(({ id, name }) => ({ id, name }));
}

function immichChecksumAsHex(checksum: string) {
  try {
    const bytes = Buffer.from(checksum, "base64");
    return bytes.length === 20 ? bytes.toString("hex").toLocaleLowerCase() : null;
  } catch {
    return null;
  }
}

function driveModifiedTimeDistanceMs(assetTime: string, driveTime?: string) {
  if (!driveTime) return Number.POSITIVE_INFINITY;
  const assetMs = Date.parse(assetTime);
  const driveMs = Date.parse(driveTime);
  if (!Number.isFinite(assetMs) || !Number.isFinite(driveMs)) {
    return Number.POSITIVE_INFINITY;
  }

  const localParts = new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.MEDIA_TIME_ZONE ?? "America/Toronto",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(driveMs));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(localParts.find((candidate) => candidate.type === type)?.value);
  const driveLocalWallTimeMs = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second"),
  );
  return Math.min(
    Math.abs(assetMs - driveMs),
    Math.abs(assetMs - driveLocalWallTimeMs),
  );
}

function selectDriveFilenameMatch(
  asset: ImmichAsset,
  lookup: { file?: DriveFile; matches: DriveFile[]; matchCount: number },
) {
  if (lookup.file) return { file: lookup.file, detail: null };

  const checksum = immichChecksumAsHex(asset.checksum);
  if (!checksum) return { file: null, detail: null };
  const checksumMatches = lookup.matches.filter(
    (file) => file.sha1Checksum?.trim().toLocaleLowerCase() === checksum,
  );
  if (checksumMatches.length === 0) {
    const timestampMatches = lookup.matches.filter(
      (file) => driveModifiedTimeDistanceMs(asset.fileCreatedAt, file.modifiedTime) <= 2_000,
    );
    return timestampMatches.length === 1
      ? {
          file: timestampMatches[0],
          detail: `resolved ${lookup.matchCount} source-name matches by capture timestamp`,
        }
      : { file: null, detail: null };
  }

  const orderedMatches = [...checksumMatches].sort((a, b) => {
    const aCreated = a.createdTime ?? a.modifiedTime ?? "9999";
    const bCreated = b.createdTime ?? b.modifiedTime ?? "9999";
    return aCreated.localeCompare(bCreated) || a.id.localeCompare(b.id);
  });
  return {
    file: orderedMatches[0],
    detail: checksumMatches.length === 1
      ? `resolved ${lookup.matchCount} filename matches by SHA-1 checksum`
      : `selected the oldest of ${checksumMatches.length} byte-identical Drive copies`,
  };
}

function tagValues(asset: ImmichAsset) {
  return Array.from(new Set(
    (asset.tags ?? [])
      .flatMap((tag) => [tag.name, tag.value])
      .map((value) => value.trim())
      .filter(Boolean),
  ));
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

function assetDriveSourceIds(asset: ImmichAsset) {
  return Array.from(new Set(tagValues(asset).filter((value) =>
    value.toLocaleLowerCase().startsWith(DRIVE_SOURCE_TAG_PREFIX),
  ).map((value) => value.slice(DRIVE_SOURCE_TAG_PREFIX.length))));
}

function assetPlacementIds(asset: ImmichAsset) {
  return Array.from(new Set(
    tagValues(asset)
      .map((value) => value.match(/^placement:(\d+)$/i)?.[1])
      .filter((value): value is string => Boolean(value)),
  )).map(Number);
}

function assetPlacementId(asset: ImmichAsset) {
  const placementIds = assetPlacementIds(asset);
  if (placementIds.length > 1) {
    throw new Error("This asset has multiple placement tags and cannot be safely matched to Google Drive.");
  }
  return placementIds[0] ?? null;
}

type DrivePlacement = Awaited<ReturnType<typeof getUploadConfig>>["placements"][number];

function drivePlacementTags(placement: DrivePlacement) {
  return [
    `placement:${placement.placement_id}`,
    placement.partner_name,
    placement.placement_name,
  ].map((value) => value.trim()).filter(Boolean);
}

function inferPlacementFromDriveFilePath(params: {
  path: DriveFolder[];
  placements: DrivePlacement[];
}) {
  const pathFolderIds = new Set(params.path.map((folder) => folder.id));
  const matches = params.placements.filter((placement) => {
    const folderId = placement.google_drive_folder_id?.trim();
    return Boolean(folderId && pathFolderIds.has(folderId));
  });
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `The matched Drive file path contains folders assigned to multiple Artasia sites (${matches.map((placement) => placement.placement_name).join(", ")}).`,
    );
  }
  return matches[0];
}

function inferActivityFromDriveFilePath(params: {
  path: DriveFolder[];
  placement: DrivePlacement | null;
  activities: ActivityConfig[];
}) {
  const placementFolderId = params.placement?.google_drive_folder_id?.trim();
  if (!placementFolderId) return null;
  const placementFolderIndex = params.path.findIndex(
    (folder) => folder.id === placementFolderId,
  );
  if (placementFolderIndex < 0) return null;
  return inferActivityFromDriveFolders(
    params.path.slice(placementFolderIndex + 1).map((folder) => folder.name),
    params.activities,
  );
}

async function canonicalizeDriveManagedTags(params: {
  assetId: string;
  fileId: string;
  placement: DrivePlacement | null;
  activity?: ActivityConfig;
}) {
  const [asset, config] = await Promise.all([
    getAsset(params.assetId),
    getUploadConfig(),
  ]);
  const configuredPlacementValues = new Set(
    config.placements
      .flatMap(drivePlacementTags)
      .map((value) => value.toLocaleLowerCase()),
  );
  const canonicalTags = [
    driveSourceTag(params.fileId),
    ...(params.placement ? drivePlacementTags(params.placement) : []),
    ...(params.activity ? [`activity:${params.activity.id}`, params.activity.label] : []),
  ];
  const canonicalValues = new Set(
    canonicalTags.map((value) => value.toLocaleLowerCase()),
  );
  const configuredActivityValues = params.activity
    ? new Set(config.activities.flatMap((activity) => [
        `activity:${activity.id}`,
        activity.label,
      ]).map((value) => value.trim().toLocaleLowerCase()))
    : null;
  const staleManagedTagIds = (asset.tags ?? [])
    .filter((tag) => [tag.name, tag.value].some((rawValue) => {
      const value = rawValue.trim().toLocaleLowerCase();
      return value.startsWith(DRIVE_SOURCE_TAG_PREFIX) ||
        /^placement:\d+$/.test(value) ||
        configuredPlacementValues.has(value) ||
        Boolean(configuredActivityValues && (
          /^activity:\d+$/.test(value) || configuredActivityValues.has(value)
        ));
    }))
    .filter((tag) => ![tag.name, tag.value].some((rawValue) =>
      canonicalValues.has(rawValue.trim().toLocaleLowerCase())))
    .map((tag) => tag.id);

  let verified = false;
  let verificationError: unknown;
  for (let attempt = 0; attempt < 2 && !verified; attempt += 1) {
    await tagAsset(params.assetId, canonicalTags);
    try {
      await waitForAssetTags(params.assetId, canonicalTags);
      verified = true;
    } catch (error) {
      verificationError = error;
    }
  }
  if (!verified) throw verificationError;

  if (staleManagedTagIds.length > 0) {
    await untagAssets([params.assetId], Array.from(new Set(staleManagedTagIds)));
  }
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
  placementId?: number;
  placementName?: string;
  placementTags?: string[];
  folderId?: string;
  folderName?: string;
  searchedFileName?: string;
  matches?: Array<{ id: string; name: string }>;
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
  const size = 500;
  for (const visibility of ["timeline", "archive"] as const) {
    let page = 1;
    for (;;) {
      const result = await searchAssets({ page, size, visibility });
      for (const asset of result.assets.items) byId.set(asset.id, asset);
      if (!result.assets.nextPage || result.assets.items.length < size) break;
      page += 1;
    }
  }
  return Array.from(byId.values());
}

async function resolveAmbiguousPlacementFromDrive(params: {
  client: GoogleDriveClient;
  asset: ImmichAsset;
  placements: DrivePlacement[];
}) {
  const candidates = params.placements.filter(
    (placement) => Boolean(placement.google_drive_folder_id?.trim()),
  );
  const lookups = await Promise.all(candidates.map(async (placement) => ({
    placement,
    lookup: await params.client.findUniqueFileInFolderTree(
      placement.google_drive_folder_id!.trim(),
      driveSourceSearchFilename(params.asset.originalFileName),
    ),
  })));
  const evaluated = lookups.map(({ placement, lookup }) => ({
    placement,
    lookup,
    selection: selectDriveFilenameMatch(params.asset, lookup),
  }));
  const unresolvedAmbiguities = evaluated.filter(
    ({ lookup, selection }) => lookup.matchCount > 0 && !selection.file,
  );
  const uniqueMatches = evaluated.filter(({ selection }) => Boolean(selection.file));
  if (unresolvedAmbiguities.length > 0 || uniqueMatches.length !== 1) {
    return {
      resolved: null,
      matchCount: lookups.reduce((total, { lookup }) => total + lookup.matchCount, 0),
    };
  }
  return {
    resolved: uniqueMatches[0],
    matchCount: 1,
  };
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
      {
        folderId: string;
        placementId: number | null;
        placementName: string | null;
        asset: ImmichAsset;
      }[]
    >();
    let globalDocumentationFolder: DriveFolder | null = null;
    let candidates = 0;

    for (const listedAsset of assets) {
      let asset = listedAsset;
      if (!Array.isArray(asset.tags)) {
        asset = await getAsset(asset.id);
      }

      const existingSourceIds = assetDriveSourceIds(asset);
      if (existingSourceIds.length === 1) continue;

      let placementId: number | null;
      try {
        placementId = assetPlacementId(asset);
      } catch (err) {
        const ambiguousPlacements = assetPlacementIds(asset)
          .map((id) => placementsById.get(id))
          .filter((placement): placement is DrivePlacement => Boolean(placement));
        try {
          const resolution = await resolveAmbiguousPlacementFromDrive({
            client,
            asset,
            placements: ambiguousPlacements,
          });
          if (resolution.resolved?.selection.file) {
            const { placement, selection } = resolution.resolved;
            const file = selection.file;
            candidates += 1;
            await canonicalizeDriveManagedTags({
              assetId: asset.id,
              fileId: file.id,
              placement,
            });
            results.push({
              assetId: asset.id,
              fileName: asset.originalFileName,
              status: "linked",
              placementId: placement.placement_id,
              placementName: placement.placement_name,
              folderId: placement.google_drive_folder_id?.trim(),
              searchedFileName: driveSourceSearchFilename(asset.originalFileName),
              fileId: file.id,
              driveFileName: `${file.name} (${selection.detail ?? "resolved conflicting placement and Drive tags"})`,
            });
            continue;
          }
          results.push({
            assetId: asset.id,
            fileName: asset.originalFileName,
            status: resolution.matchCount > 0 ? "ambiguous" : "skipped",
            placementTags: tagValues(asset).filter((value) => /^placement:/i.test(value)),
            error: resolution.matchCount > 0
              ? `Multiple tagged sites contain a possible match for this filename (${resolution.matchCount} matches).`
              : "None of the asset's tagged sites contains a unique matching Drive file.",
          });
        } catch (resolutionError) {
          results.push({
            assetId: asset.id,
            fileName: asset.originalFileName,
            status: "failed",
            placementTags: tagValues(asset).filter((value) => /^placement:/i.test(value)),
            error: (resolutionError as Error).message,
          });
        }
        continue;
      }
      if (placementId == null) {
        globalDocumentationFolder ??= await client.getProjectDocumentationFolder();
        candidates += 1;
        const group = groupedCandidates.get(globalDocumentationFolder.id) ?? [];
        group.push({
          folderId: globalDocumentationFolder.id,
          placementId: null,
          placementName: null,
          asset,
        });
        groupedCandidates.set(globalDocumentationFolder.id, group);
        continue;
      }
      const placement = placementsById.get(placementId);
      const placementName = placement?.placement_name ?? "Unknown placement";
      const folderId = placement?.google_drive_folder_id?.trim();
      if (!folderId) {
        results.push({
          assetId: asset.id,
          fileName: asset.originalFileName,
          status: "skipped",
          placementId,
          placementName,
          error: "The asset's Artasia site does not have a Google Drive folder configured.",
        });
        continue;
      }

      candidates += 1;
      const group = groupedCandidates.get(folderId) ?? [];
      group.push({ folderId, placementId, placementName, asset });
      groupedCandidates.set(folderId, group);
    }

    for (const [folderId, group] of groupedCandidates) {
      let lookups: Array<{
        filename: string;
        folderName: string;
        file?: DriveFile;
        matches: DriveFile[];
        matchCount: number;
      }>;
      try {
        lookups = await client.findUniqueFilesInFolderTree(
          folderId,
          group.map(({ asset }) => driveSourceSearchFilename(asset.originalFileName)),
        );
      } catch (err) {
        for (const { asset, placementId, placementName } of group) {
          results.push({
            assetId: asset.id,
            fileName: asset.originalFileName,
            status: "failed",
            ...(placementId == null ? {} : { placementId }),
            ...(placementName == null ? {} : { placementName }),
            folderId,
            searchedFileName: driveSourceSearchFilename(asset.originalFileName),
            error: (err as Error).message,
          });
        }
        continue;
      }

      const lookupByFilename = new Map(lookups.map((lookup) => [lookup.filename, lookup]));
      for (const { asset, placementId, placementName } of group) {
        const searchedFileName = driveSourceSearchFilename(asset.originalFileName);
        const lookup = lookupByFilename.get(searchedFileName) ?? {
          filename: searchedFileName,
          folderName: "Unknown folder",
          file: undefined,
          matches: [],
          matchCount: 0,
        };
        if (lookup.matchCount === 0) {
          results.push({
            assetId: asset.id,
            fileName: asset.originalFileName,
            status: "not-found",
            ...(placementId == null ? {} : { placementId }),
            ...(placementName == null ? {} : { placementName }),
            folderId,
            folderName: lookup.folderName,
            searchedFileName: lookup.filename,
            matches: [],
          });
          continue;
        }
        const selection = selectDriveFilenameMatch(asset, lookup);
        if (!selection.file) {
          results.push({
            assetId: asset.id,
            fileName: asset.originalFileName,
            status: "ambiguous",
            ...(placementId == null ? {} : { placementId }),
            ...(placementName == null ? {} : { placementName }),
            folderId,
            folderName: lookup.folderName,
            searchedFileName: lookup.filename,
            matches: reportedDriveMatches(lookup.matches),
            error: `Found ${lookup.matchCount} matching files in the ${placementId == null ? "project Documentation" : "site's"} Google Drive folder.`,
          });
          continue;
        }

        try {
          const parentId = selection.file.parents?.[0];
          const drivePath = parentId ? await client.getFolderPath(parentId) : [];
          const resolvedPlacement = placementId == null
            ? inferPlacementFromDriveFilePath({
                path: drivePath,
                placements: config.placements,
              })
            : placementsById.get(placementId) ?? null;
          const inferredActivity = inferActivityFromDriveFilePath({
            path: drivePath,
            placement: resolvedPlacement,
            activities: config.activities,
          });
          await canonicalizeDriveManagedTags({
            assetId: asset.id,
            fileId: selection.file.id,
            placement: resolvedPlacement,
            ...(inferredActivity ? { activity: inferredActivity } : {}),
          });
          results.push({
            assetId: asset.id,
            fileName: asset.originalFileName,
            status: "linked",
            placementId: resolvedPlacement?.placement_id,
            placementName: resolvedPlacement?.placement_name,
            folderId,
            folderName: lookup.folderName,
            searchedFileName: lookup.filename,
            matches: reportedDriveMatches(lookup.matches),
            fileId: selection.file.id,
            driveFileName: assetDriveSourceIds(asset).length > 1
              ? `${selection.file.name} (replaced ${assetDriveSourceIds(asset).length} conflicting Drive IDs${selection.detail ? `; ${selection.detail}` : ""})`
              : selection.detail
                ? `${selection.file.name} (${selection.detail})`
                : selection.file.name,
          });
        } catch (err) {
          results.push({
            assetId: asset.id,
            fileName: asset.originalFileName,
            status: "failed",
            ...(placementId == null ? {} : { placementId }),
            ...(placementName == null ? {} : { placementName }),
            folderId,
            folderName: lookup.folderName,
            searchedFileName: lookup.filename,
            matches: reportedDriveMatches(lookup.matches),
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
        console.info(
          `[Drive maintenance] scanned=${summary.scanned} candidates=${summary.candidates} linked=${summary.linked} notFound=${summary.notFound} ambiguous=${summary.ambiguous} skipped=${summary.skipped} failed=${summary.failed}`,
        );
        console.table(summary.results.map((result) => ({
          status: result.status,
          assetId: result.assetId,
          fileName: result.fileName,
          placement: result.placementName
            ? `${result.placementName} (${result.placementId ?? "?"})`
            : result.placementTags?.join(", "),
          folder: result.folderName
            ? `${result.folderName} (${result.folderId ?? "?"})`
            : result.folderId,
          searchedFileName: result.searchedFileName,
          matches: result.matches?.map((match) => `${match.name} (${match.id})`).join(" | "),
          detail: result.error ?? result.driveFileName ?? "",
        })));
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

/**
 * POST /api/v1/drive/folders/stats
 * Count direct files, immediate subfolders, and files one level below several
 * folders. Deeper descendants are intentionally excluded.
 */
router.post("/folders/stats", async (req: Request, res: Response) => {
  const requestedFolderIds: unknown[] | null = Array.isArray(req.body?.folderIds)
    ? req.body.folderIds as unknown[]
    : null;
  if (!requestedFolderIds) {
    res.status(400).json({ error: "folderIds must be an array." });
    return;
  }
  const folderIds = Array.from(
    new Set(
      requestedFolderIds
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  );
  if (folderIds.length === 0 || folderIds.length > 50) {
    res.status(400).json({
      error: "Request stats for between 1 and 50 unique folders.",
    });
    return;
  }
  const driveId =
    typeof req.body?.driveId === "string" && req.body.driveId.trim()
      ? req.body.driveId.trim()
      : undefined;

  try {
    const client = getDriveClient(req);
    const stats = await client.getFolderStats(folderIds, driveId);
    res.json({ stats });
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

  return null;
}

async function replaceImportedAsset(
  source: ImmichAsset,
  targetAssetId: string,
  canonical: { fileId: string; placement: DrivePlacement | null },
) {
  if (source.id === targetAssetId) {
    await canonicalizeDriveManagedTags({
      assetId: targetAssetId,
      fileId: canonical.fileId,
      placement: canonical.placement,
    });
    return;
  }

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
  await canonicalizeDriveManagedTags({
    assetId: targetAssetId,
    fileId: canonical.fileId,
    placement: canonical.placement,
  });
  await deleteAssets([source.id]);
}

async function importDriveFile(params: {
  client: GoogleDriveClient;
  fileId: string;
  placementId?: number | null;
  placement: DrivePlacement | null;
  activityTags: string[];
  forceAudio?: boolean;
  replacementAsset?: ImmichAsset;
}): Promise<DriveSyncResult> {
  let fileName = "Unknown";
  try {
    const fileInfo = await params.client.getFileInfo(params.fileId);
    fileName = fileInfo.name;
    const uploadFileName = ensureDriveFileExtension(fileInfo.name, fileInfo.mimeType);
    if (!fileInfo.isSupported) {
      return { fileId: params.fileId, fileName, status: "failed", error: `Unsupported file type: ${fileInfo.mimeType}` };
    }
    if (params.forceAudio && !fileInfo.isVideo) {
      return {
        fileId: params.fileId,
        fileName,
        status: "failed",
        error: `The linked Drive file is not a video (${fileInfo.mimeType}).`,
      };
    }
    const importAsAudio = fileInfo.isAudio || params.forceAudio === true;
    if (importAsAudio && fileInfo.size && fileInfo.size > UPLOAD_LIMITS.maxFileBytes) {
      return { fileId: params.fileId, fileName, status: "failed", error: `Audio file exceeds the ${Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))}MB limit` };
    }
    if (fileInfo.size && fileInfo.size > 10 * 1024 * 1024 * 1024) {
      return { fileId: params.fileId, fileName, status: "failed", error: "File exceeds 10GB limit" };
    }

    const stream = await params.client.downloadFile(params.fileId);
    const deviceAssetId = `artasia-galaxy:drive:${params.fileId}`;
    const fileDate = fileInfo.modifiedTime ? new Date(fileInfo.modifiedTime) : undefined;
    let uploadResult;
    const replacement = params.replacementAsset ?? await findDriveImportReplacement({
      fileId: params.fileId,
    });
    if (importAsAudio) {
      console.log(`[Drive] converting ${params.forceAudio ? "video's audio track" : "audio file"} ${params.fileId} to audio artwork MP4`);
      const prepared = await prepareAudioAsVideo({ stream, originalName: uploadFileName });
      try {
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
      ...(params.placement ? drivePlacementTags(params.placement) : []),
      ...params.activityTags,
      driveSourceTag(params.fileId),
      ...(importAsAudio ? ["media:audio"] : []),
    ];
    await tagAsset(uploadResult.id, allTags);
    await waitForAssetTags(uploadResult.id, allTags, {
      requireAudioDuration: importAsAudio,
    });
    if (replacement) {
      await replaceImportedAsset(replacement, uploadResult.id, {
        fileId: params.fileId,
        placement: params.placement,
      });
    }
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
    const existingSourceIds = assetDriveSourceIds(asset);
    if (existingSourceIds.length === 1) {
      res.json({ status: "already-linked", fileId: existingSourceIds[0] });
      return;
    }

    const placementId = assetPlacementId(asset);
    const config = await getUploadConfig();
    const placement = placementId == null
      ? null
      : config.placements.find((candidate) => candidate.placement_id === placementId) ?? null;
    const globalFolder = placementId == null
      ? await client.getProjectDocumentationFolder()
      : null;
    const folderId = placement?.google_drive_folder_id?.trim() ?? globalFolder?.id;
    if (!folderId) {
      res.status(400).json({ error: "This Artasia site does not have a Google Drive folder configured." });
      return;
    }

    const lookup = await client.findUniqueFileInFolderTree(folderId, asset.originalFileName);
    if (lookup.matchCount === 0) {
      res.json({ status: "not-found" });
      return;
    }
    const selection = selectDriveFilenameMatch(asset, lookup);
    if (!selection.file) {
      res.status(409).json({
        error: `Found ${lookup.matchCount} matching files in the ${placement ? "site's" : "project Documentation"} Google Drive folder. The asset was not linked.`,
      });
      return;
    }

    const parentId = selection.file.parents?.[0];
    const drivePath = parentId ? await client.getFolderPath(parentId) : [];
    const resolvedPlacement = placement ?? inferPlacementFromDriveFilePath({
      path: drivePath,
      placements: config.placements,
    });
    const inferredActivity = inferActivityFromDriveFilePath({
      path: drivePath,
      placement: resolvedPlacement,
      activities: config.activities,
    });
    await canonicalizeDriveManagedTags({
      assetId: asset.id,
      fileId: selection.file.id,
      placement: resolvedPlacement,
      ...(inferredActivity ? { activity: inferredActivity } : {}),
    });
    res.json({
      status: "linked",
      fileId: selection.file.id,
      fileName: selection.file.name,
      resolution: selection.detail,
      scope: placement ? "site" : "project-documentation",
      placementId: resolvedPlacement?.placement_id,
      placementName: resolvedPlacement?.placement_name,
      activityId: inferredActivity?.id,
      activityLabel: inferredActivity?.label,
    });
  } catch (err) {
    res
      .status(err instanceof Error && err.message.includes("Not authenticated") ? 401 : 500)
      .json({ error: (err as Error).message });
  }
});

/** Reimport one Drive-linked asset, preserving its relationships and replacing its old copy. */
router.post("/assets/:assetId/reimport", async (req: Request, res: Response) => {
  try {
    const client = getDriveClient(req);
    const assetId = Array.isArray(req.params.assetId) ? req.params.assetId[0] : req.params.assetId;
    const asset = await getAsset(assetId.trim());
    const forceAudio = req.body?.asAudio === true;
    if (forceAudio && asset.type !== "VIDEO") {
      res.status(400).json({ error: "Only video assets can be reimported as audio." });
      return;
    }
    if (forceAudio && isAudioAsset(asset)) {
      res.status(400).json({ error: "This asset is already classified as audio." });
      return;
    }
    const requestedPlacementId = Number(req.body?.placementId);
    const placementId = Number.isSafeInteger(requestedPlacementId) && requestedPlacementId > 0
      ? requestedPlacementId
      : assetPlacementId(asset);
    if (placementId == null) {
      res.status(400).json({
        error: "Select one Artasia site in the asset editor before reimporting this ambiguous asset.",
      });
      return;
    }
    const config = await getUploadConfig();
    const placement = config.placements.find((candidate) => candidate.placement_id === placementId);
    if (!placement) {
      res.status(400).json({ error: "This asset's Artasia site is no longer configured." });
      return;
    }
    const sourceIds = assetDriveSourceIds(asset);
    let fileId = sourceIds.length === 1 ? sourceIds[0] : null;
    if (!fileId) {
      const folderId = placement.google_drive_folder_id?.trim();
      if (!folderId) {
        res.status(400).json({
          error: "The selected Artasia site does not have a Google Drive folder configured.",
        });
        return;
      }
      const lookup = await client.findUniqueFileInFolderTree(folderId, asset.originalFileName);
      const selection = selectDriveFilenameMatch(asset, lookup);
      if (!selection.file) {
        res.status(409).json({
          error: lookup.matchCount === 0
            ? "No matching file was found in the selected site's Google Drive folder."
            : `Found ${lookup.matchCount} matching files in the selected site's Google Drive folder.`,
        });
        return;
      }
      fileId = selection.file.id;
    }
    const activityId = assetActivityId(asset);
    const activity = activityId == null
      ? null
      : config.activities.find((candidate) => candidate.id === activityId) ?? null;
    const result = await importDriveFile({
      client,
      fileId,
      placementId,
      placement,
      activityTags: activity ? [`activity:${activity.id}`, activity.label] : [],
      forceAudio,
      replacementAsset: asset,
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
    let activityTags: string[] = [];
    let placementConfig: (typeof config.placements)[number] | null = null;

    if (placementId !== null && placementId !== undefined) {
      placementConfig = config.placements.find(
        (p) => p.placement_id === placementId
      ) ?? null;
      if (!placementConfig) {
        res.status(400).json({ error: "Invalid placement ID" });
        return;
      }
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
        placement: placementConfig,
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
