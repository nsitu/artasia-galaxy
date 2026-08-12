import { createWriteStream } from "node:fs";
import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";

const DEFAULT_MAX_DURATION_SECONDS = 2 * 60 * 60;
const FFMPEG_TIMEOUT_MS = parseInt(
  process.env.DRIVE_AUDIO_CONVERSION_TIMEOUT_MS ?? `${30 * 60 * 1000}`,
  10,
);
const MAX_DURATION_SECONDS = parseInt(
  process.env.DRIVE_AUDIO_MAX_DURATION_SECONDS ?? `${DEFAULT_MAX_DURATION_SECONDS}`,
  10,
);
const DURATION_TOLERANCE_SECONDS = 1.25;
export const AUDIO_VIDEO_FRAME_RATE = 12;

export interface PreparedAudioVideo {
  filePath: string;
  filename: string;
  mimeType: "video/mp4";
  durationSeconds: number;
  outputBytes: number;
  cleanup: () => Promise<void>;
}

function bundledFramePath() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../../assets/audio-frame.png");
}

function audioFramePath() {
  return process.env.AUDIO_FRAME_PATH
    ? resolve(process.env.AUDIO_FRAME_PATH)
    : bundledFramePath();
}

function outputFilename(originalName: string) {
  const safeName = basename(originalName).replace(/[\u0000-\u001f<>:"/\\|?*]/g, "_");
  const extension = extname(safeName);
  const stem = extension ? safeName.slice(0, -extension.length) : safeName;
  return `${stem || "audio"}.mp4`;
}

function durationTolerance(expectedSeconds: number) {
  return Math.max(DURATION_TOLERANCE_SECONDS, expectedSeconds * 0.02);
}

function runProcess(
  command: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      command,
      args,
      { timeout, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr.trim().split(/\r?\n/).slice(-8).join("\n");
          rejectPromise(
            new Error(`${command} failed: ${detail || error.message}`),
          );
          return;
        }
        resolvePromise({ stdout, stderr });
      },
    );
  });
}

async function probeDuration(inputPath: string) {
  const { stdout } = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ],
    30_000,
  );
  const duration = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Unable to determine audio duration");
  }
  return duration;
}

async function probeInitialVideoPacketCount(inputPath: string) {
  const { stdout } = await runProcess(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-read_intervals",
      "0%+#2",
      "-count_packets",
      "-show_entries",
      "stream=nb_read_packets",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      inputPath,
    ],
    30_000,
  );
  const packetCount = Number.parseInt(stdout.trim(), 10);
  return Number.isFinite(packetCount) ? packetCount : 0;
}

export async function prepareAudioAsVideo(params: {
  stream: NodeJS.ReadableStream;
  originalName: string;
}): Promise<PreparedAudioVideo> {
  const workDir = await mkdtemp(join(tmpdir(), "artasia-drive-audio-"));
  const inputPath = join(workDir, "source.audio");
  const filename = outputFilename(params.originalName);
  const outputPath = join(workDir, filename);

  try {
    const framePath = audioFramePath();
    await access(framePath).catch(() => {
      throw new Error(`Audio frame image not found at ${framePath}`);
    });
    await pipeline(params.stream as NodeJS.ReadableStream & AsyncIterable<Uint8Array>, createWriteStream(inputPath));

    const durationSeconds = await probeDuration(inputPath);
    if (durationSeconds > MAX_DURATION_SECONDS) {
      throw new Error(
        `Audio duration exceeds the ${Math.round(MAX_DURATION_SECONDS / 60)} minute limit`,
      );
    }

    await runProcess(
      "ffmpeg",
      [
        "-y",
        "-loop",
        "1",
        "-framerate",
        `${AUDIO_VIDEO_FRAME_RATE}`,
        "-i",
        framePath,
        "-i",
        inputPath,
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-tune",
        "stillimage",
        "-r",
        `${AUDIO_VIDEO_FRAME_RATE}`,
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-t",
        durationSeconds.toFixed(3),
        "-movflags",
        "+faststart",
        outputPath,
      ],
      FFMPEG_TIMEOUT_MS,
    );

    const outputStats = await stat(outputPath);
    if (outputStats.size === 0) {
      throw new Error("Audio conversion produced an empty video");
    }

    const initialVideoPacketCount = await probeInitialVideoPacketCount(outputPath);
    if (initialVideoPacketCount < 2) {
      throw new Error(
        `Audio conversion produced too few video frames (${initialVideoPacketCount})`,
      );
    }

    const outputDurationSeconds = await probeDuration(outputPath);
    if (
      Math.abs(outputDurationSeconds - durationSeconds) >
      durationTolerance(durationSeconds)
    ) {
      throw new Error(
        `Audio conversion duration mismatch: source ${durationSeconds.toFixed(2)}s, output ${outputDurationSeconds.toFixed(2)}s`,
      );
    }

    return {
      filePath: outputPath,
      filename,
      mimeType: "video/mp4",
      durationSeconds,
      outputBytes: outputStats.size,
      cleanup: () => rm(workDir, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}
