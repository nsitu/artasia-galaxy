import type { Photo } from "../../api/client";

export type PhotoPosition = [number, number, number];

export interface PhotoLayoutItem {
  photo: Photo;
  index: number;
  position: PhotoPosition;
  hasCoordinates: boolean;
}

const GAP_X = 3.0;
const GAP_Y = 2.8;
const FRAME_PADDING = 1.6;
const MIN_PHOTO_DISTANCE = 2.5;
const MIN_SPAN = 0.0001;

function seededJitter(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return ((Math.abs(hash) % 1000) / 1000 - 0.5) * 0.5;
}

function hasCoordinates(photo: Photo) {
  const lat = photo.exifInfo?.latitude;
  const lng = photo.exifInfo?.longitude;
  return Number.isFinite(lat) && Number.isFinite(lng);
}

export function createGalleryLayout(
  photos: Photo[],
  columns = 4
): PhotoLayoutItem[] {
  const safeColumns = Math.max(1, columns);
  const geoPhotos = photos.filter(hasCoordinates);
  const gridWidth = Math.max((safeColumns - 1) * GAP_X, GAP_X);
  const estimatedRows = Math.max(1, Math.ceil(Math.max(photos.length, 1) / safeColumns));
  const mapHeight = Math.max((estimatedRows - 1) * GAP_Y, GAP_Y);

  if (geoPhotos.length === 0) {
    return photos.map((photo, index) => {
      const col = index % safeColumns;
      const row = Math.floor(index / safeColumns);
      return {
        photo,
        index,
        position: [
          (col - (safeColumns - 1) / 2) * GAP_X,
          -(row * GAP_Y) + 1,
          seededJitter(photo.id),
        ],
        hasCoordinates: false,
      };
    });
  }

  const lats = geoPhotos.map((photo) => photo.exifInfo?.latitude ?? 0);
  const lngs = geoPhotos.map((photo) => photo.exifInfo?.longitude ?? 0);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latSpan = Math.max(maxLat - minLat, MIN_SPAN);
  const lngSpan = Math.max(maxLng - minLng, MIN_SPAN);
  const mapAspect = Math.max(0.35, Math.min(2.6, lngSpan / latSpan));
  const layoutWidth = Math.min(gridWidth, Math.max(GAP_X * 1.5, mapHeight * mapAspect));
  const layoutHeight = Math.min(mapHeight * 1.5, Math.max(GAP_Y * 1.5, layoutWidth / mapAspect));
  const unmapped = photos.filter((photo) => !hasCoordinates(photo));
  const unmappedStartY = -(layoutHeight / 2 + GAP_Y);

  const layout: PhotoLayoutItem[] = photos.map((photo, index) => {
    if (hasCoordinates(photo)) {
      const lat = photo.exifInfo?.latitude ?? minLat;
      const lng = photo.exifInfo?.longitude ?? minLng;
      const normalizedX = (lng - minLng) / lngSpan - 0.5;
      const normalizedY = (lat - minLat) / latSpan - 0.5;

      return {
        photo,
        index,
        position: [
          normalizedX * layoutWidth,
          normalizedY * layoutHeight,
          seededJitter(photo.id),
        ],
        hasCoordinates: true,
      };
    }

    const unmappedIndex = unmapped.findIndex((item) => item.id === photo.id);
    const col = unmappedIndex % safeColumns;
    const row = Math.floor(unmappedIndex / safeColumns);

    return {
      photo,
      index,
      position: [
        (col - (safeColumns - 1) / 2) * GAP_X,
        unmappedStartY - row * GAP_Y,
        seededJitter(photo.id),
      ],
      hasCoordinates: false,
    };
  });

  return separateCloseItems(layout);
}

function separateCloseItems(layout: PhotoLayoutItem[]) {
  const adjusted = layout.map((item) => ({
    ...item,
    position: [...item.position] as PhotoPosition,
  }));

  for (let pass = 0; pass < 8; pass++) {
    for (let i = 0; i < adjusted.length; i++) {
      for (let j = i + 1; j < adjusted.length; j++) {
        const first = adjusted[i];
        const second = adjusted[j];
        const dx = second.position[0] - first.position[0];
        const dy = second.position[1] - first.position[1];
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance >= MIN_PHOTO_DISTANCE) continue;

        const angle =
          distance < 0.001
            ? (Math.abs(first.photo.id.localeCompare(second.photo.id)) * Math.PI) / 3
            : Math.atan2(dy, dx);
        const push = (MIN_PHOTO_DISTANCE - distance) / 2;
        const pushX = Math.cos(angle) * push;
        const pushY = Math.sin(angle) * push;

        first.position[0] -= pushX;
        first.position[1] -= pushY;
        second.position[0] += pushX;
        second.position[1] += pushY;
      }
    }
  }

  return adjusted;
}

export function getGalleryLayoutBounds(layout: PhotoLayoutItem[]) {
  if (layout.length === 0) {
    return { centerX: 0, centerY: 0, width: GAP_X, height: GAP_Y };
  }

  const xs = layout.map((item) => item.position[0]);
  const ys = layout.map((item) => item.position[1]);
  const minX = Math.min(...xs) - FRAME_PADDING;
  const maxX = Math.max(...xs) + FRAME_PADDING;
  const minY = Math.min(...ys) - FRAME_PADDING;
  const maxY = Math.max(...ys) + FRAME_PADDING;

  return {
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
    width: Math.max(maxX - minX, GAP_X),
    height: Math.max(maxY - minY, GAP_Y),
  };
}
