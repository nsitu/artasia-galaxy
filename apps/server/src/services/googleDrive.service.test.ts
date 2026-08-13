import assert from "node:assert/strict";
import test from "node:test";
import {
  comparableMediaFilename,
  driveSourceSearchFilename,
  ensureDriveFileExtension,
  GoogleDriveClient,
  inferActivityFromDriveFolders,
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

test("recognizes all registered HEIC and HEIF MIME variants", () => {
  assert.equal(GoogleDriveClient.isImage("image/heic-sequence", "Burst.HEIC"), true);
  assert.equal(GoogleDriveClient.isImage("image/heif-sequence", "Burst.HEIF"), true);
  assert.equal(
    ensureDriveFileExtension("Burst", "image/heic-sequence"),
    "Burst.heic",
  );
});

test("recognizes generic Drive MIME metadata only when the filename is HEIC or HEIF", () => {
  assert.equal(GoogleDriveClient.isSupported("application/octet-stream", "Photo.HEIC"), true);
  assert.equal(GoogleDriveClient.isSupported("binary/octet-stream", "Photo.heif"), true);
  assert.equal(GoogleDriveClient.isSupported("application/octet-stream", "Archive.bin"), false);
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

test("removes Atlas derivative suffixes from the reported Drive search filename", () => {
  assert.equal(
    driveSourceSearchFilename("IMG_9174-artasia-edit.jpg"),
    "IMG_9174.jpg",
  );
  assert.equal(
    driveSourceSearchFilename("Clip -artasia-trim-artasia-edit.mp4"),
    "Clip.mp4",
  );
});

test("infers an activity from a week subfolder using Import tab semantics", () => {
  const activities = [
    { id: 1, label: "Collage", week: 1 },
    { id: 2, label: "Printmaking", week: 2 },
  ];

  assert.deepEqual(
    inferActivityFromDriveFolders(["Participant uploads", "Week 02 - Prints"], activities),
    activities[1],
  );
});

test("does not infer an activity when the best folder match is ambiguous", () => {
  const activities = [
    { id: 1, label: "First activity", week: 3 },
    { id: 2, label: "Second activity", week: 3 },
  ];

  assert.equal(inferActivityFromDriveFolders(["Week 3"], activities), null);
});
