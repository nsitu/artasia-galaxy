import {
  ensureTag,
  listTags,
  searchAssets,
  tagAssets,
  untagAssets,
  type ImmichTag,
} from "../infra/ImmichClient.js";
import { getArtasiaPlacements, type WpArtasiaPlacement } from "../infra/WordPressClient.js";
import { placementAnchorTag } from "./uploadConfig.service.js";

const PAGE_SIZE = 500;
const MUTATION_BATCH_SIZE = 250;

export interface PlacementTagCleanupTagReport {
  tagId: string;
  tagName: string;
  placementIds: number[];
  assetCount: number;
  membershipsToRemove: number;
}

export interface PlacementTagCleanupIssue {
  assetId: string;
  legacyTags: string[];
  candidatePlacementIds: number[];
  durablePlacementIds: number[];
  reason: "ambiguous" | "conflict";
}

export interface PlacementTagCleanupReport {
  dryRun: boolean;
  generatedAt: string;
  placementsScanned: number;
  legacyTagsFound: number;
  legacyMemberships: number;
  assetsWithLegacyTags: number;
  assetsAlreadyAnchored: number;
  assetsToAnchor: number;
  membershipsToRemove: number;
  ambiguousAssets: PlacementTagCleanupIssue[];
  conflictingAssets: PlacementTagCleanupIssue[];
  legacyTags: PlacementTagCleanupTagReport[];
}

type LegacyTagState = {
  tag: ImmichTag;
  placementIds: Set<number>;
  assetIds: Set<string>;
};

type CleanupState = {
  report: PlacementTagCleanupReport;
  anchorTagByPlacementId: Map<number, ImmichTag>;
  assetsToAnchorByPlacement: Map<number, Set<string>>;
  legacyAssetsToCleanByTag: Map<string, Set<string>>;
};

function normalize(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase();
}

function tagValues(tag: ImmichTag): string[] {
  return [tag.name, tag.value].map(normalize).filter(Boolean);
}

function isDurablePlacementTag(value: string): boolean {
  return /^placement:\d+$/.test(value) || /^display-placement:\d+$/.test(value);
}

function findPlacementId(value: string): number | null {
  const match = value.match(/^placement:(\d+)$/);
  return match ? Number(match[1]) : null;
}

async function searchAllAssetIdsByTag(tagId: string): Promise<Set<string>> {
  const assetIds = new Set<string>();
  for (const visibility of ["timeline", "archive"] as const) {
    let page = 1;
    for (;;) {
      const result = await searchAssets({
        tagIds: [tagId],
        visibility,
        page,
        size: PAGE_SIZE,
        withExif: false,
        withPeople: false,
      });
      for (const asset of result.assets.items) assetIds.add(asset.id);
      if (!result.assets.nextPage || result.assets.items.length < PAGE_SIZE) break;
      page += 1;
    }
  }
  return assetIds;
}

function addPlacementName(
  index: Map<string, Set<number>>,
  name: string | undefined,
  placementId: number,
) {
  const key = normalize(name ?? "");
  if (!key) return;
  const ids = index.get(key) ?? new Set<number>();
  ids.add(placementId);
  index.set(key, ids);
}

function candidatesForTag(
  tag: ImmichTag,
  placementNames: Map<string, Set<number>>,
  partnerNames: Map<string, Set<number>>,
): Set<number> {
  const candidates = new Set<number>();
  for (const value of tagValues(tag)) {
    for (const placementId of placementNames.get(value) ?? []) candidates.add(placementId);
    for (const placementId of partnerNames.get(value) ?? []) candidates.add(placementId);
  }
  return candidates;
}

function placementNameMap(placements: WpArtasiaPlacement[]) {
  const placementNames = new Map<string, Set<number>>();
  const partnerNames = new Map<string, Set<number>>();
  for (const placement of placements) {
    addPlacementName(placementNames, placement.placement_name, placement.placement_id);
    addPlacementName(partnerNames, placement.partner?.name, placement.placement_id);
  }
  return { placementNames, partnerNames };
}

async function loadCleanupState(): Promise<CleanupState> {
  const [placements, tags] = await Promise.all([
    getArtasiaPlacements({ forceFresh: true }),
    listTags(),
  ]);
  const { placementNames, partnerNames } = placementNameMap(placements);

  const anchorTagByPlacementId = new Map<number, ImmichTag>();
  for (const tag of tags) {
    for (const value of tagValues(tag)) {
      const placementId = findPlacementId(value);
      if (placementId != null) anchorTagByPlacementId.set(placementId, tag);
    }
  }

  const legacyTagStates = tags
    .map((tag) => ({
      tag,
      placementIds: candidatesForTag(tag, placementNames, partnerNames),
      assetIds: new Set<string>(),
    }))
    .filter((state) =>
      state.placementIds.size > 0 &&
      !tagValues(state.tag).some(isDurablePlacementTag),
    );

  await Promise.all(
    legacyTagStates.map(async (state) => {
      state.assetIds = await searchAllAssetIdsByTag(state.tag.id);
    }),
  );

  const durableMemberships = new Map<string, Set<number>>();
  await Promise.all(
    [...anchorTagByPlacementId.entries()].map(async ([placementId, tag]) => {
      const assetIds = await searchAllAssetIdsByTag(tag.id);
      for (const assetId of assetIds) {
        const placementsForAsset = durableMemberships.get(assetId) ?? new Set<number>();
        placementsForAsset.add(placementId);
        durableMemberships.set(assetId, placementsForAsset);
      }
    }),
  );

  const legacyByAsset = new Map<string, { tags: Set<LegacyTagState>; candidates: Set<number> }>();
  for (const state of legacyTagStates) {
    for (const assetId of state.assetIds) {
      const entry = legacyByAsset.get(assetId) ?? {
        tags: new Set<LegacyTagState>(),
        candidates: new Set<number>(),
      };
      entry.tags.add(state);
      for (const placementId of state.placementIds) entry.candidates.add(placementId);
      legacyByAsset.set(assetId, entry);
    }
  }

  const assetsToAnchorByPlacement = new Map<number, Set<string>>();
  const legacyAssetsToCleanByTag = new Map<string, Set<string>>();
  const ambiguousAssets: PlacementTagCleanupIssue[] = [];
  const conflictingAssets: PlacementTagCleanupIssue[] = [];

  for (const [assetId, entry] of legacyByAsset) {
    const durablePlacementIds = durableMemberships.get(assetId) ?? new Set<number>();
    const candidatePlacementIds = [...entry.candidates].sort((a, b) => a - b);
    const durableIds = [...durablePlacementIds].sort((a, b) => a - b);
    const legacyTags = [...entry.tags].map((state) => state.tag.name).sort();

    if (durablePlacementIds.size === 0 && candidatePlacementIds.length === 1) {
      const placementId = candidatePlacementIds[0];
      const assetIds = assetsToAnchorByPlacement.get(placementId) ?? new Set<string>();
      assetIds.add(assetId);
      assetsToAnchorByPlacement.set(placementId, assetIds);
      for (const state of entry.tags) {
        const ids = legacyAssetsToCleanByTag.get(state.tag.id) ?? new Set<string>();
        ids.add(assetId);
        legacyAssetsToCleanByTag.set(state.tag.id, ids);
      }
      continue;
    }

    if (durablePlacementIds.size === 0) {
      ambiguousAssets.push({
        assetId,
        legacyTags,
        candidatePlacementIds,
        durablePlacementIds: durableIds,
        reason: "ambiguous",
      });
      continue;
    }

    if (
      candidatePlacementIds.length === 1 &&
      !durablePlacementIds.has(candidatePlacementIds[0])
    ) {
      conflictingAssets.push({
        assetId,
        legacyTags,
        candidatePlacementIds,
        durablePlacementIds: durableIds,
        reason: "conflict",
      });
      continue;
    }

    for (const state of entry.tags) {
      const ids = legacyAssetsToCleanByTag.get(state.tag.id) ?? new Set<string>();
      ids.add(assetId);
      legacyAssetsToCleanByTag.set(state.tag.id, ids);
    }
  }

  const legacyTags = legacyTagStates.map((state) => ({
    tagId: state.tag.id,
    tagName: state.tag.name,
    placementIds: [...state.placementIds].sort((a, b) => a - b),
    assetCount: state.assetIds.size,
    membershipsToRemove: legacyAssetsToCleanByTag.get(state.tag.id)?.size ?? 0,
  }));
  const report: PlacementTagCleanupReport = {
    dryRun: true,
    generatedAt: new Date().toISOString(),
    placementsScanned: placements.length,
    legacyTagsFound: legacyTagStates.length,
    legacyMemberships: legacyTagStates.reduce((total, state) => total + state.assetIds.size, 0),
    assetsWithLegacyTags: legacyByAsset.size,
    assetsAlreadyAnchored: [...legacyByAsset.keys()].filter((assetId) =>
      (durableMemberships.get(assetId)?.size ?? 0) > 0,
    ).length,
    assetsToAnchor: [...assetsToAnchorByPlacement.values()].reduce((total, ids) => total + ids.size, 0),
    membershipsToRemove: [...legacyAssetsToCleanByTag.values()].reduce((total, ids) => total + ids.size, 0),
    ambiguousAssets,
    conflictingAssets,
    legacyTags,
  };

  return {
    report,
    anchorTagByPlacementId,
    assetsToAnchorByPlacement,
    legacyAssetsToCleanByTag,
  };
}

function batches<T>(values: T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += MUTATION_BATCH_SIZE) {
    result.push(values.slice(index, index + MUTATION_BATCH_SIZE));
  }
  return result;
}

export async function previewPlacementTagCleanup(): Promise<PlacementTagCleanupReport> {
  return (await loadCleanupState()).report;
}

export async function applyPlacementTagCleanup(): Promise<PlacementTagCleanupReport> {
  const state = await loadCleanupState();
  for (const [placementId, assetIds] of state.assetsToAnchorByPlacement) {
    const tag = state.anchorTagByPlacementId.get(placementId)
      ?? await ensureTag(placementAnchorTag(placementId));
    for (const batch of batches([...assetIds])) {
      await tagAssets(batch, [tag.id]);
    }
  }

  for (const [tagId, assetIds] of state.legacyAssetsToCleanByTag) {
    for (const batch of batches([...assetIds])) {
      await untagAssets(batch, [tagId]);
    }
  }

  return {
    ...state.report,
    dryRun: false,
  };
}
