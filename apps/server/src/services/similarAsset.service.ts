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
export const DEFAULT_SIMILAR_RESULT_LIMIT = 5;
export const MAX_SIMILAR_RESULT_LIMIT = 500;
const PLACEMENT_TAG_SEARCH_CONCURRENCY = 4;

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

function placementTagEntriesForPlacements(
  tags: Awaited<ReturnType<typeof listTags>>,
  placementIds: Iterable<number>,
): Array<{ tagId: string; placementId: number }> {
  const requestedTags = new Map(
    Array.from(placementIds, (placementId) => [
      placementAnchorTag(placementId).toLocaleLowerCase(),
      placementId,
    ] as const),
  );
  return tags.flatMap((tag) => {
    const placementId = [tag.name, tag.value]
      .map((value) => requestedTags.get(value.trim().toLocaleLowerCase()))
      .find((value): value is number => value != null);
    return placementId == null ? [] : [{ tagId: tag.id, placementId }];
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

export async function findSimilarAssets(
  assetId: string,
  excludedPlacementId?: number,
  resultLimit = DEFAULT_SIMILAR_RESULT_LIMIT,
): Promise<SimilarAssetRecommendation[]> {
  const requestedResultLimit = Number.isFinite(resultLimit)
    ? resultLimit
    : DEFAULT_SIMILAR_RESULT_LIMIT;
  const normalizedResultLimit = Math.max(
    1,
    Math.min(MAX_SIMILAR_RESULT_LIMIT, Math.floor(requestedResultLimit)),
  );
  const [source, publishedAlbum, placements, config] = await Promise.all([
    getAsset(assetId),
    getPublishedAlbum(),
    getMapPlacements(),
    getUploadConfig(),
  ]);
  const excludedPlacementIds = new Set(placementIdsForAsset(source));
  if (excludedPlacementId != null) excludedPlacementIds.add(excludedPlacementId);

  const placementById = new Map(placements.map((placement) => [placement.placement_id, placement]));
  const placementTagEntries = placementTagEntriesForPlacements(
    await listTags(),
    placementById.keys(),
  );
  const placementByTagId = new Map(
    placementTagEntries.map(({ tagId, placementId }) => [tagId, placementId]),
  );
  // Immich's legacy metadata search treats multiple tagIds as an all-of
  // filter, so query each placement tag once and assemble the index locally.
  // The tag lookup cache keeps this work out of subsequent similar searches.
  const assetIdsByTag = await searchAssetIdsByTags(
    placementTagEntries.map(({ tagId }) => tagId),
    PLACEMENT_TAG_SEARCH_CONCURRENCY,
  );
  const placementIdsByAssetId = new Map<string, Set<number>>();
  for (const [tagId, assetIds] of assetIdsByTag) {
    const placementId = placementByTagId.get(tagId);
    if (placementId == null) continue;
    for (const candidateAssetId of assetIds) {
      const placementIdsForAsset = placementIdsByAssetId.get(candidateAssetId) ?? new Set<number>();
      placementIdsForAsset.add(placementId);
      placementIdsByAssetId.set(candidateAssetId, placementIdsForAsset);
    }
  }

  const results = await searchSimilarAssets({
    assetId,
    albumIds: [publishedAlbum.id],
    type: "IMAGE",
    size: Math.max(50, normalizedResultLimit),
  });

  const eligibleRecommendations: SimilarAssetRecommendation[] = [];
  const recommendationPlacementIds = new Set<number>();
  for (const candidate of results) {
    if (
      candidate.id === assetId ||
      candidate.type !== "IMAGE" ||
      candidate.isArchived ||
      candidate.isTrashed
    ) {
      continue;
    }

    // Smart-search results use Immich's lightweight search projection, which
    // does not include tags. Resolve placement from the tag index, then fetch
    // full metadata only for the first candidate selected for each placement.
    const placement = [...(placementIdsByAssetId.get(candidate.id) ?? [])]
      .filter((placementId) => !excludedPlacementIds.has(placementId))
      .map((placementId) => placementById.get(placementId))
      .find((value): value is ArtasiaMapPlacement => Boolean(value));
    if (!placement) continue;
    if (recommendationPlacementIds.has(placement.placement_id)) continue;

    const fullCandidate = await getAsset(candidate.id);
    recommendationPlacementIds.add(placement.placement_id);
    eligibleRecommendations.push(
      mapRecommendationAsset(fullCandidate, placement, config.activities),
    );
    if (eligibleRecommendations.length >= normalizedResultLimit) break;
  }

  return eligibleRecommendations;
}

export function pickSimilarAsset(
  recommendations: SimilarAssetRecommendation[],
): SimilarAssetRecommendation | null {
  if (recommendations.length === 0) return null;
  return recommendations[
    Math.floor(Math.random() * recommendations.length)
  ];
}

export async function findSimilarAsset(
  assetId: string,
  excludedPlacementId?: number,
): Promise<SimilarAssetRecommendation | null> {
  return pickSimilarAsset(await findSimilarAssets(assetId, excludedPlacementId));
}
