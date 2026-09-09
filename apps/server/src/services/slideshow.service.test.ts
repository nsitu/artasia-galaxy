import assert from "node:assert/strict";
import test from "node:test";
import { hasMinimumImageResolution } from "./slideshow.service.js";

const minimum = { longEdge: 1920, shortEdge: 1080 };

function asset(
  width?: number,
  height?: number,
  exifWidth?: number,
  exifHeight?: number,
) {
  return {
    width,
    height,
    exifInfo:
      exifWidth == null && exifHeight == null
        ? undefined
        : { exifImageWidth: exifWidth, exifImageHeight: exifHeight },
  } as Parameters<typeof hasMinimumImageResolution>[0];
}

test("accepts landscape and portrait images at the HD threshold", () => {
  assert.equal(hasMinimumImageResolution(asset(1920, 1080), minimum), true);
  assert.equal(hasMinimumImageResolution(asset(1080, 1920), minimum), true);
});

test("rejects images with an undersized edge or unknown dimensions", () => {
  assert.equal(hasMinimumImageResolution(asset(1919, 1080), minimum), false);
  assert.equal(hasMinimumImageResolution(asset(1920, 1079), minimum), false);
  assert.equal(hasMinimumImageResolution(asset(), minimum), false);
});

test("uses EXIF dimensions when available", () => {
  assert.equal(
    hasMinimumImageResolution(asset(1000, 700, 3840, 2160), minimum),
    true,
  );
  assert.equal(
    hasMinimumImageResolution(asset(4000, 3000, 1600, 1200), minimum),
    false,
  );
});
