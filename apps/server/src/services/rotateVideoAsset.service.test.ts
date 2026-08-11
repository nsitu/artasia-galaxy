import assert from "node:assert/strict";
import test from "node:test";
import {
  videoRotationFilter,
  videoRotationOutputFilename,
} from "./rotateVideoAsset.service.js";

test("builds right-angle FFmpeg video filters", () => {
  assert.equal(
    videoRotationFilter(90),
    "transpose=clock,scale=trunc(iw/2)*2:trunc(ih/2)*2",
  );
  assert.equal(
    videoRotationFilter(180),
    "hflip,vflip,scale=trunc(iw/2)*2:trunc(ih/2)*2",
  );
  assert.equal(
    videoRotationFilter(270),
    "transpose=cclock,scale=trunc(iw/2)*2:trunc(ih/2)*2",
  );
});

test("preserves dotted filename metadata in rotated video names", () => {
  assert.equal(
    videoRotationOutputFilename("Week5.documentation.cset.example3", 90),
    "Week5.documentation.cset.example3-artasia-rotate-90.mp4",
  );
  assert.equal(
    videoRotationOutputFilename("Clip.MOV", 270),
    "Clip-artasia-rotate-270.mp4",
  );
});
