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
export const MAX_REDACT_REGIONS = 10;
export const REDACT_BLUR_ALGORITHM = "gaussian-patch-v1" as const;
const REDACT_BLUR_MIN_SIGMA = 8;
const REDACT_BLUR_MAX_SIGMA = 32;
const NORMALIZED_RECT_TOLERANCE = 0.000001;
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

export interface NormalizedRect extends FlattenCrop {}

export interface FlattenRecipeV1 {
  version: 1;
  rotationDegrees: (typeof RIGHT_ANGLE_ROTATIONS)[number];
  straightenDegrees: number;
  crop?: FlattenCrop;
  cropNormalized?: FlattenCrop;
  cropSpace: "auto-oriented-rotated";
  output?: { format: "jpeg"; quality?: number };
}

export interface FlattenRecipeV2 {
  version: 2;
  rotationDegrees: (typeof RIGHT_ANGLE_ROTATIONS)[number];
  straightenDegrees: number;
  crop?: FlattenCrop;
  cropNormalized?: NormalizedRect;
  redactRegionsNormalized: NormalizedRect[];
  editSpace: "auto-oriented-rotated";
  output?: { format: "jpeg"; quality?: number };
}

export type FlattenRecipe = FlattenRecipeV1 | FlattenRecipeV2;

export class FlattenValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FlattenValidationError";
  }
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

export function rotatedDimensions(width: number, height: number, degrees: number) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function requireFiniteNumber(value: unknown, message: string) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FlattenValidationError(message);
  }
  return value;
}

export function normalizeNormalizedRect(value: unknown, label: string): NormalizedRect {
  if (!isRecord(value)) {
    throw new FlattenValidationError(`Choose a valid normalized ${label} area.`);
  }
  const rect = {
    x: requireFiniteNumber(value.x, `The normalized ${label} x coordinate must be finite.`),
    y: requireFiniteNumber(value.y, `The normalized ${label} y coordinate must be finite.`),
    width: requireFiniteNumber(value.width, `The normalized ${label} width must be finite.`),
    height: requireFiniteNumber(value.height, `The normalized ${label} height must be finite.`),
  };
  if (
    rect.x < -NORMALIZED_RECT_TOLERANCE ||
    rect.y < -NORMALIZED_RECT_TOLERANCE ||
    rect.width <= 0 ||
    rect.height <= 0 ||
    rect.x + rect.width > 1 + NORMALIZED_RECT_TOLERANCE ||
    rect.y + rect.height > 1 + NORMALIZED_RECT_TOLERANCE
  ) {
    throw new FlattenValidationError(`Choose a valid normalized ${label} area.`);
  }

  const x = Math.max(0, rect.x);
  const y = Math.max(0, rect.y);
  if (x >= 1 || y >= 1) {
    throw new FlattenValidationError(`Choose a valid normalized ${label} area.`);
  }
  return {
    x,
    y,
    width: Math.min(rect.width, 1 - x),
    height: Math.min(rect.height, 1 - y),
  };
}

export function normalizedRectToPixelRect(
  rect: NormalizedRect,
  dimensions: { width: number; height: number },
): FlattenCrop {
  const width = Math.max(1, Math.floor(dimensions.width));
  const height = Math.max(1, Math.floor(dimensions.height));
  const x = Math.max(0, Math.min(width - 1, Math.round(rect.x * width)));
  const y = Math.max(0, Math.min(height - 1, Math.round(rect.y * height)));
  const right = Math.max(x + 1, Math.min(width, Math.round((rect.x + rect.width) * width)));
  const bottom = Math.max(y + 1, Math.min(height, Math.round((rect.y + rect.height) * height)));
  return { x, y, width: right - x, height: bottom - y };
}

export function redactBlurSigma(dimensions: { width: number; height: number }) {
  return Math.max(
    REDACT_BLUR_MIN_SIGMA,
    Math.min(REDACT_BLUR_MAX_SIGMA, Math.max(dimensions.width, dimensions.height) / 80),
  );
}

export async function applyRedactRegions(
  inputPath: string,
  outputPath: string,
  regions: NormalizedRect[],
  dimensions: { width: number; height: number },
) {
  const blurSigma = redactBlurSigma(dimensions);
  const composites = await Promise.all(regions.map(async (normalizedRegion) => {
    const region = normalizedRectToPixelRect(normalizedRegion, dimensions);
    const padding = Math.max(8, Math.ceil(blurSigma * 3));
    const paddedLeft = Math.max(0, region.x - padding);
    const paddedTop = Math.max(0, region.y - padding);
    const paddedRight = Math.min(dimensions.width, region.x + region.width + padding);
    const paddedBottom = Math.min(dimensions.height, region.y + region.height + padding);
    const patch = await sharp(inputPath, { limitInputPixels: 268_402_689 } as any)
      .extract({
        left: paddedLeft,
        top: paddedTop,
        width: paddedRight - paddedLeft,
        height: paddedBottom - paddedTop,
      })
      .blur(blurSigma)
      .extract({
        left: region.x - paddedLeft,
        top: region.y - paddedTop,
        width: region.width,
        height: region.height,
      })
      .png()
      .toBuffer();
    return { input: patch, left: region.x, top: region.y };
  }));

  let image = sharp(inputPath, { limitInputPixels: 268_402_689 } as any);
  if (composites.length > 0) image = image.composite(composites);
  return image.png().toFile(outputPath);
}

function validatePixelCrop(value: unknown): FlattenCrop {
  if (!isRecord(value)) throw new FlattenValidationError("Choose a valid crop area.");
  const crop = {
    x: requireFiniteNumber(value.x, "Choose a valid crop area."),
    y: requireFiniteNumber(value.y, "Choose a valid crop area."),
    width: requireFiniteNumber(value.width, "Choose a valid crop area."),
    height: requireFiniteNumber(value.height, "Choose a valid crop area."),
  };
  const rounded = {
    x: Math.round(crop.x),
    y: Math.round(crop.y),
    width: Math.round(crop.width),
    height: Math.round(crop.height),
  };
  if (rounded.x < 0 || rounded.y < 0 || rounded.width < 1 || rounded.height < 1) {
    throw new FlattenValidationError("Choose a valid crop area.");
  }
  return rounded;
}

export function validateFlattenRecipe(value: unknown): FlattenRecipe {
  const recipe = isRecord(value) ? value : {};
  const version = recipe.version === 2 ? 2 : recipe.version === 1 || recipe.version == null ? 1 : null;
  if (version == null) throw new FlattenValidationError("Unsupported flatten recipe version.");

  const rotationDegrees = requireFiniteNumber(recipe.rotationDegrees ?? 0, "Rotation must be one of 0, 90, 180, or 270 degrees.");
  if (!RIGHT_ANGLE_ROTATIONS.includes(rotationDegrees as (typeof RIGHT_ANGLE_ROTATIONS)[number])) {
    throw new FlattenValidationError("Rotation must be one of 0, 90, 180, or 270 degrees.");
  }
  const straightenDegrees = requireFiniteNumber(recipe.straightenDegrees ?? 0, "Straightening must be finite.");
  if (!Number.isFinite(straightenDegrees) || Math.abs(straightenDegrees) > MAX_STRAIGHTEN_DEGREES) {
    throw new FlattenValidationError(`Straightening must be between -${MAX_STRAIGHTEN_DEGREES} and ${MAX_STRAIGHTEN_DEGREES} degrees.`);
  }
  let crop: FlattenCrop | undefined;
  if (recipe.crop) {
    crop = validatePixelCrop(recipe.crop);
  }
  let cropNormalized: FlattenCrop | undefined;
  if (recipe.cropNormalized) {
    cropNormalized = normalizeNormalizedRect(recipe.cropNormalized, "crop");
  }
  if (recipe.output != null && !isRecord(recipe.output)) {
    throw new FlattenValidationError("Output settings are invalid.");
  }
  if (recipe.output?.format != null && recipe.output.format !== "jpeg") {
    throw new FlattenValidationError("Only JPEG flatten output is supported.");
  }
  const requestedQuality = recipe.output?.quality ?? 92;
  const quality = requireFiniteNumber(requestedQuality, "Output quality must be finite.");
  const output = { format: "jpeg" as const, quality: Math.max(75, Math.min(100, Math.round(quality))) };
  if (version === 1) {
    return {
      version: 1,
      rotationDegrees: rotationDegrees as (typeof RIGHT_ANGLE_ROTATIONS)[number],
      straightenDegrees,
      crop,
      cropNormalized,
      cropSpace: "auto-oriented-rotated",
      output,
    };
  }

  if (recipe.editSpace !== "auto-oriented-rotated") {
    throw new FlattenValidationError("Flatten edit space must be auto-oriented-rotated.");
  }
  if (recipe.redactRegionsNormalized != null && !Array.isArray(recipe.redactRegionsNormalized)) {
    throw new FlattenValidationError("Redact regions must be an array.");
  }
  const redactRegionsNormalized = (recipe.redactRegionsNormalized ?? []).map((region, index) =>
    normalizeNormalizedRect(region, `redact region ${index + 1}`),
  );
  if (redactRegionsNormalized.length > MAX_REDACT_REGIONS) {
    throw new FlattenValidationError(`A maximum of ${MAX_REDACT_REGIONS} redact regions is supported.`);
  }
  return {
    version: 2,
    rotationDegrees: rotationDegrees as (typeof RIGHT_ANGLE_ROTATIONS)[number],
    straightenDegrees,
    crop,
    cropNormalized,
    redactRegionsNormalized,
    editSpace: "auto-oriented-rotated",
    output,
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
  const recipe = validateFlattenRecipe(requestedRecipe);
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
  const transformedPath = join(tempDir, "transformed.png");
  const redactedPath = join(tempDir, "redacted.png");
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
      ? normalizedRectToPixelRect(recipe.cropNormalized, rotated)
      : recipe.crop ?? largestInnerRectangle(oriented.width, oriented.height, totalRotationDegrees);
    crop.width = Math.min(crop.width, rotated.width - crop.x);
    crop.height = Math.min(crop.height, rotated.height - crop.y);
    if (crop.x + crop.width > rotated.width || crop.y + crop.height > rotated.height) {
      throw new Error("The crop area is outside the straightened image bounds.");
    }

    await sharp(inputPath, { limitInputPixels: 268_402_689, failOnError: false } as any)
      .autoOrient()
      .rotate(totalRotationDegrees, { background: { r: 0, g: 0, b: 0, alpha: 1 } })
      .png()
      .toFile(transformedPath);

    const redactRegions = recipe.version === 2 ? recipe.redactRegionsNormalized : [];
    await applyRedactRegions(transformedPath, redactedPath, redactRegions, rotated);
    const result = await sharp(redactedPath, { limitInputPixels: 268_402_689 } as any)
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
