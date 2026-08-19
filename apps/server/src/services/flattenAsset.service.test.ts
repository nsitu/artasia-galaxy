import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import sharp from "sharp";
import {
  applyRedactRegions,
  MAX_REDACT_REGIONS,
  normalizeNormalizedRect,
  normalizedRectToPixelRect,
  rotatedDimensions,
  validateFlattenRecipe,
  FlattenValidationError,
} from "./flattenAsset.service.js";

const baseRecipe = {
  version: 2 as const,
  rotationDegrees: 0 as const,
  straightenDegrees: 0,
  editSpace: "auto-oriented-rotated" as const,
  output: { format: "jpeg" as const, quality: 92 },
};

test("accepts one redact region and preserves version 1 recipes", () => {
  const recipe = validateFlattenRecipe({
    ...baseRecipe,
    redactRegionsNormalized: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }],
  });
  assert.equal(recipe.version, 2);
  assert.deepEqual(recipe.redactRegionsNormalized, [
    { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
  ]);

  const legacy = validateFlattenRecipe({
    version: 1,
    rotationDegrees: 90,
    straightenDegrees: 4,
    cropNormalized: { x: 0, y: 0, width: 1, height: 1 },
    cropSpace: "auto-oriented-rotated",
  });
  assert.equal(legacy.version, 1);
  assert.equal("redactRegionsNormalized" in legacy, false);
});

test("limits redact regions and rejects malformed normalized rectangles", () => {
  const regions = Array.from({ length: MAX_REDACT_REGIONS }, (_, index) => ({
    x: index / 20,
    y: 0,
    width: 0.02,
    height: 0.2,
  }));
  assert.equal(validateFlattenRecipe({ ...baseRecipe, redactRegionsNormalized: regions }).version, 2);

  assert.throws(
    () => validateFlattenRecipe({ ...baseRecipe, redactRegionsNormalized: [...regions, regions[0]] }),
    FlattenValidationError,
  );
  for (const region of [
    { x: -0.01, y: 0, width: 0.1, height: 0.1 },
    { x: 0, y: 0, width: 0, height: 0.1 },
    { x: 0, y: 0, width: 1.1, height: 0.1 },
    { x: Number.NaN, y: 0, width: 0.1, height: 0.1 },
    { x: 0, y: 0, width: Number.POSITIVE_INFINITY, height: 0.1 },
    { x: "0", y: 0, width: 0.1, height: 0.1 },
  ]) {
    assert.throws(
      () => validateFlattenRecipe({ ...baseRecipe, redactRegionsNormalized: [region] }),
      FlattenValidationError,
    );
  }
});

test("maps normalized rectangles at rotation dimensions and image edges", () => {
  assert.deepEqual(rotatedDimensions(100, 50, 0), { width: 100, height: 50 });
  assert.deepEqual(rotatedDimensions(100, 50, 90), { width: 50, height: 100 });
  assert.deepEqual(rotatedDimensions(100, 50, 95), rotatedDimensions(100, 50, 90 + 5));
  assert.deepEqual(
    normalizedRectToPixelRect(
      normalizeNormalizedRect({ x: 0.8, y: 0.75, width: 0.2, height: 0.25 }, "redact"),
      { width: 100, height: 80 },
    ),
    { x: 80, y: 60, width: 20, height: 20 },
  );
});

test("blurs only the selected pixels without edge seams", async () => {
  const directory = await mkdtemp(join(tmpdir(), "artasia-flatten-test-"));
  const inputPath = join(directory, "input.png");
  const outputPath = join(directory, "output.png");
  const width = 64;
  const height = 48;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 3;
      const value = (x + y) % 2 === 0 ? 255 : 0;
      raw[offset] = value;
      raw[offset + 1] = value;
      raw[offset + 2] = value;
    }
  }

  try {
    await sharp(raw, { raw: { width, height, channels: 3 } }).png().toFile(inputPath);
    await applyRedactRegions(
      inputPath,
      outputPath,
      [{ x: 0.25, y: 0.25, width: 0.5, height: 0.5 }],
      { width, height },
    );
    const source = await sharp(inputPath).raw().toBuffer({ resolveWithObject: true });
    const output = await sharp(outputPath).raw().toBuffer({ resolveWithObject: true });
    let changedInside = 0;
    let unchangedOutside = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sourceOffset = (y * width + x) * source.info.channels;
        const outputOffset = (y * width + x) * output.info.channels;
        const inside = x >= 16 && x < 48 && y >= 12 && y < 36;
        const different = source.data[sourceOffset] !== output.data[outputOffset] || source.data[sourceOffset + 1] !== output.data[outputOffset + 1] || source.data[sourceOffset + 2] !== output.data[outputOffset + 2];
        if (inside && different) changedInside += 1;
        if (!inside && !different) unchangedOutside += 1;
        if (inside) {
          assert.ok(output.data[outputOffset + 3] === undefined || output.data[outputOffset + 3] > 0, "blurred pixels should not become transparent");
        }
      }
    }
    assert.ok(changedInside > 0.9 * 32 * 24, "most selected pixels should be changed");
    assert.equal(unchangedOutside, (width * height) - (32 * 24));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
