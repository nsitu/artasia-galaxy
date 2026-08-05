import { getPublishedAlbum, listTags, searchAssetIdsByTag, searchAssetIdsByTags, searchAssets, ImmichAsset } from "../infra/ImmichClient.js";
import { DEFAULT_ASSET_ADJUSTMENTS, getAssetAdjustmentMap, type AssetAdjustments } from "./assetAdjustments.service.js";
import { activityAnchorTag, getUploadConfig, placementAnchorTag } from "./uploadConfig.service.js";
import { isAudioAsset } from "./audioAsset.service.js";
import { getGpsDisabledAssetIds } from "./assetGpsUsage.service.js";

export interface Photo {
  id: string;
  mediaKind: "image" | "video" | "audio";
  audioUrl?: string;
  videoUrl?: string;
  linkedAudioUrl?: string;
  thumbnailUrl: string;
  previewUrl: string;
  width: number;
  height: number;
  orientation: "portrait" | "landscape" | "square";
  createdAt: string;
  exifInfo?: {
    make?: string;
    model?: string;
    focalLength?: number;
    description?: string;
    latitude?: number;
    longitude?: number;
  };
  faces?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  fileName: string;
  isFavorite: boolean;
  useGpsLocation: boolean;
  adjustments: AssetAdjustments;
  iconName?: string;
  activityIds?: number[];
}

export interface SlideshowQuery {
  albumIds?: string[];
  personIds?: string[];
  datePreset?: "all" | "today" | "week" | "month" | "year" | "custom";
  startDate?: string;
  endDate?: string;
  shuffle?: boolean;
  seed?: number;
  limit?: number;
  placementFocus?: {
    placementId: number;
    lat: number;
    lng: number;
    radiusKm: number;
    activityId?: number;
  };
}

function resolveDateRange(preset?: string, startDate?: string, endDate?: string) {
  if (preset !== "custom" && preset) {
    const now = new Date();
    switch (preset) {
      case "today":
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return { takenAfter: todayStart.toISOString() };
      case "week":
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return { takenAfter: weekAgo.toISOString() };
      case "month":
        const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        return { takenAfter: monthAgo.toISOString() };
      case "year":
        const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
        return { takenAfter: yearAgo.toISOString() };
      case "custom":
        return { takenAfter: startDate, takenBefore: endDate };
      default:
        return {};
    }
  }
  return { takenAfter: startDate, takenBefore: endDate };
}

function assetToPhoto(
  asset: ImmichAsset,
  adjustments?: AssetAdjustments,
  forceAudio = false,
  useGpsLocation = true,
  iconName?: string,
  activityIds?: number[],
  linkedAudioAssetId?: string,
): Photo {
  const audio = forceAudio || isAudioAsset(asset);
  const video = !audio && asset.type === "VIDEO";
  const imgW = asset.exifInfo?.exifImageWidth ?? asset.width ?? 1920;
  const imgH = asset.exifInfo?.exifImageHeight ?? asset.height ?? 1080;
  const ratio = imgW / imgH;

  let orientation: Photo["orientation"] = "landscape";
  if (ratio > 1.05) orientation = "landscape";
  else if (ratio < 0.95) orientation = "portrait";
  else orientation = "square";

  return {
    id: asset.id,
    mediaKind: audio ? "audio" : video ? "video" : "image",
    ...(audio
      ? {
          audioUrl: `/api/v1/assets/${asset.id}/original?v=${encodeURIComponent(
            asset.updatedAt || asset.fileModifiedAt || asset.checksum || asset.id,
          )}`,
        }
      : video
        ? {
            videoUrl: `/api/v1/assets/${asset.id}/original?v=${encodeURIComponent(
              asset.updatedAt || asset.fileModifiedAt || asset.checksum || asset.id,
            )}`,
          }
        : {}),
    thumbnailUrl: assetMediaUrl(asset, "thumbnail"),
    previewUrl: assetMediaUrl(asset, "preview"),
    width: imgW,
    height: imgH,
    orientation,
    createdAt: asset.fileCreatedAt || asset.updatedAt || "",
    exifInfo: asset.exifInfo
      ? {
          make: asset.exifInfo.make,
          model: asset.exifInfo.model,
          focalLength: asset.exifInfo.focalLength,
          description: asset.exifInfo.description,
          latitude: asset.exifInfo.latitude,
          longitude: asset.exifInfo.longitude,
        }
      : undefined,
    faces: asset.people
      ?.filter((p) => p.name)
      .map(() => ({ x: 0.5, y: 0.5, width: 0.15, height: 0.2 })),
    fileName: asset.originalFileName,
    isFavorite: asset.isFavorite ?? false,
    useGpsLocation,
    adjustments: adjustments ?? { ...DEFAULT_ASSET_ADJUSTMENTS },
    ...(iconName ? { iconName } : {}),
    ...(activityIds?.length ? { activityIds } : {}),
    ...(linkedAudioAssetId
      ? {
          linkedAudioUrl: `/api/v1/assets/${linkedAudioAssetId}/original`,
        }
      : {}),
  };
}

function assetMediaUrl(asset: ImmichAsset, kind: "thumbnail" | "preview") {
  const version = encodeURIComponent(asset.updatedAt || asset.fileModifiedAt || asset.checksum || asset.id);
  return `/api/v1/assets/${asset.id}/${kind}?v=${version}&edited=true`;
}

function seededShuffle<T>(array: T[], seed: number): T[] {
  const shuffled = [...array];
  let s = seed;
  for (let i = shuffled.length - 1; i > 0; i--) {
    s = (s * 16807 + 0) % 2147483647;
    const j = s % (i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function embeddedTagKeys(asset: ImmichAsset) {
  return new Set(
    (asset.tags ?? [])
      .flatMap((tag) => [tag.name, tag.value])
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function hasEmbeddedTags(assets: ImmichAsset[]) {
  return assets.every(
    (asset) => Array.isArray(asset.tags) && asset.tags.length > 0,
  );
}

async function mapEmbeddedFocusedMetadata(assets: ImmichAsset[]) {
  const config = await getUploadConfig();
  const activityByTag = new Map<string, number>();
  for (const activity of config.activities) {
    activityByTag.set(activityAnchorTag(activity.id).toLowerCase(), activity.id);
    activityByTag.set(activity.label.trim().toLowerCase(), activity.id);
  }

  const audioAssetIds = new Set<string>();
  const activityIdsByAssetId = new Map<string, Set<number>>();
  const adjustmentMap = new Map<string, AssetAdjustments>();
  const gpsDisabledAssetIds = new Set<string>();
  const iconNameByAssetId = new Map<string, string>();
  const linkedAudioAssetIdByAssetId = new Map<string, string>();

  for (const asset of assets) {
    const adjustments = { ...DEFAULT_ASSET_ADJUSTMENTS };
    let hasAdjustments = false;
    for (const key of embeddedTagKeys(asset)) {
      if (key === "media:audio") audioAssetIds.add(asset.id);
      if (key === "artasia:gps:disabled") gpsDisabledAssetIds.add(asset.id);
      if (/^icon:[a-z0-9_]+$/.test(key)) {
        iconNameByAssetId.set(asset.id, key.slice("icon:".length));
      }
      const linkedAudioMatch = key.match(
        /^linkedaudio:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
      );
      if (linkedAudioMatch) {
        linkedAudioAssetIdByAssetId.set(asset.id, linkedAudioMatch[1]);
      }

      const activityId = activityByTag.get(key);
      if (activityId != null) {
        const activityIds =
          activityIdsByAssetId.get(asset.id) ?? new Set<number>();
        activityIds.add(activityId);
        activityIdsByAssetId.set(asset.id, activityIds);
      }

      const adjustmentMatch = key.match(
        /^artasia:adjust:(brightness|contrast|saturation):(\d{1,3})$/,
      );
      if (adjustmentMatch) {
        const value = Number(adjustmentMatch[2]);
        if (value >= 50 && value <= 150) {
          adjustments[adjustmentMatch[1] as keyof AssetAdjustments] = value;
          hasAdjustments = true;
        }
      }
    }
    if (hasAdjustments) adjustmentMap.set(asset.id, adjustments);
  }

  return {
    activityIdsByAssetId,
    adjustmentMap,
    audioAssetIds,
    gpsDisabledAssetIds,
    iconNameByAssetId,
    linkedAudioAssetIdByAssetId,
  };
}

export async function querySlideshow(
  query: SlideshowQuery
): Promise<{ photos: Photo[]; total: number }> {
  const dateRange = resolveDateRange(
    query.datePreset,
    query.startDate,
    query.endDate
  );

  const limit = Math.min(query.limit ?? 100, 500);
  const [publishedAlbum, allTags] = await Promise.all([
    getPublishedAlbum(),
    listTags(),
  ]);
  const size = query.placementFocus ? 500 : limit;
  const audioTag = allTags.find((tag) => {
    const name = tag.name.trim().toLowerCase();
    const value = tag.value.trim().toLowerCase();
    return name === "media:audio" || value === "media:audio";
  });
  let assets: ImmichAsset[] = [];
  let audioIdSet = new Set<string>();
  let activityIdsByAssetId = new Map<string, Set<number>>();
  let adjustmentMap = new Map<string, AssetAdjustments>();
  let gpsDisabledAssetIds = new Set<string>();
  let iconNameByAssetId = new Map<string, string>();
  let linkedAudioAssetIdByAssetId = new Map<string, string>();
  let usesEmbeddedMetadata = false;

  if (query.placementFocus) {
    const focus = query.placementFocus;
    const directPlacementTag = placementAnchorTag(focus.placementId).toLowerCase();
    const placementTagIds = allTags
      .filter((tag) =>
        tag.name.trim().toLowerCase() === directPlacementTag ||
        tag.value.trim().toLowerCase() === directPlacementTag
      )
      .map((tag) => tag.id);

    const taggedResults = await Promise.all(
      placementTagIds.map((tagId) =>
        searchAssets({
          albumIds: [publishedAlbum.id],
          tagIds: [tagId],
          visibility: "timeline",
          size: 500,
          takenAfter: dateRange.takenAfter,
          takenBefore: dateRange.takenBefore,
        }),
      ),
    );
    const byId = new Map<string, ImmichAsset>();
    for (const asset of taggedResults.flatMap((result) => result.assets.items)) {
      byId.set(asset.id, asset);
    }
    assets = Array.from(byId.values());

    usesEmbeddedMetadata = hasEmbeddedTags(assets);
    if (usesEmbeddedMetadata) {
      const metadata = await mapEmbeddedFocusedMetadata(assets);
      audioIdSet = metadata.audioAssetIds;
      activityIdsByAssetId = metadata.activityIdsByAssetId;
      adjustmentMap = metadata.adjustmentMap;
      gpsDisabledAssetIds = metadata.gpsDisabledAssetIds;
      iconNameByAssetId = metadata.iconNameByAssetId;
      linkedAudioAssetIdByAssetId = metadata.linkedAudioAssetIdByAssetId;
    } else {
      const audioAssetIds = audioTag
        ? await searchAssetIdsByTag(audioTag.id)
        : [];
      audioIdSet = new Set(audioAssetIds);

      const config = await getUploadConfig();
      const activityAssignments = config.activities.map((activity) => {
        const anchorTagName = activityAnchorTag(activity.id).toLowerCase();
        const labelNorm = activity.label.trim().toLowerCase();
        const tagIds = allTags
          .filter((tag) => {
            const tagKeys = [tag.name, tag.value].map((value) =>
              value.trim().toLowerCase(),
            );
            return (
              tagKeys.includes(anchorTagName) || tagKeys.includes(labelNorm)
            );
          })
          .map((tag) => tag.id);
        return { activityId: activity.id, tagIds: [...new Set(tagIds)] };
      });
      const activityMemberships = await Promise.all(
        activityAssignments.map(async ({ activityId, tagIds }) => {
          const assetIdsByTag = await searchAssetIdsByTags(tagIds);
          return {
            activityId,
            assetIds: tagIds.flatMap((tagId) => assetIdsByTag.get(tagId) ?? []),
          };
        }),
      );
      const placementAssetIds = new Set(assets.map((asset) => asset.id));
      for (const membership of activityMemberships) {
        for (const assetId of membership.assetIds) {
          if (!placementAssetIds.has(assetId)) continue;
          const activityIds =
            activityIdsByAssetId.get(assetId) ?? new Set<number>();
          activityIds.add(membership.activityId);
          activityIdsByAssetId.set(assetId, activityIds);
        }
      }
    }

    assets = assets.filter(
      (asset) => asset.type === "IMAGE" || asset.type === "VIDEO",
    );
    if (focus.activityId != null && Number.isFinite(focus.activityId)) {
      assets = assets.filter((asset) =>
        activityIdsByAssetId.get(asset.id)?.has(focus.activityId as number),
      );
    }
  } else {
    const [imageResult, videoResult, audioAssetIds] = await Promise.all([
      searchAssets({
        albumIds: [publishedAlbum.id],
        personIds: query.personIds,
        type: "IMAGE",
        visibility: "timeline",
        size,
        takenAfter: dateRange.takenAfter,
        takenBefore: dateRange.takenBefore,
      }),
      searchAssets({
        albumIds: [publishedAlbum.id],
        type: "VIDEO",
        visibility: "timeline",
        size,
        takenAfter: dateRange.takenAfter,
        takenBefore: dateRange.takenBefore,
      }),
      audioTag ? searchAssetIdsByTag(audioTag.id) : Promise.resolve([]),
    ]);
    audioIdSet = new Set(audioAssetIds);
    assets = [
      ...imageResult.assets.items.filter((asset) => asset.type === "IMAGE"),
      ...videoResult.assets.items.filter((asset) => asset.type === "VIDEO"),
    ];
  }

  const assetIds = assets.map((asset) => asset.id);
  if (!usesEmbeddedMetadata) {
    const assetIdSet = new Set(assetIds);
    const iconTags = allTags.flatMap((tag) => {
      const keys = [tag.name, tag.value].map((value) =>
        value.trim().toLowerCase(),
      );
      const key = keys.find((value) => /^icon:[a-z0-9_]+$/.test(value));
      return key ? [{ tagId: tag.id, iconName: key.slice(5) }] : [];
    });
    const linkedAudioTags = allTags.flatMap((tag) => {
      const key = [tag.name, tag.value]
        .map((value) => value.trim().toLowerCase())
        .find((value) =>
          /^linkedaudio:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            value,
          ),
        );
      return key
        ? [{
            tagId: tag.id,
            linkedAudioAssetId: key.slice("linkedaudio:".length),
          }]
        : [];
    });
    const enrichment = await Promise.all([
      getAssetAdjustmentMap(assetIds),
      getGpsDisabledAssetIds(assetIds),
      (async () => {
        const assetIdsByTag = await searchAssetIdsByTags(
          iconTags.map((iconTag) => iconTag.tagId),
        );
        return iconTags.map((iconTag) => ({
          ...iconTag,
          assetIds: assetIdsByTag.get(iconTag.tagId) ?? [],
        }));
      })(),
      (async () => {
        const assetIdsByTag = await searchAssetIdsByTags(
          linkedAudioTags.map((linkedAudioTag) => linkedAudioTag.tagId),
        );
        return linkedAudioTags.map((linkedAudioTag) => ({
          ...linkedAudioTag,
          assetIds: assetIdsByTag.get(linkedAudioTag.tagId) ?? [],
        }));
      })(),
    ]);
    adjustmentMap = enrichment[0];
    gpsDisabledAssetIds = enrichment[1];
    for (const assignment of enrichment[2]) {
      for (const assetId of assignment.assetIds) {
        if (assetIdSet.has(assetId) && !iconNameByAssetId.has(assetId)) {
          iconNameByAssetId.set(assetId, assignment.iconName);
        }
      }
    }
    for (const assignment of enrichment[3]) {
      for (const assetId of assignment.assetIds) {
        if (assetIdSet.has(assetId)) {
          linkedAudioAssetIdByAssetId.set(
            assetId,
            assignment.linkedAudioAssetId,
          );
        }
      }
    }
  }
  let photos = assets.map((asset) =>
    assetToPhoto(
      asset,
      adjustmentMap.get(asset.id),
      audioIdSet.has(asset.id),
      !gpsDisabledAssetIds.has(asset.id),
      iconNameByAssetId.get(asset.id),
      Array.from(activityIdsByAssetId.get(asset.id) ?? []),
      linkedAudioAssetIdByAssetId.get(asset.id),
    ),
  );

  if (query.shuffle && query.seed != null) {
    photos = seededShuffle(photos, query.seed);
  }

  const total = photos.length;

  return { photos: photos.slice(0, limit), total };
}
