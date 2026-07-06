// RgbModel for the vendored three-geo port.
//
// Replaces three-geo's `src/models/rgb.js`. This is the file that contains
// the per-tile synchronous loop where the original code spent ~9.6 seconds
// per regional load on a 144-tile batch. The hot loop was:
//
//   dataEle.forEach(([zoompos, arr, zoomposEle]) => {
//     this.resolveSeams(arr, this.getNeighborsInfo(...));
//     //                          ^^^^^^^^^^^^^^^^
//     // resolveSeams → _stitchWithNei3 uses Array.prototype.splice on a
//     // plain Array of 49152 entries, 128 times, each splice is O(N).
//     let geom = new THREE.PlaneBufferGeometry(1, 1, cSegments[0], cSegments[1]);
//     geom.attributes.position.array = new Float32Array(arr);
//     // ...
//     this.resolveTex(zoompos, ...); // async — closure setup is sync
//   });
//
// We rework this with three changes:
//   1. `resolveSeams` allocates a Float32Array of the right final size and
//      copies element-by-element into indexed positions instead of splicing
//      in place. This makes the east-seam stitch O(N) instead of O(N²).
//   2. `fetch` uses Promise.all instead of forEach(async). The DEM tiles
//      already fetched concurrently; this just removes the antipattern.
//   3. `_build` yields to the event loop every eighth tile so the satellite
//      textures `resolveTex` dispatches can progress and Image.onload
//      callbacks fire while geometry setup runs in parallel rather than stall
//      until the entire batch finishes.
//
// Behavior preserved: same inputs (zoomposEle list, zpCovered list), same
// outputs (THREE.Mesh planes with the same geometry and the satellite texture
// bound onto `material.map`), same callback ordering (onRgbDem called once
// with all meshes synchronously; onSatelliteMat called once per tile as the
// satellite fetch resolves).

import * as THREE from "three";

import {
  pixelToLngLat,
  projectCoord,
  type LatLng,
  type LngLat,
  type Wsen,
  type Zoompos,
} from "./mercator";
import {
  fetchSatelliteTexture,
  fetchTerrainRgbPixels,
  getSixteenthsForEle,
  getZoomposEle,
  type PixelData,
} from "./tiles";

const DEM_TILE_PIXELS = 512;
const DEFAULT_DEM_ZOOM_OFFSET = 2;
const RGBA_PER_PIXEL = 4;
const SATELLITE_FETCH_CONCURRENCY = 8;
const TEXTURE_APPLY_BATCH_SIZE = 6;

type DataEle = [Zoompos, Float32Array, Zoompos]; // [zoompos, positionArray, srcZoomposEle]

export interface RgbModelCallbacks {
  onRgbDem: (meshes: THREE.Mesh[]) => void;
  onSatelliteMat: (mesh: THREE.Mesh) => void;
  onWatcher: (payload: { what: "dem-rgb"; data: THREE.Mesh[] }) => void;
}

export interface RgbModelParams extends RgbModelCallbacks {
  unitsPerMeter: number;
  projectCoord: (
    coord: LngLat,
    nw: LngLat,
    se: LngLat,
  ) => [number, number];
  token: string;
  isDebug?: boolean;
  apiRgb?: string;
  apiSatellite?: string;
  signal?: AbortSignal;
  demZoomOffset?: number;
}

// Yield to the event loop so Image.onload / fetch callbacks can fire while
// the build loop runs. Returns once the next macrotask executes.
const yieldToMain = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
const yieldToFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });

function createAbortError() {
  const err = new Error("Terrain load aborted");
  err.name = "AbortError";
  return err;
}

export class RgbModel {
  private readonly unitsPerMeter: number;
  private readonly projectCoordFn: RgbModelParams["projectCoord"];
  private readonly token: string;
  private readonly onRgbDem: RgbModelCallbacks["onRgbDem"];
  private readonly onSatelliteMat: RgbModelCallbacks["onSatelliteMat"];
  private readonly onWatcher: RgbModelCallbacks["onWatcher"];
  private readonly apiRgb: string;
  private readonly apiSatellite: string;
  private readonly signal?: AbortSignal;
  private readonly demZoomOffset: number;
  private readonly demScaleFactor: number;
  private readonly verticesPerTile: number;
  private appliedSinceFrameYield = 0;

  private dataEleCovered: DataEle[] = [];

  constructor(params: RgbModelParams) {
    this.unitsPerMeter = params.unitsPerMeter;
    this.projectCoordFn = params.projectCoord;
    this.token = params.token;
    this.apiRgb = params.apiRgb ?? "mapbox-terrain-rgb";
    this.apiSatellite = params.apiSatellite ?? "mapbox-satellite";
    this.onRgbDem = params.onRgbDem;
    this.onSatelliteMat = params.onSatelliteMat;
    this.onWatcher = params.onWatcher;
    this.signal = params.signal;
    this.demZoomOffset = Math.max(2, Math.min(5, Math.floor(params.demZoomOffset ?? DEFAULT_DEM_ZOOM_OFFSET)));
    this.demScaleFactor = 2 ** this.demZoomOffset;
    this.verticesPerTile = DEM_TILE_PIXELS / this.demScaleFactor;
  }

  private throwIfAborted(): void {
    if (this.signal?.aborted) throw createAbortError();
  }

  /**
   * Driver: fetch all DEM tiles in parallel, accumulate per-tile position
   * arrays, then call `build()` once every DEM tile has resolved.
   *
   * Replaces three-geo's `RgbModel.fetch` which used `forEach(async...)`.
   * That pattern fires all the async coroutines synchronously and waits
   * on a manual counter; the concrete effect is identical, but Promise.all
   * is shorter and surfaces errors instead of swallowing them silently.
   */
  async fetch(zpCovered: Zoompos[], _bbox: { northWest: LngLat; southEast: LngLat }): Promise<void> {
    this.throwIfAborted();
    const zpEle = getZoomposEle(zpCovered, this.demZoomOffset);
    console.info(
      `RgbModel: ${zpEle.length} DEM tiles covering ${zpCovered.length} satellite tiles ` +
      `(DEM offset ${this.demZoomOffset}, ${this.verticesPerTile}x${this.verticesPerTile} vertices/tile)`,
    );

    const results = await Promise.all(
      zpEle.map(async (zoompos): Promise<DataEle[] | null> => {
        const pixels = await fetchTerrainRgbPixels(this.token, zoompos, this.signal);
        this.throwIfAborted();
        if (pixels === null) {
          console.warn(`fetchTile failed for DEM ${zoompos.join("/")}`);
          return null;
        }
        return this.addTile(pixels, zoompos, zpCovered);
      }),
    );

    for (const dataEles of results) {
      this.throwIfAborted();
      if (dataEles) this.dataEleCovered.push(...dataEles);
    }
    await this.build();
  }

  /**
   * For one DEM tile, decode the 512×512 PNG pixels into elevation buckets,
   * then for each of the up-to-16 satellite tiles that descend from this DEM
   * tile allocate a 49152-float position array.
   *
   * Returns an array of `DataEle` entries (one per covered 16th). The caller
   * concatenates them into `this.dataEleCovered`.
   */
  private addTile(
    pixels: PixelData,
    zoomposEle: Zoompos,
    zpCovered: Zoompos[],
  ): DataEle[] {
    const elevations = decodeElevationsFromRgb(pixels);
    const sixteenthsCovered = getSixteenthsForEle(zoomposEle, zpCovered, this.demZoomOffset);
    const out: DataEle[] = [];

    for (const zoompos of sixteenthsCovered) {
      // Which 16th of the 512×512 image this zoompos corresponds to.
      // sixteenths are indexed as col*4+row, so back-figure from zoompos.
      const col = zoompos[1] - zoomposEle[1] * this.demScaleFactor;
      const row = zoompos[2] - zoomposEle[2] * this.demScaleFactor;
      const r0 = row * this.verticesPerTile;
      const r1 = (row + 1) * this.verticesPerTile;
      const c0 = col * this.verticesPerTile;
      const c1 = (col + 1) * this.verticesPerTile;

      // Sample 128×128 elevations out of the 512×512 DEM image.
      const elev = new Float32Array(this.verticesPerTile * this.verticesPerTile);
      let e = 0;
      for (let r = r0; r < r1; r++) {
        for (let c = c0; c < c1; c++) {
          elev[e++] = elevations[r * pixels.width + c];
        }
      }

      // Build the vertex position array (128*128*3 floats, [x, y, z] in
      // [longitudinal terrain-units, latitudinal terrain-units, elevation*unitsPerMeter]).
      const array = new Float32Array(this.verticesPerTile * this.verticesPerTile * 3);
      let outIdx = 0;
      let dataIdx = 0;
      for (let rowV = 0; rowV < this.verticesPerTile; rowV++) {
        for (let colV = 0; colV < this.verticesPerTile; colV++) {
          const [lng, lat] = pixelToLngLat(
            zoompos[1] * this.verticesPerTile + colV,
            zoompos[2] * this.verticesPerTile + rowV,
            zoompos[0],
            this.verticesPerTile,
          );
          const [px, py] = this.projectCoordFn([lng, lat], this.bboxNW!, this.bboxSE!);
          array[outIdx++] = px;
          array[outIdx++] = py;
          array[outIdx++] = elev[dataIdx++] * this.unitsPerMeter;
        }
      }
      out.push([zoompos, array, zoomposEle]);
    }
    return out;
  }

  // We store bbox on a per-fetch basis here (instead of passing it into
  // addTile from the caller) to keep the signature close to three-geo's
  // original. Set once before the parallel fetch kicks off.
  private bboxNW: LngLat | null = null;
  private bboxSE: LngLat | null = null;

  /** Internal: stash the bbox derived from the public `fetch(zpCovered, bbox)` arg. */
  setBbox(northWest: LngLat, southEast: LngLat): void {
    this.bboxNW = northWest;
    this.bboxSE = southEast;
  }

  /**
   * Build geometries for the accumulated DEM data + dispatch satellite fetches.
   *
   * Replaces three-geo's `RgbModel.build` + `RgbModel._build`. The key changes
   * are described in the file header; functionally the output and the callback
   * sequence are unchanged:
   *   - onRgbDem(meshes) is called once with all N meshes synchronously.
   *   - onSatelliteMat(mesh) is called for each tile as its satellite fetch resolves.
   *   - onWatcher({ what: 'dem-rgb', data: meshes }) is called after the last
   *     satellite texture resolves.
   */
  private async build(): Promise<void> {
    this.throwIfAborted();
    if (this.dataEleCovered.length === 0) {
      const meshes: THREE.Mesh[] = [];
      this.onRgbDem(meshes);
      this.onWatcher({ what: "dem-rgb", data: meshes });
      return;
    }

    // Sort so resolveSeams runs in lexicographic tile order (matches three-geo).
    const dataEle = [...this.dataEleCovered];
    dataEle.sort((a, b) => (a[0].join("/") > b[0].join("/") ? 1 : -1));
    const dataEleIds = new Map<string, number>();
    dataEle.forEach((d, i) => dataEleIds.set(d[0].join("/"), i));

    // Phase 1: Build all geometry synchronously (no yields, no satellite
    // dispatches). This is the splice-replaced tight loop; with the O(N)
    // resolveSeams rewrite it's fast enough to run in a single chunk
    // without blocking longtask thresholds for typical tile counts.
    const meshes: THREE.Mesh[] = [];
    const meshByZoompos = new Map<string, THREE.Mesh>();
    for (let i = 0; i < dataEle.length; i++) {
      this.throwIfAborted();
      const [zoompos, arr, zoomposEle] = dataEle[i];
      if (arr.length !== this.verticesPerTile * this.verticesPerTile * 3) {
        console.warn("RgbModel.build: array already seams-resolved, skipping");
        continue;
      }
      const infoNei = getNeighborsInfo(dataEle, dataEleIds, zoompos);
      const { array: stitched, cSegments } = resolveSeams(arr, infoNei, this.verticesPerTile);
      const [wSeg, hSeg] = cSegments;
      const geom = new THREE.PlaneGeometry(1, 1, wSeg, hSeg);
      geom.setAttribute("position", new THREE.BufferAttribute(stitched, 3));
      geom.attributes.position.needsUpdate = true;
      // Recompute normals + bounds after we overwrite position — needed so
      // raycasting (sampleTerrainZ) hits the displaced surface rather than
      // the flat 1×1 plane.
      geom.computeVertexNormals();
      geom.computeBoundingSphere();

      const plane = new THREE.Mesh(
        geom,
        new THREE.MeshBasicMaterial({ wireframe: true, color: 0xcccccc }),
      );
      plane.name = `dem-rgb-${zoompos.join("/")}`;
      plane.userData.threeGeo = {
        tile: [zoompos[1], zoompos[2], zoompos[0]],
        srcDem: {
          tile: [zoomposEle[1], zoomposEle[2], zoomposEle[0]],
          uri: `mapbox-terrain-rgb/${zoomposEle.join("/")}`,
        },
      };
      meshes.push(plane);
      meshByZoompos.set(zoompos.join("/"), plane);
      if (i % 16 === 15) await yieldToMain();
    }

    // Phase 2: Fire onRgbDem synchronously with **all** meshes BEFORE any
    // satellite fetch resolves. This is critical: TerrainGallery's onRgbDem
    // callback calls applyTerrainWireframeMaterial which REPLACES each
    // mesh.material with a transparent wireframe material. If onSatelliteMat
    // fires before onRgbDem, the texture we set on the original material
    // gets disposed by this replacement and is lost forever — the tile
    // appears as a permanent transparent wireframe.
    this.onRgbDem(meshes);

    // Phase 3: Dispatch all satellite fetches concurrently and yield between
    // batches so Image.onload callbacks can fire while waiting. Since
    // onRgbDem already ran, TerrainGallery has replaced each material with a
    // transparent wireframe; resolveSatellite sets .map on THAT replacement
    // material, and onSatelliteMat → normalizeTerrainMaterials restores
    // opacity + removes the outline child.
    const satelliteTasks = dataEle.flatMap(([zoompos]) => {
      const plane = meshByZoompos.get(zoompos.join("/"));
      return plane ? [{ zoompos, plane }] : [];
    });
    await this.runSatelliteQueue(satelliteTasks);
    this.onWatcher({ what: "dem-rgb", data: meshes });
  }

  private async runSatelliteQueue(tasks: Array<{ zoompos: Zoompos; plane: THREE.Mesh }>): Promise<void> {
    let nextTask = 0;
    const workerCount = Math.min(SATELLITE_FETCH_CONCURRENCY, tasks.length);
    const workers = Array.from({ length: workerCount }, async () => {
      while (nextTask < tasks.length) {
        this.throwIfAborted();
        const task = tasks[nextTask++];
        await this.resolveSatellite(task.zoompos, task.plane);
      }
    });
    await Promise.all(workers);
  }

  private async resolveSatellite(zoompos: Zoompos, plane: THREE.Mesh): Promise<void> {
    const texture = await fetchSatelliteTexture(this.token, zoompos, this.signal);
    this.throwIfAborted();
    if (texture) {
      await this.beforeTextureApply();
      this.throwIfAborted();
      const basic = plane.material as THREE.MeshBasicMaterial;
      basic.map = texture;
      basic.wireframe = false;
      basic.color = new THREE.Color(0xffffff);
      basic.needsUpdate = true;
    }
    this.onSatelliteMat(plane);
  }

  private async beforeTextureApply(): Promise<void> {
    if (this.appliedSinceFrameYield >= TEXTURE_APPLY_BATCH_SIZE) {
      this.appliedSinceFrameYield = 0;
      await yieldToFrame();
      return;
    }
    this.appliedSinceFrameYield += 1;
  }
}

/** Decode 512×512 RGBA pixels into 512×512 elevation values (in meters). */
function decodeElevationsFromRgb(pixels: PixelData): Float32Array {
  const out = new Float32Array(pixels.width * pixels.height);
  const data = pixels.data;
  for (let e = 0; e < data.length; e += RGBA_PER_PIXEL) {
    const r = data[e];
    const g = data[e + 1];
    const b = data[e + 2];
    // Mapbox terrain-rgb encoding: -10000 + (R*256*256 + G*256 + B) * 0.1 m
    out[e / RGBA_PER_PIXEL] = -10000 + (r * 65536 + g * 256 + b) * 0.1;
  }
  return out;
}

export function getNeighbors8(zoompos: Zoompos): [Zoompos, number][] {
  // 8-neighbors indexed by three-geo's convention:
  //   4 0 7
  //   1 + 3
  //   5 2 6
  // 0,1,2,3 = cardinal; 4,5,6,7 = diagonal.
  const diffs: [number, number, number][] = [
    [0, 0, -1],
    [0, -1, 0],
    [0, 0, 1],
    [0, 1, 0],
    [0, -1, -1],
    [0, -1, 1],
    [0, 1, 1],
    [0, 1, -1],
  ];
  return diffs.map<[Zoompos, number]>((d, idx) => {
    return [[zoompos[0] + d[0], zoompos[1] + d[1], zoompos[2] + d[2]], idx];
  });
}

export function getNeighborsInfo(
  dataEle: DataEle[],
  ids: Map<string, number>,
  zoompos: Zoompos,
): Record<string, Float32Array> {
  const out: Record<string, Float32Array> = {};
  for (const [neighbor, idxNei] of getNeighbors8(zoompos)) {
    const id = `${idxNei}`;
    const found = ids.get(neighbor.join("/"));
    if (found === undefined) continue;
    if (["2", "3", "6"].includes(id)) {
      out[id] = dataEle[found][1];
    }
  }
  return out;
}

/**
 * Add edge seams to a 128×128 vertex array, producing a 129×128 (east seam),
 * 128×129 (south seam), or 129×129 (both) array. Replaces three-geo's
 * `RgbModel.resolveSeams` + `_stitchWithNei2` + `_stitchWithNei3`.
 *
 * The original `_stitchWithNei3` used `Array.prototype.splice` 384 times per
 * tile in a 49152-element plain Array — that's 384 × O(49152) → ~19M copy
 * operations per tile that has an east neighbor. For a 144-tile batch where
 * most tiles have an east neighbor, the longtask sums to ~2.7 billion
 * element-shifts. We replace it with one pre-allocated `Float32Array` and
 * direct indexed writes: O(N) total per tile — same data, written once.
 *
 * Returns the new array and the new (cols-1, rows-1) segment counts so the
 * caller can allocate the matching `PlaneGeometry`.
 */
export function resolveSeams(
  array: Float32Array,
  infoNei: Record<string, Float32Array>,
  verticesPerTile = 128,
): { array: Float32Array; cSegments: [number, number] } {
  const colsIn = verticesPerTile;
  const rowsIn = verticesPerTile;
  let colsOut = colsIn;
  let rowsOut = rowsIn;
  if (infoNei["3"]) colsOut = verticesPerTile + 1; // east seam
  if (infoNei["2"]) rowsOut = verticesPerTile + 1; // south seam

  const out = new Float32Array(rowsOut * colsOut * 3);

  // Copy original 128×128 region into upper-left of the output grid.
  for (let r = 0; r < rowsIn; r++) {
    for (let c = 0; c < colsIn; c++) {
      const src = (r * colsIn + c) * 3;
      const dst = (r * colsOut + c) * 3;
      out[dst] = array[src];
      out[dst + 1] = array[src + 1];
      out[dst + 2] = array[src + 2];
    }
  }

  // East seam: copy west edge of east neighbor as the new col 128 for each row.
  if (infoNei["3"]) {
    const arrayNei = infoNei["3"];
    for (let r = 0; r < rowsIn; r++) {
      const src = r * colsIn * 3; // neighbor's west edge is its col 0
      const dst = (r * colsOut + colsIn) * 3;
      out[dst] = arrayNei[src];
      out[dst + 1] = arrayNei[src + 1];
      out[dst + 2] = arrayNei[src + 2];
    }
  }

  // South seam: copy north edge of south neighbor as the new row 128.
  if (infoNei["2"]) {
    const arrayNei = infoNei["2"];
    // The south row spans colsOut columns (118 original + the new east col if any).
    // For cols < colsIn, source is array's pixel c (cols 0..127 of neighbor's row 0).
    // For the corner col (colsIn, when present), source is neighbor's row 0, col 127.
    for (let c = 0; c < colsOut; c++) {
      const src = c * 3;
      const dst = (rowsIn * colsOut + c) * 3;
      const safeSrc = Math.min(c, verticesPerTile - 1) * 3;
      out[dst] = arrayNei[safeSrc];
      out[dst + 1] = arrayNei[safeSrc + 1];
      out[dst + 2] = arrayNei[safeSrc + 2];
      // use src as redundant clarity; safeSrc is what we actually use, so make
      // this read explicit:
      void src;
    }
  }

  // Diagonal pothole: when both east and south seams present, the SE corner
  // cell (row 128, col 128) has no source from either neighbor's edge. three-geo
  // copies it from the SE-diagonal neighbor's pixel 0 ("6"), or falls back to
  // the previous tri's last (x, y, z) to make a degenerate triangle.
  if (infoNei["2"] && infoNei["3"]) {
    const dst = (rowsIn * colsOut + colsIn) * 3;
    const arrayNei6 = infoNei["6"];
    if (arrayNei6) {
      out[dst] = arrayNei6[0];
      out[dst + 1] = arrayNei6[1];
      out[dst + 2] = arrayNei6[2];
    } else {
      const prev = dst - 3;
      out[dst] = out[prev];
      out[dst + 1] = out[prev + 1];
      out[dst + 2] = out[prev + 2];
    }
  }

  return { array: out, cSegments: [colsOut - 1, rowsOut - 1] };
}
