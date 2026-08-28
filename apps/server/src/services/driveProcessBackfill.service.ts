import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { getAsset, tagAsset, type ImmichAsset } from "../infra/ImmichClient.js";
import { assetTypeTag, getAssetTypeFromTagValues } from "./assetType.service.js";
import { sourceAssets } from "./driveImport.service.js";
import { acquireDriveWriter, driveSourceIds } from "./driveSource.service.js";
import { GoogleDriveClient, isProcessDriveFolderName, type DriveFolder } from "./googleDrive.service.js";

export interface DriveProcessResult {
  assetId: string;
  fileName: string;
  fileId?: string;
  folderId?: string;
  folderName?: string;
  status: "tagged" | "already_process" | "not_process" | "needs_review" | "failed";
  detail?: string;
}
export interface DriveProcessJob {
  jobId: string;
  initiatedBy: string;
  startedAt: string;
  finishedAt?: string;
  status: "running" | "completed" | "completed_with_issues" | "cancelled" | "failed";
  phase: "indexing" | "checking" | "done";
  cancelRequested: boolean;
  current?: string;
  error?: string;
  counts: { scanned: number; checked: number; tagged: number; alreadyProcess: number; noSource: number; notProcess: number; needsReview: number; failed: number };
  results: DriveProcessResult[];
}
export function summarizeDriveProcessJob({ results, ...job }: DriveProcessJob) {
  return structuredClone({ ...job, resultCount: results.length });
}

const productionDeps = { inventory: sourceAssets, getAsset, tagAsset,
  pause: (signal: AbortSignal): Promise<void> => delay(250, undefined, { signal }) };
type DriveClient = Pick<GoogleDriveClient, "getFile" | "getFolder">;
function hasProcess(asset: ImmichAsset) {
  return getAssetTypeFromTagValues((asset.tags ?? []).flatMap((tag) => [tag.name, tag.value])) === "process";
}
function detail(error: unknown) {
  return (error instanceof Error ? error.message : "Metadata lookup or update failed.")
    .replace(/((?:access_token|refresh_token|authorization|client_secret)["'\s:=]+)[^\s,"'}]+/gi, "$1[redacted]").slice(0, 600);
}
function sameSource(asset: ImmichAsset, fileId: string) {
  const ids = driveSourceIds(asset);
  return Array.isArray(asset.tags) && ids.length === 1 && ids[0] === fileId;
}

export class DriveProcessBusyError extends Error {
  constructor() { super("Another Drive import or maintenance operation is running."); }
}

/** One in-memory job, shared across admin tabs. Reruns are safe after a server restart. */
export class DriveProcessBackfillManager {
  private job?: DriveProcessJob;
  private controller?: AbortController;
  private completion?: Promise<void>;
  constructor(private deps = productionDeps) {}
  latest() { return this.job ? summarizeDriveProcessJob(this.job) : null; }
  get(jobId: string) { return this.job?.jobId === jobId ? this.job : undefined; }
  async waitForIdle() { await this.completion; }

  start(client: DriveClient, initiatedBy: string) {
    if (this.job?.status === "running") return summarizeDriveProcessJob(this.job);
    const jobId = randomUUID();
    const release = acquireDriveWriter(jobId);
    if (!release) throw new DriveProcessBusyError();
    const job: DriveProcessJob = { jobId, initiatedBy, startedAt: new Date().toISOString(), status: "running", phase: "indexing", cancelRequested: false,
      counts: { scanned: 0, checked: 0, tagged: 0, alreadyProcess: 0, noSource: 0, notProcess: 0, needsReview: 0, failed: 0 }, results: [] };
    this.job = job;
    this.controller = new AbortController();
    this.completion = this.run(job, client, this.controller.signal).finally(() => { this.controller = undefined; release(); });
    return summarizeDriveProcessJob(job);
  }
  cancel(jobId: string) {
    const job = this.get(jobId);
    if (job?.status === "running") { job.cancelRequested = true; this.controller?.abort(); }
    return job ? summarizeDriveProcessJob(job) : undefined;
  }

  private async check(asset: ImmichAsset, client: DriveClient, folders: Map<string, DriveFolder>, signal: AbortSignal): Promise<DriveProcessResult> {
    const ids = driveSourceIds(asset);
    const result: DriveProcessResult = { assetId: asset.id, fileName: asset.originalFileName, fileId: ids.length === 1 ? ids[0] : undefined, status: "needs_review" };
    if (!Array.isArray(asset.tags) || ids.length !== 1) return { ...result, detail: "Unreadable tags or multiple Drive IDs; no tags were changed." };
    try {
      signal.throwIfAborted();
      const file = await client.getFile(ids[0]);
      signal.throwIfAborted();
      const parents = [...new Set(file.parents ?? [])];
      if (file.id !== ids[0] || GoogleDriveClient.isFolder(file.mimeType) || file.mimeType === "application/vnd.google-apps.shortcut" || parents.length !== 1) {
        return { ...result, detail: "The Drive source is not a file with one unambiguous parent folder; no tags were changed." };
      }
      result.folderId = parents[0];
      const folder = folders.get(parents[0]) ?? await client.getFolder(parents[0]);
      signal.throwIfAborted();
      if (folder.id !== parents[0] || !GoogleDriveClient.isFolder(folder.mimeType)) return { ...result, detail: "The Drive parent could not be verified as a folder; no tags were changed." };
      folders.set(folder.id, folder);
      result.folderName = folder.name;
      if (!isProcessDriveFolderName(folder.name)) return { ...result, status: "not_process", detail: "The immediate parent folder name does not contain process." };

      // The inventory may be stale. Never use a changed Drive link to classify an asset.
      const current = await this.deps.getAsset(asset.id);
      signal.throwIfAborted();
      if (!sameSource(current, ids[0]) || current.visibility === "locked") return { ...result, detail: "The asset's Drive link or access changed; no tags were changed." };
      if (hasProcess(current)) return { ...result, status: "already_process" };
      // Add only Process. Do not remove Artwork or change assignments, visibility, or publication.
      await this.deps.tagAsset(asset.id, [assetTypeTag("process")]);
      for (let attempt = 0; attempt < 20; attempt++) {
        signal.throwIfAborted();
        const verified = await this.deps.getAsset(asset.id);
        signal.throwIfAborted();
        if (!sameSource(verified, ids[0])) return { ...result, detail: "The Drive link changed during verification. The Process tag may have been applied; review this asset." };
        if (hasProcess(verified)) return { ...result, status: "tagged" };
        if (attempt < 19) await this.deps.pause(signal);
      }
      return { ...result, detail: "The Process tag was submitted but could not be verified. Check this asset or rerun the tool." };
    } catch (error) {
      signal.throwIfAborted();
      return { ...result, status: "failed", detail: `Could not complete lookup/tag verification: ${detail(error)} Any submitted tag may have persisted; rerunning is safe.` };
    }
  }

  private async run(job: DriveProcessJob, client: DriveClient, signal: AbortSignal) {
    try {
      // Inventory all accessible visibilities, including trash and stacked children, before writing.
      const assets = await this.deps.inventory(undefined, signal, async (count) => { job.counts.scanned = count; });
      signal.throwIfAborted();
      job.counts.scanned = assets.length;
      job.phase = "checking";
      const folders = new Map<string, DriveFolder>();
      for (const asset of assets) {
        signal.throwIfAborted();
        job.current = asset.originalFileName;
        if (Array.isArray(asset.tags) && driveSourceIds(asset).length === 0) job.counts.noSource++;
        else if (Array.isArray(asset.tags) && hasProcess(asset)) job.counts.alreadyProcess++;
        else {
          const result = await this.check(asset, client, folders, signal);
          job.results.push(result);
          const count = { tagged: "tagged", already_process: "alreadyProcess", not_process: "notProcess", needs_review: "needsReview", failed: "failed" } as const;
          job.counts[count[result.status]]++;
        }
        job.counts.checked++;
      }
      signal.throwIfAborted();
      job.status = job.counts.failed || job.counts.needsReview ? "completed_with_issues" : "completed";
    } catch (error) {
      job.status = signal.aborted ? "cancelled" : "failed";
      if (!signal.aborted) job.error = detail(error);
    } finally {
      job.phase = "done"; job.current = undefined; job.finishedAt = new Date().toISOString();
    }
  }
}

export const driveProcessBackfill = new DriveProcessBackfillManager();
