import {
  ensureTag,
  ImmichTag,
  listTags,
  searchAssetIdsByTags,
  tagAssets,
  untagAssets,
} from "../infra/ImmichClient.js";

export interface AssetAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
}

type AdjustmentKind = keyof AssetAdjustments;

const ADJUSTMENT_PREFIX = "artasia:adjust:";
const ADJUSTMENT_PATTERN = /^artasia:adjust:(brightness|contrast|saturation):(\d{1,3})$/;
const ADJUSTMENT_MIN = 50;
const ADJUSTMENT_MAX = 150;
const ADJUSTMENT_NEUTRAL = 100;
const ADJUSTMENT_KINDS: AdjustmentKind[] = ["brightness", "contrast", "saturation"];

export const DEFAULT_ASSET_ADJUSTMENTS: AssetAdjustments = {
  brightness: ADJUSTMENT_NEUTRAL,
  contrast: ADJUSTMENT_NEUTRAL,
  saturation: ADJUSTMENT_NEUTRAL,
};

function tagKey(tag: ImmichTag) {
  return (tag.name || tag.value || "").trim().toLowerCase();
}

function parseAdjustmentTag(tag: ImmichTag): { kind: AdjustmentKind; value: number } | null {
  const match = tagKey(tag).match(ADJUSTMENT_PATTERN);
  if (!match) return null;
  const value = Number(match[2]);
  if (!Number.isInteger(value) || value < ADJUSTMENT_MIN || value > ADJUSTMENT_MAX) return null;
  return { kind: match[1] as AdjustmentKind, value };
}

function adjustmentTagName(kind: AdjustmentKind, value: number) {
  return `${ADJUSTMENT_PREFIX}${kind}:${value}`;
}

function clampAdjustment(value: unknown) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return ADJUSTMENT_NEUTRAL;
  return Math.max(ADJUSTMENT_MIN, Math.min(ADJUSTMENT_MAX, numeric));
}

export function normalizeAssetAdjustments(value: unknown): AssetAdjustments {
  const body = value && typeof value === "object" ? value as Partial<AssetAdjustments> : {};
  return {
    brightness: clampAdjustment(body.brightness),
    contrast: clampAdjustment(body.contrast),
    saturation: clampAdjustment(body.saturation),
  };
}

export function isAdjustmentTag(tag: ImmichTag) {
  return tagKey(tag).startsWith(ADJUSTMENT_PREFIX) && parseAdjustmentTag(tag) !== null;
}

export async function getAssetAdjustmentMap(
  assetIds?: Iterable<string>,
): Promise<Map<string, AssetAdjustments>> {
  const assetIdSet = assetIds ? new Set(assetIds) : null;
  const map = new Map<string, AssetAdjustments>();
  const adjustmentTags = (await listTags())
    .filter(isAdjustmentTag)
    .sort((a, b) => tagKey(a).localeCompare(tagKey(b)));

  const assetIdsByTag = await searchAssetIdsByTags(
    adjustmentTags.map((tag) => tag.id),
  );
  for (const tag of adjustmentTags) {
    const parsed = parseAdjustmentTag(tag);
    if (!parsed) continue;
    const taggedAssetIds = assetIdsByTag.get(tag.id) ?? [];
    for (const assetId of taggedAssetIds) {
      if (assetIdSet && !assetIdSet.has(assetId)) continue;
      const current = map.get(assetId) ?? { ...DEFAULT_ASSET_ADJUSTMENTS };
      current[parsed.kind] = parsed.value;
      map.set(assetId, current);
    }
  }

  return map;
}

export async function getAssetAdjustments(assetId: string): Promise<AssetAdjustments> {
  return (await getAssetAdjustmentMap([assetId])).get(assetId) ?? { ...DEFAULT_ASSET_ADJUSTMENTS };
}

export async function saveAssetAdjustments(
  assetId: string,
  requested: unknown,
): Promise<AssetAdjustments> {
  const adjustments = normalizeAssetAdjustments(requested);
  const allTags = await listTags();
  const existingAdjustmentTagIds = allTags
    .filter((tag) => tagKey(tag).startsWith(ADJUSTMENT_PREFIX))
    .filter((tag) => {
      const parsed = parseAdjustmentTag(tag);
      return parsed ? ADJUSTMENT_KINDS.includes(parsed.kind) : false;
    })
    .map((tag) => tag.id);

  if (existingAdjustmentTagIds.length > 0) {
    await untagAssets([assetId], existingAdjustmentTagIds);
  }

  const tagIds: string[] = [];
  for (const kind of ADJUSTMENT_KINDS) {
    const value = adjustments[kind];
    if (value === ADJUSTMENT_NEUTRAL) continue;
    const tag = await ensureTag(adjustmentTagName(kind, value), allTags);
    tagIds.push(tag.id);
    allTags.push(tag);
  }

  if (tagIds.length > 0) {
    await tagAssets([assetId], tagIds);
  }

  return adjustments;
}
