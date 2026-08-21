import {
  getAsset,
  getPublishedAlbum,
  listTags,
  searchAssetIdsByTags,
  searchSimilarAssets,
  type ImmichAsset,
} from "../infra/ImmichClient.js";
import {
  getCustomActivityFromValues,
  getMapPlacements,
  getUploadConfig,
  placementAnchorTag,
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

function placementTagIdsForPlacements(
  tags: Awaited<ReturnType<typeof listTags>>,
  placementIds: Iterable<number>,
): string[] {
  const requestedTags = new Set(
    Array.from(placementIds, (placementId) =>
      placementAnchorTag(placementId).toLocaleLowerCase(),
    ),
  );
  return tags.flatMap((tag) => {
    const matches = [tag.name, tag.value]
      .map((value) => value.trim().toLocaleLowerCase())
      .some((value) => requestedTags.has(value));
    return matches ? [tag.id] : [];
  });
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

  const placementTagIds = placementTagIdsForPlacements(
    await listTags(),
    excludedPlacementIds,
  );
  const excludedPlacementAssetIds = new Set<string>();
  if (placementTagIds.length > 0) {
    const assetIdsByTag = await searchAssetIdsByTags(placementTagIds);
    for (const assetIds of assetIdsByTag.values()) {
      for (const assetId of assetIds) excludedPlacementAssetIds.add(assetId);
    }
  }

  const placementById = new Map(placements.map((placement) => [placement.placement_id, placement]));
  const results = await searchSimilarAssets({
    assetId,
    albumIds: [publishedAlbum.id],
    type: "IMAGE",
    size: 50,
  });

  const eligibleRecommendations: SimilarAssetRecommendation[] = [];
  for (const candidate of results) {
    if (
      candidate.id === assetId ||
      excludedPlacementAssetIds.has(candidate.id) ||
      candidate.type !== "IMAGE" ||
      candidate.isArchived ||
      candidate.isTrashed
    ) {
      continue;
    }

    // Smart-search results use Immich's lightweight search projection, which
    // does not include tags. Fetch full metadata only for candidates that have
    // already survived the current-placement exclusion.
    const fullCandidate = await getAsset(candidate.id);
    const placement = placementIdsForAsset(fullCandidate)
      .filter((placementId) => !excludedPlacementIds.has(placementId))
      .map((placementId) => placementById.get(placementId))
      .find((value): value is ArtasiaMapPlacement => Boolean(value));
    if (!placement) continue;

    eligibleRecommendations.push(
      mapRecommendationAsset(fullCandidate, placement, config.activities),
    );
    if (eligibleRecommendations.length >= 5) break;
  }

  if (eligibleRecommendations.length === 0) return null;
  return eligibleRecommendations[
    Math.floor(Math.random() * eligibleRecommendations.length)
  ];
}
