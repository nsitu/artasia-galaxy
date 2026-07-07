import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { MapControls, Preload } from "@react-three/drei";
import * as THREE from "three";
import type { MapPlacement } from "../../api/client";
import { useGalleryStore } from "../../stores/galleryStore";
import LoadingIndicator from "../ui/LoadingIndicator";
import TerrainGallery, {
  FocusedPlacementOverlay,
  type PartnerFilterOption,
  PlacementHoverLabel,
  type TerrainNotice,
} from "./TerrainGallery";

const DEFAULT_TERRAIN_CAMERA_POSITION: [number, number, number] = [0, -12, 10];
const TERRAIN_MAP_HEADING = 0;
const TERRAIN_MIN_TILT = 2.1;
const TERRAIN_MAX_TILT = 2.75;
const TERRAIN_MAP_MOUSE_BUTTONS = {
  LEFT: THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.PAN,
};
const TERRAIN_GROUND_PLANE_NORMAL = new THREE.Vector3(0, 0, 1);
const TERRAIN_GL_OPTIONS = {
  antialias: false,
  powerPreference: "default" as WebGLPowerPreference,
  failIfMajorPerformanceCaveat: false,
};

type TerrainMapControls = {
  target: THREE.Vector3;
  update?: () => void;
};

export default function ArtScene() {
  const fetchPhotos = useGalleryStore((s) => s.fetchPhotos);
  const photos = useGalleryStore((s) => s.photos);
  const selectedPhotoIndex = useGalleryStore((s) => s.selectedPhotoIndex);
  const selectPhoto = useGalleryStore((s) => s.selectPhoto);
  const error = useGalleryStore((s) => s.error);
  const [terrainNotice, setTerrainNotice] = useState<TerrainNotice | null>(null);
  const [backAction, setBackAction] = useState<(() => void) | null>(null);
  const [focusedPlacementDetails, setFocusedPlacementDetails] = useState<MapPlacement | null>(null);
  const [hoveredPlacementDetails, setHoveredPlacementDetails] = useState<MapPlacement | null>(null);
  const [partnerFilterOptions, setPartnerFilterOptions] = useState<PartnerFilterOption[]>([]);
  const [selectedPartnerFilter, setSelectedPartnerFilter] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [webglError, setWebglError] = useState<string | null>(() => getWebGL2SupportError());
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  useEffect(() => {
    function onDocumentPointerDown(event: PointerEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", onDocumentPointerDown);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown);
  }, []);

  const menuItems = useMemo(
    () => [
      { href: "/admin", label: "Admin" },
      { href: "/partners", label: "Partners" },
    ],
    []
  );

  const selectedPhoto = selectedPhotoIndex !== null ? photos[selectedPhotoIndex] : null;
  const selectedDescription = selectedPhoto?.exifInfo?.description?.trim();
  const handleBackActionChange = useCallback((action: (() => void) | null) => {
    setBackAction(action ? () => action : null);
  }, []);

  useEffect(() => {
    if (!selectedPartnerFilter) return;
    if (!partnerFilterOptions.some((option) => option.value === selectedPartnerFilter)) {
      setSelectedPartnerFilter("");
    }
  }, [partnerFilterOptions, selectedPartnerFilter]);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <div style={hudStyle}>
        <div ref={menuRef} style={menuWrapStyle}>
          <button
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((current) => !current)}
            style={menuButtonStyle}
          >
            <span style={menuIconStyle}>
              <span style={menuLineStyle} />
              <span style={menuLineStyle} />
              <span style={menuLineStyle} />
            </span>
          </button>

          {menuOpen && (
            <div role="menu" style={menuPanelStyle}>
              {menuItems.map((item) => (
                <a
                  key={item.href}
                  role="menuitem"
                  href={item.href}
                  style={menuItemStyle}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </a>
              ))}
            </div>
          )}
        </div>
      </div>

      <a href="/" aria-label="Artasia home" style={homeLogoLinkStyle}>
        <img src="/artasia.svg" alt="" style={homeLogoImageStyle} />
      </a>

      {backAction && (
        <button
          type="button"
          aria-label="Back to regional view"
          onClick={backAction}
          style={backButtonStyle}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" style={backChevronStyle}>
            <path d="M10.5 2.5 5 8l5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Back</span>
        </button>
      )}

      {!focusedPlacementDetails && partnerFilterOptions.length > 0 && (
        <label style={partnerFilterStyle}>
          <select
            aria-label="Filter placements by partner"
            value={selectedPartnerFilter}
            onChange={(event) => setSelectedPartnerFilter(event.target.value)}
            style={partnerFilterSelectStyle}
          >
            <option value="" style={partnerFilterOptionStyle}>All partners</option>
            {partnerFilterOptions.map((option) => (
              <option key={option.value} value={option.value} style={partnerFilterOptionStyle}>
                {option.label} ({option.count})
              </option>
            ))}
          </select>
        </label>
      )}

      {error && <div style={errorStyle}>{error}</div>}
      {terrainNotice && <LoadingIndicator {...terrainNotice} />}
      {focusedPlacementDetails && <FocusedPlacementOverlay placement={focusedPlacementDetails} />}
      {!focusedPlacementDetails && hoveredPlacementDetails && (
        <PlacementHoverLabel placement={hoveredPlacementDetails} />
      )}

      {selectedPhoto && (
        <div
          style={photoLightboxStyle}
          role="dialog"
          aria-modal="true"
          aria-label={selectedPhoto.fileName}
          onClick={() => selectPhoto(null)}
        >
          <img
            src={selectedPhoto.previewUrl}
            alt={selectedPhoto.fileName}
            style={photoLightboxImageStyle}
            onClick={(event) => event.stopPropagation()}
          />
          <div style={photoLightboxMetadataStyle} onClick={(event) => event.stopPropagation()}>
            <div style={photoLightboxTitleStyle}>{selectedPhoto.fileName}</div>
            <div style={photoLightboxDescriptionStyle}>
              {selectedDescription || "No description metadata."}
            </div>
          </div>
          <button
            onClick={() => selectPhoto(null)}
            aria-label="Close photo"
            style={photoLightboxCloseStyle}
          >
            x
          </button>
        </div>
      )}

      {webglError ? (
        <WebGLFallback message={webglError} />
      ) : (
        <Canvas
          camera={{ position: DEFAULT_TERRAIN_CAMERA_POSITION, fov: 50 }}
          dpr={[1, 1]}
          gl={TERRAIN_GL_OPTIONS}
          onCreated={({ camera, gl }) => {
            camera.up.set(0, 1, 0);
            camera.lookAt(0, 0, 0);
            gl.domElement.addEventListener("webglcontextlost", () => {
              setWebglError("The 3D map lost its WebGL context. Reload this page, or try a newer iPad/browser if the issue repeats.");
            });
          }}
          onError={(error) => {
            setWebglError(error instanceof Error ? error.message : "The 3D map could not start WebGL.");
          }}
          style={{ background: "#0a0a14" }}
        >
          <ambientLight intensity={0.8} />
          <Suspense fallback={null}>
            <TerrainGallery
              onNoticeChange={setTerrainNotice}
              onBackActionChange={handleBackActionChange}
              onFocusedPlacementChange={setFocusedPlacementDetails}
              onHoveredPlacementChange={setHoveredPlacementDetails}
              onPartnerFilterOptionsChange={setPartnerFilterOptions}
              selectedPartnerFilter={selectedPartnerFilter}
            />
            <MapControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              enablePan={false}
              enableZoom
              enableRotate
              minDistance={1.5}
              maxDistance={80}
              minPolarAngle={TERRAIN_MIN_TILT}
              maxPolarAngle={TERRAIN_MAX_TILT}
              minAzimuthAngle={TERRAIN_MAP_HEADING}
              maxAzimuthAngle={TERRAIN_MAP_HEADING}
              mouseButtons={TERRAIN_MAP_MOUSE_BUTTONS}
            />
            <GroundPlanePanControls />
            <Preload all />
          </Suspense>
        </Canvas>
      )}
    </div>
  );
}

function getWebGL2SupportError() {
  if (typeof document === "undefined") return null;

  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2", TERRAIN_GL_OPTIONS) as WebGL2RenderingContext | null;
  if (!gl) {
    return "This 3D map requires WebGL 2. Safari on this iPad could not create a WebGL 2 context.";
  }

  gl.getExtension("WEBGL_lose_context")?.loseContext();
  return null;
}

function WebGLFallback({ message }: { message: string }) {
  return (
    <div style={webglFallbackStyle} role="status">
      <img src="/artasia.svg" alt="" style={webglFallbackLogoStyle} />
      <div style={webglFallbackTitleStyle}>3D map unavailable</div>
      <div style={webglFallbackMessageStyle}>{message}</div>
    </div>
  );
}

function GroundPlanePanControls() {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const controls = useThree((state) => (state as unknown as { controls?: TerrainMapControls }).controls);

  useEffect(() => {
    if (!controls?.target) return;

    const element = gl.domElement;
    const terrainControls = controls;
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    const dragPlane = new THREE.Plane(TERRAIN_GROUND_PLANE_NORMAL, -terrainControls.target.z);
    const activePointers = new Map<number, PointerEvent>();
    const dragAnchor = new THREE.Vector3();
    const dragPoint = new THREE.Vector3();
    let activePointerId: number | null = null;

    function intersectGroundPlane(event: PointerEvent, target: THREE.Vector3) {
      const rect = element.getBoundingClientRect();
      pointerNdc.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      );
      dragPlane.constant = -terrainControls.target.z;
      raycaster.setFromCamera(pointerNdc, camera);
      return raycaster.ray.intersectPlane(dragPlane, target);
    }

    function canStartPan(event: PointerEvent) {
      if (event.ctrlKey || event.metaKey || event.shiftKey) return false;
      if (event.pointerType === "mouse") return event.button === 0 || event.button === 2;
      return event.isPrimary;
    }

    function stopPan(event?: PointerEvent) {
      if (activePointerId !== null && element.hasPointerCapture?.(activePointerId)) {
        element.releasePointerCapture(activePointerId);
      }
      activePointerId = null;
      if (event) activePointers.delete(event.pointerId);
    }

    function onPointerDown(event: PointerEvent) {
      activePointers.set(event.pointerId, event);

      if (activePointerId !== null || activePointers.size !== 1 || !canStartPan(event)) {
        stopPan();
        return;
      }

      const point = intersectGroundPlane(event, dragAnchor);
      if (!point) return;
      activePointerId = event.pointerId;
      element.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    }

    function onPointerMove(event: PointerEvent) {
      activePointers.set(event.pointerId, event);
      if (activePointerId !== event.pointerId) return;

      if (activePointers.size !== 1) {
        stopPan(event);
        return;
      }

      const point = intersectGroundPlane(event, dragPoint);
      if (!point) return;

      const delta = dragAnchor.clone().sub(dragPoint);
      camera.position.add(delta);
      terrainControls.target.add(delta);
      terrainControls.update?.();
      event.preventDefault();
    }

    function onPointerUp(event: PointerEvent) {
      if (activePointerId === event.pointerId) stopPan(event);
      else activePointers.delete(event.pointerId);
    }

    function onContextMenu(event: MouseEvent) {
      event.preventDefault();
    }

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerUp);
    element.addEventListener("contextmenu", onContextMenu);

    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.removeEventListener("contextmenu", onContextMenu);
    };
  }, [camera, controls, gl]);

  return null;
}

const hudStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 10,
  display: "flex",
  justifyContent: "flex-end",
  padding: "12px 16px",
  fontFamily: "monospace",
  fontSize: 13,
  color: "#aaa",
  pointerEvents: "none",
};

const webglFallbackStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 12,
  padding: 24,
  color: "#eef2f8",
  background: "#0a0a14",
  textAlign: "center",
  fontFamily: "monospace",
};

const webglFallbackLogoStyle: React.CSSProperties = {
  width: 72,
  height: "auto",
  marginBottom: 4,
};

const webglFallbackTitleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
};

const webglFallbackMessageStyle: React.CSSProperties = {
  maxWidth: 420,
  color: "#aeb7c6",
  fontSize: 13,
  lineHeight: 1.5,
};

const menuWrapStyle: React.CSSProperties = {
  position: "relative",
  pointerEvents: "auto",
};

const menuButtonStyle: React.CSSProperties = {
  pointerEvents: "auto",
  width: 40,
  height: 40,
  display: "grid",
  placeItems: "center",
  background: "rgba(255,255,255,0.08)",
  color: "#ccc",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 10,
  cursor: "pointer",
};

const menuIconStyle: React.CSSProperties = {
  display: "grid",
  gap: 3,
  width: 16,
};

const menuLineStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: 2,
  borderRadius: 999,
  background: "currentColor",
};

const menuPanelStyle: React.CSSProperties = {
  position: "absolute",
  top: 48,
  right: 0,
  minWidth: 152,
  padding: 8,
  borderRadius: 12,
  background: "rgba(12, 14, 22, 0.94)",
  border: "1px solid rgba(255,255,255,0.14)",
  boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
  display: "grid",
  gap: 6,
  zIndex: 20,
};

const menuItemStyle: React.CSSProperties = {
  display: "block",
  padding: "10px 12px",
  borderRadius: 8,
  textDecoration: "none",
  color: "#eef3fb",
  fontSize: 13,
  fontFamily: "monospace",
  background: "rgba(255,255,255,0.03)",
};

const backButtonStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  left: 178,
  zIndex: 15,
  pointerEvents: "auto",
  minHeight: 40,
  padding: "0 12px 0 10px",
  borderRadius: 999,
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "rgba(10,10,20,0.82)",
  color: "#eef2f8",
  border: "1px solid rgba(255,255,255,0.18)",
  boxShadow: "0 10px 26px rgba(0,0,0,0.28)",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: 12,
};

const backChevronStyle: React.CSSProperties = {
  width: 14,
  height: 14,
};

const homeLogoLinkStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  left: 16,
  zIndex: 16,
  width: 150,
  height: 50,
  display: "grid",
  placeItems: "center",
  pointerEvents: "auto",
};

const homeLogoImageStyle: React.CSSProperties = {
  width: 144,
  height: 48,
  objectFit: "contain",
  display: "block",
};

const partnerFilterStyle: React.CSSProperties = {
  position: "absolute",
  top: 22,
  left: 178,
  zIndex: 12,
  pointerEvents: "auto",
};

const partnerFilterSelectStyle: React.CSSProperties = {
  maxWidth: "min(320px, calc(100vw - 96px))",
  background: "rgba(12,14,22,0.92)",
  color: "#f4f7fb",
  border: "none",
  borderRadius: 6,
  padding: "7px 9px",
  fontFamily: "monospace",
  fontSize: 12,
  outline: "none",
  boxShadow: "none",
};

const partnerFilterOptionStyle: React.CSSProperties = {
  background: "#121620",
  color: "#f4f7fb",
};

const btnStyle: React.CSSProperties = {
  pointerEvents: "auto",
  background: "rgba(255,255,255,0.08)",
  color: "#ccc",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 4,
  padding: "4px 12px",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "monospace",
  textDecoration: "none",
};

const errorStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 20,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 10,
  color: "#f66",
  fontFamily: "monospace",
  fontSize: 13,
  background: "rgba(0,0,0,0.7)",
  padding: "8px 16px",
  borderRadius: 4,
};

const photoLightboxStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 30,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  background: "rgba(3,3,8,0.88)",
  cursor: "zoom-out",
};

const photoLightboxImageStyle: React.CSSProperties = {
  maxWidth: "calc(100vw - 48px)",
  maxHeight: "calc(100vh - 48px)",
  objectFit: "contain",
  boxShadow: "0 18px 60px rgba(0,0,0,0.5)",
  cursor: "default",
};

const photoLightboxMetadataStyle: React.CSSProperties = {
  position: "absolute",
  left: 24,
  bottom: 24,
  width: "min(520px, calc(100vw - 48px))",
  maxHeight: "28vh",
  overflowY: "auto",
  background: "rgba(10,10,20,0.86)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 6,
  padding: "12px 14px",
  color: "#ddd",
  fontFamily: "monospace",
  fontSize: 13,
  lineHeight: 1.45,
  cursor: "default",
};

const photoLightboxTitleStyle: React.CSSProperties = {
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  marginBottom: 6,
  overflowWrap: "anywhere",
};

const photoLightboxDescriptionStyle: React.CSSProperties = {
  color: "#c7ccd6",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const photoLightboxCloseStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  background: "rgba(245,247,251,0.94)",
  border: "1px solid rgba(0,0,0,0.28)",
  borderRadius: 999,
  color: "#10131c",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: 24,
  fontWeight: 700,
  lineHeight: 1,
  width: 46,
  height: 46,
  boxShadow: "0 10px 32px rgba(0,0,0,0.36)",
};
