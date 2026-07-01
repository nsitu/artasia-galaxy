import { getPublishedAlbum, listTags, searchAssets, ImmichAsset } from "../infra/ImmichClient.js";
import { getUploadConfig, placementAnchorTag } from "./uploadConfig.service.js";

export interface Photo {
  id: string;
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

function assetToPhoto(asset: ImmichAsset): Photo {
  const imgW = asset.exifInfo?.exifImageWidth ?? 1920;
  const imgH = asset.exifInfo?.exifImageHeight ?? 1080;
  const ratio = imgW / imgH;

  let orientation: Photo["orientation"] = "landscape";
  if (ratio > 1.05) orientation = "landscape";
  else if (ratio < 0.95) orientation = "portrait";
  else orientation = "square";

  return {
    id: asset.id,
    thumbnailUrl: `/api/v1/assets/${asset.id}/thumbnail`,
    previewUrl: `/api/v1/assets/${asset.id}/preview`,
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
  };
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

function haversineKm(a: [number, number], b: [number, number]) {
  const earthRadiusKm = 6371;
  const dLat = degToRad(b[0] - a[0]);
  const dLng = degToRad(b[1] - a[1]);
  const lat1 = degToRad(a[0]);
  const lat2 = degToRad(b[0]);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
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

  const result = await searchAssets({
    albumIds: [publishedAlbum.id],
    personIds: query.personIds,
    type: "IMAGE",
    size,
    takenAfter: dateRange.takenAfter,
    takenBefore: dateRange.takenBefore,
  });

  let assets = result.assets.items.filter((a) => a.type === "IMAGE");

  if (query.placementFocus) {
    const focus = query.placementFocus;
    const publishedAssetIds = new Set(assets.map((asset) => asset.id));
    const nearAssets = assets.filter((asset) => {
      const lat = asset.exifInfo?.latitude;
      const lng = asset.exifInfo?.longitude;
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      return haversineKm([focus.lat, focus.lng], [lat as number, lng as number]) <= focus.radiusKm;
    });

    const config = await getUploadConfig();
    const placement = config.placements.find((item) => item.placement_id === focus.placementId);
    const possibleTagNames = [
      placementAnchorTag(focus.placementId),
      placement?.partner_name,
      placement?.placement_name,
    ]
      .map((name) => name?.trim().toLowerCase())
      .filter((name): name is string => Boolean(name));

    const allTags = await listTags();
    const placementTagIds = allTags
      .filter((tag) => possibleTagNames.includes(tag.name.trim().toLowerCase()) ||
        possibleTagNames.includes(tag.value.trim().toLowerCase()))
      .map((tag) => tag.id);

    const taggedResults = await Promise.all(
      placementTagIds.map((tagId) =>
        searchAssets({
          tagIds: [tagId],
          type: "IMAGE",
          size: 500,
        })
      )
    );
    const taggedAssets = taggedResults
      .flatMap((tagResult) => tagResult.assets.items)
      .filter((asset) => asset.type === "IMAGE" && publishedAssetIds.has(asset.id));

    const byId = new Map<string, ImmichAsset>();
    for (const asset of [...nearAssets, ...taggedAssets]) byId.set(asset.id, asset);
    assets = Array.from(byId.values());
  }

  let photos = assets.map(assetToPhoto);

  if (query.shuffle && query.seed != null) {
    photos = seededShuffle(photos, query.seed);
  }

  const total = photos.length;

  return { photos: photos.slice(0, limit), total };
}
