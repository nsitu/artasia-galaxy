import assert from "node:assert/strict";
import test from "node:test";
import {
  comparableMediaFilename,
  ensureDriveFileExtension,
} from "./googleDrive.service.js";

test("adds a MIME-derived extension to a Drive filename without one", () => {
  assert.equal(ensureDriveFileExtension("Documentation", "image/jpeg"), "Documentation.jpg");
});

test("does not mistake user metadata after a dot for a file extension", () => {
  assert.equal(
    ensureDriveFileExtension("Week5.documentation.cset.example3", "image/jpeg"),
    "Week5.documentation.cset.example3.jpg",
  );
  assert.equal(
    ensureDriveFileExtension("Week5.documentation.cset.example3", "audio/mpeg"),
    "Week5.documentation.cset.example3.mp3",
  );
});

test("preserves an extension compatible with the Drive MIME type", () => {
  assert.equal(ensureDriveFileExtension("Photo.JPEG", "image/jpeg"), "Photo.JPEG");
  assert.equal(ensureDriveFileExtension("Clip.m4v", "video/mp4"), "Clip.m4v");
});

test("uses the MIME type when a recognizable extension conflicts with it", () => {
  assert.equal(ensureDriveFileExtension("Photo.png", "image/jpeg"), "Photo.png.jpg");
});

test("leaves the filename alone when the MIME type is unknown", () => {
  assert.equal(ensureDriveFileExtension("Archive.custom", "application/octet-stream"), "Archive.custom");
});

test("maps Atlas edit and trim derivatives back to their Drive source stem", () => {
  assert.equal(
    comparableMediaFilename("Photo-artasia-edit-artasia-edit.jpg"),
    "photo",
  );
  assert.equal(
    comparableMediaFilename("Recording -artasia-trim.mp4"),
    "recording",
  );
});
