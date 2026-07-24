import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getAsset, getAssetOriginal } from "../infra/ImmichClient.js";
import { isAudioAsset, parseImmichDuration } from "./audioAsset.service.js";

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const WAVEFORM_DIR = join(DATA_DIR, "audio-waveforms");
const WAVEFORM_SAMPLE_COUNT = 1500;
const execFile = promisify(execFileCallback);

export interface AudioWaveform {
  assetId: string;
  durationSeconds: number;
  sampleCount: number;
  peaks: number[];
}

function cachePath(assetId: string, checksum: string) {
  const version = checksum.replace(/[^a-zA-Z0-9_-]/g, "");
  return join(WAVEFORM_DIR, `${assetId}-${version}.json`);
}

function calculatePeaks(pcm: Buffer, sampleCount: number) {
  const totalSamples = Math.floor(pcm.length / 2);
  const bucketSize = Math.max(1, Math.ceil(totalSamples / sampleCount));
  const raw: number[] = [];
  let globalMax = 1;
  for (let bucket = 0; bucket < sampleCount; bucket += 1) {
    const start = bucket * bucketSize;
    if (start >= totalSamples) break;
    const end = Math.min(totalSamples, start + bucketSize);
    let peak = 0;
    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, Math.abs(pcm.readInt16LE(index * 2)));
    }
    raw.push(peak);
    globalMax = Math.max(globalMax, peak);
  }
  return raw.map((peak) => Number((peak / globalMax).toFixed(4)));
}

export async function getAudioWaveform(assetId: string): Promise<AudioWaveform> {
  const asset = await getAsset(assetId);
  if (!isAudioAsset(asset)) throw new Error("Waveforms are only available for tagged audio assets.");
  const durationSeconds = parseImmichDuration(asset.duration);
  if (durationSeconds <= 0) throw new Error("The audio duration is unavailable.");

  const path = cachePath(asset.id, asset.checksum);
  try {
    return JSON.parse(await readFile(path, "utf8")) as AudioWaveform;
  } catch {
    // Generate lazily when no valid cache entry exists.
  }

  await mkdir(WAVEFORM_DIR, { recursive: true });
  const tempDir = await mkdtemp(join(WAVEFORM_DIR, "work-"));
  const inputPath = join(tempDir, "source.mp4");
  const pcmPath = join(tempDir, "waveform.pcm");
  try {
    const original = await getAssetOriginal(assetId);
    if (!original.ok || !original.body) {
      throw new Error(`Unable to download audio (${original.status}).`);
    }
    await pipeline(Readable.fromWeb(original.body as never), createWriteStream(inputPath));
    await execFile(
      "ffmpeg",
      ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "2000", "-f", "s16le", pcmPath],
      { timeout: 10 * 60 * 1000, maxBuffer: 2 * 1024 * 1024 },
    );
    const result: AudioWaveform = {
      assetId,
      durationSeconds,
      sampleCount: WAVEFORM_SAMPLE_COUNT,
      peaks: calculatePeaks(await readFile(pcmPath), WAVEFORM_SAMPLE_COUNT),
    };
    await writeFile(path, JSON.stringify(result), "utf8");
    return result;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
