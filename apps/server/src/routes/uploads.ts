import { mkdirSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { Router } from "express";
import multer from "multer";
import {
  addAssetsToAlbum,
  ensureAlbum,
  getAsset,
  getServerStatistics,
  listAlbums,
  listTags,
  removeAssetsFromAlbum,
  searchAssets,
  searchAssetIdsByTag,
  tagAsset,
  untagAssets,
  updateAssetLocation,
  uploadAsset,
} from "../infra/ImmichClient.js";
import { uploadRateLimit } from "../middleware/uploadRateLimit.js";
import { getAuthContext } from "../services/auth.service.js";
import {
  findConfiguredPlacement,
  findConfiguredUploader,
  getPlacementTagNames,
  getAllowedTagNames,
  getUploadConfig,
  placementAnchorTag,
} from "../services/uploadConfig.service.js";
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  ALLOWED_UPLOAD_MIME_TYPES,
  UPLOAD_LIMITS,
} from "../services/uploadLimits.js";

const router = Router();
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const UPLOAD_TMP_DIR = join(DATA_DIR, "upload-tmp");

mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_TMP_DIR,
  limits: {
    files: UPLOAD_LIMITS.maxFiles,
    fileSize: UPLOAD_LIMITS.maxFileBytes,
  },
});

interface UploadFileResult {
  fileName: string;
  status: "completed" | "failed";
  assetId?: string;
  error?: string;
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
}

function cleanup(file: Express.Multer.File) {
  try {
    unlinkSync(file.path);
  } catch {
    // temp cleanup best effort
  }
}

function validateFile(file: Express.Multer.File) {
  const extension = extname(file.originalname).toLowerCase();
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) {
    return `Unsupported file type: ${file.mimetype}`;
  }
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
    return `Unsupported file extension: ${extension || "(none)"}`;
  }
  return null;
}

function hasGps(asset: Awaited<ReturnType<typeof getAsset>>) {
  return asset.exifInfo?.latitude != null && asset.exifInfo?.longitude != null;
}

function placementIncludesUploader(location: Awaited<ReturnType<typeof findConfiguredPlacement>>, uploaderId: number) {
  return location?.team_member?.id === uploaderId || location?.secondary_team_member?.id === uploaderId;
}

async function applyDefaultLocationIfMissing(assetId: string, location: {
  lat?: number;
  lng?: number;
}) {
  if (location.lat == null || location.lng == null || (location.lat === 0 && location.lng === 0)) return;
  const asset = await getAsset(assetId);
  if (hasGps(asset)) return;
  await updateAssetLocation(assetId, {
    latitude: location.lat,
    longitude: location.lng,
  });
}

async function processWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(workers);
  return results;
}

async function findExistingPlacementTagId(placementId: number) {
  const tagName = placementAnchorTag(placementId);
  const normalized = tagName.toLowerCase();
  const tags = await listTags();
  return tags.find(
    (tag) => tag.name.trim().toLowerCase() === normalized || tag.value.trim().toLowerCase() === normalized
  )?.id ?? null;
}

function isPlacementAnchorTagName(value: string) {
  return /^placement:\d+$/.test(value.trim().toLowerCase());
}

async function getExistingPlacementTagIds() {
  const tags = await listTags();
  return tags
    .filter((tag) => isPlacementAnchorTagName(tag.name) || isPlacementAnchorTagName(tag.value))
    .map((tag) => tag.id);
}

async function getAssetsForPlacementTagIds(tagIds: string[]) {
  const byId = new Map<string, Awaited<ReturnType<typeof searchAssets>>["assets"]["items"][number]>();
  const size = 100;
  for (const tagId of tagIds) {
    for (const type of ["IMAGE", "VIDEO"] as const) {
      let page = 1;
      for (;;) {
        const result = await searchAssets({ tagIds: [tagId], page, size, type });
        for (const asset of result.assets.items) byId.set(asset.id, asset);
        if (!result.assets.nextPage || result.assets.items.length < size) break;
        page += 1;
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.fileCreatedAt.localeCompare(a.fileCreatedAt));
}

interface UploaderAlbum {
  id: string;
  uploaderId: number;
  uploaderName: string;
}

function mapAdminAsset(
  asset: Awaited<ReturnType<typeof getAssetsForPlacementTagIds>>[number],
  uploaderAlbum?: UploaderAlbum
) {
  return {
    id: asset.id,
    type: asset.type,
    fileName: asset.originalFileName,
    createdAt: asset.fileCreatedAt,
    updatedAt: asset.updatedAt,
    archived: asset.isArchived,
    trashed: Boolean(asset.isTrashed),
    uploader_id: uploaderAlbum?.uploaderId ?? null,
    uploader_name: uploaderAlbum?.uploaderName ?? null,
    uploader_album_id: uploaderAlbum?.id ?? null,
    thumbnailUrl: `/api/v1/assets/${asset.id}/thumbnail`,
    previewUrl: `/api/v1/assets/${asset.id}/preview`,
  };
}

async function searchAssetsByAlbumId(albumId: string) {
  const byId = new Map<string, Awaited<ReturnType<typeof searchAssets>>["assets"]["items"][number]>();
  const size = 100;
  for (const type of ["IMAGE", "VIDEO"] as const) {
    let page = 1;
    for (;;) {
      const result = await searchAssets({ albumIds: [albumId], page, size, type });
      for (const asset of result.assets.items) byId.set(asset.id, asset);
      if (!result.assets.nextPage || result.assets.items.length < size) break;
      page += 1;
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.fileCreatedAt.localeCompare(a.fileCreatedAt));
}

async function searchAllImmichAssets() {
  const byId = new Map<string, Awaited<ReturnType<typeof searchAssets>>["assets"]["items"][number]>();
  const size = 100;
  for (const type of ["IMAGE", "VIDEO"] as const) {
    let page = 1;
    for (;;) {
      const result = await searchAssets({ page, size, type });
      for (const asset of result.assets.items) byId.set(asset.id, asset);
      if (!result.assets.nextPage || result.assets.items.length < size) break;
      page += 1;
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.fileCreatedAt.localeCompare(a.fileCreatedAt));
}

async function getUploaderAlbums(): Promise<UploaderAlbum[]> {
  const config = await getUploadConfig();
  const uploadersByName = new Map(config.uploaders.map((uploader) => [uploader.name.trim().toLowerCase(), uploader]));
  const albums = await listAlbums();
  return albums
    .map((album) => {
      const uploader = uploadersByName.get(album.albumName.trim().toLowerCase());
      return uploader
        ? {
            id: album.id,
            uploaderId: uploader.id,
            uploaderName: uploader.name,
          }
        : null;
    })
    .filter((album): album is UploaderAlbum => Boolean(album));
}

async function getUploaderAlbumAssignments(uploaderAlbums: UploaderAlbum[]) {
  const assignments = new Map<string, UploaderAlbum>();
  for (const album of uploaderAlbums) {
    const assets = await searchAssetsByAlbumId(album.id);
    for (const asset of assets) assignments.set(asset.id, album);
  }
  return assignments;
}

async function getUploaderAlbumMemberships(assetId: string, uploaderAlbums: UploaderAlbum[]) {
  const memberships: UploaderAlbum[] = [];
  for (const album of uploaderAlbums) {
    const assets = await searchAssetsByAlbumId(album.id);
    if (assets.some((asset) => asset.id === assetId)) memberships.push(album);
  }
  return memberships;
}

async function mapAssetsWithUploaderAlbums(assets: Awaited<ReturnType<typeof getAssetsForPlacementTagIds>>) {
  const uploaderAlbums = await getUploaderAlbums();
  const assignments = await getUploaderAlbumAssignments(uploaderAlbums);
  return assets.map((asset) => mapAdminAsset(asset, assignments.get(asset.id)));
}

router.get("/options", async (req, res) => {
  try {
    const [config, auth] = await Promise.all([getUploadConfig(), getAuthContext(req)]);
    res.json({
      ...config,
      currentUser: auth.authenticated
        ? {
            authenticated: true,
            email: auth.email,
            name: auth.name,
            uploader_id: auth.uploader?.id ?? null,
            uploader_name: auth.uploader?.name ?? null,
          }
        : null,
      limits: {
        maxFiles: UPLOAD_LIMITS.maxFiles,
        maxFileBytes: UPLOAD_LIMITS.maxFileBytes,
        maxBatchBytes: UPLOAD_LIMITS.maxBatchBytes,
      },
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.get("/assets", async (req, res) => {
  try {
    const rawPlacementIds = typeof req.query.placement_ids === "string" ? req.query.placement_ids : "";
    const placementIds = rawPlacementIds
      .split(",")
      .map((value) => parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value));

    if (placementIds.length === 0) {
      res.json({ assets: [] });
      return;
    }

    const activityTagName = typeof req.query.activity_tag === "string" ? req.query.activity_tag.trim() : "";

    const config = await getUploadConfig();
    const knownPlacementIds = new Set(config.placements.map((placement) => placement.placement_id));
    const tagIds = (
      await Promise.all(
        placementIds
          .filter((placementId) => knownPlacementIds.has(placementId))
          .map((placementId) => findExistingPlacementTagId(placementId))
      )
    ).filter((tagId): tagId is string => Boolean(tagId));

    if (tagIds.length === 0) {
      res.json({ assets: [] });
      return;
    }

    let assets = await getAssetsForPlacementTagIds(tagIds);

    if (activityTagName) {
      const normalized = activityTagName.toLowerCase();
      const allTags = await listTags();
      const activityTagId = allTags.find(
        (tag) => tag.name.trim().toLowerCase() === normalized || tag.value.trim().toLowerCase() === normalized
      )?.id ?? null;
      if (activityTagId) {
        const activityAssetIds = new Set(await searchAssetIdsByTag(activityTagId));
        assets = assets.filter((asset) => activityAssetIds.has(asset.id));
      } else {
        assets = [];
      }
    }

    res.json({ assets: await mapAssetsWithUploaderAlbums(assets) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.get("/assets/untagged", async (_req, res) => {
  try {
    const [uploaderAlbums, placementTagIds] = await Promise.all([
      getUploaderAlbums(),
      getExistingPlacementTagIds(),
    ]);

    const [allAssets, taggedAssets] = await Promise.all([
      searchAllImmichAssets(),
      getAssetsForPlacementTagIds(placementTagIds),
    ]);

    const taggedAssetIds = new Set(taggedAssets.map((asset) => asset.id));
    const untaggedAssets = allAssets
      .filter((asset) => !taggedAssetIds.has(asset.id))
      .sort((a, b) => b.fileCreatedAt.localeCompare(a.fileCreatedAt));

    const assignments = await getUploaderAlbumAssignments(uploaderAlbums);
    res.json({ assets: untaggedAssets.map((asset) => mapAdminAsset(asset, assignments.get(asset.id))) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post("/assets/:assetId/placement", async (req, res) => {
  try {
    const placementId = parseInt(String(req.body?.placement_id ?? ""), 10);
    if (!Number.isFinite(placementId)) {
      res.status(400).json({ error: "Select a valid placement." });
      return;
    }

    const placement = await findConfiguredPlacement(placementId);
    if (!placement) {
      res.status(404).json({ error: "Placement was not found." });
      return;
    }

    const assetId = req.params.assetId;
    await getAsset(assetId);

    const existingPlacementTagIds = await getExistingPlacementTagIds();
    await untagAssets([assetId], existingPlacementTagIds);
    await tagAsset(assetId, getPlacementTagNames(placement));
    await applyDefaultLocationIfMissing(assetId, {
      lat: placement.place?.lat,
      lng: placement.place?.lng,
    });

    res.json({
      ok: true,
      asset_id: assetId,
      placement_id: placementId,
      tags: getPlacementTagNames(placement),
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post("/assets/:assetId/uploader", async (req, res) => {
  try {
    const uploaderId = parseInt(String(req.body?.uploader_id ?? ""), 10);
    if (!Number.isFinite(uploaderId)) {
      res.status(400).json({ error: "Select a valid team member." });
      return;
    }

    const selectedUploader = await findConfiguredUploader({ id: uploaderId });
    if (!selectedUploader) {
      res.status(404).json({ error: "Team member was not found." });
      return;
    }

    const assetId = req.params.assetId;
    await getAsset(assetId);

    const [uploaderAlbums, destinationAlbum] = await Promise.all([
      getUploaderAlbums(),
      ensureAlbum(selectedUploader.name),
    ]);

    const currentAlbums = await getUploaderAlbumMemberships(assetId, uploaderAlbums);
    for (const currentAlbum of currentAlbums) {
      if (currentAlbum.id !== destinationAlbum.id) {
        await removeAssetsFromAlbum(currentAlbum.id, [assetId]);
      }
    }
    await addAssetsToAlbum(destinationAlbum.id, [assetId]);

    res.json({
      ok: true,
      asset_id: assetId,
      uploader_id: selectedUploader.id,
      uploader_name: selectedUploader.name,
      uploader_album_id: destinationAlbum.id,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.get("/placements/:id/assets", async (req, res) => {
  try {
    const placementId = parseInt(req.params.id, 10);
    if (!Number.isFinite(placementId)) {
      res.status(400).json({ error: "Select a valid placement." });
      return;
    }

    const placement = await findConfiguredPlacement(placementId);
    if (!placement) {
      res.status(404).json({ error: "Placement was not found." });
      return;
    }

    const tagId = await findExistingPlacementTagId(placementId);
    if (!tagId) {
      res.json({ placement_id: placementId, assets: [] });
      return;
    }

    const assets = await getAssetsForPlacementTagIds([tagId]);
    res.json({
      placement_id: placementId,
      assets: await mapAssetsWithUploaderAlbums(assets),
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post(
  "/",
  uploadRateLimit,
  upload.array("files", UPLOAD_LIMITS.maxFiles),
  async (req, res) => {
    const files = (req.files ?? []) as Express.Multer.File[];

    try {
      const uploader = typeof req.body.uploader === "string" ? req.body.uploader.trim() : "";
      const uploader_id = parseInt(typeof req.body.uploader_id === "string" ? req.body.uploader_id.trim() : "", 10);
      const placement_id = parseInt(typeof req.body.placement_id === "string" ? req.body.placement_id.trim() : "", 10);
      const [location, selectedUploader] = await Promise.all([
        findConfiguredPlacement(placement_id),
        findConfiguredUploader({
          id: Number.isFinite(uploader_id) ? uploader_id : undefined,
          name: uploader,
        }),
      ]);
      const selectedTags = await getAllowedTagNames(parseTags(req.body.tags));

      if (!selectedUploader) {
        res.status(400).json({ error: "Select a valid uploader." });
        return;
      }

      if (!location) {
        res.status(400).json({ error: "Select a valid placement." });
        return;
      }

      if (!placementIncludesUploader(location, selectedUploader.id)) {
        res.status(400).json({ error: "Select a placement assigned to the selected uploader." });
        return;
      }

      if (files.length === 0) {
        res.status(400).json({ error: "Add at least one file." });
        return;
      }

      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > UPLOAD_LIMITS.maxBatchBytes) {
        res.status(413).json({ error: "Upload batch is too large." });
        return;
      }

      const stats = await getServerStatistics();
      if (stats.usage > UPLOAD_LIMITS.maxImmichUsageBytes) {
        res.status(503).json({
          error: "Uploads are temporarily disabled because Immich storage is above the configured limit.",
        });
        return;
      }

      const album = await ensureAlbum(selectedUploader.name);
      const tagNames = [...selectedTags, ...getPlacementTagNames(location)];

      const results = await processWithConcurrency(files, 2, async (file) => {
        const validationError = validateFile(file);
        if (validationError) {
          cleanup(file);
          return {
            fileName: file.originalname,
            status: "failed",
            error: validationError,
          } satisfies UploadFileResult;
        }

        try {
          const uploaded = await uploadAsset({
            filePath: file.path,
            filename: file.originalname,
            mimeType: file.mimetype,
          });

          await applyDefaultLocationIfMissing(uploaded.id, {
            lat: location.place?.lat,
            lng: location.place?.lng,
          });
          await tagAsset(uploaded.id, tagNames);
          await addAssetsToAlbum(album.id, [uploaded.id]);

          return {
            fileName: file.originalname,
            status: "completed",
            assetId: uploaded.id,
          } satisfies UploadFileResult;
        } catch (err) {
          return {
            fileName: file.originalname,
            status: "failed",
            error: (err as Error).message,
          } satisfies UploadFileResult;
        } finally {
          cleanup(file);
        }
      });

      res.json({
        uploader: selectedUploader.name,
        uploader_id: selectedUploader.id,
        placement_id,
        tags: tagNames,
        results,
      });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    } finally {
      for (const file of files) cleanup(file);
    }
  }
);

export default router;
