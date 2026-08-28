import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { GoogleDriveClient, folderActivityMatchScore, isProcessDriveFolderName, type DriveFile, type DriveFolder } from "./googleDrive.service.js";
import type { ActivityConfig, UploadConfig } from "./uploadConfig.service.js";
import { assetTypeTag, type AssetType } from "./assetType.service.js";
import { acquireDriveWriter } from "./driveSource.service.js";
import { findDriveSourceAssets, importNewDriveFile, loadDriveSourceIndex, sourceConflict } from "./driveImport.service.js";

export type DriveJobStatus = "running" | "completed" | "completed_with_issues" | "no_matches" | "failed" | "cancelled" | "interrupted";
export interface DriveImportItem {
  kind: "file" | "folder";
  fileId: string;
  name: string;
  path: string;
  status: "pending" | "imported" | "linked" | "existing" | "excluded" | "needs_review" | "failed";
  activityId?: number;
  activityLabel?: string;
  assetType?: AssetType;
  detail?: string;
  assetId?: string;
  createdAssetId?: string;
  file?: DriveFile;
}
export interface DriveImportJob {
  version: 1;
  jobId: string;
  placementId: number;
  placementName: string;
  rootFolderId: string;
  configurationHash: string;
  initiatedBy: string;
  startedAt: string;
  scanCompletedAt?: string;
  finishedAt?: string;
  status: DriveJobStatus;
  phase: "scanning" | "indexing" | "importing" | "verifying" | "done";
  cancelRequested: boolean;
  current?: string;
  foldersScanned: number;
  matchedFolders: number;
  eligible: number;
  results: DriveImportItem[];
  error?: string;
}

export function summarizeDriveJob(job: DriveImportJob) {
  const { results, ...summary } = job;
  const count = (status: DriveImportItem["status"]) => results.filter((item) => item.status === status).length;
  return { ...summary, counts: { discovered: results.filter((item) => item.kind === "file").length,
    imported: count("imported"), linked: count("linked"), existing: count("existing"), excluded: count("excluded"),
    needsReview: count("needs_review"), failed: count("failed"), pending: count("pending") }, resultCount: results.length };
}

export function driveConfigurationHash(config: UploadConfig, placementId: number) {
  const placement = config.placements.find((p) => p.placement_id === placementId);
  return createHash("sha256").update(JSON.stringify({
    placement: placement && { id: placement.placement_id, root: placement.google_drive_folder_id?.trim(), name: placement.placement_name, partner: placement.partner_name },
    roots: config.placements.map((p) => [p.placement_id, p.google_drive_folder_id]).sort((a, b) => Number(a[0]) - Number(b[0])),
    activities: config.activities.map(({ id, label, week }) => ({ id, label, week })).sort((a, b) => a.id - b.id),
    policy: "recursive-inherit-conflicts-excluded-source-link-process-v3",
  })).digest("hex");
}

function errorMessage(error: unknown) {
  return (error instanceof Error ? error.message : "Import failed")
    .replace(/((?:access_token|refresh_token|authorization|client_secret)["'\s:=]+)[^\s,"'}]+/gi, "$1[redacted]").slice(0, 600);
}

export function matchDriveActivity(name: string, activities: ActivityConfig[]) {
  const scored = activities.map((activity) => ({ activity, score: folderActivityMatchScore(name, activity) }));
  const max = Math.max(0, ...scored.map(({ score }) => score));
  const matches = scored.filter(({ score }) => score > 0 && score === max).map(({ activity }) => activity);
  return { activity: matches.length === 1 ? matches[0] : undefined, ambiguous: matches.length > 1 };
}

async function retryRead<T>(read: () => Promise<T>, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted();
    try { return await read(); } catch (error) {
      const status = Number((error as { code?: unknown; response?: { status?: unknown } }).response?.status ?? (error as { code?: unknown }).code);
      if (attempt >= 2 || ![429, 500, 502, 503, 504].includes(status)) throw error;
      await delay(500 * 2 ** attempt, undefined, { signal });
    }
  }
}

/** Exported scanner is also a scan-only entry point for fixtures and validation. */
export async function scanDrivePlacement(params: {
  client: Pick<GoogleDriveClient, "getFolder" | "listChildren">;
  config: UploadConfig;
  job: DriveImportJob;
  signal: AbortSignal;
  progress: () => Promise<void>;
  maxFolders?: number;
  maxFiles?: number;
}) {
  const { client, config, job, signal } = params;
  const root = await retryRead(() => client.getFolder(job.rootFolderId), signal);
  if (!GoogleDriveClient.isFolder(root.mimeType)) throw new Error("The placement's Drive root is not a folder.");
  const queue: Array<{ folder: DriveFolder; path: string; activity?: ActivityConfig; assetType?: AssetType; blocked?: string }> = [{ folder: root, path: root.name }];
  const folders = new Set<string>();
  const scheduledFolders = new Set([root.id]);
  const files = new Set<string>();
  const foreignRoots = new Set(config.placements.filter((p) => p.placement_id !== job.placementId).map((p) => p.google_drive_folder_id?.trim()).filter(Boolean));
  while (queue.length) {
    signal.throwIfAborted();
    const current = queue.shift()!;
    if (folders.has(current.folder.id)) continue;
    if (folders.size >= (params.maxFolders ?? 2000)) throw new Error("Drive scan exceeded the 2,000-folder safety limit; the scan is incomplete.");
    folders.add(current.folder.id);
    job.current = current.path;
    if (foreignRoots.has(current.folder.id)) {
      job.results.push({ kind: "folder", fileId: current.folder.id, name: current.folder.name, path: current.path,
        status: "needs_review", detail: "This folder is configured for another placement and was not traversed." });
      continue;
    }
    let activity = current.activity;
    let blocked = current.blocked;
    if (current.folder.id !== root.id && !blocked) {
      const match = matchDriveActivity(current.folder.name, config.activities);
      if (match.ambiguous || (activity && match.activity && activity.id !== match.activity.id)) {
        blocked = "Ambiguous or conflicting nested activity folder; media in this branch was not imported.";
        job.results.push({ kind: "folder", fileId: current.folder.id, name: current.folder.name, path: current.path, status: "needs_review", detail: blocked });
      } else if (match.activity) {
        activity = match.activity;
        job.matchedFolders++;
      }
    }
    // Only folders beneath a matched activity classify media; descendants inherit it.
    const assetType = current.assetType ?? (current.activity && isProcessDriveFolderName(current.folder.name) ? "process" : undefined);
    const tokens = new Set<string>();
    let pageToken: string | undefined;
    let tokenRestarted = false;
    try {
      do {
        signal.throwIfAborted();
        let page: Awaited<ReturnType<GoogleDriveClient["listChildren"]>>;
        try { page = await retryRead(() => client.listChildren(current.folder.id, pageToken, root.driveId), signal); }
        catch (error) {
          if (pageToken && !tokenRestarted && /page.?token/i.test(errorMessage(error))) {
            pageToken = undefined; tokens.clear(); tokenRestarted = true;
            page = await retryRead(() => client.listChildren(current.folder.id, undefined, root.driveId), signal);
          } else {
            throw error;
          }
        }
        for (const file of page.files) {
          if (GoogleDriveClient.isFolder(file.mimeType)) {
            if (!scheduledFolders.has(file.id)) {
              if (scheduledFolders.size >= (params.maxFolders ?? 2000)) throw new Error("Drive scan exceeded the folder safety limit; the scan is incomplete.");
              scheduledFolders.add(file.id);
              queue.push({ folder: file, path: `${current.path}/${file.name}`, activity, assetType, blocked });
            }
            continue;
          }
          if (files.has(file.id)) continue;
          if (files.size >= (params.maxFiles ?? 20_000)) throw new Error("Drive scan exceeded the 20,000-file safety limit.");
          files.add(file.id);
          const supported = GoogleDriveClient.isSupported(file.mimeType, file.name);
          const eligible = supported && activity && !blocked;
          if (eligible) job.eligible++;
          job.results.push({ kind: "file", fileId: file.id, name: file.name, path: `${current.path}/${file.name}`,
            status: eligible ? "pending" : "excluded", activityId: activity?.id, activityLabel: activity?.label,
            ...(eligible ? { file, assetType } : { detail: blocked ?? (!supported ? "Unsupported format or Drive shortcut." : "No matching activity folder in this path.") }) });
        }
        pageToken = page.nextPageToken;
        if (pageToken && tokens.has(pageToken)) throw new Error("Drive repeated a page token; this folder scan is incomplete.");
        if (pageToken) tokens.add(pageToken);
      } while (pageToken);
    } catch (error) {
      signal.throwIfAborted();
      // Independent branches can still be imported, but this run cannot be successful.
      job.results.push({ kind: "folder", fileId: current.folder.id, name: current.folder.name, path: current.path,
        status: "failed", detail: errorMessage(error) });
      if (errorMessage(error).includes("safety limit")) throw error;
    }
    job.foldersScanned++;
    await params.progress();
  }
  job.scanCompletedAt = new Date().toISOString();
}

export class DriveJobStore {
  readonly jobs = new Map<string, DriveImportJob>();
  private writes: Promise<void> = Promise.resolve();
  constructor(readonly directory: string) {}

  async initialize() {
    await mkdir(this.directory, { recursive: true });
    for (const name of await readdir(this.directory)) {
      if (!/^[0-9a-f-]{36}\.json$/.test(name)) continue;
      const job = JSON.parse(await readFile(join(this.directory, name), "utf8")) as DriveImportJob;
      if (job.version !== 1 || name !== `${job.jobId}.json` || !Array.isArray(job.results)) throw new Error("Invalid Drive job history; repair the history store before importing.");
      this.jobs.set(job.jobId, job);
      if (job.status === "running") {
        job.status = "interrupted"; job.phase = "done"; job.finishedAt = new Date().toISOString();
        job.error = "Atlas restarted before this import finished. Run again to check remaining files.";
        await this.save(job);
      }
    }
    const temporary = join(this.directory, "tmp");
    await mkdir(temporary, { recursive: true });
    for (const name of await readdir(temporary)) {
      if (/^transfer-[a-zA-Z0-9]+$/.test(name)) await rm(join(temporary, name), { recursive: true, force: true });
    }
  }

  save(job: DriveImportJob) {
    const contents = JSON.stringify(job);
    const path = join(this.directory, `${job.jobId}.json`);
    const write = this.writes.catch(() => undefined).then(async () => {
      await writeFile(`${path}.tmp`, contents, { mode: 0o600, flush: true });
      await rename(`${path}.tmp`, path);
      this.jobs.set(job.jobId, JSON.parse(contents) as DriveImportJob);
    });
    this.writes = write;
    return write;
  }

  async prune() {
    const ordered = [...this.jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const protectedIds = new Set(ordered.slice(0, 25).map((job) => job.jobId));
    const successfulScopes = new Set<string>();
    const latestPlacements = new Set<number>();
    for (const job of ordered) {
      const scope = `${job.placementId}:${job.rootFolderId}:${job.configurationHash}`;
      if (!latestPlacements.has(job.placementId)) { protectedIds.add(job.jobId); latestPlacements.add(job.placementId); }
      if (job.status === "completed" && !successfulScopes.has(scope)) { protectedIds.add(job.jobId); successfulScopes.add(scope); }
      if (job.results.some((item) => item.createdAssetId && item.status !== "imported")) protectedIds.add(job.jobId);
    }
    for (const job of ordered) {
      if (protectedIds.has(job.jobId)) continue;
      await rm(join(this.directory, `${job.jobId}.json`));
      this.jobs.delete(job.jobId);
    }
  }
}

const productionDeps = { loadDriveSourceIndex, findDriveSourceAssets, importNewDriveFile };
export class DriveAutoImportManager {
  private ready?: Promise<void>;
  private active?: { job: DriveImportJob; controller: AbortController };
  private completion?: Promise<void>;
  constructor(readonly store: DriveJobStore, private deps = productionDeps) {}
  initialize() { return this.ready ??= this.store.initialize(); }
  async waitForIdle() { await this.completion; }

  async start(placementId: number, config: UploadConfig, initiatedBy: string, client: GoogleDriveClient) {
    await this.initialize();
    const placement = config.placements.find((p) => p.placement_id === placementId);
    const rootFolderId = placement?.google_drive_folder_id?.trim();
    if (!placement || !rootFolderId) throw new Error("Select a placement with a configured Google Drive folder.");
    if (config.placements.some((p) => p.placement_id !== placementId && p.google_drive_folder_id?.trim() === rootFolderId)) {
      throw new Error("This Drive root is configured for multiple placements. Resolve the configuration first.");
    }
    if (this.active?.job.placementId === placementId && this.active.job.rootFolderId === rootFolderId) return summarizeDriveJob(this.active.job);
    const jobId = randomUUID();
    const release = acquireDriveWriter(jobId);
    if (!release) throw new DriveImportBusyError();
    const job: DriveImportJob = { version: 1, jobId, placementId, placementName: placement.placement_name, rootFolderId,
      configurationHash: driveConfigurationHash(config, placementId), initiatedBy, startedAt: new Date().toISOString(),
      status: "running", phase: "scanning", cancelRequested: false, foldersScanned: 0, matchedFolders: 0, eligible: 0, results: [] };
    const controller = new AbortController();
    this.active = { job, controller };
    try { await this.store.save(job); } catch (error) { this.active = undefined; release(); throw error; }
    this.completion = this.run(job, config, client, controller.signal).finally(() => { this.active = undefined; release(); });
    return summarizeDriveJob(job);
  }

  async status(placementId: number, config: UploadConfig) {
    await this.initialize();
    const jobs = [...this.store.jobs.values()].filter((job) => job.placementId === placementId).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const hash = driveConfigurationHash(config, placementId);
    const successful = jobs.find((job) => job.status === "completed" && job.configurationHash === hash) ?? jobs.find((job) => job.status === "completed");
    return { latest: jobs[0] ? summarizeDriveJob(jobs[0]) : null, lastSuccessful: successful ? summarizeDriveJob(successful) : null,
      configurationChanged: Boolean(successful && successful.configurationHash !== hash) };
  }

  async get(jobId: string) { await this.initialize(); return this.store.jobs.get(jobId); }
  async cancel(jobId: string) {
    let job = await this.get(jobId);
    if (job && this.active?.job.jobId === jobId) {
      job = this.active.job;
      job.cancelRequested = true;
      this.active.controller.abort();
      await this.store.save(job);
    }
    return job;
  }

  private async run(job: DriveImportJob, config: UploadConfig, client: GoogleDriveClient, signal: AbortSignal) {
    try {
      await scanDrivePlacement({ client, config, job, signal, progress: () => this.store.save(job) });
      job.phase = "indexing"; job.current = "Checking existing Immich sources, including archive and trash";
      await this.store.save(job);
      const index: Awaited<ReturnType<typeof loadDriveSourceIndex>> = job.eligible ? await this.deps.loadDriveSourceIndex(signal, async (count) => {
        job.current = `${count} Immich assets checked, including archived and trashed assets`;
        await this.store.save(job);
      }) : new Map();
      const placement = config.placements.find((p) => p.placement_id === job.placementId)!;
      let skippedSinceSave = 0;
      for (const item of job.results.filter((result) => result.status === "pending")) {
        signal.throwIfAborted();
        job.phase = "importing"; job.current = item.path;
        // Incomplete uploads are repaired only with durable evidence that Atlas created them.
        const recovery = [...this.store.jobs.values()].filter((prior) => prior.jobId !== job.jobId && prior.rootFolderId === job.rootFolderId && prior.placementId === job.placementId)
          .flatMap((prior) => prior.results).find((prior) => prior.fileId === item.fileId && prior.createdAssetId && prior.status !== "imported");
        try {
          const existing = index.get(item.fileId) ?? await this.deps.findDriveSourceAssets(item.fileId, signal);
          const others = recovery ? existing.filter((asset) => asset.id !== recovery.createdAssetId) : existing;
          if (others.length || (existing.length && !recovery)) {
            const conflict = sourceConflict(others.length ? others : existing, job.placementId);
            item.status = conflict ? "needs_review" : "existing";
            item.detail = conflict ?? "Drive source already exists in Immich (including archived/trashed assets).";
            item.assetId = existing[0].id;
          } else if (recovery && (recovery.file?.modifiedTime !== item.file?.modifiedTime || recovery.activityId !== item.activityId ||
              (recovery.assetType ?? "artwork") !== (item.assetType ?? "artwork"))) {
            item.status = "needs_review"; item.detail = "A pending upload exists, but its source, activity, or asset type changed. Reconcile it manually.";
          } else {
            await this.store.save(job);
            const result = await this.deps.importNewDriveFile({ client, file: item.file!,
              sourceLinkContext: { config, placementId: job.placementId, activityId: item.activityId! },
              tags: [`placement:${job.placementId}`, placement.partner_name, placement.placement_name, `activity:${item.activityId}`, item.activityLabel!,
                ...(item.assetType ? [assetTypeTag(item.assetType)] : [])].filter(Boolean),
              tempDirectory: join(this.store.directory, "tmp"), signal, recoveryAssetId: recovery?.createdAssetId,
              checkpoint: async (assetId) => { item.createdAssetId = assetId; item.assetId = assetId; job.phase = "verifying"; await this.store.save(job); } });
            item.status = result.status; item.assetId = result.assetId; item.detail = result.detail;
            if (result.status === "imported" && recovery) {
              for (const prior of this.store.jobs.values()) {
                let changed = false;
                for (const old of prior.results) {
                  if (old.createdAssetId === recovery.createdAssetId && old !== item) { delete old.createdAssetId; changed = true; }
                }
                if (changed) await this.store.save(prior);
              }
            }
          }
        } catch (error) {
          item.status = "failed"; item.detail = errorMessage(error);
          signal.throwIfAborted();
        }
        if (item.status !== "existing" || ++skippedSinceSave >= 25) { await this.store.save(job); skippedSinceSave = 0; }
      }
      signal.throwIfAborted();
      job.status = job.results.some((item) => item.status === "failed" || item.status === "needs_review")
        ? "completed_with_issues" : job.matchedFolders === 0 ? "no_matches" : "completed";
    } catch (error) {
      job.status = signal.aborted ? "cancelled" : "failed"; job.error = signal.aborted ? "Cancelled; completed imports were preserved." : errorMessage(error);
    }
    job.phase = "done"; job.current = undefined; job.finishedAt = new Date().toISOString();
    try { await this.store.save(job); } catch (error) {
      job.status = "failed"; job.error = `Could not persist final sync history: ${errorMessage(error)}`;
      this.store.jobs.set(job.jobId, structuredClone(job));
      console.error("[Drive auto-import] Could not persist final job status");
    }
    try { await this.store.prune(); } catch { console.warn("[Drive auto-import] History retention cleanup failed"); }
  }
}

export class DriveImportBusyError extends Error {
  constructor() { super("Another Drive import or maintenance operation is running. Try again after it finishes."); }
}

export const driveAutoImport = new DriveAutoImportManager(new DriveJobStore(join(process.env.DATA_DIR ?? join(process.cwd(), "data"), "drive-auto-import")));
