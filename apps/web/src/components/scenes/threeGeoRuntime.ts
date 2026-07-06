// Runtime adapter for the vendored three-geo port.
//
// Previously this file lazy-loaded `three-geo/dist/three-geo.min.js` via a
// <script> tag and exposed a typed wrapper. The minified bundle had a
// hot-loop bottleneck (Array.prototype.splice 384 times per tile inside a
// 49152-element array, in three-geo's `RgbModel._stitchWithNei3`) that
// blocked the main thread for ~9.6 seconds per 144-tile regional load.
//
// We now vendor a TypeScript port under `src/lib/three-geo/` that:
//   - Replaces splice with a single pre-allocated Float32Array and indexed
//     writes — the same operation in O(N) instead of O(N²).
//   - Decodes raster tiles via native `fetch` + `createImageBitmap` (with
//     an `OffscreenCanvas` y-flip path), dropping the `xhr` + `get-pixels`
//     dependency chain. Image decode now runs on the image/GPU thread.
//   - Yields to the event loop every 8 tiles during the synchronous build
//     loop so satellite Image.onload callbacks fire while geometry work
//     continues, instead of stalling for the duration of the longtask.
//   - Drops `regenerator-runtime`, `@turf/*`, `@mapbox/tile-cover`, and the
//     `window.THREE.PlaneBufferGeometry` shim (the vendored code uses
//     `THREE.PlaneGeometry` directly).
//
// The public surface (`loadThreeGeo`, `ThreeGeoProjection`) is preserved so
// `TerrainGallery.tsx` doesn't need to change its call shape.

import { ThreeGeo } from "../../lib/three-geo";

export type { ThreeGeoProjection, ThreeGeoTerrainCallbacks, ThreeGeoTerrainResult } from "../../lib/three-geo";

export type ThreeGeoConstructor = typeof ThreeGeo;

let cached: ThreeGeoConstructor | null = null;

/**
 * Returns the vendored `ThreeGeo` class constructor. No script loading is
 * required — the port is plain TypeScript that bundles with the rest of the
 * app. The cached return value matches the previous promise-based signature
 * for back-compat with the existing `loadThreeGeo().then(...)` call shape.
 */
export function loadThreeGeo(): Promise<ThreeGeoConstructor> {
  if (cached) return Promise.resolve(cached);
  cached = ThreeGeo;
  return Promise.resolve(cached);
}