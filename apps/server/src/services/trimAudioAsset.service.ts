import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  copyAssetRelationships,
  getAsset,
  getAssetOriginal,
  tagAssets,
  updateAsset,
  uploadAsset,
} from "../infra/ImmichClient.js";
import { isAudioAsset, parseImmichDuration } from "./audioAsset.service.js";

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const JOB_DIR = join(DATA_DIR, "audio-trim-jobs");
const MIN_TRIM_SECONDS = 0.5;

export type AudioTrimJobState =
  | "prepared"
  | "downloading"
  | "rendering"
  | "uploaded"
  | "relationships_copied"
  | "verified"
  | "source_archived"
  | "complete"
  | "failed";

export interface AudioTrimJob {
  id: string;
  sourceAssetId: string;
  targetAssetId?: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  state: AudioTrimJobState;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

const activeJobs = new Map<string, AudioTrimJob>();

function jobPath(id: string) {
  return join(JOB_DIR, `${id}.json`);
}

async function persist(job: AudioTrimJob) {
  job.updatedAt = new Date().toISOString();
  await mkdir(JOB_DIR, { recursive: true });
  await writeFile(jobPath(job.id), JSON.stringify(job, null, 2), "utf8");
}

async function transition(
  job: AudioTrimJob,
  state: AudioTrimJobState,
  progress: number,
  message: string,
) {
  job.state = state;
  job.progress = progress;
  job.message = message;
  await persist(job);
}

function outputFilename(originalName: string) {
  const extension = extname(originalName);
  const originalStem = basename(originalName, extension);
  const stem = originalStem.replace(/-artasia-trim$/i, "");
  return `${stem || "audio"}-artasia-trim.mp4`;
}

function runFfmpeg(
  inputPath: string,
  outputPath: string,
  startSeconds: number,
  endSeconds: number,
  onProgress: (progress: number) => void,
) {
  const selectedDuration = endSeconds - startSeconds;
  const start = startSeconds.toFixed(2);
  const end = endSeconds.toFixed(2);
  const filter =
    `[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[v];` +
    `[0:a]atrim=start=${start}:end=${end},asetpts=PTS-STARTPTS[a]`;
  const args = [
    "-y",
    "-i",
    inputPath,
    "-filter_complex",
    filter,
    "-map",
    "[v]",
    "-map",
    "[a]",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-tune",
    "stillimage",
    "-r",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-progress",
    "pipe:1",
    "-nostats",
    outputPath,
  ];

  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^out_time_ms=(\d+)$/.exec(line);
        if (!match) continue;
        const renderedSeconds = Number(match[1]) / 1_000_000;
        onProgress(Math.min(99, Math.max(0, (renderedSeconds / selectedDuration) * 100)));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-12_000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg trim failed: ${stderr.trim().split(/\r?\n/).slice(-8).join("\n")}`));
    });
  });
}

async function verifyReplacement(
  assetId: string,
  expectedDuration: number,
  expectedTagIds: string[],
) {
  let lastDuration = 0;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const asset = await getAsset(assetId);
    lastDuration = parseImmichDuration(asset.duration);
    const tagIds = new Set((asset.tags ?? []).map((tag) => tag.id));
    if (
      asset.type === "VIDEO" &&
      Math.abs(lastDuration - expectedDuration) <= 0.15 &&
      expectedTagIds.every((id) => tagIds.has(id))
    ) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `Replacement verification failed: expected ${expectedDuration.toFixed(2)}s, received ${lastDuration.toFixed(2)}s.`,
  );
}

async function runTrimJob(job: AudioTrimJob) {
  const tempDir = await mkdtemp(join(JOB_DIR, "work-"));
  const inputPath = join(tempDir, "source.mp4");
  const outputPath = join(tempDir, "trimmed.mp4");
  try {
    const source = await getAsset(job.sourceAssetId);
    await transition(job, "downloading", 3, "Preparing audio");
    const original = await getAssetOriginal(job.sourceAssetId);
    if (!original.ok || !original.body) {
      throw new Error(`Unable to download source audio (${original.status}).`);
    }
    await pipeline(Readable.fromWeb(original.body as never), createWriteStream(inputPath));

    await transition(job, "rendering", 5, "Trimming audio");
    await runFfmpeg(inputPath, outputPath, job.startSeconds, job.endSeconds, (renderProgress) => {
      job.progress = 5 + Math.round(renderProgress * 0.7);
    });

    await transition(job, "rendering", 77, "Uploading replacement");
    const uploaded = await uploadAsset({
      filePath: outputPath,
      filename: outputFilename(source.originalFileName),
      mimeType: "video/mp4",
      createdAt: new Date(source.fileCreatedAt),
      modifiedAt: new Date(),
    });
    job.targetAssetId = uploaded.id;
    await transition(job, "uploaded", 80, "Replacement uploaded");

    await copyAssetRelationships(source.id, uploaded.id);
    const sourceTags = source.tags ?? [];
    const tagIds = sourceTags.map((tag) => tag.id);
    if (tagIds.length > 0) await tagAssets([uploaded.id], tagIds);
    const latitude = source.exifInfo?.latitude;
    const longitude = source.exifInfo?.longitude;
    await updateAsset(uploaded.id, {
      description: source.exifInfo?.description ?? "",
      isFavorite: source.isFavorite,
      ...(typeof latitude === "number" &&
      Number.isFinite(latitude) &&
      typeof longitude === "number" &&
      Number.isFinite(longitude)
        ? { latitude, longitude }
        : {}),
      dateTimeOriginal: source.fileCreatedAt,
      visibility: "timeline",
    });
    await transition(job, "relationships_copied", 88, "Copying tags and albums");

    await verifyReplacement(uploaded.id, job.durationSeconds, tagIds);
    await transition(job, "verified", 95, "Verifying replacement");
    await updateAsset(source.id, { visibility: "archive" });
    await transition(job, "source_archived", 99, "Archiving original");
    await transition(job, "complete", 100, "Audio trim complete");
  } catch (error) {
    job.error = (error as Error).message;
    await transition(job, "failed", job.progress, "Audio trim failed");
  } finally {
    activeJobs.delete(job.id);
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function createAudioTrimJob(
  sourceAssetId: string,
  requestedStart: unknown,
  requestedEnd: unknown,
) {
  if (
    Array.from(activeJobs.values()).some(
      (job) => job.sourceAssetId === sourceAssetId && job.state !== "failed",
    )
  ) {
    throw new Error("An audio trim is already running for this asset.");
  }
  const source = await getAsset(sourceAssetId);
  if (!isAudioAsset(source)) throw new Error("Only tagged audio assets can be trimmed.");
  const sourceDuration = parseImmichDuration(source.duration);
  if (sourceDuration <= 0) throw new Error("The audio duration is unavailable.");
  const startSeconds = Math.round(Number(requestedStart) * 100) / 100;
  const endSeconds = Math.round(Number(requestedEnd) * 100) / 100;
  if (
    !Number.isFinite(startSeconds) ||
    !Number.isFinite(endSeconds) ||
    startSeconds < 0 ||
    endSeconds > sourceDuration + 0.05 ||
    endSeconds - startSeconds < MIN_TRIM_SECONDS
  ) {
    throw new Error("Choose a valid audio range of at least 0.50 seconds.");
  }
  const now = new Date().toISOString();
  const job: AudioTrimJob = {
    id: `${Date.now()}-${sourceAssetId}`,
    sourceAssetId,
    startSeconds,
    endSeconds,
    durationSeconds: endSeconds - startSeconds,
    state: "prepared",
    progress: 0,
    message: "Trim queued",
    createdAt: now,
    updatedAt: now,
  };
  activeJobs.set(job.id, job);
  await persist(job);
  void runTrimJob(job);
  return job;
}

export async function getAudioTrimJob(jobId: string) {
  if (!/^\d{10,}-[0-9a-f-]{36}$/i.test(jobId)) return null;
  const active = activeJobs.get(jobId);
  if (active) return active;
  try {
    const job = JSON.parse(await readFile(jobPath(jobId), "utf8")) as AudioTrimJob;
    if (job.state !== "complete" && job.state !== "failed") {
      job.error = "The server restarted before this audio trim completed. The original remains active.";
      await transition(job, "failed", job.progress, "Audio trim interrupted");
    }
    return job;
  } catch {
    return null;
  }
}
