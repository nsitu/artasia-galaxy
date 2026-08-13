import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { basename, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import {
  copyAssetRelationships,
  getAsset,
  getAssetOriginal,
  getPublishedAlbum,
  removeAssetsFromAlbum,
  tagAssets,
  updateAsset,
  uploadAsset,
} from "../infra/ImmichClient.js";
import {
  getAssetAdjustments,
  saveAssetAdjustments,
} from "./assetAdjustments.service.js";

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const FLATTEN_DIR = join(DATA_DIR, "flatten-jobs");
const MAX_STRAIGHTEN_DEGREES = 45;
const RIGHT_ANGLE_ROTATIONS = [0, 90, 180, 270] as const;
const execFile = promisify(execFileCallback);

async function convertHeifToJpeg(inputPath: string) {
  const extension = extname(inputPath);
  const outputPath = extension ? `${inputPath.slice(0, -extension.length)}.jpg` : `${inputPath}.jpg`;

  try {
    await execFile("heif-convert", [inputPath, outputPath]);
  } catch (err) {
    try {
      await execFile("magick", [inputPath, outputPath]);
    } catch (innerErr) {
      try {
        await execFile("ffmpeg", ["-y", "-i", inputPath, outputPath]);
      } catch (finalErr) {
        throw new Error(`HEIF fallback conversion failed: ${(finalErr as Error).message}`);
      }
    }
  }

  await pipeline(createReadStream(outputPath), createWriteStream(inputPath));
}

export interface FlattenCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlattenRecipe {
  version: 1;
  rotationDegrees: (typeof RIGHT_ANGLE_ROTATIONS)[number];
  straightenDegrees: number;
  crop?: FlattenCrop;
  cropNormalized?: FlattenCrop;
  cropSpace: "auto-oriented-rotated";
  output?: { format: "jpeg"; quality?: number };
}

type JobState = "prepared" | "rendered" | "uploaded" | "relationships_copied" | "verified" | "source_archived" | "complete" | "failed";

interface FlattenJob {
  id: string;
  sourceAssetId: string;
  targetAssetId?: string;
  recipe: FlattenRecipe;
  state: JobState;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

function rotatedDimensions(width: number, height: number, degrees: number) {
  const radians = Math.abs(degrees) * Math.PI / 180;
  return {
    width: Math.max(1, Math.round(Math.abs(width * Math.cos(radians)) + Math.abs(height * Math.sin(radians)))),
    height: Math.max(1, Math.round(Math.abs(width * Math.sin(radians)) + Math.abs(height * Math.cos(radians)))),
  };
}

// Largest centered axis-aligned rectangle contained by a rotated rectangle.
function largestInnerRectangle(width: number, height: number, degrees: number): FlattenCrop {
  const angle = Math.abs(degrees % 180) * Math.PI / 180;
  if (angle < 1e-8) return { x: 0, y: 0, width, height };
  const sin = Math.abs(Math.sin(angle));
  const cos = Math.abs(Math.cos(angle));
  const longSide = Math.max(width, height);
  const shortSide = Math.min(width, height);
  let innerWidth: number;
  let innerHeight: number;

  if (shortSide <= 2 * sin * cos * longSide || Math.abs(sin - cos) < 1e-8) {
    const x = 0.5 * shortSide;
    if (width >= height) {
      innerWidth = x / sin;
      innerHeight = x / cos;
    } else {
      innerWidth = x / cos;
      innerHeight = x / sin;
    }
  } else {
    const cos2 = cos * cos - sin * sin;
    innerWidth = (width * cos - height * sin) / cos2;
    innerHeight = (height * cos - width * sin) / cos2;
  }

  const rotated = rotatedDimensions(width, height, degrees);
  const cropWidth = Math.max(1, Math.min(rotated.width, Math.floor(innerWidth)));
  const cropHeight = Math.max(1, Math.min(rotated.height, Math.floor(innerHeight)));
  return {
    x: Math.floor((rotated.width - cropWidth) / 2),
    y: Math.floor((rotated.height - cropHeight) / 2),
    width: cropWidth,
    height: cropHeight,
  };
}

function validateRecipe(value: unknown): FlattenRecipe {
  const recipe = value && typeof value === "object" ? value as Partial<FlattenRecipe> : {};
  const rotationDegrees = Number(recipe.rotationDegrees ?? 0);
  if (!RIGHT_ANGLE_ROTATIONS.includes(rotationDegrees as (typeof RIGHT_ANGLE_ROTATIONS)[number])) {
    throw new Error("Rotation must be one of 0, 90, 180, or 270 degrees.");
  }
  const straightenDegrees = Number(recipe.straightenDegrees ?? 0);
  if (!Number.isFinite(straightenDegrees) || Math.abs(straightenDegrees) > MAX_STRAIGHTEN_DEGREES) {
    throw new Error(`Straightening must be between -${MAX_STRAIGHTEN_DEGREES} and ${MAX_STRAIGHTEN_DEGREES} degrees.`);
  }
  let crop: FlattenCrop | undefined;
  if (recipe.crop) {
    crop = {
      x: Math.round(Number(recipe.crop.x)),
      y: Math.round(Number(recipe.crop.y)),
      width: Math.round(Number(recipe.crop.width)),
      height: Math.round(Number(recipe.crop.height)),
    };
    if (Object.values(crop).some((part) => !Number.isFinite(part)) || crop.x < 0 || crop.y < 0 || crop.width < 1 || crop.height < 1) {
      throw new Error("Choose a valid crop area.");
    }
  }
  let cropNormalized: FlattenCrop | undefined;
  if (recipe.cropNormalized) {
    cropNormalized = {
      x: Number(recipe.cropNormalized.x),
      y: Number(recipe.cropNormalized.y),
      width: Number(recipe.cropNormalized.width),
      height: Number(recipe.cropNormalized.height),
    };
    if (
      Object.values(cropNormalized).some((part) => !Number.isFinite(part)) ||
      cropNormalized.x < 0 || cropNormalized.y < 0 ||
      cropNormalized.width <= 0 || cropNormalized.height <= 0 ||
      cropNormalized.x + cropNormalized.width > 1.000001 ||
      cropNormalized.y + cropNormalized.height > 1.000001
    ) {
      throw new Error("Choose a valid normalized crop area.");
    }
  }
  const quality = Math.max(75, Math.min(100, Math.round(Number(recipe.output?.quality ?? 92))));
  return {
    version: 1,
    rotationDegrees: rotationDegrees as (typeof RIGHT_ANGLE_ROTATIONS)[number],
    straightenDegrees,
    crop,
    cropNormalized,
    cropSpace: "auto-oriented-rotated",
    output: { format: "jpeg", quality },
  };
}

function outputFilename(original: string) {
  const extension = extname(original);
  const stem = basename(original, extension);
  return `${stem}-artasia-edit.jpg`;
}

async function persistJob(job: FlattenJob) {
  job.updatedAt = new Date().toISOString();
  await mkdir(FLATTEN_DIR, { recursive: true });
  await writeFile(join(FLATTEN_DIR, `${job.id}.json`), JSON.stringify(job, null, 2), "utf8");
}

async function waitForReplacement(assetId: string, width: number, height: number, expectedTagIds: string[]) {
  let lastDimensions = "unavailable";
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const target = await getAsset(assetId);
    lastDimensions = `${target.width ?? "?"}x${target.height ?? "?"}`;
    const targetTagIds = new Set((target.tags ?? []).map((tag) => tag.id));
    if (
      target.type === "IMAGE" &&
      target.width === width &&
      target.height === height &&
      expectedTagIds.every((tagId) => targetTagIds.has(tagId))
    ) {
      return target;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`Replacement verification failed: expected ${width}x${height} with ${expectedTagIds.length} tags, received ${lastDimensions}.`);
}

export async function flattenAsset(sourceAssetId: string, requestedRecipe: unknown) {
  const recipe = validateRecipe(requestedRecipe);
  const source = await getAsset(sourceAssetId);
  if (source.type !== "IMAGE") throw new Error("Only image assets can be flattened.");

  const job: FlattenJob = {
    id: `${Date.now()}-${sourceAssetId}`,
    sourceAssetId,
    recipe,
    state: "prepared",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await persistJob(job);
  const tempDir = await mkdtemp(join(FLATTEN_DIR, "work-"));
  const sourceExtension = extname(source.originalFileName) || ".heic";
  const inputPath = join(tempDir, `source${sourceExtension}`);
  const outputPath = join(tempDir, "rendered.jpg");

  try {
    const original = await getAssetOriginal(sourceAssetId);
    if (!original.ok || !original.body) throw new Error(`Unable to download source asset (${original.status}).`);
    await pipeline(Readable.fromWeb(original.body as never), createWriteStream(inputPath));

    let metadata;
    try {
      metadata = await sharp(inputPath, { limitInputPixels: 268_402_689, failOnError: false } as any).metadata();
    } catch (err) {
      // Fallback for malformed HEIF/HEIC images: convert to JPEG with ImageMagick first.
      await convertHeifToJpeg(inputPath);
      metadata = await sharp(inputPath, { limitInputPixels: 268_402_689 } as any).metadata();
    }

    const oriented = metadata.autoOrient;
    if (!oriented.width || !oriented.height) throw new Error("The source image dimensions could not be read.");
    const totalRotationDegrees = recipe.rotationDegrees + recipe.straightenDegrees;
    const rotated = rotatedDimensions(oriented.width, oriented.height, totalRotationDegrees);
    const crop = recipe.cropNormalized
      ? {
          x: Math.max(0, Math.round(recipe.cropNormalized.x * rotated.width)),
          y: Math.max(0, Math.round(recipe.cropNormalized.y * rotated.height)),
          width: Math.max(1, Math.round(recipe.cropNormalized.width * rotated.width)),
          height: Math.max(1, Math.round(recipe.cropNormalized.height * rotated.height)),
        }
      : recipe.crop ?? largestInnerRectangle(oriented.width, oriented.height, recipe.straightenDegrees);
    crop.width = Math.min(crop.width, rotated.width - crop.x);
    crop.height = Math.min(crop.height, rotated.height - crop.y);
    if (crop.x + crop.width > rotated.width || crop.y + crop.height > rotated.height) {
      throw new Error("The crop area is outside the straightened image bounds.");
    }

    const result = await sharp(inputPath, { limitInputPixels: 268_402_689, failOnError: false } as any)
      .autoOrient()
      .rotate(totalRotationDegrees, { background: { r: 0, g: 0, b: 0, alpha: 1 } })
      .extract({ left: crop.x, top: crop.y, width: crop.width, height: crop.height })
      .jpeg({ quality: recipe.output?.quality ?? 92, chromaSubsampling: "4:4:4" })
      .withMetadata({ orientation: 1 })
      .toFile(outputPath);
    job.state = "rendered";
    await persistJob(job);

    const uploaded = await uploadAsset({
      filePath: outputPath,
      filename: outputFilename(source.originalFileName),
      mimeType: "image/jpeg",
      createdAt: new Date(source.fileCreatedAt),
      modifiedAt: new Date(),
    });
    job.targetAssetId = uploaded.id;
    job.state = "uploaded";
    await persistJob(job);

    await copyAssetRelationships(sourceAssetId, uploaded.id);

    const sourceTags = source.tags ?? [];
    const tagIds = sourceTags.map((tag) => tag.id);
    if (tagIds.length > 0) {
      await tagAssets([uploaded.id], tagIds);
    }

    const adjustments = await getAssetAdjustments(sourceAssetId);
    if (
      adjustments.brightness !== 100 ||
      adjustments.contrast !== 100 ||
      adjustments.saturation !== 100
    ) {
      await saveAssetAdjustments(uploaded.id, adjustments);
    }
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
    job.state = "relationships_copied";
    await persistJob(job);

    await waitForReplacement(uploaded.id, result.width, result.height, tagIds);
    job.state = "verified";
    await persistJob(job);

    const publishedAlbum = await getPublishedAlbum();
    await Promise.all([
      updateAsset(sourceAssetId, { visibility: "archive" }),
      removeAssetsFromAlbum(publishedAlbum.id, [sourceAssetId]),
    ]);
    job.state = "source_archived";
    await persistJob(job);
    job.state = "complete";
    await persistJob(job);

    return { sourceAssetId, assetId: uploaded.id, width: result.width, height: result.height, archivedSource: true };
  } catch (error) {
    job.state = "failed";
    job.error = (error as Error).message;
    await persistJob(job);
    throw error;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
