// Pure geographic math used by the vendored three-geo port.
//
// Replaces the following runtime dependencies from the original three-geo:
//   - @turf/destination, @turf/helpers, @turf/transform-translate,
//     @turf/transform-rotate (used in Utils.originRadiusToBbox and
//     Utils.translateTurfObject)
//   - @mapbox/sphericalmercator (used in RgbModel via `constTilePixels.ll`)
//   - @mapbox/tilebelt (Utils.tileToBbox)
//   - @mapbox/tile-cover (ThreeGeo.getZoomposCovered — replaced with a direct
//     bbox→tiles enumeration)
//
// All formulas are the standard Web Mercator / haversine expressions. No
// external runtime deps; safe to use in a Web Worker.

export type LngLat = [number, number]; // [lng, lat]
export type LatLng = [number, number]; // [lat, lng]
export type Wsen = [number, number, number, number]; // [west, south, east, north]
export type Zoompos = [number, number, number]; // [zoom, tileX, tileY]

export const EARTH_RADIUS_KM = 6371;

const degToRad = (deg: number): number => (deg * Math.PI) / 180;
const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

export function clampLatitude(lat: number): number {
  // Web Mercator latitude limit (same as Leaflet/Mapbox).
  const max = 85.05112878;
  return Math.min(Math.max(lat, -max), max);
}

export function normalizeLongitude(lng: number): number {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

/** Haversine great-circle distance between two lat/lng pairs, in km. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = degToRad(b[0] - a[0]);
  const dLng = degToRad(b[1] - a[1]);
  const lat1 = degToRad(a[0]);
  const lat2 = degToRad(b[0]);
  const v =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(v), Math.sqrt(1 - v));
}

/**
 * Destination lat/lng from an origin given a bearing (deg, 0=N, 90=E) and a
 * great-circle distance in km. Standard spherical-trig formula.
 *
 * Replaces @turf/destination.
 */
export function destinationFromBearing(
  origin: LatLng,
  bearingDeg: number,
  distanceKm: number,
): LatLng {
  const angular = distanceKm / EARTH_RADIUS_KM;
  const theta = degToRad(bearingDeg);
  const phi1 = degToRad(origin[0]);
  const lambda1 = degToRad(origin[1]);

  const sinPhi2 =
    Math.sin(phi1) * Math.cos(angular) +
    Math.cos(phi1) * Math.sin(angular) * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);
  const y = Math.sin(theta) * Math.sin(angular) * Math.cos(phi1);
  const x = Math.cos(angular) - Math.sin(phi1) * sinPhi2;
  const lambda2 = lambda1 + Math.atan2(y, x);

  return [radToDeg(phi2), radToDeg(lambda2)];
}

/**
 * Bounding box (west, south, east, north) for an origin + radius in km.
 * Replicates three-geo's `Utils.originRadiusToBbox`, which used
 * @turf/destination to find the southwest and northeast corners along
 * bearings -45 (=315, NW) and 135 (SE).
 */
export function originRadiusToBbox(origin: LatLng, radiusKm: number): Wsen {
  // bearing -45 = 315 deg → northwest corner → returns [lng, lat] = [w, n]
  const nwLngLat = destinationFromBearing(origin, -45, radiusKm);
  // bearing 135 deg → southeast corner → returns [lng, lat] = [e, s]
  const seLngLat = destinationFromBearing(origin, 135, radiusKm);
  return [
    normalizeLongitude(nwLngLat[1]),
    Math.min(nwLngLat[0], seLngLat[0]),
    normalizeLongitude(seLngLat[1]),
    Math.max(nwLngLat[0], seLngLat[0]),
  ];
}

/**
 * Inverse of Web Mercator: convert pixel coordinates at a given zoom (with
 * the specified tile-size in projected pixels) to lng/lat.
 *
 * Replaces @mapbox/sphericalmercator's `.ll(px, zoom)` with size = 128.
 */
export function pixelToLngLat(
  pixelX: number,
  pixelY: number,
  zoom: number,
  tileSize = 128,
): LngLat {
  const worldSize = tileSize * 2 ** zoom;
  const lng = (pixelX / worldSize) * 360 - 180;
  const lat = radToDeg(
    2 * Math.atan(Math.exp(Math.PI * (1 - (2 * pixelY) / worldSize))) -
      Math.PI / 2,
  );
  return [lng, clampLatitude(lat)];
}

/** Slippy-map tile X for a longitude at a given zoom (flattened to [0, 2^z)). */
export function longitudeToTileX(lng: number, zoom: number): number {
  const scale = 2 ** zoom;
  return Math.floor(((normalizeLongitude(lng) + 180) / 360) * scale);
}

/** Slippy-map tile Y for a latitude at a given zoom (flattened to [0, 2^z)). */
export function latitudeToTileY(lat: number, zoom: number): number {
  const scale = 2 ** zoom;
  const rad = degToRad(clampLatitude(lat));
  const y = ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * scale;
  return Math.max(0, Math.min(scale - 1, Math.floor(y)));
}

/**
 * All [zoom, tileX, tileY] covering the bbox at the given zoom. Replaces
 * `@mapbox/tile-cover` for the rectangular-bbox case three-geo uses.
 *
 * Handles antimeridian wrap by clamping east-of-west; if the bbox straddles
 * ±180 we clamp to the eastern hemisphere (sufficient for the regional areas
 * used here — Mapbox'sterrain tiles span the whole world at low zoom anyway).
 */
export function bboxToZoomposCovered(bbox: Wsen, zoom: number): Zoompos[] {
  const [w, s, e, n] = bbox;
  const scale = 2 ** zoom;

  const westTile = longitudeToTileX(w, zoom);
  let eastTile = longitudeToTileX(e, zoom);
  if (eastTile < westTile) eastTile += scale; // antimeridian wrap
  const northTile = latitudeToTileY(n, zoom);
  const southTile = latitudeToTileY(s, zoom);

  const xCount = eastTile - westTile + 1;
  const yCount = Math.abs(southTile - northTile) + 1;

  const result: Zoompos[] = [];
  for (let yi = 0; yi < yCount; yi++) {
    const tileY = Math.min(northTile, southTile) + yi;
    const wrappedTileY = ((tileY % scale) + scale) % scale;
    for (let xi = 0; xi < xCount; xi++) {
      const tileX = (westTile + xi) % scale;
      result.push([zoom, tileX, wrappedTileY]);
    }
  }
  return result;
}

/**
 * Project an lng/lat into the local terrain coordinate system spanned by the
 * bbox, with the world extending `unitsSide` units on each side. Matches
 * three-geo's `ThreeGeo._projectCoord` exactly.
 */
export function projectCoord(
  unitsSide: number,
  coord: LngLat, // [lng, lat]
  nw: LngLat, // [lng, lat] of northwest corner
  se: LngLat, // [lng, lat] of southeast corner
): [number, number] {
  return [
    unitsSide * (-0.5 + (coord[0] - nw[0]) / (se[0] - nw[0])),
    unitsSide * (-0.5 - (coord[1] - se[1]) / (se[1] - nw[1])),
  ];
}

export function unitsPerMeterFromRadius(
  unitsSide: number,
  radiusKm: number,
): number {
  return unitsSide / (radiusKm * Math.SQRT2 * 1000);
}

/**
 * Inverse of `projectCoord`: given a terrain (x, y) and the origin in lat/lng,
 * return the corresponding lat/lng. Matches three-geo's `_projInv` which went
 * through `Utils.translateTurfObject` (translate a point by (dx, dy) in terrain
 * units, getting back the lng/lat of the displaced point).
 */
export function projectInverse(
  xTerrain: number,
  yTerrain: number,
  origin: LatLng,
  unitsPerMeter: number,
): LatLng {
  // (x, y) in terrain units -> meters east/north of origin.
  const dxMeters = xTerrain / unitsPerMeter;
  const dyMeters = yTerrain / unitsPerMeter;
  const distanceM = Math.hypot(dxMeters, dyMeters);
  const bearing = 90 - radToDeg(Math.atan2(dyMeters, dxMeters));
  const dest = destinationFromBearing(origin, bearing, distanceM / 1000);
  return dest;
}