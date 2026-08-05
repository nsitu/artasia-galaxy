// Tile fetching for the vendored three-geo port.
//
// Replaces three-geo's `src/models/fetch.js`, which used the `xhr` library for
// HTTP and `get-pixels` (DOM Image + canvas + getImageData) for raster decode.
// All tile pixels arrive via the same browser fetch path and are decoded with
// `createImageBitmap`, which can run the decode off the main thread and reuse
// the browser's image cache. No `get-pixels`, no `xhr`, no `regenerator-runtime`.
//
// Two decoders are exposed:
//   • decodeToPixels(url)   — for mapbox-terrain-rgb tiles, where we need raw
//                              RGBA pixel values to compute elevation.
//   • decodeToTexture(url)  — for mapbox-satellite tiles, where we just need a
//                              THREE.Texture; this skips the canvas+getImageData
//                              round-trip get-pixels used to do.

import * as THREE from "three";
import type { LatLng, Wsen, Zoompos } from "./mercator";

export type PixelData = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

const MAPBOX_API_TYPES = new Set([
  "mapbox-terrain-rgb",
  "mapbox-satellite",
  "mapbox-terrain-vector",
]);

// Keep the decoded source bytes in a session cache. Terrain loads can be
// replayed in development (React StrictMode) or canceled when the focused
// placement changes; both cases should reuse a tile that is already in flight
// or has completed instead of issuing another Mapbox request.
const tileBlobCache = new Map<string, Promise<Blob | null>>();

function isAbortError(err: unknown) {
  return err instanceof DOMException && err.name === "AbortError";
}

function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T | null> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.resolve(null);

  return new Promise<T | null>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      resolve(null);
    };
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

async function fetchTileBlobUncached(url: string): Promise<Blob | null> {
  try {
    const response = await fetch(url, {
      mode: "cors",
      credentials: "omit",
    });
    if (!response.ok) {
      console.warn(`fetchTileBlob: HTTP ${response.status} for ${url.slice(0, 120)}`);
      return null;
    }
    const blob = await response.blob();
    return blob.size > 0 ? blob : null;
  } catch (err) {
    if (!isAbortError(err)) {
      console.warn(`fetchTileBlob: error for ${url.slice(0, 120)}`, err);
    }
    return null;
  }
}

function fetchTileBlob(url: string, signal?: AbortSignal): Promise<Blob | null> {
  if (signal?.aborted) return Promise.resolve(null);

  let pending = tileBlobCache.get(url);
  if (!pending) {
    pending = fetchTileBlobUncached(url);
    tileBlobCache.set(url, pending);
    void pending.then((blob) => {
      if (blob === null && tileBlobCache.get(url) === pending) {
        tileBlobCache.delete(url);
      }
    });
  }
  return withAbort(pending, signal);
}

export function buildMapboxUri(
  token: string,
  api: string,
  zoompos: Zoompos,
): string {
  if (!MAPBOX_API_TYPES.has(api)) {
    throw new Error(`buildMapboxUri: unsupported api: ${api}`);
  }
  const [z, x, y] = zoompos;
  switch (api) {
    case "mapbox-terrain-rgb":
      return `https://api.mapbox.com/v4/mapbox.terrain-rgb/${z}/${x}/${y}@2x.pngraw?access_token=${token}`;
    case "mapbox-satellite":
      return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/${z}/${x}/${y}?access_token=${token}`;
    default:
      throw new Error(`buildMapboxUri: unsupported api: ${api}`);
  }
}

/**
 * Fetch raster pixel data for a tile URL.
 *
 * Uses `fetch` + `createImageBitmap` + (an OffscreenCanvas if available, else a
 * regular <canvas>) so the heavy decode happens on a non-main GPU/image thread
 * where possible. Returns the RGBA bytes — only used for terrain-rgb elevation
 * decode; satellite textures use `decodeToTexture` instead.
 */
export async function decodeToPixels(url: string, signal?: AbortSignal): Promise<PixelData | null> {
  try {
    const blob = await fetchTileBlob(url, signal);
    if (!blob || signal?.aborted) return null;
    // Terrain-RGB tiles encode elevation in exact channel values. Safari/iOS can
    // color-convert decoded image pixels by default, which corrupts the DEM and
    // turns the mesh into extreme spikes after elevation decoding.
    const bitmap = await createImageBitmap(blob, {
      colorSpaceConversion: "none",
      premultiplyAlpha: "none",
    });
    if (signal?.aborted) {
      bitmap.close?.();
      return null;
    }
    const width = bitmap.width;
    const height = bitmap.height;

    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    let canvas: HTMLCanvasElement | OffscreenCanvas;
    if (typeof OffscreenCanvas !== "undefined") {
      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D;
    } else {
      canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      ctx = canvas.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
    }
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const imageData = ctx.getImageData(0, 0, width, height);
    return { data: imageData.data, width, height };
  } catch (err) {
    if (isAbortError(err)) return null;
    console.warn(`decodeToPixels: err for ${url.slice(0, 120)}`, err);
    return null;
  }
}

/**
 * Fetch a satellite tile as a THREE.Texture. This replaces three-geo's
 * `resolveTex` path, which decoded pixels through get-pixels + manual y-flip
 * + DataTexture. We instead create a `THREE.Texture` directly from the
 * `ImageBitmap` and let WebGL own the upload + flip.
 *
 * `createImageBitmap` decodes off the main thread; the only main-thread work
 * is the texture allocation. The cost per tile drops from ~5-10ms (drawImage +
 * getImageData + flip + DataTexture) to ~0.1ms.
 */
export async function decodeToTexture(url: string, signal?: AbortSignal): Promise<THREE.Texture | null> {
  try {
    const blob = await fetchTileBlob(url, signal);
    if (!blob || signal?.aborted) return null;
    // ImageBitmap textures do not reliably honor THREE.Texture.flipY during
    // WebGL upload, so apply the usual three.js Y flip at decode time.
    const bitmap = await createImageBitmap(blob, { imageOrientation: "flipY" });
    if (signal?.aborted) {
      bitmap.close?.();
      return null;
    }
    const texture = new THREE.Texture(bitmap as unknown as HTMLImageElement);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false;
    return texture;
  } catch (err) {
    if (isAbortError(err)) return null;
    console.warn(`decodeToTexture: err for ${url.slice(0, 120)}`, err);
    return null;
  }
}

/** Convenience wrapper for terrain-rgb tiles. */
export function fetchTerrainRgbPixels(
  token: string,
  zoompos: Zoompos,
  signal?: AbortSignal,
): Promise<PixelData | null> {
  return decodeToPixels(buildMapboxUri(token, "mapbox-terrain-rgb", zoompos), signal);
}

/** Convenience wrapper for satellite tiles. */
export function fetchSatelliteTexture(
  token: string,
  zoompos: Zoompos,
  signal?: AbortSignal,
): Promise<THREE.Texture | null> {
  return decodeToTexture(buildMapboxUri(token, "mapbox-satellite", zoompos), signal);
}

/**
 * Compute the DEM tiles that parent the given satellite zoompos list.
 *
 * three-geo used `zoom - 2`, where one DEM tile covers 4x4 satellite tiles.
 * The vendored path keeps that as the default, but lets regional terrain use
 * a larger offset to fetch coarser elevation tiles before mesh construction.
 */
export function getZoomposEle(zpArray: Zoompos[], demZoomOffset = 2): Zoompos[] {
  const scaleFactor = 2 ** demZoomOffset;
  const seen = new Map<string, Zoompos>();
  for (const zp of zpArray) {
    const grandparent: Zoompos = [
      zp[0] - demZoomOffset,
      Math.floor(zp[1] / scaleFactor),
      Math.floor(zp[2] / scaleFactor),
    ];
    const key = grandparent.join("/");
    if (!seen.has(key)) seen.set(key, grandparent);
  }
  return [...seen.values()];
}

/**
 * Given a DEM tile's zoompos and the satellite-level zoompos list, return the
 * satellite zoompos that descend from this DEM tile and are present in the
 * covered list.
 */
export function getSixteenthsForEle(
  zoomposEle: Zoompos,
  zpCovered: Zoompos[],
  demZoomOffset = 2,
): Zoompos[] {
  const coveredSet = new Set(zpCovered.map((zp) => zp.join("/")));
  const out: Zoompos[] = [];
  const scaleFactor = 2 ** demZoomOffset;
  for (let col = 0; col < scaleFactor; col++) {
    for (let row = 0; row < scaleFactor; row++) {
      const z: Zoompos = [
        zoomposEle[0] + demZoomOffset,
        zoomposEle[1] * scaleFactor + col,
        zoomposEle[2] * scaleFactor + row,
      ];
      if (coveredSet.has(z.join("/"))) out.push(z);
    }
  }
  return out;
}

export type { LatLng, Wsen };
