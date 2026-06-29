import { Html } from "@react-three/drei";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { fetchMapPlacements, type MapPlacement } from "../../api/client";
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
type TerrainPhase = "idle" | "projecting" | "fetching" | "rendering" | "ready" | "flat" | "error";

export default function TerrainGallery() {
  const photos = useGalleryStore((s) => s.photos);
  const selectedIndex = useGalleryStore((s) => s.selectedPhotoIndex);
  const selectPhoto = useGalleryStore((s) => s.selectPhoto);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [terrain, setTerrain] = useState<THREE.Group | null>(null);
  const [projection, setProjection] = useState<ThreeGeoProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<TerrainPhase>("idle");
  const [placements, setPlacements] = useState<MapPlacement[]>([]);
  const [placementError, setPlacementError] = useState<string | null>(null);

  const geoPhotos = useMemo(() => getGeoPhotos(photos), [photos]);
  const geoPlacements = useMemo(
    () =>
      placements
        .filter((placement) => Number.isFinite(placement.lat) && Number.isFinite(placement.lng))
        .map((placement) => ({ lat: placement.lat, lng: placement.lng })),
    [placements]
  );
  const request = useMemo(() => createTerrainRequest([...geoPhotos, ...geoPlacements]), [geoPhotos, geoPlacements]);
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
  const placementLayout = useMemo(() => {
    if (!projection) return [];
    return placements.flatMap((placement) => {
      if (!Number.isFinite(placement.lat) || !Number.isFinite(placement.lng)) return [];
      const [x, y, z = 0] = projection.proj([placement.lat, placement.lng]);
      return [{
        placement,
        position: [
          x,
          y,
          terrain ? sampleTerrainZ(terrain, x, y) ?? z : z,
        ] as [number, number, number],
      }];
    });
  }, [placements, projection, terrain]);

  useEffect(() => {
    let cancelled = false;
    fetchMapPlacements()
      .then((data) => {
        if (!cancelled) {
          setPlacements(data);
          setPlacementError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setPlacementError((err as Error).message);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!request) {
      setTerrain(null);
      setProjection(null);
      setLoading(false);
      setError(null);
      setPhase("idle");
      return;
    }

    let cancelled = false;
    let renderFrame: number | null = null;
    setLoading(Boolean(MAPBOX_TOKEN));
    setError(null);
    setPhase("projecting");

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
          setPhase("flat");
          return null;
        }
        setPhase("fetching");
        return tgeo.getTerrainRgb(request.origin, request.radiusKm, request.zoom);
      })
      .then((group) => {
        if (!group) return;
        if (cancelled) {
          disposeObject(group);
          return;
        }
        setPhase("rendering");
        group.name = "artasia-terrain";
        group.scale.z = TERRAIN_ELEVATION_SCALE;
        setTerrain((previous) => {
          if (previous) disposeObject(previous);
          return group;
        });
        renderFrame = window.requestAnimationFrame(() => {
          if (!cancelled) setPhase("ready");
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setTerrain(null);
          setError((err as Error).message);
          setPhase("error");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
      if (renderFrame !== null) window.cancelAnimationFrame(renderFrame);
    };
  }, [request]);

  useEffect(() => {
    return () => {
      if (terrain) disposeObject(terrain);
    };
  }, [terrain]);

  if (photos.length === 0 && placements.length === 0 && !placementError) return null;

  if (geoPhotos.length === 0 && geoPlacements.length === 0) {
    return (
      <Html center style={messageStyle}>
        {placementError ? `Placement locations failed: ${placementError}` : "No GPS photos or placements for terrain mode."}
      </Html>
    );
  }

  return (
    <group>
      {request && (
        <Html fullscreen style={overlayRootStyle}>
          <div style={tileStatusStyle}>
            <div style={tileStatusHeaderStyle}>Terrain tiles</div>
            <div style={tileStatusRowStyle}>
              <span>Status</span>
              <strong style={tileStatusValueStyle}>{terrainPhaseLabel(phase)}</strong>
            </div>
            <div style={tileStatusRowStyle}>
              <span>Resolution</span>
              <strong style={tileStatusValueStyle}>z{request.zoom}</strong>
            </div>
            <div style={tileStatusRowStyle}>
              <span>Estimated tiles</span>
              <strong style={tileStatusValueStyle}>{request.estimatedSatelliteTiles}</strong>
            </div>
            <div style={tileStatusRowStyle}>
              <span>Radius</span>
              <strong style={tileStatusValueStyle}>{formatRadius(request.radiusKm)}</strong>
            </div>
          </div>
        </Html>
      )}

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

      {placementLayout.map(({ placement, position }) => (
        <TerrainPlaceMarker
          key={placement.placement_id}
          position={position}
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

function TerrainPlaceMarker({ position }: { position: [number, number, number] }) {
  const [x, y, z] = position;

  return (
    <group position={[x, y, z + 0.08]}>
      <mesh>
        <sphereGeometry args={[0.12, 18, 12]} />
        <meshStandardMaterial color="#ff2d2d" emissive="#7a0808" roughness={0.5} />
      </mesh>
      <mesh position={[0, 0, -0.08]} rotation={[Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.14, 0.22, 28]} />
        <meshBasicMaterial color="#ff2d2d" transparent opacity={0.42} side={THREE.DoubleSide} />
      </mesh>
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

const overlayRootStyle: React.CSSProperties = {
  pointerEvents: "none",
};

const tileStatusStyle: React.CSSProperties = {
  position: "absolute",
  top: 56,
  right: 16,
  minWidth: 178,
  background: "rgba(10,10,20,0.78)",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 6,
  padding: "10px 12px",
  color: "#b8bfcb",
  fontFamily: "monospace",
  fontSize: 11,
  lineHeight: 1.35,
};

const tileStatusHeaderStyle: React.CSSProperties = {
  color: "#f0f2f5",
  fontSize: 12,
  marginBottom: 7,
};

const tileStatusRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
};

const tileStatusValueStyle: React.CSSProperties = {
  color: "#f5f7fb",
  fontWeight: 600,
};

function terrainPhaseLabel(phase: TerrainPhase) {
  switch (phase) {
    case "projecting":
      return "Projecting";
    case "fetching":
      return "Loading";
    case "rendering":
      return "Rendering";
    case "ready":
      return "Rendered";
    case "flat":
      return "Flat preview";
    case "error":
      return "Error";
    default:
      return "Waiting";
  }
}

function formatRadius(radiusKm: number) {
  return `${radiusKm.toFixed(radiusKm >= 10 ? 0 : 1)} km`;
}

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
