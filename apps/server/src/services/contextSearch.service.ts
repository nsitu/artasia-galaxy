import {
  getPublishedAlbum,
  listTags,
  searchAssetIdsByTags,
  searchContextAssets,
  type ImmichAsset,
} from "../infra/ImmichClient.js";
import {
  assetToPhoto,
  type Photo,
} from "./slideshow.service.js";
import { getMapPlacements, type ArtasiaMapPlacement } from "./uploadConfig.service.js";

const PLACEMENT_TAG_PATTERN = /^(?:placement|display-placement):(\d+)$/i;
const CONTEXT_SEARCH_RESULT_LIMIT = 40;

export interface ContextSearchResult {
  placementId: number;
  asset: Photo;
}

function placementIdFromTag(tag: { name: string; value: string }): number | null {
  for (const value of [tag.name, tag.value]) {
    const match = value.trim().match(PLACEMENT_TAG_PATTERN);
    if (!match) continue;
    const placementId = Number(match[1]);
    if (Number.isInteger(placementId) && placementId > 0) return placementId;
  }
  return null;
}

function mapContextAsset(asset: ImmichAsset, placementId: number): ContextSearchResult {
  const photo = assetToPhoto(asset);
  photo.placementId = placementId;
  return { placementId, asset: photo };
}

export async function searchContextPlacements(query: string): Promise<ContextSearchResult[]> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) return [];

  const [publishedAlbum, tags, placements] = await Promise.all([
    getPublishedAlbum(),
    listTags(),
    getMapPlacements(),
  ]);
  const placementById = new Map<number, ArtasiaMapPlacement>(
    placements.map((placement) => [placement.placement_id, placement]),
  );
  const placementTagEntries = tags.flatMap((tag) => {
    const placementId = placementIdFromTag(tag);
    return placementId != null && placementById.has(placementId)
      ? [{ tagId: tag.id, placementId }]
      : [];
  });
  const assetIdsByTag = await searchAssetIdsByTags(
    placementTagEntries.map((entry) => entry.tagId),
  );
  const placementIdsByAssetId = new Map<string, Set<number>>();
  for (const entry of placementTagEntries) {
    for (const assetId of assetIdsByTag.get(entry.tagId) ?? []) {
      const placementIds = placementIdsByAssetId.get(assetId) ?? new Set<number>();
      placementIds.add(entry.placementId);
      placementIdsByAssetId.set(assetId, placementIds);
    }
  }

  const assets = await searchContextAssets({
    query: normalizedQuery,
    albumIds: [publishedAlbum.id],
    type: "IMAGE",
    size: CONTEXT_SEARCH_RESULT_LIMIT,
  });
  const firstAssetByPlacementId = new Map<number, ImmichAsset>();
  for (const asset of assets) {
    if (asset.type !== "IMAGE" || asset.isArchived || asset.isTrashed) continue;
    for (const placementId of placementIdsByAssetId.get(asset.id) ?? []) {
      if (!firstAssetByPlacementId.has(placementId)) {
        firstAssetByPlacementId.set(placementId, asset);
      }
    }
  }

  return [...firstAssetByPlacementId.entries()]
    .sort(([left], [right]) => left - right)
    .map(([placementId, asset]) => mapContextAsset(asset, placementId));
}
