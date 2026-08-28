import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm, statfs } from "node:fs/promises";
import { join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { setTimeout as delay } from "node:timers/promises";
import { getAsset, listTags, searchAssets, tagAsset, uploadAsset, type ImmichAsset } from "../infra/ImmichClient.js";
import { driveSourceIds, DRIVE_SOURCE_PREFIX } from "./driveSource.service.js";
import { GoogleDriveClient, ensureDriveFileExtension, type DriveFile } from "./googleDrive.service.js";
import { prepareAudioAsVideo } from "./audioToVideo.service.js";
import { parseImmichDuration } from "./audioAsset.service.js";
import { UPLOAD_LIMITS } from "./uploadLimits.js";
import { linkDriveChecksumDuplicate, type DriveDuplicateLinkContext } from "./driveDuplicateLink.service.js";

export type SourceIndex = Map<string, ImmichAsset[]>;
// Locked assets require an elevated Immich user session; API keys cannot search them.
const VISIBILITIES = ["timeline", "archive", "hidden"] as const;

export function addSourceAsset(index: SourceIndex, asset: ImmichAsset) {
  for (const id of driveSourceIds(asset)) {
    const existing = index.get(id) ?? [];
    index.set(id, [...existing.filter((candidate) => candidate.id !== asset.id), asset]);
  }
}

/** Include trash and stacked children across all API-key-accessible visibilities. */
export async function sourceAssets(tagIds?: string[], signal?: AbortSignal, progress?: (count: number) => Promise<void>) {
  const assets = new Map<string, ImmichAsset>();
  for (const visibility of VISIBILITIES) {
    for (let page = 1; ; page++) {
      signal?.throwIfAborted();
      if (page > 10_000) throw new Error("Immich inventory exceeded the page safety limit.");
      const result = await searchAssets({ visibility, withDeleted: true, withStacked: true, tagIds,
        page, size: 500, withExif: false, withPeople: false });
      for (const asset of result.assets.items) {
        signal?.throwIfAborted();
        assets.set(asset.id, Array.isArray(asset.tags) ? asset : await getAsset(asset.id));
      }
      await progress?.(assets.size);
      if (!result.assets.nextPage) break;
    }
  }
  return [...assets.values()];
}

export async function loadDriveSourceIndex(signal?: AbortSignal, progress?: (count: number) => Promise<void>): Promise<SourceIndex> {
  const index: SourceIndex = new Map();
  for (const asset of await sourceAssets(undefined, signal, progress)) addSourceAsset(index, asset);
  return index;
}

/** Fresh source-specific check immediately before a transfer, including external writes. */
export async function findDriveSourceAssets(fileId: string, signal?: AbortSignal) {
  const tags = (await listTags(true)).filter((tag) => driveSourceIds({ tags: [tag] }).includes(fileId));
  const assets = new Map<string, ImmichAsset>();
  for (const tag of tags) {
    for (const asset of await sourceAssets([tag.id], signal)) {
      if (driveSourceIds(asset).includes(fileId)) assets.set(asset.id, asset);
    }
  }
  return [...assets.values()];
}

export function sourceConflict(assets: ImmichAsset[], placementId: number) {
  // Atlas intentionally retains archived originals beside edited derivatives.
  const active = assets.filter((asset) => !asset.isArchived && !asset.isTrashed && (!asset.visibility || asset.visibility === "timeline"));
  if (active.length > 1) return "Multiple active Immich assets share this Drive ID; resolve the source links manually.";
  const placements = assets.flatMap((asset) => asset.tags ?? []).flatMap((tag) => [tag.name, tag.value])
    .map((value) => value.trim().match(/^placement:(\d+)$/i)?.[1]).filter(Boolean);
  return placements.some((id) => Number(id) !== placementId)
    ? "This Drive source already belongs to another placement; it was left unchanged." : undefined;
}

export async function spoolDriveFile(stream: NodeJS.ReadableStream, directory: string, maxBytes: number, signal: AbortSignal) {
  let workDir: string | undefined;
  let bytes = 0;
  try {
    await mkdir(directory, { recursive: true });
    workDir = await mkdtemp(join(directory, "transfer-"));
    const filePath = join(workDir, "source");
    const disk = await statfs(workDir);
    const available = Math.max(0, disk.bavail * disk.bsize - 256 * 1024 * 1024);
    const limit = Math.min(maxBytes, available);
    const limiter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > limit ? new Error("Download exceeds the file limit or available temporary disk space.") : null, chunk);
    } });
    await pipeline(stream as NodeJS.ReadableStream & AsyncIterable<Uint8Array>, limiter, createWriteStream(filePath), { signal });
    if (!bytes) throw new Error("Drive returned an empty file.");
    const completedDirectory = workDir;
    return { workDir, filePath, cleanup: () => rm(completedDirectory, { recursive: true, force: true }) };
  } catch (error) {
    (stream as NodeJS.ReadableStream & { destroy?: () => void }).destroy?.();
    if (workDir) await rm(workDir, { recursive: true, force: true });
    throw error;
  }
}

const defaultMediaDeps = { getAsset, tagAsset, uploadAsset, prepareAudioAsVideo };
export type AdditiveImportResult = { status: "imported" | "linked" | "existing" | "needs_review"; assetId: string; detail?: string };

/** No replacement/deletion/relationship-copying path exists in this entry point. */
export async function importNewDriveFile(params: {
  client: Pick<GoogleDriveClient, "getFile" | "downloadFile">;
  file: DriveFile;
  tags: string[];
  tempDirectory: string;
  signal: AbortSignal;
  recoveryAssetId?: string;
  sourceLinkContext?: DriveDuplicateLinkContext;
  checkpoint: (assetId: string) => Promise<void>;
}, deps: typeof defaultMediaDeps & { findDriveSourceAssets?: typeof findDriveSourceAssets } = defaultMediaDeps): Promise<AdditiveImportResult> {
  const audio = GoogleDriveClient.isAudio(params.file.mimeType);
  let assetId = params.recoveryAssetId;
  if (!assetId) {
    params.signal.throwIfAborted();
    const current = await params.client.getFile(params.file.id);
    if (current.modifiedTime !== params.file.modifiedTime || current.mimeType !== params.file.mimeType ||
      !current.parents?.some((id) => params.file.parents?.includes(id))) {
      throw new Error("Drive file changed or moved after discovery. Run auto-import again.");
    }
    if (!GoogleDriveClient.isSupported(current.mimeType, current.name)) throw new Error("Unsupported Drive media type.");
    const maxBytes = audio ? UPLOAD_LIMITS.maxFileBytes : 10 * 1024 ** 3;
    if (Number(current.size) > maxBytes) throw new Error("Drive file exceeds the import size limit.");
    const signal = AbortSignal.any([params.signal, AbortSignal.timeout(60 * 60_000)]);
    const stream = await params.client.downloadFile(current.id, signal);
    const source = await spoolDriveFile(stream, params.tempDirectory, maxBytes, signal);
    let prepared: Awaited<ReturnType<typeof prepareAudioAsVideo>> | undefined;
    try {
      const filename = ensureDriveFileExtension(current.name, current.mimeType);
      if (audio) prepared = await deps.prepareAudioAsVideo({ stream: createReadStream(source.filePath), originalName: filename, signal, workRoot: source.workDir });
      const result = await deps.uploadAsset({
        filePath: prepared?.filePath ?? source.filePath, filename: prepared?.filename ?? filename,
        mimeType: prepared?.mimeType ?? current.mimeType, deviceAssetId: `artasia-galaxy:drive:${current.id}`,
        createdAt: current.modifiedTime ? new Date(current.modifiedTime) : undefined,
        modifiedAt: current.modifiedTime ? new Date(current.modifiedTime) : undefined, signal,
      });
      if (!result.id) throw new Error("Immich did not return an asset ID.");
      if (result.status === "duplicate") {
        return await linkDriveChecksumDuplicate({ assetId: result.id, fileId: current.id, context: params.sourceLinkContext, signal }, {
          getAsset: deps.getAsset, tagAsset: deps.tagAsset, findSources: deps.findDriveSourceAssets ?? findDriveSourceAssets,
        });
      }
      if (result.status !== "created") {
        return { status: "needs_review", assetId: result.id, detail: "Immich returned an unrecognized upload status. No tags were changed; inspect the asset before retrying." };
      }
      assetId = result.id;
      // Persist ownership before any metadata writes; retries only repair our own uploads.
      await params.checkpoint(assetId);
    } finally {
      try { await prepared?.cleanup(); } finally { await source.cleanup(); }
    }
  }
  let asset: ImmichAsset;
  try { asset = await deps.getAsset(assetId); } catch (error) {
    if (params.recoveryAssetId && /^Immich 404\b/.test(error instanceof Error ? error.message : "")) {
      // A permanently deleted incomplete upload no longer blocks this Drive source.
      return importNewDriveFile({ ...params, recoveryAssetId: undefined }, deps);
    }
    throw error;
  }
  const sourceIds = driveSourceIds(asset);
  const requiredManagedTags = new Set(params.tags.map((tag) => tag.toLowerCase()));
  const reassigned = (asset.tags ?? []).flatMap((tag) => [tag.name, tag.value])
    .some((tag) => /^(placement|activity):\d+$/i.test(tag.trim()) && !requiredManagedTags.has(tag.trim().toLowerCase()));
  if (asset.isArchived || asset.isTrashed || (asset.visibility && asset.visibility !== "timeline") ||
      reassigned || sourceIds.some((id) => id !== params.file.id)) {
    return { status: "needs_review", assetId, detail: "The pending upload was archived, trashed, or reassigned. It was left unchanged." };
  }
  const tags = [...params.tags, `${DRIVE_SOURCE_PREFIX}${params.file.id}`, ...(audio ? ["media:audio"] : [])];
  for (let pass = 0; pass < 2; pass++) {
    params.signal.throwIfAborted();
    await deps.tagAsset(assetId, tags);
    for (let attempt = 0; attempt < (audio ? 120 : 20); attempt++) {
      params.signal.throwIfAborted();
      const verified = await deps.getAsset(assetId);
      const values = new Set((verified.tags ?? []).flatMap((tag) => [tag.name, tag.value]).map((value) => value.trim().toLowerCase()));
      const sourceVerified = driveSourceIds(verified).includes(params.file.id);
      if (sourceVerified && tags.filter((tag) => !tag.startsWith(DRIVE_SOURCE_PREFIX)).every((tag) => values.has(tag.toLowerCase())) && (!audio || parseImmichDuration(verified.duration) > 0)) {
        return { status: "imported", assetId };
      }
      await delay(250, undefined, { signal: params.signal });
    }
  }
  throw new Error("Upload exists, but required tags/audio duration could not be verified. Run again to retry verification.");
}
