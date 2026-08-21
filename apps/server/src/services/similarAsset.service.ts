import {
  getAsset,
  getPublishedAlbum,
  searchSimilarAssets,
  type ImmichAsset,
} from "../infra/ImmichClient.js";
import {
  getCustomActivityFromValues,
  getMapPlacements,
  getUploadConfig,
  type ActivityConfig,
  type ArtasiaMapPlacement,
} from "./uploadConfig.service.js";
import { getAssetTypeFromTagValues } from "./assetType.service.js";
import {
  assetToPhoto,
  type Photo,
} from "./slideshow.service.js";

const PLACEMENT_TAG_PATTERN = /^placement:(\d+)$/i;

export interface SimilarAssetRecommendation {
  asset: Photo;
  placement: Pick<ArtasiaMapPlacement, "placement_id" | "placement_name" | "placement_slug" | "section">;
  contextualLabels: string[];
}

function assetTagValues(asset: ImmichAsset): string[] {
  return (asset.tags ?? []).flatMap((tag) => [tag.name, tag.value])
    .map((value) => value.trim())
    .filter(Boolean);
}

function placementIdsForAsset(asset: ImmichAsset): number[] {
  return assetTagValues(asset)
    .map((value) => value.match(PLACEMENT_TAG_PATTERN)?.[1])
    .flatMap((value) => value ? [Number(value)] : [])
    .filter((value) => Number.isInteger(value) && value > 0);
}

function activityLabelsForAsset(asset: ImmichAsset, activities: ActivityConfig[]): string[] {
  const values = new Set(assetTagValues(asset).map((value) => value.toLocaleLowerCase()));
  const labels = activities.flatMap((activity) => {
    const anchor = `activity:${activity.id}`.toLocaleLowerCase();
    return values.has(anchor) || values.has(activity.label.toLocaleLowerCase())
      ? [activity.label]
      : [];
  });
  const customActivity = getCustomActivityFromValues(assetTagValues(asset));
  if (customActivity) labels.push(customActivity);
  return [...new Set(labels)];
}

function getAssetIconName(asset: ImmichAsset): string | undefined {
  const iconTag = assetTagValues(asset).find((value) => /^icon:[a-z0-9_]+$/i.test(value));
  return iconTag?.slice("icon:".length);
}

function getAssetTypeTags(asset: ImmichAsset): string[] {
  return getAssetTypeFromTagValues(assetTagValues(asset)) === "process"
    ? ["process"]
    : [];
}

function mapRecommendationAsset(
  asset: ImmichAsset,
  placement: ArtasiaMapPlacement,
  activities: ActivityConfig[],
): SimilarAssetRecommendation {
  const labels = activityLabelsForAsset(asset, activities);
  const photo = assetToPhoto(
    asset,
    undefined,
    false,
    true,
    getAssetIconName(asset),
    [],
    [],
    undefined,
    getAssetTypeTags(asset).length > 0 ? "process" : "artwork",
  );
  photo.placementId = placement.placement_id;
  return {
    asset: photo,
    placement: {
      placement_id: placement.placement_id,
      placement_name: placement.placement_name,
      ...(placement.placement_slug ? { placement_slug: placement.placement_slug } : {}),
      ...(placement.section ? { section: placement.section } : {}),
    },
    contextualLabels: labels,
  };
}

export async function findSimilarAsset(
  assetId: string,
  excludedPlacementId?: number,
): Promise<SimilarAssetRecommendation | null> {
  const [source, publishedAlbum, placements, config] = await Promise.all([
    getAsset(assetId),
    getPublishedAlbum(),
    getMapPlacements(),
    getUploadConfig(),
  ]);
  const excludedPlacementIds = new Set(placementIdsForAsset(source));
  if (excludedPlacementId != null) excludedPlacementIds.add(excludedPlacementId);

  const placementById = new Map(placements.map((placement) => [placement.placement_id, placement]));
  const results = await searchSimilarAssets({
    assetId,
    albumIds: [publishedAlbum.id],
    type: "IMAGE",
    size: 50,
  });

  for (const candidate of results) {
    if (candidate.id === assetId || candidate.type !== "IMAGE" || candidate.isArchived || candidate.isTrashed) {
      continue;
    }

    const placement = placementIdsForAsset(candidate)
      .filter((placementId) => !excludedPlacementIds.has(placementId))
      .map((placementId) => placementById.get(placementId))
      .find((value): value is ArtasiaMapPlacement => Boolean(value));
    if (!placement) continue;

    return mapRecommendationAsset(candidate, placement, config.activities);
  }

  return null;
}
