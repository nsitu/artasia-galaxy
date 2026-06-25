import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGalleryStore } from "../../stores/galleryStore";
import { createGalleryLayout, getGalleryLayoutBounds } from "./galleryLayout";
import {
  createTerrainPhotoLayout,
  createTerrainRequest,
  getGeoPhotos,
  getTerrainLayoutBounds,
} from "./terrainLayout";

export default function CameraRig({
  columns = 4,
  mode = "wall",
}: {
  columns?: number;
  mode?: "wall" | "terrain";
}) {
  const { camera, size } = useThree();
  const target = useRef(new THREE.Vector3(0, 0, 8));
  const lookTarget = useRef(new THREE.Vector3(0, 0, 0));
  const selectedIndex = useGalleryStore((s) => s.selectedPhotoIndex);
  const photos = useGalleryStore((s) => s.photos);
  const layout = useMemo(
    () => createGalleryLayout(photos, columns),
    [photos, columns]
  );
  const bounds = useMemo(() => getGalleryLayoutBounds(layout), [layout]);
  const geoPhotos = useMemo(() => getGeoPhotos(photos), [photos]);
  const terrainRequest = useMemo(() => createTerrainRequest(geoPhotos), [geoPhotos]);
  const terrainLayout = useMemo(() => {
    if (!terrainRequest) return [];
    return createTerrainPhotoLayout(geoPhotos, (latlng) =>
      projectTerrainPoint(latlng, terrainRequest)
    );
  }, [geoPhotos, terrainRequest]);
  const terrainBounds = useMemo(
    () => getTerrainLayoutBounds(terrainLayout, terrainRequest?.unitsSide ?? 12),
    [terrainLayout, terrainRequest]
  );

  useFrame(() => {
    const activeLayout = mode === "terrain" ? terrainLayout : layout;
    const activeBounds = mode === "terrain" ? terrainBounds : bounds;

    if (selectedIndex !== null) {
      const selected = activeLayout.find((item) => item.index === selectedIndex);
      const [x, y] = selected?.position ?? [0, 0, 0];

      if (selected) {
        lookTarget.current.set(x, y, 0);
        target.current.set(x, y, mode === "terrain" ? 5 : 3.5);
      } else {
        lookTarget.current.set(activeBounds.centerX, activeBounds.centerY, 0);
        target.current.set(activeBounds.centerX, activeBounds.centerY, fitCameraZ(activeBounds, size));
      }
    } else {
      const z = fitCameraZ(activeBounds, size);

      lookTarget.current.set(activeBounds.centerX, activeBounds.centerY, 0);
      target.current.set(activeBounds.centerX, activeBounds.centerY, z);
    }

    camera.position.lerp(target.current, 0.06);
    camera.lookAt(
      camera.position
        .clone()
        .lerp(lookTarget.current, 0.06)
    );
  });

  return null;
}

function projectTerrainPoint(
  [lat, lng]: [number, number],
  request: {
    origin: [number, number];
    radiusKm: number;
    unitsSide: number;
  }
): [number, number] {
  const bbox = originRadiusToBbox(request.origin, request.radiusKm);
  const [w, s, e, n] = bbox;
  return [
    request.unitsSide * (-0.5 + (lng - w) / (e - w)),
    request.unitsSide * (-0.5 - (lat - s) / (s - n)),
  ];
}

function originRadiusToBbox(origin: [number, number], radiusKm: number) {
  const [lat, lng] = origin;
  const latDelta = radiusKm / 111.32;
  const lngDelta = radiusKm / (111.32 * Math.cos(THREE.MathUtils.degToRad(lat)));
  return [lng - lngDelta, lat - latDelta, lng + lngDelta, lat + latDelta];
}

function fitCameraZ(
  bounds: { width: number; height: number },
  size: { width: number; height: number }
) {
  const aspect = size.width / Math.max(size.height, 1);
  const verticalZ = bounds.height / (2 * Math.tan(THREE.MathUtils.degToRad(25)));
  const horizontalZ = bounds.width / (2 * Math.tan(THREE.MathUtils.degToRad(25)) * aspect);
  return Math.max(8, verticalZ, horizontalZ);
}
