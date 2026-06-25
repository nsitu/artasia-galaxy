import type { Photo } from "../../api/client";
import type { PhotoPosition } from "./galleryLayout";

export interface GeoPhoto {
  photo: Photo;
  index: number;
  lat: number;
  lng: number;
}

export interface TerrainRequest {
  origin: [number, number];
  radiusKm: number;
  zoom: number;
  unitsSide: number;
}

export interface TerrainPhotoLayoutItem {
  photo: Photo;
  index: number;
  position: PhotoPosition;
}

const EARTH_RADIUS_KM = 6371;
const MIN_RADIUS_KM = 25;
const RADIUS_PADDING = 1.35;
const TERRAIN_UNITS_SIDE = 12;
const CLUSTER_RADIUS = 0.75;

export function getGeoPhotos(photos: Photo[]): GeoPhoto[] {
  return photos.flatMap((photo, index) => {
    const lat = photo.exifInfo?.latitude;
    const lng = photo.exifInfo?.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];
    return [{ photo, index, lat: lat as number, lng: lng as number }];
  });
}

export function createTerrainRequest(geoPhotos: GeoPhoto[]): TerrainRequest | null {
  if (geoPhotos.length === 0) return null;

  const lats = geoPhotos.map((item) => item.lat);
  const lngs = geoPhotos.map((item) => item.lng);
  const origin: [number, number] = [
    (Math.min(...lats) + Math.max(...lats)) / 2,
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
  ];
  const furthestKm = Math.max(
    ...geoPhotos.map((item) => haversineKm(origin, [item.lat, item.lng]))
  );

  return {
    origin,
    radiusKm: Math.max(furthestKm * RADIUS_PADDING, MIN_RADIUS_KM),
    zoom: chooseTerrainZoom(furthestKm),
    unitsSide: TERRAIN_UNITS_SIDE,
  };
}

export function createTerrainPhotoLayout(
  geoPhotos: GeoPhoto[],
  project: (latlng: [number, number]) => [number, number] | [number, number, number]
): TerrainPhotoLayoutItem[] {
  const clusterCounts = new Map<string, number>();

  return geoPhotos.map((item) => {
    const key = `${item.lat.toFixed(5)},${item.lng.toFixed(5)}`;
    const clusterIndex = clusterCounts.get(key) ?? 0;
    clusterCounts.set(key, clusterIndex + 1);
    const [x, y, z = 0] = project([item.lat, item.lng]);
    const offset = radialClusterOffset(clusterIndex);

    return {
      photo: item.photo,
      index: item.index,
      position: [x + offset[0], y + offset[1], z],
    };
  });
}

export function getTerrainLayoutBounds(layout: TerrainPhotoLayoutItem[], unitsSide: number) {
  if (layout.length === 0) {
    return { centerX: 0, centerY: 0, width: unitsSide, height: unitsSide };
  }

  const xs = layout.map((item) => item.position[0]);
  const ys = layout.map((item) => item.position[1]);
  const padding = Math.max(1.5, unitsSide * 0.08);
  const minX = Math.min(...xs, -unitsSide / 2) - padding;
  const maxX = Math.max(...xs, unitsSide / 2) + padding;
  const minY = Math.min(...ys, -unitsSide / 2) - padding;
  const maxY = Math.max(...ys, unitsSide / 2) + padding;

  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: Math.max(maxX - minX, unitsSide),
    height: Math.max(maxY - minY, unitsSide),
  };
}

function radialClusterOffset(index: number): [number, number] {
  if (index === 0) return [0, 0];
  const ring = Math.ceil(index / 6);
  const angle = ((index - 1) % 6) * (Math.PI / 3);
  const radius = CLUSTER_RADIUS * ring;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

function haversineKm(a: [number, number], b: [number, number]) {
  const dLat = degToRad(b[0] - a[0]);
  const dLng = degToRad(b[1] - a[1]);
  const lat1 = degToRad(a[0]);
  const lat2 = degToRad(b[0]);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function chooseTerrainZoom(radiusKm: number) {
  if (radiusKm > 1000) return 5;
  if (radiusKm > 250) return 7;
  if (radiusKm > 75) return 9;
  return 12;
}
