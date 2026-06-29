import { writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ensureTag,
  listTags,
  searchAssetIdsByTag,
  tagAssets,
  type ImmichTag,
} from "../infra/ImmichClient.js";
import { getArtasiaPlacements } from "../infra/WordPressClient.js";
import { placementAnchorTag } from "../services/uploadConfig.service.js";

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const REPORT_PATH = join(DATA_DIR, "backfill-orphans.json");

function normalize(s: string | undefined): string | null {
  return s && s.trim() ? s.trim().toLowerCase() : null;
}

function findTagByName(tags: ImmichTag[], name: string): ImmichTag | null {
  const key = normalize(name);
  if (!key) return null;
  return tags.find((tag) => normalize(tag.name) === key || normalize(tag.value) === key) ?? null;
}

async function main() {
  console.log("[backfill] fetching WP placements + Immich tag list");
  const [wpPlacements, allTags] = await Promise.all([
    getArtasiaPlacements({ forceFresh: true }),
    listTags(),
  ]);

  const placementByExactName = new Map<string, { placement_id: number; partnerName: string; placementName: string }>();
  const placementByDerivedPair = new Map<string, { placement_id: number; partnerName: string; placementName: string }>();
  for (const p of wpPlacements) {
    const partnerName = p.partner?.name;
    const entry = {
      placement_id: p.placement_id,
      partnerName: partnerName ?? "",
      placementName: p.placement_name,
    };
    if (partnerName) placementByExactName.set(normalize(partnerName)!, entry);
    placementByExactName.set(normalize(p.placement_name)!, entry);
    if (partnerName) {
      const pairKey = `${normalize(partnerName)}::${normalize(p.placement_name)}`;
      placementByDerivedPair.set(pairKey, entry);
    }
  }

  const alreadyAnchoredIds = new Set<string>();
  for (const tag of allTags) {
    if (/^placement:\d+$/.test(tag.name)) {
      for (const id of await searchAssetIdsByTag(tag.id)) alreadyAnchoredIds.add(id);
    }
  }
  console.log(`[backfill] ${alreadyAnchoredIds.size} assets already carry a placement:N anchor`);

  const candidateTags = allTags.filter((tag) => {
    const name = normalize(tag.name);
    if (!name) return false;
    if (/^placement:\d+$/.test(tag.name)) return false;
    if (/^archived:placement:\d+$/.test(tag.name)) return false;
    return placementByExactName.has(name);
  });

  const orphans: Array<{ partnerName?: string; placementName: string; assetCount: number; assetIds: string[] }> = [];
  const backfilled: Array<{ placement_id: number; assetsTagged: number; partnerName: string; placementName: string }> = [];
  const assetsAnchoredByPlacementId = new Map<number, Set<string>>();

  for (const tag of candidateTags) {
    const assetIds = (await searchAssetIdsByTag(tag.id)).filter((id) => !alreadyAnchoredIds.has(id));
    if (assetIds.length === 0) continue;

    const matchByPair = [...placementByDerivedPair.values()].find((entry) => {
      const partnerKey = normalize(entry.partnerName);
      const placementKey = normalize(entry.placementName);
      return partnerKey === normalize(tag.name) || placementKey === normalize(tag.name);
    });

    if (matchByPair) {
      const anchorTag = await ensureTag(placementAnchorTag(matchByPair.placement_id));
      await tagAssets(assetIds, [anchorTag.id]);
      const set = assetsAnchoredByPlacementId.get(matchByPair.placement_id) ?? new Set<string>();
      for (const id of assetIds) set.add(id);
      assetsAnchoredByPlacementId.set(matchByPair.placement_id, set);
      backfilled.push({
        placement_id: matchByPair.placement_id,
        assetsTagged: assetIds.length,
        partnerName: matchByPair.partnerName,
        placementName: matchByPair.placementName,
      });
      console.log(`[backfill] tag "${tag.name}" -> placement:${matchByPair.placement_id} (${assetIds.length} assets)`);
    } else {
      orphans.push({
        partnerName: undefined,
        placementName: tag.name,
        assetCount: assetIds.length,
        assetIds,
      });
      console.warn(`[backfill] orphan: "${tag.name}" with ${assetIds.length} assets — no WP match`);
    }
  }

  writeFileSync(
    REPORT_PATH,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        placementIds: [...assetsAnchoredByPlacementId.entries()].map(([id, set]) => ({ placement_id: id, assets: set.size })),
        orphans,
        backfilled,
      },
      null,
      2
    )
  );

  console.log(`[backfill] report written to ${REPORT_PATH}`);
  console.log(`[backfill] summary: ${backfilled.length} placements backfilled, ${orphans.length} orphan tags unresolved`);
}

main().catch((err) => {
  console.error(`[backfill] failed: ${(err as Error).message}`);
  process.exitCode = 1;
});