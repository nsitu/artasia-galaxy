import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { execFile as execFileCallback, spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
  copyAssetRelationships,
  deleteAssets,
  getAsset,
  getAssetOriginal,
  tagAssets,
  updateAsset,
  uploadAsset,
} from "../infra/ImmichClient.js";
import { isAudioAsset, parseImmichDuration } from "./audioAsset.service.js";

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const JOB_DIR = join(DATA_DIR, "video-rotation-jobs");
const VIDEO_ROTATION_TIMEOUT_MS = parseInt(
  process.env.VIDEO_ROTATION_TIMEOUT_MS ?? `${2 * 60 * 60 * 1000}`,
  10,
);
const VIDEO_ROTATIONS = [90, 180, 270] as const;
const VIDEO_FILE_EXTENSIONS = new Set([
  ".mp4",
  ".m4v",
  ".mov",
  ".webm",
  ".avi",
  ".mkv",
]);
const execFile = promisify(execFileCallback);

export type VideoRotationDegrees = (typeof VIDEO_ROTATIONS)[number];
export type VideoRotationJobState =
  | "prepared"
  | "downloading"
  | "rendering"
  | "uploaded"
  | "relationships_copied"
  | "verified"
  | "source_archived"
  | "complete"
  | "failed";

export interface VideoRotationJob {
  id: string;
  sourceAssetId: string;
  targetAssetId?: string;
  rotationDegrees: VideoRotationDegrees;
  durationSeconds: number;
  width?: number;
  height?: number;
  state: VideoRotationJobState;
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

const activeJobs = new Map<string, VideoRotationJob>();

function jobPath(id: string) {
  return join(JOB_DIR, `${id}.json`);
}

async function persist(job: VideoRotationJob) {
  job.updatedAt = new Date().toISOString();
  await mkdir(JOB_DIR, { recursive: true });
  await writeFile(jobPath(job.id), JSON.stringify(job, null, 2), "utf8");
}

async function transition(
  job: VideoRotationJob,
  state: VideoRotationJobState,
  progress: number,
  message: string,
) {
  job.state = state;
  job.progress = progress;
  job.message = message;
  await persist(job);
}

export function videoRotationFilter(rotationDegrees: VideoRotationDegrees) {
  const rotation = rotationDegrees === 90
    ? "transpose=clock"
    : rotationDegrees === 180
      ? "hflip,vflip"
      : "transpose=cclock";
  return `${rotation},scale=trunc(iw/2)*2:trunc(ih/2)*2`;
}

function parseRotation(value: unknown): VideoRotationDegrees {
  const degrees = Number(value);
  if (!VIDEO_ROTATIONS.includes(degrees as VideoRotationDegrees)) {
    throw new Error("Video rotation must be 90, 180, or 270 degrees.");
  }
  return degrees as VideoRotationDegrees;
}

export function videoRotationOutputFilename(
  originalName: string,
  rotationDegrees: VideoRotationDegrees,
) {
  const safeName = basename(originalName);
  const extension = extname(safeName);
  const originalStem = VIDEO_FILE_EXTENSIONS.has(extension.toLowerCase())
    ? basename(safeName, extension)
    : safeName;
  const stem = originalStem.replace(/-artasia-rotate-(?:90|180|270)$/i, "");
  return `${stem || "video"}-artasia-rotate-${rotationDegrees}.mp4`;
}

async function probeVideo(filePath: string) {
  const { stdout } = await execFile(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=width,height:format=duration",
      "-of",
      "json",
      filePath,
    ],
    { timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as {
    streams?: Array<{ width?: number; height?: number }>;
    format?: { duration?: string };
  };
  const width = Number(parsed.streams?.[0]?.width);
  const height = Number(parsed.streams?.[0]?.height);
  const durationSeconds = Number(parsed.format?.duration);
  if (
    !Number.isFinite(width) || width <= 0 ||
    !Number.isFinite(height) || height <= 0 ||
    !Number.isFinite(durationSeconds) || durationSeconds <= 0
  ) {
    throw new Error("Unable to verify the rotated video output.");
  }
  return { width, height, durationSeconds };
}

function runFfmpeg(
  inputPath: string,
  outputPath: string,
  rotationDegrees: VideoRotationDegrees,
  durationSeconds: number,
  onProgress: (progress: number) => void,
) {
  const args = [
    "-y",
    "-i",
    inputPath,
    "-map",
    "0:v:0",
    "-map",
    "0:a:0?",
    "-vf",
    videoRotationFilter(rotationDegrees),
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-b:a",
    "192k",
    "-movflags",
    "+faststart",
    "-metadata:s:v:0",
    "rotate=0",
    "-progress",
    "pipe:1",
    "-nostats",
    outputPath,
  ];

  return new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, VIDEO_ROTATION_TIMEOUT_MS);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        const match = /^out_time_(?:ms|us)=(\d+)$/.exec(line);
        if (!match) continue;
        const renderedSeconds = Number(match[1]) / 1_000_000;
        onProgress(Math.min(99, Math.max(0, (renderedSeconds / durationSeconds) * 100)));
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-12_000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      rejectPromise(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolvePromise();
      else if (timedOut) rejectPromise(new Error("FFmpeg video rotation timed out."));
      else rejectPromise(new Error(`FFmpeg video rotation failed: ${stderr.trim().split(/\r?\n/).slice(-8).join("\n")}`));
    });
  });
}

function durationTolerance(durationSeconds: number) {
  return Math.max(0.25, durationSeconds * 0.01);
}

async function verifyReplacement(
  assetId: string,
  expected: { width: number; height: number; durationSeconds: number },
  expectedTagIds: string[],
) {
  let lastResult = "unavailable";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const asset = await getAsset(assetId);
    const durationSeconds = parseImmichDuration(asset.duration);
    lastResult = `${asset.width ?? "?"}x${asset.height ?? "?"}, ${durationSeconds.toFixed(2)}s`;
    const tagIds = new Set((asset.tags ?? []).map((tag) => tag.id));
    if (
      asset.type === "VIDEO" &&
      asset.width === expected.width &&
      asset.height === expected.height &&
      Math.abs(durationSeconds - expected.durationSeconds) <= durationTolerance(expected.durationSeconds) &&
      expectedTagIds.every((tagId) => tagIds.has(tagId))
    ) {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000));
  }
  throw new Error(
    `Replacement verification failed: expected ${expected.width}x${expected.height}, ${expected.durationSeconds.toFixed(2)}s; received ${lastResult}.`,
  );
}

async function runRotationJob(
  job: VideoRotationJob,
  onComplete?: () => void | Promise<void>,
) {
  await mkdir(JOB_DIR, { recursive: true });
  const tempDir = await mkdtemp(join(JOB_DIR, "work-"));
  let sourceArchived = false;
  try {
    const source = await getAsset(job.sourceAssetId);
    const sourceExtension = extname(source.originalFileName) || ".video";
    const inputPath = join(tempDir, `source${sourceExtension}`);
    const outputPath = join(tempDir, "rotated.mp4");

    await transition(job, "downloading", 3, "Preparing video");
    const original = await getAssetOriginal(job.sourceAssetId);
    if (!original.ok || !original.body) {
      throw new Error(`Unable to download source video (${original.status}).`);
    }
    await pipeline(Readable.fromWeb(original.body as never), createWriteStream(inputPath));

    await transition(job, "rendering", 5, "Rotating video");
    await runFfmpeg(
      inputPath,
      outputPath,
      job.rotationDegrees,
      job.durationSeconds,
      (renderProgress) => {
        job.progress = 5 + Math.round(renderProgress * 0.7);
      },
    );
    const outputStats = await stat(outputPath);
    if (outputStats.size <= 0) throw new Error("Video rotation produced an empty file.");
    const output = await probeVideo(outputPath);
    job.width = output.width;
    job.height = output.height;
    job.durationSeconds = output.durationSeconds;

    await transition(job, "rendering", 77, "Uploading replacement");
    const uploaded = await uploadAsset({
      filePath: outputPath,
      filename: videoRotationOutputFilename(source.originalFileName, job.rotationDegrees),
      mimeType: "video/mp4",
      createdAt: new Date(source.fileCreatedAt),
      modifiedAt: new Date(),
    });
    job.targetAssetId = uploaded.id;
    await transition(job, "uploaded", 80, "Replacement uploaded");

    await copyAssetRelationships(source.id, uploaded.id);
    const tagIds = (source.tags ?? []).map((tag) => tag.id);
    if (tagIds.length > 0) await tagAssets([uploaded.id], tagIds);
    const latitude = source.exifInfo?.latitude;
    const longitude = source.exifInfo?.longitude;
    await updateAsset(uploaded.id, {
      description: source.exifInfo?.description ?? "",
      isFavorite: source.isFavorite,
      ...(typeof latitude === "number" && Number.isFinite(latitude) &&
      typeof longitude === "number" && Number.isFinite(longitude)
        ? { latitude, longitude }
        : {}),
      dateTimeOriginal: source.fileCreatedAt,
      visibility: "timeline",
    });
    await transition(job, "relationships_copied", 88, "Copying tags and albums");

    await verifyReplacement(uploaded.id, output, tagIds);
    await transition(job, "verified", 95, "Verifying replacement");
    await updateAsset(source.id, { visibility: "archive" });
    sourceArchived = true;
    await transition(job, "source_archived", 99, "Archiving original");
    await transition(job, "complete", 100, "Video rotation complete");
    await Promise.resolve(onComplete?.()).catch(() => undefined);
  } catch (error) {
    if (job.targetAssetId && !sourceArchived) {
      await deleteAssets([job.targetAssetId]).catch(() => undefined);
      job.targetAssetId = undefined;
    }
    job.error = (error as Error).message;
    await transition(job, "failed", job.progress, "Video rotation failed");
  } finally {
    activeJobs.delete(job.id);
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function createVideoRotationJob(
  sourceAssetId: string,
  requestedRotation: unknown,
  onComplete?: () => void | Promise<void>,
) {
  if (
    Array.from(activeJobs.values()).some(
      (job) => job.sourceAssetId === sourceAssetId && job.state !== "failed",
    )
  ) {
    throw new Error("A video rotation is already running for this asset.");
  }
  const source = await getAsset(sourceAssetId);
  if (source.type !== "VIDEO" || isAudioAsset(source)) {
    throw new Error("Only video assets can be rotated.");
  }
  if (source.isArchived) {
    throw new Error("Archived videos cannot be rotated. Restore the video first.");
  }
  const durationSeconds = parseImmichDuration(source.duration);
  if (durationSeconds <= 0) throw new Error("The video duration is unavailable.");
  const rotationDegrees = parseRotation(requestedRotation);
  const now = new Date().toISOString();
  const job: VideoRotationJob = {
    id: `${Date.now()}-${sourceAssetId}`,
    sourceAssetId,
    rotationDegrees,
    durationSeconds,
    state: "prepared",
    progress: 0,
    message: "Video rotation queued",
    createdAt: now,
    updatedAt: now,
  };
  activeJobs.set(job.id, job);
  await persist(job);
  void runRotationJob(job, onComplete);
  return job;
}

export async function getVideoRotationJob(jobId: string) {
  if (!/^\d{10,}-[0-9a-f-]{36}$/i.test(jobId)) return null;
  const active = activeJobs.get(jobId);
  if (active) return active;
  try {
    const job = JSON.parse(await readFile(jobPath(jobId), "utf8")) as VideoRotationJob;
    if (job.state !== "complete" && job.state !== "failed") {
      job.error = "The server restarted before this video rotation completed. The original remains active.";
      await transition(job, "failed", job.progress, "Video rotation interrupted");
    }
    return job;
  } catch {
    return null;
  }
}
