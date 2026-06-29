import { Html } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { useGalleryStore } from "../../stores/galleryStore";
import TerrainPhotoPin from "./TerrainPhotoPin";
import {
  createTerrainPhotoLayout,
  createTerrainRequest,
  getGeoPhotos,
} from "./terrainLayout";
import { loadThreeGeo, type ThreeGeoProjection } from "./threeGeoRuntime";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? "";
const TERRAIN_ELEVATION_SCALE = 5;

export default function TerrainGallery() {
  const photos = useGalleryStore((s) => s.photos);
  const selectedIndex = useGalleryStore((s) => s.selectedPhotoIndex);
  const selectPhoto = useGalleryStore((s) => s.selectPhoto);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [terrain, setTerrain] = useState<THREE.Group | null>(null);
  const [projection, setProjection] = useState<ThreeGeoProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const geoPhotos = useMemo(() => getGeoPhotos(photos), [photos]);
  const request = useMemo(() => createTerrainRequest(geoPhotos), [geoPhotos]);
  const layout = useMemo(() => {
    if (!projection) return [];
    const flatLayout = createTerrainPhotoLayout(geoPhotos, projection.proj);
    if (!terrain) return flatLayout;
    return flatLayout.map((item) => ({
      ...item,
      position: [
        item.position[0],
        item.position[1],
        sampleTerrainZ(terrain, item.position[0], item.position[1]) ?? item.position[2],
      ] as [number, number, number],
    }));
  }, [geoPhotos, projection, terrain]);

  useEffect(() => {
    if (!request) {
      setTerrain(null);
      setProjection(null);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(Boolean(MAPBOX_TOKEN));
    setError(null);

    loadThreeGeo()
      .then((ThreeGeo) => {
        const tgeo = new ThreeGeo({
          tokenMapbox: MAPBOX_TOKEN,
          unitsSide: request.unitsSide,
        });
        console.info("Artasia terrain request", {
          radiusKm: request.radiusKm,
          zoom: request.zoom,
          estimatedSatelliteTiles: request.estimatedSatelliteTiles,
        });
        setProjection(tgeo.getProjection(request.origin, request.radiusKm, request.unitsSide));
        if (!MAPBOX_TOKEN) {
          setTerrain(null);
          setError("Set VITE_MAPBOX_TOKEN to load terrain.");
          return null;
        }
        return tgeo.getTerrainRgb(request.origin, request.radiusKm, request.zoom);
      })
      .then((group) => {
        if (!group) return;
        if (cancelled) {
          disposeObject(group);
          return;
        }
        group.name = "artasia-terrain";
        group.scale.z = TERRAIN_ELEVATION_SCALE;
        setTerrain((previous) => {
          if (previous) disposeObject(previous);
          return group;
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setTerrain(null);
          setError((err as Error).message);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [request]);

  useEffect(() => {
    return () => {
      if (terrain) disposeObject(terrain);
    };
  }, [terrain]);

  if (photos.length === 0) return null;

  if (geoPhotos.length === 0) {
    return (
      <Html center style={messageStyle}>
        No GPS photos for terrain mode.
      </Html>
    );
  }

  return (
    <group>
      {terrain && <primitive object={terrain} />}

      {layout.map(({ photo, index, position }) => (
        <TerrainPhotoPin
          key={photo.id}
          id={photo.id}
          url={photo.thumbnailUrl}
          width={photo.width}
          height={photo.height}
          position={position}
          isSelected={index === selectedIndex}
          isHighlighted={index === hoveredIndex}
          onClick={() => selectPhoto(index === selectedIndex ? null : index)}
          onPointerEnter={() => setHoveredIndex(index)}
          onPointerLeave={() => setHoveredIndex(null)}
        />
      ))}

      {(loading || error) && (
        <Html position={[0, 0, 2]} center style={messageStyle}>
          {loading ? "Loading terrain..." : error}
        </Html>
      )}
    </group>
  );
}

const messageStyle: React.CSSProperties = {
  color: "#ccc",
  background: "rgba(10,10,20,0.75)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 4,
  padding: "8px 12px",
  fontFamily: "monospace",
  fontSize: 12,
  whiteSpace: "nowrap",
};

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose());
    } else {
      material?.dispose();
    }
  });
}

function sampleTerrainZ(terrain: THREE.Group, x: number, y: number) {
  terrain.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(terrain);
  if (!Number.isFinite(box.max.z)) return null;

  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(x, y, box.max.z + 10),
    new THREE.Vector3(0, 0, -1),
    0,
    Math.max(20, box.max.z - box.min.z + 20)
  );
  const hits = raycaster.intersectObject(terrain, true);
  return hits[0]?.point.z ?? null;
}
