import {
  ensureTag,
  listTags,
  renameTag,
  searchAssetIdsByTag,
  tagAssets,
  type ImmichTag,
} from "../infra/ImmichClient.js";
import { getArtasiaPlacements } from "../infra/WordPressClient.js";
import {
  PLACEMENT_ANCHOR_TAG_PATTERN,
  placementAnchorTag,
} from "./uploadConfig.service.js";

const ARCHIVED_ANCHOR_PREFIX = "archived:placement:";

export interface DriftReport {
  scanned: number;
  inSync: number;
  staleDerived: StaleDerivedEntry[];
  orphaned: OrphanEntry[];
  restored: RestoreEntry[];
}

export interface StaleDerivedEntry {
  placement_id: number;
  anchorTag: string;
  missing: string[];
  assetCount: number;
}

export interface OrphanEntry {
  placement_id: number;
  anchorTag: string;
  archivedTo: string;
  assetCount: number;
}

export interface RestoreEntry {
  placement_id: number;
  archivedTag: string;
  restoredTo: string;
  assetCount: number;
}

export interface ReconcileResult {
  drift: DriftReport;
  applied: boolean;
  mutations: string[];
}

function keyOf(name: string | undefined): string | null {
  return name && name.trim() ? name.trim().toLowerCase() : null;
}

function isAnchorTag(name: string): boolean {
  return PLACEMENT_ANCHOR_TAG_PATTERN.test(name);
}

function isArchivedAnchorTag(name: string): boolean {
  return name.startsWith(ARCHIVED_ANCHOR_PREFIX);
}

function placementIdFromAnchor(name: string): number | null {
  const match = name.match(PLACEMENT_ANCHOR_TAG_PATTERN);
  return match ? parseInt(match[1], 10) : null;
}

function placementIdFromArchived(name: string): number | null {
  if (!name.startsWith(ARCHIVED_ANCHOR_PREFIX)) return null;
  const id = parseInt(name.slice(ARCHIVED_ANCHOR_PREFIX.length), 10);
  return Number.isFinite(id) ? id : null;
}

function nonEmpty(values: Array<string | undefined>): string[] {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

async function collectAnchorTags(): Promise<{ active: ImmichTag[]; archived: ImmichTag[] }> {
  const all = await listTags();
  const active: ImmichTag[] = [];
  const archived: ImmichTag[] = [];
  for (const tag of all) {
    if (isAnchorTag(tag.name)) active.push(tag);
    else if (isArchivedAnchorTag(tag.name)) archived.push(tag);
  }
  return { active, archived };
}

async function safeAssetIds(tagId: string): Promise<string[]> {
  try {
    return await searchAssetIdsByTag(tagId);
  } catch (err) {
    console.warn(`[reconcile] failed to list assets for tag ${tagId}: ${(err as Error).message}`);
    return [];
  }
}

async function tagHasAssets(tagId: string): Promise<boolean> {
  return (await safeAssetIds(tagId)).length > 0;
}

export function expectedDerivedTagNames(
  partnerName: string | undefined,
  placementName: string | undefined
): string[] {
  return nonEmpty([partnerName, placementName]);
}

export async function collectDrift(): Promise<DriftReport> {
  const [wpPlacements, { active, archived }] = await Promise.all([
    getArtasiaPlacements({ forceFresh: true }),
    collectAnchorTags(),
  ]);

  const wpById = new Map<number, { partnerName?: string; placementName: string }>();
  for (const p of wpPlacements) {
    wpById.set(p.placement_id, {
      partnerName: p.partner?.name,
      placementName: p.placement_name,
    });
  }

  const staleDerived: StaleDerivedEntry[] = [];
  const orphaned: OrphanEntry[] = [];
  const restored: RestoreEntry[] = [];
  let inSync = 0;

  for (const tag of active) {
    const placementId = placementIdFromAnchor(tag.name);
    if (placementId == null) continue;

    const wp = wpById.get(placementId);
    if (!wp) {
      const assetCount = (await safeAssetIds(tag.id)).length;
      orphaned.push({
        placement_id: placementId,
        anchorTag: tag.name,
        archivedTo: `${ARCHIVED_ANCHOR_PREFIX}${placementId}`,
        assetCount,
      });
      continue;
    }

    const expectedDerived = expectedDerivedTagNames(wp.partnerName, wp.placementName);
    const missing = await computeMissingDerivedTags(tag.id, expectedDerived);
    if (missing.length === 0) {
      inSync += 1;
      continue;
    }
    staleDerived.push({
      placement_id: placementId,
      anchorTag: tag.name,
      missing,
      assetCount: (await safeAssetIds(tag.id)).length,
    });
  }

  for (const tag of archived) {
    const placementId = placementIdFromArchived(tag.name);
    if (placementId == null) continue;
    if (!wpById.has(placementId)) continue;
    const assetCount = (await safeAssetIds(tag.id)).length;
    restored.push({
      placement_id: placementId,
      archivedTag: tag.name,
      restoredTo: placementAnchorTag(placementId),
      assetCount,
    });
  }

  return {
    scanned: active.length,
    inSync,
    staleDerived,
    orphaned,
    restored,
  };
}

async function computeMissingDerivedTags(
  anchorTagId: string,
  expectedDerived: string[]
): Promise<string[]> {
  if (expectedDerived.length === 0) return [];
  const anchorAssetIds = new Set(await safeAssetIds(anchorTagId));
  if (anchorAssetIds.size === 0) return [];

  const missing: string[] = [];
  for (const name of expectedDerived) {
    const derived = await ensureTag(name).catch(() => null);
    if (!derived) continue;
    const derivedAssetIds = await safeAssetIds(derived.id);
    const derivedSet = new Set(derivedAssetIds);
    let hasGap = false;
    for (const id of anchorAssetIds) {
      if (!derivedSet.has(id)) {
        hasGap = true;
        break;
      }
    }
    if (hasGap) missing.push(name);
  }
  return missing;
}

export async function applyReconcile(report: DriftReport): Promise<ReconcileResult> {
  const mutations: string[] = [];

  for (const entry of report.staleDerived) {
    const anchor = await ensureTag(entry.anchorTag);
    const assetIds = await safeAssetIds(anchor.id);
    if (assetIds.length === 0) continue;

    const tagIds: string[] = [];
    for (const name of entry.missing) {
      const tag = await ensureTag(name);
      tagIds.push(tag.id);
    }
    if (tagIds.length === 0) continue;

    await tagAssets(assetIds, tagIds);
    mutations.push(
      `placement:${entry.placement_id} added [${entry.missing.join(", ")}] to ${assetIds.length} assets`
    );
  }

  for (const entry of report.orphaned) {
    if (entry.assetCount === 0) continue;
    const active = await listTagByName(entry.anchorTag);
    if (!active) continue;
    await renameTag(active.id, entry.archivedTo);
    mutations.push(
      `placement:${entry.placement_id} archived ${entry.assetCount} assets: ${entry.anchorTag} -> ${entry.archivedTo}`
    );
  }

  for (const entry of report.restored) {
    if (entry.assetCount === 0) continue;
    const archived = await listTagByName(entry.archivedTag);
    if (!archived) continue;
    if (!(await tagHasAssets(archived.id))) continue;
    await renameTag(archived.id, entry.restoredTo);
    mutations.push(
      `placement:${entry.placement_id} restored ${entry.assetCount} assets: ${entry.archivedTag} -> ${entry.restoredTo}`
    );
  }

  return { drift: report, applied: mutations.length > 0, mutations };
}

async function listTagByName(name: string): Promise<ImmichTag | null> {
  const list = await listTags();
  const key = keyOf(name);
  return list.find((tag) => keyOf(tag.name) === key) ?? null;
}