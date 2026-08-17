# Atlas Image Redact Feature — Implementation Plan

## Objective

Add a **Redact** tool to the Atlas admin image editor. An authenticated administrator can select a rectangular portion of an image and save a new image in which that region has a strong server-side blur applied.

The editor will have a top-level tool switch so crop geometry and redact geometry are never displayed simultaneously:

- **Crop & Straighten**
- **Redact**

Saving an image may compose rotation, straightening, cropping, and redaction in one replacement-image operation.

## Product and safety semantics

- The first release supports one rectangular redact region in the UI.
- The API will use an array of regions so multiple-region support can be added without changing the contract.
- The server controls blur strength. The initial UI will not expose a strength control.
- The browser preview is illustrative; the server-rendered image is authoritative.
- The existing replacement workflow is retained: create and verify an edited copy, then archive the source.
- Redaction obscures the published replacement but does not securely delete the source. The original remains available to authorized Immich administrators and may remain in Google Drive.
- Gaussian blur is not guaranteed secure redaction. The UI should describe it as obscuring content. A future opaque-fill redaction mode should be considered for high-sensitivity material.

## Current architecture

The relevant implementation is concentrated in:

- `apps/web/src/components/ui/UploadPanel.tsx`
  - Image-editor state and save orchestration.
  - Crop pointer interaction, resizing, movement, normalization, preview, rotation, and straightening.
- `apps/web/src/api/client.ts`
  - The normalized flatten recipe sent to the server.
- `apps/server/src/routes/uploads.ts`
  - Authenticated `POST /api/v1/uploads/assets/:assetId/flatten` route.
- `apps/server/src/services/flattenAsset.service.ts`
  - EXIF auto-orientation, rotation, crop, JPEG rendering, replacement upload, relationship copying, verification, and source archival.

The older Immich `/crop` edit endpoint should not be extended for this feature. Redaction belongs in the Sharp-based flatten/replacement pipeline.

## Coordinate system and processing order

Crop and redact rectangles will use normalized coordinates in the existing `auto-oriented-rotated` space. Coordinates are measured against the full image canvas after EXIF orientation and the requested rotation/straightening, but before cropping.

The server processing order will be:

1. Decode the original.
2. Apply EXIF auto-orientation.
3. Apply right-angle rotation and fine straightening.
4. Apply each redact region.
5. Apply the crop.
6. Encode the output JPEG.
7. Upload and verify the replacement.
8. Archive the source and remove it from the published album.

Applying redaction before crop keeps redact geometry attached to source content when the crop changes. A redact region outside the final crop has no visible effect.

## Proposed API contract

Extend the flatten request with a version 2 recipe while retaining version 1 parsing during migration:

```ts
interface NormalizedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FlattenRecipeV2 {
  version: 2;
  rotationDegrees: 0 | 90 | 180 | 270;
  straightenDegrees: number;
  cropNormalized?: NormalizedRect;
  redactRegionsNormalized?: NormalizedRect[];
  editSpace: "auto-oriented-rotated";
  output?: {
    format: "jpeg";
    quality?: number;
  };
}
```

Server validation must:

- Reject non-finite values.
- Require positive width and height.
- Require every rectangle to remain within normalized bounds, allowing only the existing small floating-point tolerance.
- Limit the number of regions even though the initial UI sends at most one. Use a limit of 10.
- Reject redact requests for non-image assets.
- Keep blur parameters server-owned and bounded.
- Return invalid recipes as HTTP 400 rather than 502.

## Frontend implementation

### 1. Introduce editor tool state

Add:

```ts
type ImageEditTool = "crop" | "redact";
```

Maintain independent state:

- `activeImageEditTool`
- `cropRect`
- `redactRect`
- Existing rotation and straighten state

Opening an image defaults to **Crop & Straighten**. Navigating to another image or closing the editor clears both pending rectangles and restores the default tool.

### 2. Extract reusable rectangle interaction

Refactor the crop-only geometry code into helpers that can operate on either selection:

- Pointer-to-image coordinate conversion
- Rectangle normalization and bounds clamping
- New-selection drag
- Move drag
- Eight-handle resize
- Percentage-based overlay positioning
- Preservation across rotation changes

Avoid duplicating crop handlers for redaction. The active tool determines which rectangle the shared interaction code reads and updates.

### 3. Add the top-level tool switch

Place a segmented control above the image stage:

- `Crop & Straighten`
- `Redact`

Requirements:

- Use buttons with `aria-pressed` or tab semantics.
- Show only the active tool's rectangle and controls.
- Preserve pending geometry when switching tools.
- Disable switching while an image save is in progress.
- Keep the tool switch out of video and audio editors.

In Crop & Straighten mode, retain the current rotation, straighten, crop overlay, instructions, and handles.

In Redact mode:

- Hide the crop outline and crop/straighten controls.
- Show a visually distinct redact selection and the same move/resize handles.
- Allow drawing a new rectangle by dragging over the image.
- Include a `Clear redact area` action.
- Explain that the selected content will be blurred in the saved copy.

### 4. Add an approximate preview

Within the redact rectangle, render a clipped duplicate of the transformed image with a CSS blur filter. The selection border and handles remain sharp and visible above it.

The duplicate must use the same source dimensions, rotation, positioning, brightness, contrast, and saturation preview styles as the base image so the clipped content aligns correctly.

Label this as a preview in help text because browser CSS blur and Sharp blur will not be pixel-identical.

### 5. Integrate change detection and save

Update pending pixel-edit detection so a valid redact rectangle enables `Save Changes`, including when crop and rotation are otherwise unchanged.

When saving:

- Normalize crop and redact rectangles against the same rotated canvas dimensions.
- Send `redactRegionsNormalized` as an empty/omitted array or a one-item array.
- Use the existing flatten endpoint once for the complete recipe.
- Update progress text to `Saving & Creating Redacted Copy...` when redaction is present.
- On success, keep the existing replacement message and mention that the source was archived.
- On failure, keep the editor open with pending geometry intact.

## Server implementation

### 1. Extend recipe parsing

In `flattenAsset.service.ts`:

- Add normalized redact-region types.
- Accept version 1 recipes without redaction and version 2 recipes with redaction.
- Extract rectangle validation into a reusable pure helper used by crop and redact fields.
- Persist the complete validated recipe in the existing flatten job record.

### 2. Refactor transform calculations

Extract pure helpers for:

- Oriented and rotated dimensions
- Normalized-to-pixel rectangle conversion
- Pixel-bound clamping caused only by rounding
- Crop calculation
- Redact patch padding

These helpers should be exported where useful for focused unit tests.

### 3. Render redact patches efficiently

Do not blur the full-resolution image once per region.

Recommended implementation:

1. Render the auto-oriented and rotated image to a temporary intermediate file.
2. Convert each normalized redact rectangle to integer pixel bounds.
3. Expand the extraction bounds by enough padding for the blur kernel, clamped to the image edges.
4. Extract and blur the padded patch with Sharp.
5. Crop the blurred patch back to the exact redact rectangle.
6. Composite the patch at the requested location on the transformed image.
7. Extract the final crop and encode the JPEG.

Using padded patches prevents visible hard-edge artifacts caused by blurring an isolated exact-size selection. A temporary intermediate also bounds memory better than keeping multiple full-resolution buffers alive.

Choose a strong resolution-aware sigma on the server and clamp it to a tested range. The value should scale with image size sufficiently to obscure ordinary text while remaining within Sharp's accepted limits. Record the chosen algorithm as a constant so results remain predictable.

### 4. Preserve replacement behavior

Retain the current sequence:

- Upload rendered JPEG.
- Copy relationships, tags, adjustments, description, location, dates, and visibility metadata.
- Verify output dimensions and tags.
- Archive the source only after verification.
- Remove the source from the published album.
- Remove temporary files in `finally`, including failure cases.

Do not archive the source if decoding, blur rendering, upload, relationship copying, or verification fails.

### 5. Improve route error classification

Update the flatten route's client-error matching or introduce a typed validation error so invalid redact rectangles and unsupported recipes reliably produce HTTP 400. Operational failures should continue to produce HTTP 502.

## Tests

### Server unit tests

Add `apps/server/src/services/flattenAsset.service.test.ts` with coverage for:

- Valid single region.
- Multiple valid regions up to the server limit.
- More than the permitted number of regions.
- Negative coordinates.
- Zero or negative dimensions.
- `NaN`, `Infinity`, strings, and missing values.
- Rectangles extending beyond 1.0.
- Rounding at right and bottom image edges.
- Coordinate mapping with 0°, 90°, 180°, and 270° rotation.
- Coordinate mapping with fine straightening.
- Redact regions partially or entirely outside the selected crop.
- Version 1 backward compatibility.

### Image fixture tests

Create a small deterministic image containing high-contrast detail. Render it through the pixel-processing portion of the service and assert:

- Pixels inside the selected region differ substantially from the source.
- Detail inside the selected region is measurably reduced.
- Pixels well outside the selection remain unchanged apart from expected JPEG tolerance.
- Selection edges do not show an unintended transparent or black seam.
- A region touching each image edge renders successfully.
- Redaction composes correctly with crop and rotation.

Keep the image transformation logic testable without calling Immich by separating rendering from upload/replacement orchestration.

### Route and frontend verification

- Confirm unauthenticated flatten requests remain rejected.
- Confirm malformed redact recipes return HTTP 400.
- Run server tests and both TypeScript builds.
- Manually test mouse and touch/pointer input.
- Test small and large selections, movement, all resize handles, clearing, and redraw.
- Test switching tools repeatedly without losing either rectangle.
- Test previous/next image navigation resets pending state.
- Test HEIC/HEIF images with EXIF orientation.
- Test large images for runtime and memory behavior.
- Confirm the published replacement is blurred and the source is archived only after success.

## Copy and existing workflow cleanup

The current `Reset Edits` action clears Immich's edit stack, but a flattened crop, straighten, or redact operation creates a new asset and archives the source. It cannot undo a previously saved flattened edit.

As part of this work:

- Rename or clarify `Reset Edits` so it refers to pending/current Immich edits only.
- Do not imply that saved redaction deletes or permanently sanitizes the original.
- Warn that Google Drive reimport can restore the unredacted upstream file.

## Rollout sequence

1. Land recipe validation, pure geometry helpers, and tests.
2. Land server rendering behind a server-side feature flag if staged deployment is needed.
3. Add the client contract and editor UI.
4. Exercise the feature against JPEG, PNG, and HEIC/HEIF sources in a non-production environment.
5. Measure flatten duration and peak memory on representative large images.
6. Enable the tool for authenticated Atlas administrators.
7. Monitor flatten-job failures, replacement verification failures, processing duration, and temporary-disk use.

## Acceptance criteria

- An authenticated administrator can switch between Crop & Straighten and Redact for an image.
- Crop and redact rectangles are never visible simultaneously.
- The redact rectangle can be drawn, moved, resized, cleared, and previewed.
- Switching tools preserves pending crop and redact geometry.
- Saving redaction creates a verified replacement image with a strong server-side blur in the selected area.
- Crop, rotation, straightening, and redaction can be saved together with correct coordinate alignment.
- No unselected portion of the image is visibly blurred beyond expected kernel behavior at the selection boundary.
- Invalid geometry returns a clear client error and does not create or archive assets.
- Any rendering, upload, or verification failure leaves the source active.
- Successful replacement preserves relationships and metadata according to the existing flatten workflow.
- UI copy makes clear that the original is archived, not securely deleted.
- Server tests and web/server builds pass.

## Estimated effort

- Server contract, rendering refactor, and validation: 1–1.5 days
- Editor state refactor, tool switch, interaction, and preview: 1.5–2 days
- Automated tests, format/orientation QA, and performance tuning: 1–1.5 days

Estimated total: **3.5–5 engineering days**.

