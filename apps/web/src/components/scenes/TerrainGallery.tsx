import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { fetchMapPlacements, type MapPlacement } from "../../api/client";
import { useGalleryStore } from "../../stores/galleryStore";
import LoadingIndicator from "../ui/LoadingIndicator";
import TerrainPhotoPin from "./TerrainPhotoPin";
import PlaceMarker from "./PlaceMarker";
import {
  createTerrainPhotoLayout,
  createTerrainDetailRequest,
  createFixedTerrainRequest,
  createTerrainRequest,
  getGeoPhotos,
  type TerrainDetailRequest,
} from "./terrainLayout";
import { loadThreeGeo, type ThreeGeoProjection } from "./threeGeoRuntime";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? "";
const TERRAIN_ELEVATION_SCALE = 5;
const DETAIL_TRIGGER_DISTANCE = 6;
const DETAIL_MIN_RADIUS_KM = 0.8;
const DETAIL_MAX_RADIUS_KM = 5;
type TerrainPhase = "idle" | "projecting" | "fetching" | "rendering" | "ready" | "flat" | "error";
type DetailFocus = { x: number; y: number; distance: number };
type TerrainOrbitControls = {
  target?: THREE.Vector3;
  update?: () => void;
};
type TerrainNotice = {
  label: string;
  detail?: string;
  tone?: "loading" | "error" | "muted";
  busy?: boolean;
};

export interface TerrainOverlayState {
  notice?: TerrainNotice;
  request?: {
    zoom: number;
    estimatedSatelliteTiles: number;
    radiusKm: number;
  };
  basePhase?: TerrainPhase;
  detail?: {
    status: string;
    zoom?: number;
    estimatedSatelliteTiles?: number;
    radiusKm?: number;
  };
  focusedPlacement?: MapPlacement | null;
  onBack?: () => void;
}

export default function TerrainGallery({ onOverlayChange }: { onOverlayChange: (state: TerrainOverlayState | null) => void }) {
  const camera = useThree((state) => state.camera);
  const controls = useThree((state) => (state as unknown as { controls?: TerrainOrbitControls }).controls);
  const photos = useGalleryStore((s) => s.photos);
  const galleryLoading = useGalleryStore((s) => s.loading);
  const selectedIndex = useGalleryStore((s) => s.selectedPhotoIndex);
  const selectPhoto = useGalleryStore((s) => s.selectPhoto);
  const fetchPhotos = useGalleryStore((s) => s.fetchPhotos);
  const fetchPlacementFocus = useGalleryStore((s) => s.fetchPlacementFocus);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [terrain, setTerrain] = useState<THREE.Group | null>(null);
  const [projection, setProjection] = useState<ThreeGeoProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<TerrainPhase>("idle");
  const [renderedTerrainKey, setRenderedTerrainKey] = useState<string | null>(null);
  const [placements, setPlacements] = useState<MapPlacement[]>([]);
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [detailFocus, setDetailFocus] = useState<DetailFocus | null>(null);
  const [detailTerrain, setDetailTerrain] = useState<THREE.Group | null>(null);
  const [detailPhase, setDetailPhase] = useState<TerrainPhase>("idle");
  const [detailError, setDetailError] = useState<string | null>(null);
  const [focusedPlacement, setFocusedPlacement] = useState<MapPlacement | null>(null);

  const geoPhotos = useMemo(() => {
    if (!focusedPlacement) return getGeoPhotos(photos);
    return photos.flatMap((photo, index) => {
      const lat = photo.exifInfo?.latitude;
      const lng = photo.exifInfo?.longitude;
      return [{
        photo,
        index,
        lat: Number.isFinite(lat) ? lat as number : focusedPlacement.lat,
        lng: Number.isFinite(lng) ? lng as number : focusedPlacement.lng,
      }];
    });
  }, [focusedPlacement, photos]);
  const geoPlacements = useMemo(
    () =>
      (focusedPlacement ? [focusedPlacement] : placements)
        .filter((placement) => Number.isFinite(placement.lat) && Number.isFinite(placement.lng))
        .map((placement) => ({ lat: placement.lat, lng: placement.lng })),
    [focusedPlacement, placements]
  );
  const visiblePlacements = useMemo(() => focusedPlacement ? [focusedPlacement] : placements, [focusedPlacement, placements]);
  const request = useMemo(() => {
    if (focusedPlacement) {
      return createFixedTerrainRequest([focusedPlacement.lat, focusedPlacement.lng], 10);
    }
    return createTerrainRequest([...geoPhotos, ...geoPlacements]);
  }, [focusedPlacement, geoPhotos, geoPlacements]);
  const requestKey = useMemo(() => {
    if (!request) return null;
    const mode = focusedPlacement ? `placement:${focusedPlacement.placement_id}` : "regional";
    return [
      mode,
      request.origin[0],
      request.origin[1],
      request.radiusKm,
      request.zoom,
      request.unitsSide,
    ].join(":");
  }, [focusedPlacement, request]);
  const detailRequest = useMemo(() => {
    if (!request || !projection || !detailFocus || detailFocus.distance > DETAIL_TRIGGER_DISTANCE) return null;

    const [lat, lng] = projection.projInv(detailFocus.x, detailFocus.y);
    const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50;
    const visibleRadiusUnits = detailFocus.distance * Math.tan(THREE.MathUtils.degToRad(fov / 2)) * 0.75;
    const radiusKm = clamp(
      visibleRadiusUnits / (projection.unitsPerMeter * 1000),
      DETAIL_MIN_RADIUS_KM,
      Math.min(DETAIL_MAX_RADIUS_KM, request.radiusKm / 2)
    );

    return createTerrainDetailRequest({
      origin: [lat, lng],
      center: [detailFocus.x, detailFocus.y],
      radiusKm,
      baseUnitsPerMeter: projection.unitsPerMeter,
      baseZoom: request.zoom,
    });
  }, [camera, detailFocus, projection, request]);
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
    return visiblePlacements.flatMap((placement) => {
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
  }, [projection, terrain, visiblePlacements]);

  const focusPlacement = useCallback((placement: MapPlacement) => {
    document.body.style.cursor = "";
    resetTerrainCamera(camera, controls);
    setFocusedPlacement(placement);
    setDetailFocus(null);
    setDetailTerrain((previous) => {
      if (previous) disposeObject(previous);
      return null;
    });
    setDetailPhase("idle");
    setDetailError(null);
    setRenderedTerrainKey(null);
    selectPhoto(null);
    void fetchPlacementFocus({
      placementId: placement.placement_id,
      lat: placement.lat,
      lng: placement.lng,
      radiusKm: 10,
    });
  }, [camera, controls, fetchPlacementFocus, selectPhoto]);

  const returnToRegional = useCallback(() => {
    document.body.style.cursor = "";
    setFocusedPlacement(null);
    setDetailFocus(null);
    setDetailTerrain((previous) => {
      if (previous) disposeObject(previous);
      return null;
    });
    setDetailPhase("idle");
    setDetailError(null);
    setRenderedTerrainKey(null);
    selectPhoto(null);
    void fetchPhotos();
  }, [fetchPhotos, selectPhoto]);

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

  useFrame(() => {
    if (!projection || !request) {
      setDetailFocus((current) => (current ? null : current));
      return;
    }

    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    if (Math.abs(direction.z) < 0.001) return;

    const t = -camera.position.z / direction.z;
    if (t <= 0) return;

    const point = camera.position.clone().add(direction.multiplyScalar(t));
    const distance = camera.position.distanceTo(point);
    if (distance > DETAIL_TRIGGER_DISTANCE) {
      setDetailFocus((current) => (current ? null : current));
      return;
    }

    setDetailFocus((current) => {
      if (
        current &&
        Math.hypot(current.x - point.x, current.y - point.y) < 0.55 &&
        Math.abs(current.distance - distance) < 0.7
      ) {
        return current;
      }

      return { x: point.x, y: point.y, distance };
    });
  });

  useEffect(() => {
    if (!request) {
      setTerrain(null);
      setProjection(null);
      setLoading(false);
      setError(null);
      setPhase("idle");
      setRenderedTerrainKey(null);
      return;
    }

    let cancelled = false;
    let renderFrame: number | null = null;
    setLoading(Boolean(MAPBOX_TOKEN));
    setError(null);
    setPhase("projecting");
    setRenderedTerrainKey(null);
    setTerrain((previous) => {
      if (previous) disposeObject(previous);
      return null;
    });
    setProjection(null);

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
          setRenderedTerrainKey(requestKey);
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
          if (!cancelled) {
            setRenderedTerrainKey(requestKey);
            setPhase("ready");
          }
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setTerrain(null);
          setRenderedTerrainKey(null);
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
  }, [requestKey]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
      if (terrain) disposeObject(terrain);
    };
  }, [terrain]);

  useEffect(() => {
    if (!detailRequest || !MAPBOX_TOKEN) {
      setDetailPhase("idle");
      setDetailError(null);
      setDetailTerrain((previous) => {
        if (previous) disposeObject(previous);
        return null;
      });
      return;
    }

    let cancelled = false;
    let renderFrame: number | null = null;
    setDetailPhase("fetching");
    setDetailError(null);

    loadThreeGeo()
      .then((ThreeGeo) => {
        const tgeo = new ThreeGeo({
          tokenMapbox: MAPBOX_TOKEN,
          unitsSide: detailRequest.unitsSide,
        });
        console.info("Artasia terrain detail request", {
          radiusKm: detailRequest.radiusKm,
          zoom: detailRequest.zoom,
          estimatedSatelliteTiles: detailRequest.estimatedSatelliteTiles,
        });
        return tgeo.getTerrainRgb(detailRequest.origin, detailRequest.radiusKm, detailRequest.zoom);
      })
      .then((group) => {
        if (cancelled) {
          disposeObject(group);
          return;
        }
        setDetailPhase("rendering");
        group.name = "artasia-terrain-detail";
        group.position.set(detailRequest.center[0], detailRequest.center[1], 0.025);
        group.scale.z = TERRAIN_ELEVATION_SCALE;
        setDetailTerrain((previous) => {
          if (previous) disposeObject(previous);
          return group;
        });
        renderFrame = window.requestAnimationFrame(() => {
          if (!cancelled) setDetailPhase("ready");
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setDetailTerrain(null);
          setDetailError((err as Error).message);
          setDetailPhase("error");
        }
      });

    return () => {
      cancelled = true;
      if (renderFrame !== null) window.cancelAnimationFrame(renderFrame);
    };
  }, [detailRequest]);

  useEffect(() => {
    return () => {
      if (detailTerrain) disposeObject(detailTerrain);
    };
  }, [detailTerrain]);

  const terrainMatchesRequest = Boolean(request && requestKey && renderedTerrainKey === requestKey);
  const sceneReadyForMarkers = terrainMatchesRequest || phase === "flat";
  const isPreparingTerrain = photos.length === 0 && placements.length === 0 && !placementError;
  const hasNoTerrainLocations = !isPreparingTerrain && geoPhotos.length === 0 && geoPlacements.length === 0;
  const terrainOverlay = useMemo<TerrainOverlayState>(() => {
    if (isPreparingTerrain) {
      return {
        notice: {
          label: galleryLoading ? "Loading gallery" : "Preparing terrain",
        },
      };
    }

    if (hasNoTerrainLocations) {
      return {
        notice: {
          label: placementError ? "Placement locations failed" : "No terrain locations",
          detail: placementError ?? "No GPS photos or placements for terrain mode.",
          tone: placementError ? "error" : "muted",
          busy: false,
        },
      };
    }

    return {
      ...(request
        ? {
            request: {
              zoom: request.zoom,
              estimatedSatelliteTiles: request.estimatedSatelliteTiles,
              radiusKm: request.radiusKm,
            },
            basePhase: phase,
            detail: {
              status: detailStatusLabel(detailRequest, detailPhase, detailError),
              ...(detailRequest ? { zoom: detailRequest.zoom } : {}),
              ...(detailRequest ? { estimatedSatelliteTiles: detailRequest.estimatedSatelliteTiles } : {}),
              ...(detailRequest ? { radiusKm: detailRequest.radiusKm } : {}),
            },
          }
        : {}),
      ...(focusedPlacement ? { focusedPlacement, onBack: returnToRegional } : {}),
      ...(loading || error
        ? {
            notice: {
              label: loading ? "Loading terrain" : "Terrain failed",
              detail: error ?? undefined,
              tone: error ? "error" : "loading",
              busy: loading,
            },
          }
        : {}),
    };
  }, [
    detailError,
    detailPhase,
    detailRequest,
    error,
    focusedPlacement,
    galleryLoading,
    geoPhotos.length,
    geoPlacements.length,
    hasNoTerrainLocations,
    isPreparingTerrain,
    loading,
    phase,
    placementError,
    request,
    returnToRegional,
  ]);

  useEffect(() => {
    onOverlayChange(terrainOverlay);
  }, [onOverlayChange, terrainOverlay]);

  useEffect(() => {
    return () => onOverlayChange(null);
  }, [onOverlayChange]);

  if (isPreparingTerrain || hasNoTerrainLocations) return null;

  return (
    <group>
      {terrain && terrainMatchesRequest && <primitive object={terrain} />}
      {detailTerrain && terrainMatchesRequest && <primitive object={detailTerrain} />}

      {sceneReadyForMarkers && layout.map(({ photo, index, position }) => (
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

      {sceneReadyForMarkers && placementLayout.map(({ placement, position }) => (
        <PlaceMarker
          key={placement.placement_id}
          position={position}
          onClick={focusedPlacement ? undefined : () => focusPlacement(placement)}
        />
      ))}

    </group>
  );
}

export function TerrainOverlay({ state }: { state: TerrainOverlayState | null }) {
  if (!state) return null;

  return (
    <div style={terrainOverlayRootStyle}>
      {state.request && (
        <div style={tileStatusStyle}>
          <div style={tileStatusHeaderStyle}>Terrain tiles</div>
          <div style={tileStatusSubheaderStyle}>Base</div>
          <div style={tileStatusRowStyle}>
            <span>Status</span>
            <strong style={tileStatusValueStyle}>{terrainPhaseLabel(state.basePhase ?? "idle")}</strong>
          </div>
          <div style={tileStatusRowStyle}>
            <span>Resolution</span>
            <strong style={tileStatusValueStyle}>z{state.request.zoom}</strong>
          </div>
          <div style={tileStatusRowStyle}>
            <span>Estimated tiles</span>
            <strong style={tileStatusValueStyle}>{state.request.estimatedSatelliteTiles}</strong>
          </div>
          <div style={tileStatusRowStyle}>
            <span>Radius</span>
            <strong style={tileStatusValueStyle}>{formatRadius(state.request.radiusKm)}</strong>
          </div>
          <div style={tileStatusSubheaderStyle}>Detail</div>
          <div style={tileStatusRowStyle}>
            <span>Status</span>
            <strong style={tileStatusValueStyle}>{state.detail?.status ?? "Inactive"}</strong>
          </div>
          <div style={tileStatusRowStyle}>
            <span>Resolution</span>
            <strong style={tileStatusValueStyle}>{state.detail?.zoom ? `z${state.detail.zoom}` : "-"}</strong>
          </div>
          <div style={tileStatusRowStyle}>
            <span>Estimated tiles</span>
            <strong style={tileStatusValueStyle}>{state.detail?.estimatedSatelliteTiles ?? "-"}</strong>
          </div>
          <div style={tileStatusRowStyle}>
            <span>Radius</span>
            <strong style={tileStatusValueStyle}>{state.detail?.radiusKm ? formatRadius(state.detail.radiusKm) : "-"}</strong>
          </div>
        </div>
      )}
      {state.focusedPlacement && state.onBack && (
        <>
          <button type="button" onClick={state.onBack} style={backButtonStyle}>
            Back to regional view
          </button>
          <FocusedPlacementOverlay placement={state.focusedPlacement} />
        </>
      )}
      {state.notice && <LoadingIndicator {...state.notice} />}
    </div>
  );
}

function resetTerrainCamera(camera: THREE.Camera, controls?: TerrainOrbitControls) {
  camera.position.set(0, 0, 16);
  camera.up.set(0, 1, 0);
  camera.lookAt(0, 0, 0);
  controls?.target?.set(0, 0, 0);
  controls?.update?.();
}

function FocusedPlacementOverlay({ placement }: { placement: MapPlacement }) {
  const people = [placement.team_member, placement.secondary_team_member].filter(
    (person): person is NonNullable<MapPlacement["team_member"]> => Boolean(person?.name)
  );
  const participantDetails = formatParticipantDetails(placement);
  const peopleLabel = people.length > 1 ? "Artist Educators" : "Artist Educator";
  const siteDetails = formatSiteDetails(placement);

  return (
    <section style={siteDetailsStyle} aria-label="Placement details">
      <div style={siteDetailsHeaderStyle}>
        {placement.partner_logo?.url && (
          <img
            src={placement.partner_logo.url}
            alt={placement.partner_logo.alt || placement.partner_name || "Partner logo"}
            style={partnerLogoStyle}
          />
        )}
        <div>
          <div style={sitePartnerStyle}>{placement.partner_name || "Partner organization"}</div>
          <div style={siteNameStyle}>{placement.placement_name}</div>
        </div>
      </div>

      <div style={siteDetailsGridStyle}>
        <SiteDetail label="Site" value={siteDetails || "Not specified"} />
        <SiteDetail label={peopleLabel} value={people.map((person) => person.name).join(", ") || "Unassigned"} />
        <SiteDetail label="Children" value={participantDetails || "Not specified"} />
      </div>
    </section>
  );
}

function formatSiteDetails(placement: MapPlacement) {
  const details = [
    placement.place_name?.trim(),
    placement.place_city?.trim(),
  ].filter(Boolean);

  return details.join(", ") || placement.address || "";
}

function formatParticipantDetails(placement: MapPlacement) {
  const details: string[] = [];
  if (placement.participant_count != null) details.push(String(placement.participant_count));

  const ageRange = placement.participant_age?.trim();
  if (ageRange) {
    details.push(/\d/.test(ageRange) ? `age ${ageRange}` : ageRange);
  }

  return details.join(", ");
}

function SiteDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={siteDetailLabelStyle}>{label}</div>
      <div style={siteDetailValueStyle}>{value}</div>
    </div>
  );
}

const terrainOverlayRootStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 12,
  pointerEvents: "none",
};

const backButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 56,
  left: 16,
  pointerEvents: "auto",
  background: "rgba(255,255,255,0.08)",
  color: "#ddd",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 4,
  padding: "7px 12px",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: 12,
};

const siteDetailsStyle: React.CSSProperties = {
  position: "absolute",
  top: 96,
  left: 16,
  width: 300,
  maxWidth: "calc(100vw - 32px)",
  pointerEvents: "none",
  background: "rgba(10,10,20,0.82)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 6,
  padding: "12px",
  color: "#d8dde7",
  fontFamily: "monospace",
  boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
};

const siteDetailsHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  paddingBottom: 10,
  borderBottom: "1px solid rgba(255,255,255,0.12)",
};

const partnerLogoStyle: React.CSSProperties = {
  flex: "0 0 auto",
  width: 54,
  height: 40,
  objectFit: "contain",
  background: "rgba(255,255,255,0.9)",
  borderRadius: 4,
  padding: 5,
};

const sitePartnerStyle: React.CSSProperties = {
  color: "#f4f7fb",
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1.25,
};

const siteNameStyle: React.CSSProperties = {
  color: "#aeb7c6",
  fontSize: 11,
  lineHeight: 1.35,
  marginTop: 3,
};

const siteDetailsGridStyle: React.CSSProperties = {
  display: "grid",
  gap: 9,
  paddingTop: 10,
};

const siteDetailLabelStyle: React.CSSProperties = {
  color: "#8490a3",
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 0,
  marginBottom: 3,
};

const siteDetailValueStyle: React.CSSProperties = {
  color: "#eef2f8",
  fontSize: 12,
  lineHeight: 1.35,
  overflowWrap: "anywhere",
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

const tileStatusSubheaderStyle: React.CSSProperties = {
  color: "#d7dce5",
  fontSize: 11,
  margin: "8px 0 3px",
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

function detailStatusLabel(
  request: TerrainDetailRequest | null,
  phase: TerrainPhase,
  error: string | null
) {
  if (error) return "Error";
  if (!request) return "Inactive";
  return terrainPhaseLabel(phase);
}

function formatRadius(radiusKm: number) {
  return `${radiusKm.toFixed(radiusKm >= 10 ? 0 : 1)} km`;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
