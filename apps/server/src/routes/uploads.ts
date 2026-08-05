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
  tagAsset,
  untagAssets,
  updateAsset,
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
import {
  getGpsDisabledAssetIds,
  saveAssetGpsUsage,
} from "../services/assetGpsUsage.service.js";
import { getAuthContext } from "../services/auth.service.js";
import { flattenAsset } from "../services/flattenAsset.service.js";
import { isAudioAsset, parseImmichDuration } from "../services/audioAsset.service.js";
import { getAudioWaveform } from "../services/audioWaveform.service.js";
import {
  createAudioTrimJob,
  getAudioTrimJob,
} from "../services/trimAudioAsset.service.js";
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
const SITE_ACTIVITY_STATS_TTL_MS = 30_000;
const GLOBAL_AUDIO_PLACEMENT_ID = 21639;
const LINKED_AUDIO_TAG_PREFIX = "linkedaudio:";
const DRIVE_SOURCE_TAG_PREFIX = "source:drive:";
// These indexes scan all uploader and published albums. Admin mutations
// explicitly invalidate them, so keep them warm between Browse requests.
const ADMIN_BROWSE_INDEX_TTL_MS = 5 * 60_000;
const AUDIO_OPTION_CACHE_TTL_MS = 60_000;

export interface SiteActivityStatsResponse {
  sites: Record<string, {
    totalPublished: number;
    activities: Array<{
      activityId: number;
      label: string;
      publishedCount: number;
    }>;
  }>;
  generatedAt: string;
}

let siteActivityStatsCache: {
  expiresAt: number;
  value: SiteActivityStatsResponse;
} | null = null;
let siteActivityStatsRequest: Promise<SiteActivityStatsResponse> | null = null;

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

function findExistingPlacementTagIds(
  placement: { placement_id: number; placement_name: string } | null | undefined,
  tags: Awaited<ReturnType<typeof listTags>>,
) {
  if (!placement) return [];

  const placementTagNames = new Set([
    placementAnchorTag(placement.placement_id).trim().toLowerCase(),
    placement.placement_name.trim().toLowerCase(),
  ]);

  return tags
    .filter((tag) =>
      placementTagNames.has(tag.name.trim().toLowerCase()) ||
      placementTagNames.has(tag.value.trim().toLowerCase())
    )
    .map((tag) => tag.id);
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
  const size = 500;
  const searches = tagIds.flatMap((tagId) =>
    (["IMAGE", "VIDEO"] as const).flatMap((type) =>
      (["timeline", "archive"] as const).map((visibility) => ({
        tagId,
        type,
        visibility,
      })),
    ),
  );
  const results = await processWithConcurrency(
    searches,
    8,
    async ({ tagId, type, visibility }) => {
      const assets: Awaited<ReturnType<typeof searchAssets>>["assets"]["items"] = [];
      let page = 1;
      for (;;) {
        const result = await searchAssets({
          tagIds: [tagId],
          page,
          size,
          type,
          visibility,
          withPeople: false,
        });
        assets.push(...result.assets.items);
        if (!result.assets.nextPage || result.assets.items.length < size) break;
        page += 1;
      }
      return assets;
    },
  );
  for (const assets of results) {
    for (const asset of assets) byId.set(asset.id, asset);
  }

  return Array.from(byId.values()).sort((a, b) => b.fileCreatedAt.localeCompare(a.fileCreatedAt));
}

async function getActiveAudioAssetsForPlacementTagIds(tagIds: string[]) {
  const results = await processWithConcurrency(
    tagIds,
    4,
    async (tagId) => {
      const assets: Awaited<ReturnType<typeof searchAssets>>["assets"]["items"] =
        [];
      const size = 500;
      let page = 1;
      for (;;) {
        const result = await searchAssets({
          tagIds: [tagId],
          page,
          size,
          type: "VIDEO",
          visibility: "timeline",
          withExif: false,
          withPeople: false,
        });
        assets.push(...result.assets.items);
        if (!result.assets.nextPage || result.assets.items.length < size) break;
        page += 1;
      }
      return assets;
    },
  );
  const byId = new Map(
    results.flat().map((asset) => [asset.id, asset]),
  );
  const candidates = Array.from(byId.values()).filter(
    (asset) => !asset.isArchived && !asset.isTrashed,
  );
  if (embeddedAssetTagsAvailable(candidates)) {
    return candidates.filter(isAudioAsset);
  }

  const tags = await listTags();
  const audioTagIds = tags
    .filter((tag) =>
      [tag.name, tag.value].some(
        (value) => value.trim().toLowerCase() === "media:audio",
      ),
    )
    .map((tag) => tag.id);
  const audioAssetIds = new Set(
    (
      await Promise.all(audioTagIds.map(searchAdminAssetIdsByTag))
    ).flat(),
  );
  return candidates.filter((asset) => audioAssetIds.has(asset.id));
}

async function searchAdminAssetIdsByTag(tagId: string) {
  const assetIds = new Set<string>();
  const size = 100;
  for (const type of ["IMAGE", "VIDEO"] as const) {
    for (const visibility of ["timeline", "archive"] as const) {
      let page = 1;
      for (;;) {
        const result = await searchAssets({
          tagIds: [tagId],
          page,
          size,
          type,
          visibility,
        });
        for (const asset of result.assets.items) assetIds.add(asset.id);
        if (!result.assets.nextPage || result.assets.items.length < size) break;
        page += 1;
      }
    }
  }
  return Array.from(assetIds);
}

interface UploaderAlbum {
  id: string;
  uploaderId: number;
  uploaderName: string;
}

let uploaderAssignmentCache: {
  expiresAt: number;
  value: Map<string, UploaderAlbum>;
} | null = null;
let uploaderAssignmentRequest: Promise<Map<string, UploaderAlbum>> | null =
  null;
let publishedAssetIdCache: {
  expiresAt: number;
  value: Set<string>;
} | null = null;
let publishedAssetIdRequest: Promise<Set<string>> | null = null;
let adminBrowseIndexGeneration = 0;
const audioOptionCache = new Map<
  string,
  { expiresAt: number; value: Array<{ id: string; fileName: string }> }
>();

function invalidateAdminBrowseIndexes() {
  adminBrowseIndexGeneration += 1;
  uploaderAssignmentCache = null;
  uploaderAssignmentRequest = null;
  publishedAssetIdCache = null;
  publishedAssetIdRequest = null;
  audioOptionCache.clear();
}

interface AssetManagementAssignment {
  placementId?: number;
  placementName?: string;
  activityId?: number;
  activityLabel?: string;
  iconName?: string;
  linkedAudioAssetId?: string;
  driveFileId?: string;
  published?: boolean;
  isAudio?: boolean;
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
  adjustments?: AssetAdjustments,
  useGpsLocation = true,
) {
  const dimensions = editableAssetDimensions(asset);
  const embeddedDriveFileId = (asset.tags ?? [])
    .flatMap((tag) => [tag.name, tag.value])
    .map((value) => value.trim())
    .find((value) => value.toLocaleLowerCase().startsWith(DRIVE_SOURCE_TAG_PREFIX))
    ?.slice(DRIVE_SOURCE_TAG_PREFIX.length);
  const driveFileId = assignment?.driveFileId ?? embeddedDriveFileId;
  return {
    id: asset.id,
    type: asset.type,
    mediaKind: assignment?.isAudio || isAudioAsset(asset)
      ? "audio"
      : asset.type === "VIDEO"
        ? "video"
        : "image",
    durationSeconds: parseImmichDuration(asset.duration),
    fileName: asset.originalFileName,
    description: asset.exifInfo?.description ?? "",
    latitude: asset.exifInfo?.latitude ?? null,
    longitude: asset.exifInfo?.longitude ?? null,
    useGpsLocation,
    createdAt: asset.fileCreatedAt,
    updatedAt: asset.updatedAt,
    archived: asset.isArchived,
    trashed: Boolean(asset.isTrashed),
    published: assignment?.published ?? false,
    placement_id: assignment?.placementId ?? null,
    placement_name: assignment?.placementName ?? null,
    activity_id: assignment?.activityId ?? null,
    activity_label: assignment?.activityLabel ?? null,
    iconName: assignment?.iconName ?? null,
    linkedAudioAssetId: assignment?.linkedAudioAssetId ?? null,
    driveFileId: driveFileId || null,
    uploader_id: uploaderAlbum?.uploaderId ?? null,
    uploader_name: uploaderAlbum?.uploaderName ?? null,
    uploader_album_id: uploaderAlbum?.id ?? null,
    width: dimensions.width || null,
    height: dimensions.height || null,
    adjustments: adjustments ?? { ...DEFAULT_ASSET_ADJUSTMENTS },
    thumbnailUrl: assetMediaUrl(asset, "thumbnail"),
    previewUrl: assetMediaUrl(asset, "preview"),
    originalUrl: `/api/v1/assets/${asset.id}/original?v=${encodeURIComponent(
      asset.updatedAt || asset.fileModifiedAt || asset.checksum || asset.id,
    )}`,
  };
}

function assetMediaUrl(asset: Awaited<ReturnType<typeof getAssetsForPlacementTagIds>>[number], kind: "thumbnail" | "preview") {
  const version = encodeURIComponent(asset.updatedAt || asset.fileModifiedAt || asset.checksum || asset.id);
  return `/api/v1/assets/${asset.id}/${kind}?v=${version}&edited=true`;
}

async function searchAssetsByAlbumId(
  albumId: string,
  options?: { compact?: boolean },
) {
  const byId = new Map<string, Awaited<ReturnType<typeof searchAssets>>["assets"]["items"][number]>();
  const size = options?.compact ? 500 : 100;
  const searches = (["IMAGE", "VIDEO"] as const).flatMap((type) =>
    (["timeline", "archive"] as const).map((visibility) => ({
      type,
      visibility,
    })),
  );
  const results = await processWithConcurrency(
    searches,
    4,
    async ({ type, visibility }) => {
      const assets: Awaited<ReturnType<typeof searchAssets>>["assets"]["items"] =
        [];
      let page = 1;
      for (;;) {
        const result = await searchAssets({
          albumIds: [albumId],
          page,
          size,
          type,
          visibility,
          ...(options?.compact ? { withExif: false, withPeople: false } : {}),
        });
        assets.push(...result.assets.items);
        if (!result.assets.nextPage || result.assets.items.length < size) break;
        page += 1;
      }
      return assets;
    },
  );
  for (const assets of results) {
    for (const asset of assets) byId.set(asset.id, asset);
  }

  return Array.from(byId.values()).sort((a, b) => b.fileCreatedAt.localeCompare(a.fileCreatedAt));
}

async function searchAllImmichAssets() {
  const byId = new Map<string, Awaited<ReturnType<typeof searchAssets>>["assets"]["items"][number]>();
  const size = 100;
  for (const type of ["IMAGE", "VIDEO"] as const) {
    for (const visibility of ["timeline", "archive"] as const) {
      let page = 1;
      for (;;) {
        const result = await searchAssets({ page, size, type, visibility });
        for (const asset of result.assets.items) byId.set(asset.id, asset);
        if (!result.assets.nextPage || result.assets.items.length < size) break;
        page += 1;
      }
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.fileCreatedAt.localeCompare(a.fileCreatedAt));
}

async function buildSiteActivityStats(): Promise<SiteActivityStatsResponse> {
  const [config, publishedAlbum] = await Promise.all([
    getUploadConfig(),
    getPublishedAlbum(),
  ]);
  const publishedAssets = await searchAssetsByAlbumId(
    publishedAlbum.id,
    { compact: true },
  );
  const activePublishedAssets = publishedAssets.filter(
    (asset) => !asset.isArchived && !asset.isTrashed,
  );
  const assignments = await getManagementAssignments(
    activePublishedAssets.map((asset) => asset.id),
    { includeAudio: false, includeIcons: false },
  );
  const totals = new Map<number, number>();
  const counts = new Map<number, Map<number, number>>();

  for (const asset of activePublishedAssets) {
    const assignment = assignments.get(asset.id);
    if (assignment?.placementId == null) continue;

    totals.set(
      assignment.placementId,
      (totals.get(assignment.placementId) ?? 0) + 1,
    );
    if (assignment.activityId == null) continue;

    const placementCounts =
      counts.get(assignment.placementId) ?? new Map<number, number>();
    placementCounts.set(
      assignment.activityId,
      (placementCounts.get(assignment.activityId) ?? 0) + 1,
    );
    counts.set(assignment.placementId, placementCounts);
  }

  const sites: SiteActivityStatsResponse["sites"] = {};
  for (const placement of config.placements) {
    const placementCounts = counts.get(placement.placement_id);
    sites[String(placement.placement_id)] = {
      totalPublished: totals.get(placement.placement_id) ?? 0,
      activities: config.activities.flatMap((activity) => {
        const publishedCount = placementCounts?.get(activity.id) ?? 0;
        return publishedCount > 0
          ? [{
              activityId: activity.id,
              label: activity.label,
              publishedCount,
            }]
          : [];
      }),
    };
  }

  return { sites, generatedAt: new Date().toISOString() };
}

export async function getSiteActivityStats(): Promise<SiteActivityStatsResponse> {
  if (siteActivityStatsCache && siteActivityStatsCache.expiresAt > Date.now()) {
    return siteActivityStatsCache.value;
  }
  if (siteActivityStatsRequest) return siteActivityStatsRequest;

  const request = buildSiteActivityStats()
    .then((value) => {
      siteActivityStatsCache = {
        expiresAt: Date.now() + SITE_ACTIVITY_STATS_TTL_MS,
        value,
      };
      return value;
    })
    .finally(() => {
      siteActivityStatsRequest = null;
    });
  siteActivityStatsRequest = request;
  return request;
}

function invalidateSiteActivityStats() {
  siteActivityStatsCache = null;
  invalidateAdminBrowseIndexes();
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
  const albumAssets = await processWithConcurrency(
    uploaderAlbums,
    2,
    async (album) => ({
      album,
      assets: await searchAssetsByAlbumId(album.id, { compact: true }),
    }),
  );
  for (const { album, assets } of albumAssets) {
    for (const asset of assets) assignments.set(asset.id, album);
  }
  return assignments;
}

async function getCachedUploaderAlbumAssignments() {
  if (
    uploaderAssignmentCache &&
    uploaderAssignmentCache.expiresAt > Date.now()
  ) {
    return uploaderAssignmentCache.value;
  }
  if (uploaderAssignmentRequest) return uploaderAssignmentRequest;

  const generation = adminBrowseIndexGeneration;
  const request = getUploaderAlbums()
    .then(getUploaderAlbumAssignments)
    .then((value) => {
      if (generation === adminBrowseIndexGeneration) {
        uploaderAssignmentCache = {
          expiresAt: Date.now() + ADMIN_BROWSE_INDEX_TTL_MS,
          value,
        };
      }
      return value;
    })
    .finally(() => {
      if (uploaderAssignmentRequest === request) {
        uploaderAssignmentRequest = null;
      }
    });
  uploaderAssignmentRequest = request;
  return request;
}

async function getCachedPublishedAssetIds() {
  if (publishedAssetIdCache && publishedAssetIdCache.expiresAt > Date.now()) {
    return publishedAssetIdCache.value;
  }
  if (publishedAssetIdRequest) return publishedAssetIdRequest;

  const generation = adminBrowseIndexGeneration;
  const request = getPublishedAlbum()
    .then((album) => searchAssetsByAlbumId(album.id, { compact: true }))
    .then((assets) => new Set(assets.map((asset) => asset.id)))
    .then((value) => {
      if (generation === adminBrowseIndexGeneration) {
        publishedAssetIdCache = {
          expiresAt: Date.now() + ADMIN_BROWSE_INDEX_TTL_MS,
          value,
        };
      }
      return value;
    })
    .finally(() => {
      if (publishedAssetIdRequest === request) {
        publishedAssetIdRequest = null;
      }
    });
  publishedAssetIdRequest = request;
  return request;
}

async function getUploaderAlbumMemberships(assetId: string, uploaderAlbums: UploaderAlbum[]) {
  const memberships: UploaderAlbum[] = [];
  for (const album of uploaderAlbums) {
    const assets = await searchAssetsByAlbumId(album.id);
    if (assets.some((asset) => asset.id === assetId)) memberships.push(album);
  }
  return memberships;
}

async function getManagementAssignments(
  assetIds: string[],
  options?: { includeAudio?: boolean; includeIcons?: boolean },
) {
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
    const taggedAssetIds = await searchAdminAssetIdsByTag(tagId);
    for (const assetId of taggedAssetIds) {
      if (!assetIdSet.has(assetId)) continue;
      const current = assignments.get(assetId) ?? {};
      current.placementId = placement.id;
      current.placementName = placement.name;
      assignments.set(assetId, current);
    }
  }

  for (const [tagId, activity] of activityByTagId) {
    const taggedAssetIds = await searchAdminAssetIdsByTag(tagId);
    for (const assetId of taggedAssetIds) {
      if (!assetIdSet.has(assetId)) continue;
      const current = assignments.get(assetId) ?? {};
      current.activityId = activity.id;
      current.activityLabel = activity.label;
      assignments.set(assetId, current);
    }
  }

  if (options?.includeIcons !== false) {
    const iconTags = tags.flatMap((tag) => {
      const name = [tag.name, tag.value]
        .map((value) => value.trim().toLowerCase())
        .find((value) => /^icon:[a-z0-9_]+$/.test(value));
      return name ? [{ id: tag.id, iconName: name.slice("icon:".length) }] : [];
    });
    await Promise.all(
      iconTags.map(async ({ id, iconName }) => {
        const taggedAssetIds = await searchAdminAssetIdsByTag(id);
        for (const assetId of taggedAssetIds) {
          if (!assetIdSet.has(assetId)) continue;
          const current = assignments.get(assetId) ?? {};
          current.iconName = iconName;
          assignments.set(assetId, current);
        }
      }),
    );
  }

  const linkedAudioTags = tags.flatMap((tag) => {
    const value = [tag.name, tag.value]
      .map((candidate) => candidate.trim().toLowerCase())
      .find((candidate) =>
        /^linkedaudio:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          candidate,
        ),
      );
    return value
      ? [{ id: tag.id, linkedAudioAssetId: value.slice(LINKED_AUDIO_TAG_PREFIX.length) }]
      : [];
  });
  await Promise.all(
    linkedAudioTags.map(async ({ id, linkedAudioAssetId }) => {
      const taggedAssetIds = await searchAdminAssetIdsByTag(id);
      for (const assetId of taggedAssetIds) {
        if (!assetIdSet.has(assetId)) continue;
        const current = assignments.get(assetId) ?? {};
        current.linkedAudioAssetId = linkedAudioAssetId;
        assignments.set(assetId, current);
      }
    }),
  );

  const driveSourceTags = tags.flatMap((tag) => {
    const value = [tag.name, tag.value]
      .map((candidate) => candidate.trim())
      .find((candidate) =>
        candidate.toLocaleLowerCase().startsWith(DRIVE_SOURCE_TAG_PREFIX),
      );
    return value
      ? [{ id: tag.id, driveFileId: value.slice(DRIVE_SOURCE_TAG_PREFIX.length) }]
      : [];
  });
  await Promise.all(
    driveSourceTags.map(async ({ id, driveFileId }) => {
      const taggedAssetIds = await searchAdminAssetIdsByTag(id);
      for (const assetId of taggedAssetIds) {
        if (!assetIdSet.has(assetId)) continue;
        const current = assignments.get(assetId) ?? {};
        current.driveFileId = driveFileId;
        assignments.set(assetId, current);
      }
    }),
  );

  const audioTag =
    options?.includeAudio === false
      ? undefined
      : tags.find((tag) => {
          const name = tag.name.trim().toLowerCase();
          const value = tag.value.trim().toLowerCase();
          return name === "media:audio" || value === "media:audio";
        });
  if (audioTag) {
    const audioAssetIds = await searchAdminAssetIdsByTag(audioTag.id);
    for (const assetId of audioAssetIds) {
      if (!assetIdSet.has(assetId)) continue;
      const current = assignments.get(assetId) ?? {};
      current.isAudio = true;
      assignments.set(assetId, current);
    }
  }

  return assignments;
}

function embeddedAssetTagsAvailable(
  assets: Awaited<ReturnType<typeof getAssetsForPlacementTagIds>>,
) {
  return assets.every((asset) => Array.isArray(asset.tags));
}

function embeddedTagKeys(asset: {
  tags?: Array<{ name: string; value: string }>;
}) {
  return new Set(
    (asset.tags ?? [])
      .flatMap((tag) => [tag.name, tag.value])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function mapEmbeddedAssetMetadata(
  assets: Awaited<ReturnType<typeof getAssetsForPlacementTagIds>>,
  config: Awaited<ReturnType<typeof getUploadConfig>>,
) {
  const assignments = new Map<string, AssetManagementAssignment>();
  const adjustments = new Map<string, AssetAdjustments>();
  const gpsDisabledAssetIds = new Set<string>();
  const placementsByTag = new Map<
    string,
    { id: number; name: string }
  >();
  const activitiesByTag = new Map<
    string,
    { id: number; label: string }
  >();

  for (const placement of config.placements) {
    const value = {
      id: placement.placement_id,
      name: placement.placement_name,
    };
    placementsByTag.set(
      placementAnchorTag(placement.placement_id).toLowerCase(),
      value,
    );
    placementsByTag.set(placement.placement_name.trim().toLowerCase(), value);
  }
  for (const activity of config.activities) {
    const value = { id: activity.id, label: activity.label };
    activitiesByTag.set(activityAnchorTag(activity.id).toLowerCase(), value);
    activitiesByTag.set(activity.label.trim().toLowerCase(), value);
  }

  for (const asset of assets) {
    const keys = embeddedTagKeys(asset);
    const assignment: AssetManagementAssignment = {};
    const assetAdjustments = { ...DEFAULT_ASSET_ADJUSTMENTS };
    let hasAdjustments = false;

    for (const key of keys) {
      const placement = placementsByTag.get(key);
      if (placement) {
        assignment.placementId = placement.id;
        assignment.placementName = placement.name;
      }
      const activity = activitiesByTag.get(key);
      if (activity) {
        assignment.activityId = activity.id;
        assignment.activityLabel = activity.label;
      }
      if (/^icon:[a-z0-9_]+$/.test(key)) {
        assignment.iconName = key.slice("icon:".length);
      }
      const linkedAudioMatch = key.match(
        /^linkedaudio:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
      );
      if (linkedAudioMatch) {
        assignment.linkedAudioAssetId = linkedAudioMatch[1];
      }
      if (key.startsWith(DRIVE_SOURCE_TAG_PREFIX)) {
        assignment.driveFileId = key.slice(DRIVE_SOURCE_TAG_PREFIX.length);
      }
      if (key === "media:audio") assignment.isAudio = true;
      if (key === "artasia:gps:disabled") gpsDisabledAssetIds.add(asset.id);

      const adjustmentMatch = key.match(
        /^artasia:adjust:(brightness|contrast|saturation):(\d{1,3})$/,
      );
      if (adjustmentMatch) {
        const value = Number(adjustmentMatch[2]);
        if (value >= 50 && value <= 150) {
          assetAdjustments[
            adjustmentMatch[1] as keyof AssetAdjustments
          ] = value;
          hasAdjustments = true;
        }
      }
    }

    assignments.set(asset.id, assignment);
    if (hasAdjustments) adjustments.set(asset.id, assetAdjustments);
  }

  return { assignments, adjustments, gpsDisabledAssetIds };
}

async function mapAssetsWithUploaderAlbums(assets: Awaited<ReturnType<typeof getAssetsForPlacementTagIds>>) {
  if (assets.length === 0) return [];
  const usesEmbeddedTags = embeddedAssetTagsAvailable(assets);
  const [config, albumAssignments, publishedAssetIds] = await Promise.all([
    usesEmbeddedTags ? getUploadConfig() : Promise.resolve(null),
    getCachedUploaderAlbumAssignments(),
    getCachedPublishedAssetIds(),
  ]);
  const assetIds = assets.map((asset) => asset.id);
  const embeddedMetadata =
    usesEmbeddedTags && config
      ? mapEmbeddedAssetMetadata(assets, config)
      : null;
  const [managementAssignments, adjustmentMap, gpsDisabledAssetIds] =
    embeddedMetadata
      ? [
          embeddedMetadata.assignments,
          embeddedMetadata.adjustments,
          embeddedMetadata.gpsDisabledAssetIds,
        ]
      : await Promise.all([
          getManagementAssignments(assetIds),
          getAssetAdjustmentMap(assetIds),
          getGpsDisabledAssetIds(assetIds),
        ]);
  return assets.map((asset) => mapAdminAsset(
    asset,
    albumAssignments.get(asset.id),
    {
      ...(managementAssignments.get(asset.id) ?? {}),
      published: publishedAssetIds.has(asset.id),
    },
    adjustmentMap.get(asset.id),
    !gpsDisabledAssetIds.has(asset.id),
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

router.get("/site-activity-stats", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to view site statistics." });
      return;
    }
    res.json(await getSiteActivityStats());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.get("/audio-options", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to view available sounds." });
      return;
    }

    const requestedPlacementId = parseInt(
      typeof req.query.placement_id === "string"
        ? req.query.placement_id
        : "",
      10,
    );
    const placementIds = Array.from(
      new Set([
        GLOBAL_AUDIO_PLACEMENT_ID,
        ...(Number.isFinite(requestedPlacementId)
          ? [requestedPlacementId]
          : []),
      ]),
    ).sort((a, b) => a - b);
    const cacheKey = placementIds.join(",");
    const cached = audioOptionCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      res.json({ options: cached.value });
      return;
    }

    const [config, tags] = await Promise.all([
      getUploadConfig(),
      listTags(),
    ]);
    const placementsById = new Map(
      config.placements.map((placement) => [
        placement.placement_id,
        placement,
      ]),
    );
    const placementTagIds = Array.from(
      new Set(
        placementIds.flatMap((placementId) =>
          findExistingPlacementTagIds(placementsById.get(placementId), tags),
        ),
      ),
    );
    const assets = placementTagIds.length
      ? await getActiveAudioAssetsForPlacementTagIds(placementTagIds)
      : [];
    const options = assets
      .map((asset) => ({ id: asset.id, fileName: asset.originalFileName }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName));
    audioOptionCache.set(cacheKey, {
      expiresAt: Date.now() + AUDIO_OPTION_CACHE_TTL_MS,
      value: options,
    });

    res.json({ options });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.get("/assets", async (req, res) => {
  const requestStartedAt = Date.now();
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

    const [config, tags] = await Promise.all([
      getUploadConfig(),
      listTags(),
    ]);
    const placementsById = new Map(
      config.placements.map((placement) => [placement.placement_id, placement]),
    );
    const tagIds = Array.from(new Set(
      placementIds.flatMap((placementId) =>
        findExistingPlacementTagIds(placementsById.get(placementId), tags)
      ),
    ));
    const resolvedAt = Date.now();

    if (tagIds.length === 0) {
      res.setHeader(
        "Server-Timing",
        `resolve;dur=${resolvedAt - requestStartedAt}, search;dur=0, enrich;dur=0`,
      );
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
      const anchorTagName = activityAnchorTag(activityId);
      const labelNorm = activity.label.trim().toLowerCase();
      if (embeddedAssetTagsAvailable(assets)) {
        assets = assets.filter((asset) => {
          const keys = embeddedTagKeys(asset);
          return keys.has(anchorTagName) || keys.has(labelNorm);
        });
      } else {
        // Match by anchor tag (new) OR label tag (legacy), union of both.
        const allTags = await listTags();
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
            (
              await Promise.all(
                activityImmichTagIds.map(searchAdminAssetIdsByTag),
              )
            ).flat(),
          );
          assets = assets.filter((asset) => activityAssetIds.has(asset.id));
        }
      }
    }

    const searchedAt = Date.now();
    const mappedAssets = await mapAssetsWithUploaderAlbums(assets);
    const completedAt = Date.now();
    const resolveDuration = resolvedAt - requestStartedAt;
    const searchDuration = searchedAt - resolvedAt;
    const enrichDuration = completedAt - searchedAt;
    res.setHeader(
      "Server-Timing",
      [
        `resolve;dur=${resolveDuration}`,
        `search;dur=${searchDuration}`,
        `enrich;dur=${enrichDuration}`,
      ].join(", "),
    );
    if (completedAt - requestStartedAt >= 1_000) {
      console.info(
        `[uploads/assets] ${placementIds.length} placement(s), ${tagIds.length} tag(s), ${assets.length} asset(s): resolve=${resolveDuration}ms search=${searchDuration}ms enrich=${enrichDuration}ms total=${completedAt - requestStartedAt}ms`,
      );
    }
    res.json({ assets: mappedAssets });
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

router.get("/assets/:assetId", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to edit uploads." });
      return;
    }

    const assetId = req.params.assetId.trim();
    const asset = await getAsset(assetId);
    const [mapped] = await mapAssetsWithUploaderAlbums([asset]);
    if (!mapped) {
      res.status(404).json({ error: "Upload was not found." });
      return;
    }
    res.json({ asset: mapped });
  } catch (err) {
    const message = (err as Error).message;
    res.status(/404|not found/i.test(message) ? 404 : 502).json({ error: message });
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
    invalidateSiteActivityStats();

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
    invalidateAdminBrowseIndexes();

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
    invalidateSiteActivityStats();

    res.json({ ok: true, asset_id: assetId, activity_id: activityId });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post("/assets/:assetId/icon", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to assign an asset icon." });
      return;
    }

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

    const rawIconName = req.body?.icon_name;
    const iconName =
      rawIconName == null || rawIconName === ""
        ? null
        : String(rawIconName).trim().toLowerCase();
    if (iconName && !/^[a-z0-9_]+$/.test(iconName)) {
      res.status(400).json({ error: "Select a valid Material Symbol." });
      return;
    }

    await getAsset(assetId);
    const tags = await listTags();
    const existingIconTagIds = tags
      .filter((tag) =>
        [tag.name, tag.value].some((value) =>
          /^icon:[a-z0-9_]+$/i.test(value.trim()),
        ),
      )
      .map((tag) => tag.id);
    if (existingIconTagIds.length > 0) {
      await untagAssets([assetId], existingIconTagIds);
    }
    if (iconName) {
      await tagAsset(assetId, [`icon:${iconName}`]);
    }

    res.json({ ok: true, asset_id: assetId, icon_name: iconName });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post("/assets/:assetId/linked-audio", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to link audio to an image." });
      return;
    }

    const assetId = req.params.assetId.trim();
    const rawLinkedAudioAssetId = req.body?.linked_audio_asset_id;
    const linkedAudioAssetId =
      rawLinkedAudioAssetId == null || rawLinkedAudioAssetId === ""
        ? null
        : String(rawLinkedAudioAssetId).trim().toLowerCase();
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }
    if (linkedAudioAssetId && !uuidPattern.test(linkedAudioAssetId)) {
      res.status(400).json({ error: "Select a valid linked sound." });
      return;
    }

    const sourceAsset = await getAsset(assetId);
    if (sourceAsset.type !== "IMAGE") {
      res.status(400).json({ error: "Audio can only be linked to an image." });
      return;
    }
    if (linkedAudioAssetId) {
      const linkedAsset = await getAsset(linkedAudioAssetId);
      if (!isAudioAsset(linkedAsset)) {
        res.status(400).json({ error: "The selected asset is not an audio asset." });
        return;
      }
    }

    const tags = await listTags();
    const existingLinkedAudioTagIds = tags
      .filter((tag) =>
        [tag.name, tag.value].some((value) =>
          /^linkedaudio:[0-9a-f-]+$/i.test(value.trim()),
        ),
      )
      .map((tag) => tag.id);
    if (existingLinkedAudioTagIds.length > 0) {
      await untagAssets([assetId], existingLinkedAudioTagIds);
    }
    if (linkedAudioAssetId) {
      await tagAsset(assetId, [
        `${LINKED_AUDIO_TAG_PREFIX}${linkedAudioAssetId}`,
      ]);
    }

    res.json({
      ok: true,
      asset_id: assetId,
      linked_audio_asset_id: linkedAudioAssetId,
      global_audio_placement_id: GLOBAL_AUDIO_PLACEMENT_ID,
    });
  } catch (err) {
    const message = (err as Error).message;
    res.status(/404|not found/i.test(message) ? 404 : 502).json({ error: message });
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
    const asset = await getAsset(assetId);
    if (published && asset.isArchived) {
      res.status(409).json({
        error: "Archived assets cannot be published. Restore the asset first.",
      });
      return;
    }

    const album = await getPublishedAlbum();
    if (published) {
      await addAssetsToAlbum(album.id, [assetId]);
    } else {
      await removeAssetsFromAlbum(album.id, [assetId]);
    }
    invalidateSiteActivityStats();

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

router.post("/assets/:assetId/archived", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to archive uploads." });
      return;
    }

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

    const archived = Boolean(req.body?.archived);
    await getAsset(assetId);
    if (archived) {
      const album = await getPublishedAlbum();
      await Promise.all([
        updateAsset(assetId, { visibility: "archive" }),
        removeAssetsFromAlbum(album.id, [assetId]),
      ]);
    } else {
      await updateAsset(assetId, { visibility: "timeline" });
    }
    invalidateSiteActivityStats();

    res.json({
      ok: true,
      asset_id: assetId,
      archived,
      ...(archived ? { published: false } : {}),
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

router.put("/assets/:assetId/location", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to edit upload locations." });
      return;
    }

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

    const latitude = req.body?.latitude;
    const longitude = req.body?.longitude;
    if (
      typeof latitude !== "number" ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90
    ) {
      res.status(400).json({ error: "Latitude must be between -90 and 90." });
      return;
    }
    if (
      typeof longitude !== "number" ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      res.status(400).json({ error: "Longitude must be between -180 and 180." });
      return;
    }

    await getAsset(assetId);
    await updateAssetLocation(assetId, { latitude, longitude });

    res.json({ ok: true, asset_id: assetId, latitude, longitude });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.put("/assets/:assetId/gps-usage", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to edit GPS usage." });
      return;
    }

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }
    if (typeof req.body?.useGpsLocation !== "boolean") {
      res.status(400).json({ error: "GPS usage must be true or false." });
      return;
    }

    await getAsset(assetId);
    await saveAssetGpsUsage(assetId, req.body.useGpsLocation);

    res.json({
      ok: true,
      asset_id: assetId,
      useGpsLocation: req.body.useGpsLocation,
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

router.post("/assets/:assetId/flatten", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to straighten or crop uploads." });
      return;
    }

    const assetId = req.params.assetId.trim();
    if (!assetId) {
      res.status(400).json({ error: "Asset ID is required." });
      return;
    }

    const result = await flattenAsset(assetId, req.body);
    res.json({ ok: true, ...result, asset_id: result.assetId, source_asset_id: result.sourceAssetId });
  } catch (err) {
    const message = (err as Error).message;
    const status = /valid|between|outside|rotation|Only image|dimensions/i.test(message) ? 400 : 502;
    res.status(status).json({ error: message });
  }
});

router.get("/assets/:assetId/waveform", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    const assetId = req.params.assetId.trim();
    const isPublished = auth.authenticated
      || (await getCachedPublishedAssetIds()).has(assetId);
    if (!isPublished) {
      res.status(401).json({ error: "Sign in to view audio waveforms." });
      return;
    }
    res.json(await getAudioWaveform(assetId));
  } catch (err) {
    const message = (err as Error).message;
    const status = /only|duration|valid/i.test(message) ? 400 : 502;
    res.status(status).json({ error: message });
  }
});

router.post("/assets/:assetId/trim", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to trim audio." });
      return;
    }
    const job = await createAudioTrimJob(
      req.params.assetId.trim(),
      req.body?.startSeconds,
      req.body?.endSeconds,
    );
    res.status(202).json({ job });
  } catch (err) {
    const message = (err as Error).message;
    const status = /already running/i.test(message)
      ? 409
      : /only|duration|range|seconds/i.test(message)
        ? 400
        : 502;
    res.status(status).json({ error: message });
  }
});

router.get("/audio-trim-jobs/:jobId", async (req, res) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Sign in to view audio trim jobs." });
      return;
    }
    const job = await getAudioTrimJob(req.params.jobId);
    if (!job) {
      res.status(404).json({ error: "Audio trim job was not found." });
      return;
    }
    res.json({ job });
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
    invalidateSiteActivityStats();

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

    const tags = await listTags();
    const tagIds = findExistingPlacementTagIds(placement, tags);
    if (tagIds.length === 0) {
      res.json({ placement_id: placementId, assets: [] });
      return;
    }

    const assets = await getAssetsForPlacementTagIds(tagIds);
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
      invalidateSiteActivityStats();

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
