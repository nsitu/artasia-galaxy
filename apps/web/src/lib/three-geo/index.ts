// ThreeGeo — vendored main entry point.
//
// Replaces three-geo's `src/index.js` with a TypeScript implementation that:
//   - Drops the `regenerator-runtime` polyfill and Babel-rewritten async.
//   - Replaces `@mapbox/tile-cover` with a direct bbox→tiles enumeration
//     (`bboxToZoomposCovered`).
//   - Drops `@turf/*` for bbox computation (`originRadiusToBbox`).
//   - Drops the `VectorModel` path (we only use the RgbModel flow). If the
//     consumer needs `onVectorDem` we throw immediately rather than silently.
//   - Exposes only the two APIs we use: `getProjection` and `getTerrain`.
//
// Behavior preserved relative to three-geo 1.4.5:
//   - `getTerrain()` returns a Promise<{ rgbDem }> that resolves after the
//     last `onSatelliteMat` callback fires (via the internal watcher).
//   - The `projection` returned by `getProjection` is a plain object with
//     `proj`, `projInv`, `bbox`, `unitsPerMeter` — same shape as three-geo's.
//   - `projInv(x, y)` returns [lat, lng]; `proj([lat, lng])` returns [x, y]
//     (z is undefined because we don't hook Elevation.resolveElevation —
//     it was a no-op in three-geo 1.4.5 anyway).
//
// Behavior intentionally NOT preserved:
//   - `getTerrainRgb`, `getTerrainVector`, `Utils.bboxToWireframe`,
//     `Utils.createLine`, `_resolveTri`, `setApi*` — none of these are called
//     by TerrainGallery.tsx, so we drop them. They can come back if needed.

import * as THREE from "three";

import {
  bboxToZoomposCovered,
  originRadiusToBbox,
  projectCoord,
  projectInverse,
  unitsPerMeterFromRadius,
  type LatLng,
  type LngLat,
  type Wsen,
  type Zoompos,
} from "./mercator";
import { RgbModel } from "./rgb-model";

export interface ThreeGeoProjection {
  proj: (latlng: LatLng, meshes?: THREE.Object3D[]) => [number, number] | [number, number, number];
  projInv: (x: number, y: number) => LatLng; // [lat, lng]
  bbox: Wsen;
  unitsPerMeter: number;
}

export interface ThreeGeoTerrainCallbacks {
  onRgbDem?: (meshes: THREE.Mesh[]) => void;
  onSatelliteMat?: (mesh: THREE.Mesh) => void;
  onVectorDem?: (meshes: THREE.Object3D[]) => void;
}

export interface ThreeGeoTerrainResult {
  rgbDem: THREE.Mesh[];
}

export interface ThreeGeoTerrainOptions {
  signal?: AbortSignal;
  demZoomOffset?: number;
}

export interface ThreeGeoOptions {
  unitsSide?: number;
  tokenMapbox?: string;
  isNode?: boolean;
  isDebug?: boolean;
  apiRgb?: string;
  apiSatellite?: string;
}

export class ThreeGeo {
  readonly version = "1.4.5-vendored";
  readonly constUnitsSide: number;
  readonly tokenMapbox: string;
  readonly isNode: boolean;
  readonly isDebug: boolean;
  readonly apiRgb: string;
  readonly apiSatellite: string;

  constructor(opts: ThreeGeoOptions = {}) {
    const actual: Required<ThreeGeoOptions> = {
      unitsSide: opts.unitsSide ?? 1.0,
      tokenMapbox: opts.tokenMapbox ?? "",
      isNode: (opts as { useNodePixels?: boolean }).useNodePixels ?? opts.isNode ?? false,
      isDebug: opts.isDebug ?? false,
      apiRgb: opts.apiRgb ?? "mapbox-terrain-rgb",
      apiSatellite: opts.apiSatellite ?? "mapbox-satellite",
    };

    this.constUnitsSide = actual.unitsSide;
    this.tokenMapbox = actual.tokenMapbox;
    this.isNode = actual.isNode;
    this.isDebug = actual.isDebug;
    this.apiRgb = actual.apiRgb;
    this.apiSatellite = actual.apiSatellite;

    console.info(`ThreeGeo ${this.version} with THREE r${THREE.REVISION}`);
  }

  /**
   * Build the local-projection helpers for an ROI (origin + radius).
   *
   * Replicates three-geo's `getProjection` exactly:
   *   - bbox derived from origin/radius via @turf/destination → our pure
   *     haversine `originRadiusToBbox`.
   *   - unitsPerMeter = unitsSide / (radius * sqrt(2) * 1000).
   *   - `proj([lat, lng])` → terrain (x, y). The optional `meshes` argument
   *     in three-geo would resolve z via the WIP `Elevation.resolveElevation`
   *     which was a no-op in 1.4.5, so we accept and ignore it.
   *   - `projInv(x, y)` → [lat, lng].
   */
  getProjection(
    origin: LatLng,
    radius: number,
    unitsSide: number = this.constUnitsSide,
  ): ThreeGeoProjection {
    const wsen = originRadiusToBbox(origin, radius);
    const [w, s, e, n] = wsen;
    const nw: LngLat = [w, n];
    const se: LngLat = [e, s];
    const upm = unitsPerMeterFromRadius(unitsSide, radius);

    return {
      proj: (latlng: LatLng, _meshes?: THREE.Object3D[]): [number, number] | [number, number, number] => {
        const [lat, lng] = latlng;
        const [x, y] = projectCoord(unitsSide, [lng, lat], nw, se);
        return [x, y];
      },
      projInv: (x: number, y: number): LatLng => projectInverse(x, y, origin, upm),
      bbox: wsen,
      unitsPerMeter: upm,
    };
  }

  /**
   * Kick terrain build + satellite fetches. Returns a Promise<{ rgbDem }>
   * that resolves after the last `onSatelliteMat` callback fires.
   *
   * The flow is identical to three-geo's:
   *   1. Compute the ROI bbox and the satellite-level zoompos covered list.
   *   2. Spin up an `RgbModel` with the (onRgbDem, onSatelliteMat) callbacks
   *      plus an internal watcher Promise resolver.
   *   3. The watcher resolves when the RgbModel finishes its build phase
   *      AND every satellite texture resolves.
   */
  getTerrain(
    origin: LatLng,
    radius: number,
    zoom: number,
    cbs: ThreeGeoTerrainCallbacks = {},
    options: ThreeGeoTerrainOptions = {},
  ): Promise<ThreeGeoTerrainResult> {
    return new Promise<ThreeGeoTerrainResult>((resolve, reject) => {
      try {
        void this.runGetTerrain(origin, radius, zoom, cbs, options, resolve).catch(reject);
      } catch (err) {
        reject(err as Error);
      }
    });
  }

  private async runGetTerrain(
    origin: LatLng,
    radius: number,
    zoom: number,
    cbs: ThreeGeoTerrainCallbacks,
    options: ThreeGeoTerrainOptions,
    resolve: (result: ThreeGeoTerrainResult) => void,
  ): Promise<void> {
    if (cbs.onVectorDem) {
      throw new Error("ThreeGeo (vendored): onVectorDem is not supported — only the rgb terrain flow is available.");
    }
    if (!cbs.onRgbDem && !cbs.onSatelliteMat) {
      console.info("ThreeGeo.getTerrain: no callbacks set; resolving immediately");
      resolve({ rgbDem: [] });
      return;
    }

    const unitsSide = this.constUnitsSide;
    const upm = unitsPerMeterFromRadius(unitsSide, radius);
    const wsen = originRadiusToBbox(origin, radius);
    const [w, s, e, n] = wsen;
    const nw: LngLat = [w, n];
    const se: LngLat = [e, s];
    const zpCovered: Zoompos[] = bboxToZoomposCovered(wsen, zoom);

    console.info("ThreeGeo.getTerrain: bbox", { w, s, e, n, zoom, unitsSide, satelliteTiles: zpCovered.length });

    let watcherDrained = false;
    const watchDrain = (meshes: THREE.Mesh[]) => {
      if (watcherDrained) return;
      if (!cbs.onRgbDem && !cbs.onSatelliteMat) {
        watcherDrained = true;
        resolve({ rgbDem: meshes });
        return;
      }
      if (!cbs.onSatelliteMat) {
        // Without onSatelliteMat, the watcher completes immediately after
        // onRgbDem — three-geo also short-circuits here.
        watcherDrained = true;
        resolve({ rgbDem: meshes });
        return;
      }
      // Else: the RgbModel will call onWatcher after the last satellite tile
      // resolves; we wire it through RgbModel callbacks below.
    };

    const model = new RgbModel({
      unitsPerMeter: upm,
      projectCoord: (coord: LngLat, nwIn: LngLat, seIn: LngLat) =>
        projectCoord(unitsSide, coord, nwIn, seIn),
      token: this.tokenMapbox,
      isDebug: this.isDebug,
      apiRgb: this.apiRgb,
      apiSatellite: this.apiSatellite,
      signal: options.signal,
      demZoomOffset: options.demZoomOffset,
      onRgbDem: (meshes) => {
        if (cbs.onRgbDem) cbs.onRgbDem(meshes);
        watchDrain(meshes);
      },
      onSatelliteMat: (mesh) => {
        if (cbs.onSatelliteMat) cbs.onSatelliteMat(mesh);
      },
      onWatcher: (payload) => {
        if (watcherDrained) return;
        watcherDrained = true;
        resolve({ rgbDem: Array.from(payload.data) });
      },
    });

    // Late-set the bbox used by addTile; this is set on the model so the
    // existing public call shape (`getTerrain(origin, radius, zoom, cbs)`)
    // is preserved.
    // (RgbModel.fetch accepts `(zpCovered, bbox)`; but to match three-geo's
    //  legacy signature we stash it on the model and let addTile read it.)
    model.setBbox(nw, se);

    await model.fetch(zpCovered, { northWest: nw, southEast: se });
  }
}
