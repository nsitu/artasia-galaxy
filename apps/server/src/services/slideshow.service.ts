import { getPublishedAlbum, listTags, searchAssetIdsByTag, searchAssets, ImmichAsset } from "../infra/ImmichClient.js";
import { DEFAULT_ASSET_ADJUSTMENTS, getAssetAdjustmentMap, type AssetAdjustments } from "./assetAdjustments.service.js";
import { activityAnchorTag, getUploadConfig, placementAnchorTag } from "./uploadConfig.service.js";
import { isAudioAsset } from "./audioAsset.service.js";

export interface Photo {
  id: string;
  mediaKind: "image" | "audio";
  audioUrl?: string;
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
  adjustments: AssetAdjustments;
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
): Photo {
  const audio = forceAudio || isAudioAsset(asset);
  const imgW = asset.exifInfo?.exifImageWidth ?? 1920;
  const imgH = asset.exifInfo?.exifImageHeight ?? 1080;
  const ratio = imgW / imgH;

  let orientation: Photo["orientation"] = "landscape";
  if (ratio > 1.05) orientation = "landscape";
  else if (ratio < 0.95) orientation = "portrait";
  else orientation = "square";

  return {
    id: asset.id,
    mediaKind: audio ? "audio" : "image",
    ...(audio
      ? {
          audioUrl: `/api/v1/assets/${asset.id}/original?v=${encodeURIComponent(
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
    adjustments: adjustments ?? { ...DEFAULT_ASSET_ADJUSTMENTS },
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

export async function querySlideshow(
  query: SlideshowQuery
): Promise<{ photos: Photo[]; total: number }> {
  const dateRange = resolveDateRange(
    query.datePreset,
    query.startDate,
    query.endDate
  );

  const limit = Math.min(query.limit ?? 100, 500);
  const publishedAlbum = await getPublishedAlbum();
  const size = query.placementFocus ? 500 : limit;

  const allTags = await listTags();
  const audioTag = allTags.find((tag) => {
    const name = tag.name.trim().toLowerCase();
    const value = tag.value.trim().toLowerCase();
    return name === "media:audio" || value === "media:audio";
  });
  const [imageResult, videoResult, audioAssetIds] = await Promise.all([
    searchAssets({
      albumIds: [publishedAlbum.id],
      personIds: query.personIds,
      type: "IMAGE",
      size,
      takenAfter: dateRange.takenAfter,
      takenBefore: dateRange.takenBefore,
    }),
    searchAssets({
      albumIds: [publishedAlbum.id],
      type: "VIDEO",
      size,
      takenAfter: dateRange.takenAfter,
      takenBefore: dateRange.takenBefore,
    }),
    audioTag ? searchAssetIdsByTag(audioTag.id) : Promise.resolve([]),
  ]);

  const audioIdSet = new Set(audioAssetIds);
  let assets = [
    ...imageResult.assets.items.filter((asset) => asset.type === "IMAGE"),
    ...videoResult.assets.items.filter(
      (asset) => asset.type === "VIDEO" && audioIdSet.has(asset.id),
    ),
  ];

  if (query.placementFocus) {
    const focus = query.placementFocus;
    const publishedAssetIds = new Set(assets.map((asset) => asset.id));
    const directPlacementTag = placementAnchorTag(focus.placementId).toLowerCase();

    const placementTagIds = allTags
      .filter((tag) =>
        tag.name.trim().toLowerCase() === directPlacementTag ||
        tag.value.trim().toLowerCase() === directPlacementTag
      )
      .map((tag) => tag.id);

    const taggedResults = await Promise.all(
      placementTagIds.flatMap((tagId) =>
        (["IMAGE", "VIDEO"] as const).map((type) =>
          searchAssets({
            tagIds: [tagId],
            type,
            size: 500,
          }),
        ),
      ),
    );
    const taggedAssets = taggedResults
      .flatMap((tagResult) => tagResult.assets.items)
      .filter(
        (asset) =>
          publishedAssetIds.has(asset.id) &&
          (asset.type === "IMAGE" ||
            (asset.type === "VIDEO" && audioIdSet.has(asset.id))),
      );

    const byId = new Map<string, ImmichAsset>();
    for (const asset of taggedAssets) byId.set(asset.id, asset);
    assets = Array.from(byId.values());

    if (focus.activityId != null && Number.isFinite(focus.activityId)) {
      const config = await getUploadConfig();
      const activity = config.activities.find((a) => a.id === focus.activityId);
      if (!activity) {
        assets = [];
      } else {
        const anchorTagName = activityAnchorTag(focus.activityId);
        const labelNorm = activity.label.trim().toLowerCase();
        const activityTagIds = allTags
          .filter((tag) =>
            tag.name.trim().toLowerCase() === anchorTagName ||
            tag.value.trim().toLowerCase() === anchorTagName ||
            tag.name.trim().toLowerCase() === labelNorm ||
            tag.value.trim().toLowerCase() === labelNorm
          )
          .map((tag) => tag.id);

        if (activityTagIds.length === 0) {
          assets = [];
        } else {
          const activityAssetIds = new Set(
            (await Promise.all(activityTagIds.map(searchAssetIdsByTag))).flat()
          );
          assets = assets.filter((asset) => activityAssetIds.has(asset.id));
        }
      }
    }
  }

  const adjustmentMap = await getAssetAdjustmentMap(assets.map((asset) => asset.id));
  let photos = assets.map((asset) =>
    assetToPhoto(asset, adjustmentMap.get(asset.id), audioIdSet.has(asset.id)),
  );

  if (query.shuffle && query.seed != null) {
    photos = seededShuffle(photos, query.seed);
  }

  const total = photos.length;

  return { photos: photos.slice(0, limit), total };
}
