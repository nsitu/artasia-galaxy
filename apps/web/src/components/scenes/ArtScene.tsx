import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { MapControls, Preload } from "@react-three/drei";
import * as THREE from "three";
import { fetchAuthUser, fetchUploadOptions, type ActivityOption, type AuthUser, type MapPlacement } from "../../api/client";
import { useGalleryStore } from "../../stores/galleryStore";
import LoadingIndicator from "../ui/LoadingIndicator";
import WelcomeOverlay from "../ui/WelcomeOverlay";
import { loadMaterialSymbols } from "../../modules/iconLoader";
import TerrainGallery, {
  FocusedPlacementOverlay,
  type PartnerFilterOption,
  PlacementHoverLabel,
  PlacementPreviewPanel,
  type TerrainNotice,
} from "./TerrainGallery";

const DEFAULT_TERRAIN_CAMERA_POSITION: [number, number, number] = [0, -12, 10];
const TERRAIN_MAP_HEADING = 0;
const TERRAIN_MIN_TILT = 2.1;
const TERRAIN_MAX_TILT = 2.75;
const TERRAIN_MAP_MOUSE_BUTTONS = {
  LEFT: THREE.MOUSE.PAN,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE,
};
const TERRAIN_GROUND_PLANE_NORMAL = new THREE.Vector3(0, 0, 1);
const TERRAIN_GL_OPTIONS = {
  antialias: false,
  powerPreference: "default" as WebGLPowerPreference,
  failIfMajorPerformanceCaveat: false,
};
type IntroPhase = "loading" | "ready" | "exiting" | "complete";
const PARTNER_PATH_PREFIX = "/partners/";

function getContrastingTextColour(backgroundColour: string): string | undefined {
  const hex = backgroundColour.trim().replace(/^#/, "");
  const expandedHex = /^[0-9a-f]{3}$/i.test(hex)
    ? hex.split("").map((character) => character.repeat(2)).join("")
    : hex;

  if (!/^[0-9a-f]{6}$/i.test(expandedHex)) return undefined;

  const [red, green, blue] = [0, 2, 4].map((offset) => {
    const channel = Number.parseInt(expandedHex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045
      ? channel / 12.92
      : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
  const whiteContrast = 1.05 / (luminance + 0.05);
  const blackContrast = (luminance + 0.05) / 0.05;

  return whiteContrast >= blackContrast ? "#fff" : "#000";
}

function getActivityColourStyle(colour?: string): React.CSSProperties {
  if (!colour?.trim()) return {};

  const textColour = getContrastingTextColour(colour);
  return {
    backgroundColor: colour,
    ...(textColour ? { color: textColour } : {}),
  };
}

type TerrainMapControls = {
  target: THREE.Vector3;
  update?: () => void;
};

export default function ArtScene() {
  const [showWelcomeIntro] = useState(() => window.location.pathname === "/");
  const [introPhase, setIntroPhase] = useState<IntroPhase>(() =>
    showWelcomeIntro ? "loading" : "complete",
  );
  const fetchPhotos = useGalleryStore((s) => s.fetchPhotos);
  const photos = useGalleryStore((s) => s.photos);
  const selectedPhotoIndex = useGalleryStore((s) => s.selectedPhotoIndex);
  const selectPhoto = useGalleryStore((s) => s.selectPhoto);
  const error = useGalleryStore((s) => s.error);
  const [terrainNotice, setTerrainNotice] = useState<TerrainNotice | null>(null);
  const [backAction, setBackAction] = useState<(() => void) | null>(null);
  const [focusedPlacementDetails, setFocusedPlacementDetails] = useState<MapPlacement | null>(null);
  const [hoveredPlacementDetails, setHoveredPlacementDetails] = useState<MapPlacement | null>(null);
  const [previewPlacementDetails, setPreviewPlacementDetails] = useState<MapPlacement | null>(null);
  const [previewPlacementAction, setPreviewPlacementAction] = useState<(() => void) | null>(null);
  const [partnerFilterOptions, setPartnerFilterOptions] = useState<PartnerFilterOption[]>([]);
  const [selectedPartnerFilter, setSelectedPartnerFilter] = useState("");
  const [requestedPartnerSlug, setRequestedPartnerSlug] = useState(() =>
    getPartnerSlugFromPath(window.location.pathname),
  );
  const [activityFilterOptions, setActivityFilterOptions] = useState<ActivityOption[]>([]);
  const [selectedActivityFilter, setSelectedActivityFilter] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [webglError, setWebglError] = useState<string | null>(() => getWebGL2SupportError());
  const menuRef = useRef<HTMLDivElement | null>(null);
  const linkedAudioRef = useRef<HTMLAudioElement | null>(null);
  const [linkedAudioPlaying, setLinkedAudioPlaying] = useState(false);

  const handleIntroReady = useCallback(() => {
    setIntroPhase((current) => current === "loading" ? "ready" : current);
  }, []);

  const handleStartExploring = useCallback(() => {
    if (!showWelcomeIntro || introPhase !== "ready") return;
    setIntroPhase("exiting");
  }, [introPhase, showWelcomeIntro]);

  const handleIntroComplete = useCallback(() => {
    setIntroPhase((current) => current === "exiting" ? "complete" : current);
  }, []);

  useEffect(() => {
    if (window.location.pathname.startsWith("/sites/")) return;
    fetchPhotos();
  }, [fetchPhotos]);

  useEffect(() => {
    const assignedIconNames = photos.flatMap((photo) =>
      photo.iconName ? [photo.iconName] : [],
    );
    if (assignedIconNames.length > 0) {
      void loadMaterialSymbols(assignedIconNames).catch((iconError) => {
        console.warn(`[viewer-icons] ${(iconError as Error).message}`);
      });
    }
  }, [photos]);

  useEffect(() => {
    let cancelled = false;
    fetchAuthUser()
      .then((user) => {
        if (!cancelled) setAuthUser(user);
      })
      .catch(() => {
        if (!cancelled) setAuthUser({ authenticated: false });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchUploadOptions()
      .then((options) => {
        if (!cancelled) setActivityFilterOptions(options.activities);
      })
      .catch((err) => {
        console.warn(`[viewer] failed to load activity filters: ${(err as Error).message}`);
        if (!cancelled) setActivityFilterOptions([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

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
  const selectedActivityColour =
    activityFilterOptions.find(
      (activity) => String(activity.id) === selectedActivityFilter,
    )?.colour;

  useEffect(() => {
    const audio = linkedAudioRef.current;
    return () => {
      audio?.pause();
      setLinkedAudioPlaying(false);
    };
  }, [selectedPhoto?.id, selectedPhoto?.linkedAudioUrl]);

  const toggleLinkedAudio = useCallback(() => {
    const audio = linkedAudioRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play()
        .then(() => setLinkedAudioPlaying(true))
        .catch((playError) => {
          console.warn(
            `[viewer-audio] ${(playError as Error).message}`,
          );
          setLinkedAudioPlaying(false);
        });
    } else {
      audio.pause();
      setLinkedAudioPlaying(false);
    }
  }, []);
  const handleBackActionChange = useCallback((action: (() => void) | null) => {
    setBackAction(action ? () => action : null);
  }, []);
  const handlePreviewPlacementChange = useCallback((placement: MapPlacement | null, action?: (() => void) | null) => {
    setPreviewPlacementDetails(placement);
    setPreviewPlacementAction(action ? () => action : null);
  }, []);

  useEffect(() => {
    if (!selectedPartnerFilter) return;
    if (!partnerFilterOptions.some((option) => option.value === selectedPartnerFilter)) {
      setSelectedPartnerFilter("");
    }
  }, [partnerFilterOptions, selectedPartnerFilter]);

  useEffect(() => {
    const onPopState = () => {
      setRequestedPartnerSlug(
        getPartnerSlugFromPath(window.location.pathname),
      );
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (partnerFilterOptions.length === 0) return;
    if (!requestedPartnerSlug) {
      setSelectedPartnerFilter("");
      return;
    }

    const partner = partnerFilterOptions.find(
      (option) =>
        normalizePartnerSlug(slugifyPartnerName(option.value)) ===
        normalizePartnerSlug(requestedPartnerSlug),
    );
    setSelectedPartnerFilter(partner?.value ?? "");
  }, [partnerFilterOptions, requestedPartnerSlug]);

  useEffect(() => {
    if (!selectedActivityFilter) return;
    if (!activityFilterOptions.some((option) => String(option.id) === selectedActivityFilter)) {
      setSelectedActivityFilter("");
    }
  }, [activityFilterOptions, selectedActivityFilter]);

  useEffect(() => {
    if (!focusedPlacementDetails) setSelectedActivityFilter("");
  }, [focusedPlacementDetails]);

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <div style={topNavStyle}>
        <div style={homeBrandStyle}>
          <a href="/" aria-label="Artasia home" style={homeLogoLinkStyle}>
            <img src="/artasia-atlas.svg" alt="Artasia Atlas" style={homeLogoImageStyle} />
          </a>
          <div style={homePartnerLogoRowStyle} aria-label="Artasia partners">
            <img src="/spider.png" alt="Spider" style={homeSpiderLogoStyle} />
          </div>
        </div>

        <div style={topControlGroupStyle}>
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
            <label style={filterControlStyle}>
              <select
                aria-label="Filter placements by partner"
                value={selectedPartnerFilter}
                onChange={(event) => {
                  const partner = event.target.value;
                  setSelectedPartnerFilter(partner);
                  updatePartnerPath(partner);
                }}
                style={filterSelectStyle}
              >
                <option value="" style={filterOptionStyle}>All partners</option>
                {partnerFilterOptions.map((option) => (
                  <option key={option.value} value={option.value} style={filterOptionStyle}>
                    {option.label} ({option.count})
                  </option>
                ))}
              </select>
            </label>
          )}

          {focusedPlacementDetails && activityFilterOptions.length > 0 && (
            <label style={filterControlStyle}>
              <select
                aria-label="Filter photos by activity"
                value={selectedActivityFilter}
                onChange={(event) => setSelectedActivityFilter(event.target.value)}
                style={{
                  ...filterSelectStyle,
                  width: "auto",
                  ...getActivityColourStyle(selectedActivityColour),
                }}
              >
                <option value="" style={filterOptionStyle}>All Activities</option>
                {activityFilterOptions.map((option) => (
                  <option
                    key={option.id}
                    value={String(option.id)}
                    style={{
                      ...filterOptionStyle,
                      ...getActivityColourStyle(option.colour),
                    }}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

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

      {error && <div style={errorStyle}>{error}</div>}
      <div style={buildStampStyle}>{__ARTASIA_BUILD_LABEL__}</div>
      {terrainNotice && <LoadingIndicator {...terrainNotice} />}
      {focusedPlacementDetails && (
        <FocusedPlacementOverlay
          placement={focusedPlacementDetails}
          adminHref={
            authUser?.authenticated
              ? `/admin/browse?site=${encodeURIComponent(String(focusedPlacementDetails.placement_id))}`
              : undefined
          }
        />
      )}
      {!focusedPlacementDetails && previewPlacementDetails && previewPlacementAction && (
        <PlacementPreviewPanel placement={previewPlacementDetails} onOpen={previewPlacementAction} />
      )}
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
          {selectedPhoto.mediaKind === "video" && selectedPhoto.videoUrl ? (
            <video
              src={selectedPhoto.videoUrl}
              poster={selectedPhoto.previewUrl}
              controls
              autoPlay
              playsInline
              preload="metadata"
              aria-label={selectedPhoto.fileName}
              style={photoLightboxImageStyle}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <img
              src={selectedPhoto.previewUrl}
              alt={selectedPhoto.fileName}
              style={{ ...photoLightboxImageStyle, ...photoAdjustmentFilterStyle(selectedPhoto.adjustments) }}
              onClick={(event) => event.stopPropagation()}
            />
          )}
          <div style={photoLightboxMetadataStyle} onClick={(event) => event.stopPropagation()}>
            <div style={photoLightboxTitleStyle}>{selectedPhoto.fileName}</div>
            {selectedDescription && (
              <div style={photoLightboxDescriptionStyle}>
                {selectedDescription}
              </div>
            )}
            {selectedPhoto.linkedAudioUrl && (
              <div style={photoLightboxAudioStyle}>
                <audio
                  ref={linkedAudioRef}
                  src={selectedPhoto.linkedAudioUrl}
                  preload="metadata"
                  onEnded={() => setLinkedAudioPlaying(false)}
                  onPause={() => setLinkedAudioPlaying(false)}
                  onPlay={() => setLinkedAudioPlaying(true)}
                />
                <button
                  type="button"
                  onClick={toggleLinkedAudio}
                  style={photoLightboxAudioButtonStyle}
                  aria-label={
                    linkedAudioPlaying
                      ? "Pause linked sound"
                      : "Play linked sound"
                  }
                >
                  <span aria-hidden="true">
                    {linkedAudioPlaying ? "Ⅱ" : "▶"}
                  </span>
                  {linkedAudioPlaying ? "Pause sound" : "Play sound"}
                </button>
              </div>
            )}
            {authUser?.authenticated && (
              <a
                href={`/edit/${selectedPhoto.id}`}
                style={photoLightboxEditLinkStyle}
                onClick={(event) => event.stopPropagation()}
              >
                Edit
              </a>
            )}
          </div>
          <button
            type="button"
            onClick={() => selectPhoto(null)}
            aria-label="Close photo"
            style={photoLightboxCloseStyle}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" style={photoLightboxCloseIconStyle}>
              <path
                d="m3.5 3.5 9 9m0-9-9 9"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
              />
            </svg>
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
              introEnabled={showWelcomeIntro}
              introPhase={introPhase}
              onIntroReady={handleIntroReady}
              onIntroComplete={handleIntroComplete}
              onNoticeChange={setTerrainNotice}
              onBackActionChange={handleBackActionChange}
              onFocusedPlacementChange={setFocusedPlacementDetails}
              onHoveredPlacementChange={setHoveredPlacementDetails}
              onPreviewPlacementChange={handlePreviewPlacementChange}
              onPartnerFilterOptionsChange={setPartnerFilterOptions}
              selectedPartnerFilter={selectedPartnerFilter}
              selectedActivityFilter={selectedActivityFilter}
              selectedActivityColour={selectedActivityColour}
            />
            <MapControls
              makeDefault
              enabled={!showWelcomeIntro || introPhase === "complete"}
              enableDamping
              dampingFactor={0.08}
              enablePan={false}
              enableZoom={!showWelcomeIntro || introPhase === "complete"}
              enableRotate={!showWelcomeIntro || introPhase === "complete"}
              minDistance={1.5}
              maxDistance={80}
              minPolarAngle={TERRAIN_MIN_TILT}
              maxPolarAngle={TERRAIN_MAX_TILT}
              minAzimuthAngle={TERRAIN_MAP_HEADING}
              maxAzimuthAngle={TERRAIN_MAP_HEADING}
              mouseButtons={TERRAIN_MAP_MOUSE_BUTTONS}
            />
            <GroundPlanePanControls
              enabled={
                !showWelcomeIntro ||
                introPhase === "exiting" ||
                introPhase === "complete"
              }
            />
            <Preload all />
          </Suspense>
        </Canvas>
      )}

      {showWelcomeIntro && introPhase !== "complete" && (
        <WelcomeOverlay
          exiting={introPhase === "exiting"}
          ready={introPhase === "ready"}
          onStart={handleStartExploring}
        />
      )}
    </div>
  );
}

function photoAdjustmentFilterStyle(adjustments?: { brightness?: number; contrast?: number; saturation?: number }): React.CSSProperties {
  const brightness = adjustmentPercent(adjustments?.brightness);
  const contrast = adjustmentPercent(adjustments?.contrast);
  const saturation = adjustmentPercent(adjustments?.saturation);
  return {
    filter: `brightness(${brightness / 100}) contrast(${contrast / 100}) saturate(${saturation / 100})`,
  };
}

function adjustmentPercent(value?: number) {
  if (!Number.isFinite(value)) return 100;
  return Math.max(50, Math.min(150, Math.round(value as number)));
}

function getPartnerSlugFromPath(pathname: string) {
  if (!pathname.startsWith(PARTNER_PATH_PREFIX)) return null;
  const slug = pathname.slice(PARTNER_PATH_PREFIX.length).split("/")[0] ?? "";
  return slug ? decodeURIComponent(slug) : null;
}

function normalizePartnerSlug(value: string) {
  return value.trim().toLowerCase();
}

function slugifyPartnerName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function updatePartnerPath(partner: string) {
  const slug = slugifyPartnerName(partner);
  const path = slug
    ? `${PARTNER_PATH_PREFIX}${encodeURIComponent(slug)}`
    : "/";
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
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

function GroundPlanePanControls({ enabled }: { enabled: boolean }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const controls = useThree((state) => (state as unknown as { controls?: TerrainMapControls }).controls);

  useEffect(() => {
    if (!enabled || !controls?.target) return;

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
      if (event.pointerType === "mouse") return event.button === 0;
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
  }, [camera, controls, enabled, gl]);

  return null;
}

const topNavStyle: React.CSSProperties = {
  position: "absolute",
  top: 12,
  left: 16,
  right: 16,
  zIndex: 16,
  display: "flex",
  alignItems: "center",
  gap: 12,
  fontFamily: "monospace",
  color: "#aaa",
  pointerEvents: "none",
};

const topControlGroupStyle: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
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
  flex: "0 0 auto",
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
  pointerEvents: "auto",
  height: 40,
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
  flex: "0 0 auto",
  width: "clamp(92px, 18vw, 150px)",
  height: 50,
  display: "grid",
  placeItems: "center",
  pointerEvents: "auto",
};

const homeBrandStyle: React.CSSProperties = {
  flex: "0 1 auto",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const homePartnerLogoRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  minWidth: 0,
  pointerEvents: "none",
};

const homeSpiderLogoStyle: React.CSSProperties = {
  width: "clamp(40px, 8vw, 60px)",
  height: 64,
  objectFit: "contain",
};

const homeLogoImageStyle: React.CSSProperties = {
  width: "100%",
  height: 48,
  objectFit: "contain",
  display: "block",
};

const filterControlStyle: React.CSSProperties = {
  pointerEvents: "auto",
  minWidth: 0,
};

const filterSelectStyle: React.CSSProperties = {
  width: "clamp(116px, 28vw, 320px)",
  maxWidth: "100%",
  height: 40,
  background: "rgba(10,10,20,0.82)",
  color: "#f4f7fb",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 999,
  padding: "0 34px 0 14px",
  fontFamily: "monospace",
  fontSize: 12,
  outline: "none",
  boxShadow: "0 10px 26px rgba(0,0,0,0.28)",
  cursor: "pointer",
};

const filterOptionStyle: React.CSSProperties = {
  background: "#121620",
  color: "#f4f7fb",
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

const buildStampStyle: React.CSSProperties = {
  position: "absolute",
  left: 12,
  bottom: 10,
  zIndex: 9,
  pointerEvents: "none",
  color: "rgba(238,242,248,0.62)",
  fontFamily: "monospace",
  fontSize: 10,
  lineHeight: 1,
  textShadow: "0 1px 3px rgba(0,0,0,0.7)",
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

const photoLightboxAudioStyle: React.CSSProperties = {
  marginTop: 10,
};

const photoLightboxAudioButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 11px",
  border: "1px solid rgba(255,255,255,0.28)",
  borderRadius: 999,
  background: "rgba(255,255,255,0.1)",
  color: "#fff",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
};

const photoLightboxEditLinkStyle: React.CSSProperties = {
  display: "inline-block",
  marginTop: 9,
  color: "#fff",
  fontWeight: 700,
  textDecoration: "underline",
  textUnderlineOffset: 3,
};

const photoLightboxCloseStyle: React.CSSProperties = {
  ...menuButtonStyle,
  position: "absolute",
  top: 16,
  right: 16,
  background: "rgba(10,10,20,0.82)",
  color: "#eef2f8",
  border: "1px solid rgba(255,255,255,0.18)",
  boxShadow: "0 10px 26px rgba(0,0,0,0.28)",
};

const photoLightboxCloseIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
};
