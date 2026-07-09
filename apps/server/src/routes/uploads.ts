import { mkdirSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { Router } from "express";
import multer from "multer";
import {
  addAssetsToAlbum,
  deleteAssets,
  editAsset,
  ensureAlbum,
  getAsset,
  getAssetEdits,
  getPublishedAlbum,
  getServerStatistics,
  listAlbums,
  listTags,
  removeAssetsFromAlbum,
  removeAssetEdits,
  searchAssets,
  searchAssetIdsByTag,
  tagAsset,
  untagAssets,
  updateAssetDescription,
  updateAssetLocation,
  uploadAsset,
} from "../infra/ImmichClient.js";
import { uploadRateLimit } from "../middleware/uploadRateLimit.js";
import {
  DEFAULT_ASSET_ADJUSTMENTS,
  getAssetAdjustmentMap,
  getAssetAdjustments,
  saveAssetAdjustments,
  type AssetAdjustments,
} from "../services/assetAdjustments.service.js";
import { getAuthContext } from "../services/auth.service.js";
import {
  findConfiguredPlacement,
  findConfiguredUploader,
  getPlacementTagNames,
  getActivityTagNames,
  getUploadConfig,
  placementAnchorTag,
  activityAnchorTag,
  isActivityAnchorTagName,
} from "../services/uploadConfig.service.js";
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  ALLOWED_UPLOAD_MIME_TYPES,
  GENERIC_UPLOAD_MIME_TYPES,
  HEIC_UPLOAD_EXTENSIONS,
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
  const hasAllowedExtension = ALLOWED_UPLOAD_EXTENSIONS.has(extension);
  const hasAllowedMimeType = ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype);
  const isGenericHeicUpload =
    HEIC_UPLOAD_EXTENSIONS.has(extension) &&
    GENERIC_UPLOAD_MIME_TYPES.has(file.mimetype);

  if (!hasAllowedMimeType && !isGenericHeicUpload) {
    return `Unsupported file type: ${file.mimetype}`;
  }
  if (!hasAllowedExtension) {
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

async function getConfiguredPlacementAssignmentTagIds() {
  const config = await getUploadConfig();
  const placementTagNames = new Set(
    config.placements.flatMap((placement) => [
      placementAnchorTag(placement.placement_id),
      placement.partner_name,
      placement.placement_name,
    ])
      .map((name) => name.trim().toLowerCase())
      .filter(Boolean)
  );
  const tags = await listTags();
  return tags
    .filter((tag) =>
      placementTagNames.has(tag.name.trim().toLowerCase()) ||
      placementTagNames.has(tag.value.trim().toLowerCase())
    )
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

interface AssetManagementAssignment {
  placementId?: number;
  placementName?: string;
  activityId?: number;
  activityLabel?: string;
  published?: boolean;
}

function isFlippedOrientation(orientation?: string | null) {
  const value = Number(orientation);
  return Boolean(value && [5, 6, 7, 8, -90, 90].includes(value));
}

function editableAssetDimensions(asset: Awaited<ReturnType<typeof getAssetsForPlacementTagIds>>[number] | Awaited<ReturnType<typeof getAsset>>) {
  if (asset.width && asset.height) {
    return { width: asset.width, height: asset.height };
  }

  const width = asset.exifInfo?.exifImageWidth ?? 0;
  const height = asset.exifInfo?.exifImageHeight ?? 0;
  if (!width || !height) return { width: 0, height: 0 };
  return isFlippedOrientation(asset.exifInfo?.orientation)
    ? { width: height, height: width }
    : { width, height };
}

function clampCropToDimensions(crop: {
  x: number;
  y: number;
  width: number;
  height: number;
}, dimensions: { width: number; height: number }) {
  if (dimensions.width <= 0 || dimensions.height <= 0) return crop;
  const x = Math.max(0, Math.min(crop.x, dimensions.width - 1));
  const y = Math.max(0, Math.min(crop.y, dimensions.height - 1));
  return {
    x,
    y,
    width: Math.max(1, Math.min(crop.width, dimensions.width - x)),
    height: Math.max(1, Math.min(crop.height, dimensions.height - y)),
  };
}

function mapAdminAsset(
  asset: Awaited<ReturnType<typeof getAssetsForPlacementTagIds>>[number],
  uploaderAlbum?: UploaderAlbum,
  assignment?: AssetManagementAssignment,
  adjustments?: AssetAdjustments
) {
  const dimensions = editableAssetDimensions(asset);
  return {
    id: asset.id,
    type: asset.type,
    fileName: asset.originalFileName,
    createdAt: asset.fileCreatedAt,
    updatedAt: asset.updatedAt,
    archived: asset.isArchived,
    trashed: Boolean(asset.isTrashed),
    published: assignment?.published ?? false,
    placement_id: assignment?.placementId ?? null,
    placement_name: assignment?.placementName ?? null,
    activity_id: assignment?.activityId ?? null,
    activity_label: assignment?.activityLabel ?? null,
    uploader_id: uploaderAlbum?.uploaderId ?? null,
    uploader_name: uploaderAlbum?.uploaderName ?? null,
    uploader_album_id: uploaderAlbum?.id ?? null,
    width: dimensions.width || null,
    height: dimensions.height || null,
    adjustments: adjustments ?? { ...DEFAULT_ASSET_ADJUSTMENTS },
    thumbnailUrl: assetMediaUrl(asset, "thumbnail"),
    previewUrl: assetMediaUrl(asset, "preview"),
  };
}

function assetMediaUrl(asset: Awaited<ReturnType<typeof getAssetsForPlacementTagIds>>[number], kind: "thumbnail" | "preview") {
  const version = encodeURIComponent(asset.updatedAt || asset.fileModifiedAt || asset.checksum || asset.id);
  return `/api/v1/assets/${asset.id}/${kind}?v=${version}&edited=true`;
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

async function getManagementAssignments(assetIds: string[]) {
  const assignments = new Map<string, AssetManagementAssignment>();
  if (assetIds.length === 0) return assignments;

  const assetIdSet = new Set(assetIds);
  const config = await getUploadConfig();
  const tags = await listTags();

  const placementByTagId = new Map<string, { id: number; name: string }>();
  for (const placement of config.placements) {
    const anchor = placementAnchorTag(placement.placement_id);
    const normalizedAnchor = anchor.trim().toLowerCase();
    const tag = tags.find(
      (candidate) =>
        candidate.name.trim().toLowerCase() === normalizedAnchor ||
        candidate.value.trim().toLowerCase() === normalizedAnchor
    );
    if (tag) {
      placementByTagId.set(tag.id, {
        id: placement.placement_id,
        name: placement.placement_name,
      });
    }
  }

  const activityByTagId = new Map<string, { id: number; label: string }>();
  for (const activity of config.activities) {
    const anchor = activityAnchorTag(activity.id);
    const normalizedAnchor = anchor.trim().toLowerCase();
    const normalizedLabel = activity.label.trim().toLowerCase();
    for (const tag of tags) {
      const tagName = tag.name.trim().toLowerCase();
      const tagValue = tag.value.trim().toLowerCase();
      if (
        tagName === normalizedAnchor ||
        tagValue === normalizedAnchor ||
        tagName === normalizedLabel ||
        tagValue === normalizedLabel
      ) {
        activityByTagId.set(tag.id, {
          id: activity.id,
          label: activity.label,
        });
      }
    }
  }

  for (const [tagId, placement] of placementByTagId) {
    const taggedAssetIds = await searchAssetIdsByTag(tagId);
    for (const assetId of taggedAssetIds) {
      if (!assetIdSet.has(assetId)) continue;
      const current = assignments.get(assetId) ?? {};
      current.placementId = placement.id;
      current.placementName = placement.name;
      assignments.set(assetId, current);
    }
  }

  for (const [tagId, activity] of activityByTagId) {
    const taggedAssetIds = await searchAssetIdsByTag(tagId);
    for (const assetId of taggedAssetIds) {
      if (!assetIdSet.has(assetId)) continue;
      const current = assignments.get(assetId) ?? {};
      current.activityId = activity.id;
      current.activityLabel = activity.label;
      assignments.set(assetId, current);
    }
  }

  return assignments;
}

async function mapAssetsWithUploaderAlbums(assets: Awaited<ReturnType<typeof getAssetsForPlacementTagIds>>) {
  const uploaderAlbums = await getUploaderAlbums();
  const publishedAlbum = await getPublishedAlbum();
  const [albumAssignments, managementAssignments, publishedAssets] = await Promise.all([
    getUploaderAlbumAssignments(uploaderAlbums),
    getManagementAssignments(assets.map((asset) => asset.id)),
    searchAssetsByAlbumId(publishedAlbum.id),
  ]);
  const adjustmentMap = await getAssetAdjustmentMap(assets.map((asset) => asset.id));
  const publishedAssetIds = new Set(publishedAssets.map((asset) => asset.id));
  return assets.map((asset) => mapAdminAsset(
    asset,
    albumAssignments.get(asset.id),
    {
      ...(managementAssignments.get(asset.id) ?? {}),
      published: publishedAssetIds.has(asset.id),
    },
    adjustmentMap.get(asset.id)
  ));
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

    const rawActivityId = typeof req.query.activity_id === "string" ? req.query.activity_id : "";
    const activityId = rawActivityId ? parseInt(rawActivityId, 10) : null;

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

    if (activityId != null && Number.isFinite(activityId)) {
      const activity = config.activities.find((a) => a.id === activityId);
      if (!activity) {
        res.json({ assets: [] });
        return;
      }
      // Match by anchor tag (new) OR label tag (legacy), union of both
      const allTags = await listTags();
      const anchorTagName = activityAnchorTag(activityId);
      const labelNorm = activity.label.trim().toLowerCase();
      const activityImmichTagIds = allTags
        .filter((tag) =>
          tag.name.trim().toLowerCase() === anchorTagName ||
          tag.value.trim().toLowerCase() === anchorTagName ||
          tag.name.trim().toLowerCase() === labelNorm ||
          tag.value.trim().toLowerCase() === labelNorm
        )
        .map((tag) => tag.id);

      if (activityImmichTagIds.length === 0) {
        assets = [];
      } else {
        const activityAssetIds = new Set(
          (await Promise.all(activityImmichTagIds.map(searchAssetIdsByTag))).flat()
        );
        assets = assets.filter((asset) => activityAssetIds.has(asset.id));
      }
    }

    res.json({ assets: await mapAssetsWithUploaderAlbums(assets) });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.get("/assets/untagged", async (_req, res) => {
  try {
    const placementTagIds = await getExistingPlacementTagIds();

    const [allAssets, taggedAssets] = await Promise.all([
      searchAllImmichAssets(),
      getAssetsForPlacementTagIds(placementTagIds),
    ]);

    const taggedAssetIds = new Set(taggedAssets.map((asset) => asset.id));
    const untaggedAssets = allAssets
      .filter((asset) => !taggedAssetIds.has(asset.id))
      .sort((a, b) => b.fileCreatedAt.localeCompare(a.fileCreatedAt));

    res.json({ assets: await mapAssetsWithUploaderAlbums(untaggedAssets) });
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

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

    await getAsset(assetId);

    const existingPlacementTagIds = await getConfiguredPlacementAssignmentTagIds();
    if (existingPlacementTagIds.length > 0) {
      await untagAssets([assetId], existingPlacementTagIds);
    }
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

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

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

router.post("/assets/:assetId/activity-tag", async (req, res) => {
  try {
    const rawActivityId = req.body?.activity_id;
    const activityId = rawActivityId != null && rawActivityId !== ""
      ? parseInt(String(rawActivityId), 10)
      : null;
    const removing = rawActivityId === null || rawActivityId === "" || rawActivityId === 0;

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

    await getAsset(assetId);

    // Remove all existing activity tags (both anchor-style and label-style)
    const config = await getUploadConfig();
    const allTags = await listTags();
    const activityLabelKeys = new Set(config.activities.map((a) => a.label.trim().toLowerCase()));
    const activityTagIds = allTags
      .filter((tag) =>
        isActivityAnchorTagName(tag.name) || isActivityAnchorTagName(tag.value) ||
        activityLabelKeys.has(tag.name.trim().toLowerCase()) || activityLabelKeys.has(tag.value.trim().toLowerCase())
      )
      .map((tag) => tag.id);
    if (activityTagIds.length > 0) {
      await untagAssets([assetId], activityTagIds);
    }

    if (!removing && activityId != null && Number.isFinite(activityId)) {
      const tagNames = await getActivityTagNames(activityId);
      if (!tagNames.length) {
        res.status(400).json({ error: "Unrecognised activity." });
        return;
      }
      await tagAsset(assetId, tagNames);
    }

    res.json({ ok: true, asset_id: assetId, activity_id: activityId });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post("/assets/:assetId/published", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to publish uploads." });
      return;
    }

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

    const published = Boolean(req.body?.published);
    await getAsset(assetId);

    const album = await getPublishedAlbum();
    if (published) {
      await addAssetsToAlbum(album.id, [assetId]);
    } else {
      await removeAssetsFromAlbum(album.id, [assetId]);
    }

    res.json({
      ok: true,
      asset_id: assetId,
      published,
      published_album_id: album.id,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post("/assets/:assetId/caption", async (req, res) => {
  try {
    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

    const caption = typeof req.body?.caption === "string" ? req.body.caption.trim() : "";
    await getAsset(assetId);
    await updateAssetDescription(assetId, caption);

    res.json({
      ok: true,
      asset_id: assetId,
      caption,
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.get("/assets/:assetId/adjustments", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to view upload adjustments." });
      return;
    }

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

    await getAsset(assetId);
    res.json(await getAssetAdjustments(assetId));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.put("/assets/:assetId/adjustments", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to edit upload adjustments." });
      return;
    }

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

    await getAsset(assetId);
    const adjustments = await saveAssetAdjustments(assetId, req.body);
    res.json({ ok: true, asset_id: assetId, adjustments });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.get("/assets/:assetId/edits", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to edit uploads." });
      return;
    }

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

    await getAsset(assetId);
    res.json(await getAssetEdits(assetId));
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.put("/assets/:assetId/crop", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to crop uploads." });
      return;
    }

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

    const requestedCrop = {
      x: Math.round(Number(req.body?.x)),
      y: Math.round(Number(req.body?.y)),
      width: Math.round(Number(req.body?.width)),
      height: Math.round(Number(req.body?.height)),
    };
    if (
      !Number.isFinite(requestedCrop.x) ||
      !Number.isFinite(requestedCrop.y) ||
      !Number.isFinite(requestedCrop.width) ||
      !Number.isFinite(requestedCrop.height) ||
      requestedCrop.x < 0 ||
      requestedCrop.y < 0 ||
      requestedCrop.width < 1 ||
      requestedCrop.height < 1
    ) {
      res.status(400).json({ error: "Choose a valid crop area." });
      return;
    }

    const asset = await getAsset(assetId);
    const dimensions = editableAssetDimensions(asset);
    const crop = clampCropToDimensions(requestedCrop, dimensions);
    if (
      dimensions.width > 0 &&
      dimensions.height > 0 &&
      (crop.x + crop.width > dimensions.width || crop.y + crop.height > dimensions.height)
    ) {
      res.status(400).json({ error: "Crop area is outside the image bounds." });
      return;
    }

    const current = await getAssetEdits(assetId).catch(() => ({ assetId, edits: [] }));
    const nonCropEdits = current.edits.filter((edit) => edit.action !== "crop");
    const edits = await editAsset(assetId, [
      { action: "crop", parameters: crop },
      ...nonCropEdits.map((edit) => ({ action: edit.action, parameters: edit.parameters })),
    ]);

    res.json(edits);
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.delete("/assets/:assetId/edits", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to reset upload edits." });
      return;
    }

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

    await getAsset(assetId);
    await removeAssetEdits(assetId);
    res.json({ ok: true, asset_id: assetId });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.delete("/assets/:assetId", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to delete uploads." });
      return;
    }

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

    await getAsset(assetId);
    await deleteAssets([assetId]);

    res.json({
      ok: true,
      asset_id: assetId,
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
      const hasUploaderSelection = Boolean(uploader) || Number.isFinite(uploader_id);
      const [location, selectedUploader] = await Promise.all([
        findConfiguredPlacement(placement_id),
        hasUploaderSelection
          ? findConfiguredUploader({
              id: Number.isFinite(uploader_id) ? uploader_id : undefined,
              name: uploader,
            })
          : Promise.resolve(undefined),
      ]);
      const rawActivityId = parseInt(typeof req.body.activity_id === "string" ? req.body.activity_id : "", 10);
      const selectedTags = Number.isFinite(rawActivityId) ? await getActivityTagNames(rawActivityId) : [];

      if (hasUploaderSelection && !selectedUploader) {
        res.status(400).json({ error: "Select a valid uploader." });
        return;
      }

      if (!location) {
        res.status(400).json({ error: "Select a valid placement." });
        return;
      }

      if (selectedUploader && !placementIncludesUploader(location, selectedUploader.id)) {
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
          if (selectedUploader) {
            const album = await ensureAlbum(selectedUploader.name);
            await addAssetsToAlbum(album.id, [uploaded.id]);
          }

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
        uploader: selectedUploader?.name ?? null,
        uploader_id: selectedUploader?.id ?? null,
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
