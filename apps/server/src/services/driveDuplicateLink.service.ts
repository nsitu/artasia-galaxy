import { setTimeout as delay } from "node:timers/promises";
import type { getAsset, tagAsset, ImmichAsset } from "../infra/ImmichClient.js";
import { driveSourceIds, DRIVE_SOURCE_PREFIX } from "./driveSource.service.js";
import type { UploadConfig } from "./uploadConfig.service.js";

export interface DriveDuplicateLinkContext {
  placementId: number;
  activityId: number;
  config: Pick<UploadConfig, "placements" | "activities">;
}

export type DuplicateLinkResult = {
  status: "linked" | "existing" | "needs_review";
  assetId: string;
  detail: string;
};

function linkingConflict(asset: ImmichAsset, fileId: string, context: DriveDuplicateLinkContext) {
  if (!Array.isArray(asset.tags)) return "The existing asset's source and assignment tags could not be inspected.";
  if (asset.visibility === "locked") return "The existing asset is locked and cannot be linked automatically.";
  if (driveSourceIds(asset).some((id) => id !== fileId)) return "The existing asset is already linked to a different Drive file ID.";

  const values = new Set(asset.tags.flatMap((tag) => [tag.name, tag.value]).map((value) => value.trim().toLowerCase()));
  const placementTag = `placement:${context.placementId}`;
  const activityTag = `activity:${context.activityId}`;
  for (const value of values) {
    if (value.startsWith("archived:placement:") || (value.startsWith("placement:") && value !== placementTag)) {
      return "The existing asset has a conflicting or archived placement assignment.";
    }
    if (value.startsWith("custom_activity:") || (value.startsWith("activity:") && value !== activityTag)) {
      return "The existing asset has a conflicting activity assignment.";
    }
  }

  // Older Atlas uploads may have human-readable assignments instead of anchors.
  // Ambiguous labels are safe only when a matching anchor disambiguates them.
  for (const value of values) {
    const placements = context.config.placements.filter((item) => item.placement_name.trim().toLowerCase() === value);
    if (placements.length && (!placements.some((item) => item.placement_id === context.placementId) ||
      (placements.length > 1 && !values.has(placementTag)))) {
      return "The existing asset has a conflicting or ambiguous legacy placement label.";
    }
    const activities = context.config.activities.filter((item) => item.label.trim().toLowerCase() === value);
    if (activities.length && (!activities.some((item) => item.id === context.activityId) ||
      (activities.length > 1 && !values.has(activityTag)))) {
      return "The existing asset has a conflicting or ambiguous legacy activity label.";
    }
  }
}

/** A checksum match permits only a missing source link, never new-upload metadata. */
export async function linkDriveChecksumDuplicate(params: {
  assetId: string;
  fileId: string;
  context?: DriveDuplicateLinkContext;
  signal: AbortSignal;
}, deps: {
  getAsset: typeof getAsset;
  tagAsset: typeof tagAsset;
  findSources: (fileId: string, signal: AbortSignal) => Promise<ImmichAsset[]>;
}): Promise<DuplicateLinkResult> {
  const { assetId, fileId, context, signal } = params;
  const review = (detail: string): DuplicateLinkResult => ({ status: "needs_review", assetId, detail });
  if (!context || !context.config.placements.some((item) => item.placement_id === context.placementId) ||
    !context.config.activities.some((item) => item.id === context.activityId)) {
    return review("Checksum duplicate found, but the placement/activity context could not be verified. No tags were changed.");
  }
  let writeAttempted = false;
  try {
    signal.throwIfAborted();
    let asset = await deps.getAsset(assetId);
    let conflict = linkingConflict(asset, fileId, context);
    if (conflict) return review(`${conflict} No tags were changed.`);

    // Recheck after the upload attempt; another writer may have linked this source.
    const sources = await deps.findSources(fileId, signal);
    if (sources.some((candidate) => candidate.id !== assetId)) {
      return review("This Drive file ID is now linked to another Immich asset. No tags were changed.");
    }
    signal.throwIfAborted();
    asset = await deps.getAsset(assetId);
    conflict = linkingConflict(asset, fileId, context);
    if (conflict) return review(`${conflict} No tags were changed.`);
    if (driveSourceIds(asset).includes(fileId)) {
      return { status: "existing", assetId, detail: "The checksum duplicate already has this Drive source link. No tags were changed." };
    }

    signal.throwIfAborted();
    writeAttempted = true;
    await deps.tagAsset(assetId, [`${DRIVE_SOURCE_PREFIX}${fileId}`]);
    // Tag writes can succeed without granting asset access. Read back the exact
    // source ID before reporting success; never checkpoint this as an owned upload.
    for (let attempt = 0; attempt < 20; attempt++) {
      signal.throwIfAborted();
      const verified = await deps.getAsset(assetId);
      conflict = linkingConflict(verified, fileId, context);
      if (conflict) return review(`Source-link verification needs review: ${conflict} No placement, activity, or visibility changes were requested.`);
      if (driveSourceIds(verified).includes(fileId)) {
        return { status: "linked", assetId, detail: "Linked this Drive file to an existing checksum-matched asset. Only the missing source tag was added; placement, activity, archive/trash, and publication were left unchanged." };
      }
      if (attempt < 19) await delay(250, undefined, { signal });
    }
    return review("The existing asset's Drive source link could not be verified after the tag request. Run auto-import again to check it; no new asset was created.");
  } catch {
    signal.throwIfAborted();
    return review(writeAttempted
      ? "The source-link write or verification failed. Run auto-import again to check whether it was saved; no new asset was created."
      : "The checksum duplicate or its source links could not be inspected. No tags were changed.");
  }
}
