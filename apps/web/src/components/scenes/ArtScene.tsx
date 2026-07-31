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
  alpha: true,
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
  const [openFilter, setOpenFilter] = useState<"partner" | "activity" | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [webglError, setWebglError] = useState<string | null>(() => getWebGL2SupportError());
  const menuRef = useRef<HTMLDivElement | null>(null);
  const topControlsRef = useRef<HTMLDivElement | null>(null);
  const linkedAudioRef = useRef<HTMLAudioElement | null>(null);
  const [linkedAudioPlaying, setLinkedAudioPlaying] = useState(false);
  const lightboxSwipeStartRef = useRef<{ x: number; y: number } | null>(null);
  const [lightboxSwipeOffset, setLightboxSwipeOffset] = useState(0);
  const [lightboxSwipeSettling, setLightboxSwipeSettling] = useState(false);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const lightboxZoomRef = useRef(1);
  const lightboxTouchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const lightboxPinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const lightboxSuppressClickRef = useRef(false);

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
      if (!topControlsRef.current?.contains(event.target as Node)) {
        setOpenFilter(null);
      }
    }

    document.addEventListener("pointerdown", onDocumentPointerDown);
    return () => document.removeEventListener("pointerdown", onDocumentPointerDown);
  }, []);

  const menuItems = useMemo(
    () => [
      { href: "#about", label: "About", action: "about" as const },
      { href: "/admin", label: "Admin" },
      { href: "/partners", label: "Partners" },
    ],
    []
  );

  const selectedPhoto = selectedPhotoIndex !== null ? photos[selectedPhotoIndex] : null;
  const selectedDescription = selectedPhoto?.exifInfo?.description?.trim();
  const selectedPhotoActivities = selectedPhoto?.activityIds
    ?.map((activityId) =>
      activityFilterOptions.find((activity) => activity.id === activityId),
    )
    .filter((activity): activity is ActivityOption => Boolean(activity)) ?? [];
  useEffect(() => {
    lightboxZoomRef.current = 1;
    setLightboxZoom(1);
    lightboxTouchPointsRef.current.clear();
    lightboxPinchRef.current = null;
  }, [selectedPhoto?.id]);
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

  const selectAdjacentPhoto = useCallback((direction: -1 | 1) => {
    if (selectedPhotoIndex === null || photos.length < 2) return;
    const nextIndex = (selectedPhotoIndex + direction + photos.length) % photos.length;
    selectPhoto(nextIndex);
  }, [photos.length, selectedPhotoIndex, selectPhoto]);

  const handleLightboxPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== "touch") return;
    lightboxTouchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (lightboxTouchPointsRef.current.size === 2) {
      const [first, second] = [...lightboxTouchPointsRef.current.values()];
      lightboxPinchRef.current = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        zoom: lightboxZoomRef.current,
      };
      lightboxSwipeStartRef.current = null;
      setLightboxSwipeOffset(0);
      return;
    }
    lightboxSwipeStartRef.current = { x: event.clientX, y: event.clientY };
    setLightboxSwipeSettling(false);
    setLightboxSwipeOffset(0);
  }, []);

  const handleLightboxPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch" && lightboxTouchPointsRef.current.has(event.pointerId)) {
      lightboxTouchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (lightboxPinchRef.current && lightboxTouchPointsRef.current.size >= 2) {
      const [first, second] = [...lightboxTouchPointsRef.current.values()];
      const distance = Math.hypot(second.x - first.x, second.y - first.y);
      const nextZoom = THREE.MathUtils.clamp(
        lightboxPinchRef.current.zoom * distance / Math.max(1, lightboxPinchRef.current.distance),
        1,
        4,
      );
      lightboxZoomRef.current = nextZoom;
      setLightboxZoom(nextZoom);
      lightboxSuppressClickRef.current = true;
      return;
    }
    const start = lightboxSwipeStartRef.current;
    if (!start || event.pointerType !== "touch" || lightboxZoomRef.current > 1.01) return;
    setLightboxSwipeOffset(event.clientX - start.x);
  }, []);

  const handleLightboxPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    lightboxTouchPointsRef.current.delete(event.pointerId);
    if (lightboxPinchRef.current) {
      if (lightboxTouchPointsRef.current.size < 2) lightboxPinchRef.current = null;
      lightboxSwipeStartRef.current = null;
      lightboxSuppressClickRef.current = true;
      return;
    }
    const start = lightboxSwipeStartRef.current;
    lightboxSwipeStartRef.current = null;
    if (!start || event.pointerType !== "touch") return;

    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 48 || Math.abs(deltaX) < Math.abs(deltaY)) {
      setLightboxSwipeSettling(true);
      setLightboxSwipeOffset(0);
      return;
    }

    lightboxSuppressClickRef.current = true;
    setLightboxSwipeSettling(true);
    setLightboxSwipeOffset(deltaX < 0 ? -window.innerWidth : window.innerWidth);
    window.setTimeout(() => {
      selectAdjacentPhoto(deltaX < 0 ? 1 : -1);
      setLightboxSwipeSettling(false);
      setLightboxSwipeOffset(0);
    }, 180);
  }, [selectAdjacentPhoto]);
  const handleLightboxWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nextZoom = THREE.MathUtils.clamp(
      lightboxZoomRef.current * Math.exp(-event.deltaY * 0.0015),
      1,
      4,
    );
    lightboxZoomRef.current = nextZoom;
    setLightboxZoom(nextZoom);
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
    <div className={window.location.pathname.startsWith("/sites/") ? "atlas-site-view" : undefined} style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <style>{responsiveTopNavStyles}</style>
      <div className="atlas-top-nav" style={topNavStyle}>
        <div className="atlas-home-brand" style={homeBrandStyle}>
          <a className="atlas-home-logo-link" href="/" aria-label="Artasia home" style={homeLogoLinkStyle}>
            <img src="/artasia-atlas.svg" alt="Artasia Atlas" style={homeLogoImageStyle} />
          </a>
        </div>

        <div ref={topControlsRef} className="atlas-top-controls" style={topControlGroupStyle}>
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
            </button>
          )}

          {!focusedPlacementDetails && partnerFilterOptions.length > 0 && (
            <div style={filterControlStyle}>
              <button
                type="button"
                className="atlas-partner-filter-trigger"
                aria-expanded={openFilter === "partner"}
                aria-haspopup="listbox"
                onClick={() => setOpenFilter((current) => current === "partner" ? null : "partner")}
                style={{ ...filterTriggerStyle, ...partnerFilterTriggerStyle }}
              >
                <span>{selectedPartnerFilter || "All partners"}</span>
                <ChevronIcon expanded={openFilter === "partner"} />
              </button>
              {openFilter === "partner" && (
                <div role="listbox" aria-label="Filter placements by partner" style={filterMenuStyle}>
                  <FilterOption active={!selectedPartnerFilter} onSelect={() => {
                    setSelectedPartnerFilter(""); updatePartnerPath(""); setOpenFilter(null);
                  }}>All partners</FilterOption>
                  {partnerFilterOptions.map((option) => (
                    <FilterOption key={option.value} active={selectedPartnerFilter === option.value} onSelect={() => {
                      setSelectedPartnerFilter(option.value); updatePartnerPath(option.value); setOpenFilter(null);
                    }}>{option.label} ({option.count})</FilterOption>
                  ))}
                </div>
              )}
            </div>
          )}

          {focusedPlacementDetails && activityFilterOptions.length > 0 && (
            <div style={filterControlStyle}>
              <button
                type="button"
                className="atlas-activity-filter-trigger"
                aria-expanded={openFilter === "activity"}
                aria-haspopup="listbox"
                onClick={() => setOpenFilter((current) => current === "activity" ? null : "activity")}
                style={{ ...filterTriggerStyle, ...partnerFilterTriggerStyle }}
              >
                <span style={activityFilterLabelStyle}>
                  {selectedActivityColour && (
                    <span
                      aria-hidden="true"
                      style={{
                        ...activityColourDotStyle,
                        background: selectedActivityColour,
                      }}
                    />
                  )}
                  {activityFilterOptions.find((option) => String(option.id) === selectedActivityFilter)?.label || "All Activities"}
                </span>
                <ChevronIcon expanded={openFilter === "activity"} />
              </button>
              {openFilter === "activity" && (
                <div role="listbox" aria-label="Filter photos by activity" style={filterMenuStyle}>
                  <FilterOption active={!selectedActivityFilter} onSelect={() => {
                    setSelectedActivityFilter(""); setOpenFilter(null);
                  }}>All Activities</FilterOption>
                  {activityFilterOptions.map((option) => (
                    <FilterOption key={option.id} active={selectedActivityFilter === String(option.id)} colour={option.colour} onSelect={() => {
                      setSelectedActivityFilter(String(option.id)); setOpenFilter(null);
                    }}>{option.label}</FilterOption>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div ref={menuRef} className="atlas-menu-wrap" style={menuWrapStyle}>
          <button
            type="button"
            aria-label="Open navigation menu"
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((current) => !current)}
            style={menuButtonStyle}
          >
            <span className="atlas-menu-icon" style={menuIconStyle}>
              <span style={menuLineStyle} />
              <span style={menuLineStyle} />
              <span style={menuLineStyle} />
            </span>
          </button>

          {menuOpen && (
            <div className="atlas-menu-panel" role="menu" style={menuPanelStyle}>
                {menuItems.map((item) => item.action === "about" ? (
                  <button
                    key={item.href}
                    type="button"
                    role="menuitem"
                    style={{
                      ...menuItemStyle,
                      textAlign: "left",
                      border: 0,
                      borderBottom: "1px solid rgba(255,255,255,0.12)",
                      cursor: "pointer",
                    }}
                    onClick={() => { setMenuOpen(false); setAboutOpen(true); }}
                  >
                    {item.label}
                  </button>
                ) : <a
                  key={item.href}
                  role="menuitem"
                  href={item.href}
                  style={menuItemStyle}
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </a>)}
            </div>
          )}
        </div>
      </div>

      <a
        className="atlas-presented-by"
        href="https://artsforall.co"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Presented by Arts For All"
        style={presentedByStyle}
      >
        
        <img src="/afa-horizontal.svg" alt="Arts For All" style={presentedByLogoStyle} />
      </a>

      {aboutOpen && (
        <div role="dialog" aria-modal="true" aria-label="About Atlas" style={aboutOverlayStyle}>
          <div style={aboutCardStyle}>
            <button type="button" aria-label="Close About" onClick={() => setAboutOpen(false)} style={aboutCloseStyle}>×</button>
            <div style={aboutPresenterStyle}>
              <a
                href="https://artsforall.co"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Arts For All"
                style={aboutPresenterLinkStyle}
              >
                <img
                  src="/afa-horizontal.svg"
                  alt="Arts For All"
                  style={aboutPresenterLogoStyle}
                />
              </a>
              <span style={aboutPresenterTextStyle}>PRESENTS</span>
            </div>
            <img src="/artasia-atlas.svg" alt="ArtAsia Atlas" style={aboutLogoStyle} />
            <p style={aboutTextStyle}>Explore artist-led learning experiences and creative spaces across our community.</p>
            <a href="https://artsforall.co" target="_blank" rel="noopener noreferrer" style={aboutLinkStyle}>Visit Arts For All</a>
          </div>
        </div>
      )}

      {error && <div style={errorStyle}>{error}</div>}
      <div style={buildStampStyle}>{__ARTASIA_BUILD_LABEL__}</div>
      {terrainNotice && (!showWelcomeIntro || introPhase === "complete") && (
        <LoadingIndicator {...terrainNotice} />
      )}
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
          className="atlas-photo-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={selectedPhoto.fileName}
          onPointerDown={handleLightboxPointerDown}
          onPointerMove={handleLightboxPointerMove}
          onPointerUp={handleLightboxPointerUp}
          onPointerCancel={handleLightboxPointerUp}
          onWheel={handleLightboxWheel}
          onClick={() => {
            if (lightboxSuppressClickRef.current) {
              lightboxSuppressClickRef.current = false;
              return;
            }
            selectPhoto(null);
          }}
          style={{ ...photoLightboxStyle, touchAction: "none" }}
        >
          {focusedPlacementDetails && (
            <div style={photoLightboxPlacementStyle}>
              {focusedPlacementDetails.placement_name}
              {focusedPlacementDetails.section?.trim()
                ? ` - ${focusedPlacementDetails.section.trim()}`
                : ""}
            </div>
          )}
          {selectedPhoto.mediaKind === "video" && selectedPhoto.videoUrl ? (
            <video
              className="atlas-photo-lightbox-media"
              src={selectedPhoto.videoUrl}
              poster={selectedPhoto.previewUrl}
              controls
              autoPlay
              playsInline
              preload="metadata"
              aria-label={selectedPhoto.fileName}
              style={{
                ...photoLightboxImageStyle,
                transform: `translateX(${lightboxSwipeOffset}px) scale(${lightboxZoom})`,
                transformOrigin: "center",
                transition: lightboxSwipeSettling ? "transform 180ms ease-out" : "none",
              }}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <img
              className="atlas-photo-lightbox-media"
              src={selectedPhoto.previewUrl}
              alt={selectedPhoto.fileName}
              style={{
                ...photoLightboxImageStyle,
                ...photoAdjustmentFilterStyle(selectedPhoto.adjustments),
                transform: `translateX(${lightboxSwipeOffset}px) scale(${lightboxZoom})`,
                transformOrigin: "center",
                transition: lightboxSwipeSettling ? "transform 180ms ease-out" : "none",
              }}
              onClick={(event) => event.stopPropagation()}
            />
          )}
          <div
            className="atlas-photo-lightbox-metadata"
            style={photoLightboxMetadataStyle}
            onClick={(event) => event.stopPropagation()}
          >
            <div style={photoLightboxTitleStyle}>{selectedPhoto.fileName}</div>
            {selectedPhotoActivities.length > 0 && (
              <div style={photoLightboxActivityListStyle}>
                {selectedPhotoActivities.map((activity) => (
                  <span
                    key={activity.id}
                    style={{
                      ...photoLightboxActivityBadgeStyle,
                      ...getActivityColourStyle(activity.colour),
                    }}
                  >
                    {activity.label}
                  </span>
                ))}
              </div>
            )}
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
          {photos.length > 1 && (
            <>
              <button
                type="button"
                className="atlas-lightbox-nav-button"
                onClick={(event) => {
                  event.stopPropagation();
                  selectAdjacentPhoto(-1);
                }}
                aria-label="Previous artwork"
                style={{ ...photoLightboxNavStyle, left: 16 }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" style={photoLightboxNavIconStyle}>
                  <path d="m10.5 2.5-5.5 5.5 5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                className="atlas-lightbox-nav-button"
                onClick={(event) => {
                  event.stopPropagation();
                  selectAdjacentPhoto(1);
                }}
                aria-label="Next artwork"
                style={{ ...photoLightboxNavStyle, right: 16 }}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" style={photoLightboxNavIconStyle}>
                  <path d="m5.5 2.5 5.5 5.5-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          )}
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
            gl.setClearColor(0x000000, 0);
            gl.domElement.addEventListener("webglcontextlost", () => {
              setWebglError("The 3D map lost its WebGL context. Reload this page, or try a newer iPad/browser if the issue repeats.");
            });
          }}
          onError={(error) => {
            setWebglError(error instanceof Error ? error.message : "The 3D map could not start WebGL.");
          }}
          style={{
            background:
              "linear-gradient(130deg, #8E1D58 0%, #F28B20DD 100%)",
          }}
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
              activityOptions={activityFilterOptions}
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
            <TouchDoubleTapZoom
              enabled={
                (!showWelcomeIntro || introPhase === "complete") &&
                !previewPlacementDetails &&
                !selectedPhoto
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

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" style={{ width: 16, height: 16, transform: expanded ? "rotate(180deg)" : "none" }}>
      <path d="m3.5 5.75 4.5 4.5 4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function FilterOption({
  children,
  active,
  colour,
  onSelect,
}: {
  children: React.ReactNode;
  active: boolean;
  colour?: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onSelect}
      style={{
        ...filterMenuOptionStyle,
        ...(colour ? getActivityColourStyle(colour) : {}),
        ...(active ? filterMenuOptionActiveStyle : {}),
      }}
    >
      {children}
    </button>
  );
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

function TouchDoubleTapZoom({ enabled }: { enabled: boolean }) {
  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  const controls = useThree(
    (state) =>
      (state as unknown as { controls?: TerrainMapControls }).controls,
  );

  useEffect(() => {
    if (!enabled || !controls?.target) return;

    const element = gl.domElement;
    const terrainControls = controls;
    let pointerId: number | null = null;
    let pointerStart = new THREE.Vector2();
    let moved = false;
    let lastTapAt = 0;
    let lastTapPosition = new THREE.Vector2();
    let zoomAnimationFrame: number | null = null;

    function stopZoomAnimation() {
      if (zoomAnimationFrame !== null) {
        cancelAnimationFrame(zoomAnimationFrame);
        zoomAnimationFrame = null;
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (event.pointerType !== "touch" || !event.isPrimary) return;
      stopZoomAnimation();
      pointerId = event.pointerId;
      pointerStart.set(event.clientX, event.clientY);
      moved = false;
    }

    function onPointerMove(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      if (
        pointerStart.distanceTo(
          new THREE.Vector2(event.clientX, event.clientY),
        ) > 12
      ) {
        moved = true;
      }
    }

    function onPointerUp(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      pointerId = null;
      if (moved) {
        lastTapAt = 0;
        return;
      }

      const now = performance.now();
      const tapPosition = new THREE.Vector2(event.clientX, event.clientY);
      const isDoubleTap =
        now - lastTapAt <= 350 &&
        tapPosition.distanceTo(lastTapPosition) <= 28;

      if (!isDoubleTap) {
        lastTapAt = now;
        lastTapPosition.copy(tapPosition);
        return;
      }

      const offset = camera.position.clone().sub(terrainControls.target);
      const currentDistance = offset.length();
      if (currentDistance > 1.5) {
        const nextDistance = Math.max(1.5, currentDistance * 0.78);
        const startPosition = camera.position.clone();
        const endPosition = terrainControls.target
          .clone()
          .add(offset.setLength(nextDistance));
        const startedAt = performance.now();

        function animateZoom(timestamp: number) {
          const progress = Math.min(1, (timestamp - startedAt) / 200);
          const eased = 1 - Math.pow(1 - progress, 3);
          camera.position.lerpVectors(startPosition, endPosition, eased);
          terrainControls.update?.();
          if (progress < 1) {
            zoomAnimationFrame = requestAnimationFrame(animateZoom);
          } else {
            zoomAnimationFrame = null;
          }
        }

        zoomAnimationFrame = requestAnimationFrame(animateZoom);
      }
      lastTapAt = 0;
      event.preventDefault();
    }

    function onPointerCancel() {
      pointerId = null;
      moved = false;
      lastTapAt = 0;
    }

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerCancel);

    return () => {
      stopZoomAnimation();
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [camera, controls, enabled, gl]);

  return null;
}

const topNavStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 16,
  display: "flex",
  alignItems: "center",
  gap: 0,
  minHeight: "5rem",
  padding: "0 16px",
  boxSizing: "border-box",
  background: "rgba(0, 0, 0, 0.42)",
  backdropFilter: "blur(8px)",
  fontFamily: "monospace",
  color: "#aaa",
  pointerEvents: "none",
};

const responsiveTopNavStyles = `
  .atlas-home-logo-link {
    padding-bottom: 8px;
    box-sizing: border-box;
  }

  @media (max-width: 640px) {
    .atlas-home-logo-link {
      padding-bottom: 12px;
    }

    .atlas-site-view .atlas-presented-by {
      display: none !important;
    }
    .atlas-lightbox-nav-button {
      display: none !important;
    }
    .atlas-photo-lightbox {
      position: fixed !important;
      width: 100vw;
      height: 100dvh;
      min-height: 100svh;
      box-sizing: border-box;
      flex-direction: column;
      gap: 12px;
      padding: max(72px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom)) !important;
      overflow: hidden;
    }
    .atlas-photo-lightbox-media {
      min-height: 0;
      max-width: 100% !important;
      max-height: none !important;
      flex: 1 1 auto;
    }
    .atlas-photo-lightbox-metadata {
      position: static !important;
      flex: 0 0 auto;
      width: 100% !important;
      max-height: 32dvh !important;
      overflow-y: auto;
    }

    .atlas-top-nav {
      left: 0 !important;
      right: 0 !important;
      padding: 0 !important;
      box-sizing: border-box;
      background: rgba(0, 0, 0, 0.42);
      flex-wrap: wrap;
      align-items: flex-start !important;
      gap: 0 !important;
    }

    .atlas-home-brand {
      flex: 1 1 auto !important;
      padding-left: 12px;
      box-sizing: border-box;
    }

    .atlas-home-logo-link {
      padding-bottom: 8px;
      box-sizing: border-box;
    }

    .atlas-menu-wrap {
      order: 2;
      margin: 0;
    }

    .atlas-menu-wrap > button {
      width: 5rem !important;
      height: 5rem !important;
      border-radius: 0 !important;
      border-top: 0 !important;
      border-right: 0 !important;
    }

    .atlas-menu-icon {
      width: 26px !important;
      gap: 5px !important;
    }

    .atlas-menu-icon > span {
      height: 3px !important;
    }

    .atlas-menu-panel {
      top: calc(100% + 40px) !important;
    }

    .atlas-top-controls {
      order: 3;
      flex: 1 0 100% !important;
      width: 100%;
      margin: 0;
      justify-content: flex-start;
      flex-wrap: nowrap;
      border-top: 1px solid rgba(255,255,255,0.12);
    }

    .atlas-top-controls > div {
      flex: 1 1 220px;
    }

    .atlas-partner-filter-trigger,
    .atlas-activity-filter-trigger {
      height: 40px !important;
    }
  }
`;

const topControlGroupStyle: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  display: "flex",
  alignItems: "center",
  gap: 0,
  pointerEvents: "none",
};

const presentedByStyle: React.CSSProperties = {
  position: "fixed",
  right: 16,
  bottom: 14,
  zIndex: 16,
  display: "inline-flex",
  alignItems: "end",
  gap: 8,
  padding: "6px 8px",
  color: "#c1c9d7",
  textDecoration: "none",
  fontFamily: "monospace",
  pointerEvents: "auto",
};
 

const presentedByLogoStyle: React.CSSProperties = {
  width: "clamp(84px, 16vw, 116px)",
  height: "auto",
  display: "block",
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
  width: "5rem",
  height: "5rem",
  display: "grid",
  placeItems: "center",
  background: "transparent",
  color: "#ccc",
  border: 0,
  borderRadius: 0,
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
  top: "100%",
  right: 0,
  minWidth: 184,
  padding: 0,
  borderRadius: 0,
  background: "rgba(8,10,16,0.78)",
  backdropFilter: "blur(8px)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderTop: 0,
  boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
  display: "grid",
  gap: 0,
  zIndex: 20,
};

const menuItemStyle: React.CSSProperties = {
  display: "block",
  padding: "12px 14px",
  borderRadius: 0,
  textDecoration: "none",
  color: "#eef3fb",
  fontSize: 13,
  fontFamily: "monospace",
  background: "transparent",
  borderBottom: "1px solid rgba(255,255,255,0.12)",
};

const backButtonStyle: React.CSSProperties = {
  pointerEvents: "auto",
  flex: "0 0 48px",
  width: 48,
  height: 40,
  padding: 0,
  borderRadius: 0,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 0,
  background: "rgba(0,0,0,0.18)",
  color: "#eef2f8",
  border: 0,
  borderRight: "1px solid rgba(255,255,255,0.18)",
  boxShadow: "none",
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
  width: "9.92rem",
  height: "5rem",
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

const homeLogoImageStyle: React.CSSProperties = {
  width: "9.92rem",
  height: "100%",
  aspectRatio: "484.7404381 / 244.2527827",
  objectFit: "contain",
  display: "block",
};

const filterControlStyle: React.CSSProperties = {
  pointerEvents: "auto",
  minWidth: 0,
  width: "clamp(180px, 28vw, 320px)",
  position: "relative",
};

const filterTriggerStyle: React.CSSProperties = {
  width: "100%",
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  background: "rgba(0,0,0,0.18)",
  color: "#f4f7fb",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 0,
  padding: "0 14px",
  fontFamily: "monospace",
  fontSize: 12,
  outline: "none",
  boxShadow: "none",
  cursor: "pointer",
  textAlign: "left",
};

const partnerFilterTriggerStyle: React.CSSProperties = {
  height: "5rem",
  border: 0,
};

const filterMenuStyle: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  zIndex: 20,
  display: "flex",
  flexDirection: "column",
  maxHeight: "min(55vh, 420px)",
  overflowY: "auto",
  background: "rgba(8,10,16,0.78)",
  backdropFilter: "blur(8px)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderTop: 0,
};

const filterMenuOptionStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 40,
  padding: "9px 14px",
  border: 0,
  borderBottom: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 0,
  background: "transparent",
  color: "#f4f7fb",
  fontFamily: "monospace",
  fontSize: 12,
  textAlign: "left",
  cursor: "pointer",
};

const filterMenuOptionActiveStyle: React.CSSProperties = {
  boxShadow: "inset 4px 0 0 #ffffff",
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
  // Reserve room for the caption panel, especially on short mobile screens.
  maxHeight: "calc(100dvh - 220px)",
  objectFit: "contain",
  boxShadow: "0 18px 60px rgba(0,0,0,0.5)",
  cursor: "default",
};

const photoLightboxMetadataStyle: React.CSSProperties = {
  position: "absolute",
  left: 24,
  bottom: "max(12px, env(safe-area-inset-bottom))",
  width: "min(520px, calc(100vw - 48px))",
  maxHeight: "min(36vh, calc(100dvh - 120px))",
  boxSizing: "border-box",
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

const photoLightboxActivityListStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  marginBottom: 8,
};

const photoLightboxActivityBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 24,
  padding: "3px 9px",
  borderRadius: 0,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.2,
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
  boxShadow: "none",
};

const photoLightboxPlacementStyle: React.CSSProperties = {
  position: "absolute",
  top: "max(16px, env(safe-area-inset-top))",
  left: 16,
  zIndex: 2,
  maxWidth: "calc(100vw - 96px)",
  color: "#fff",
  fontFamily: "monospace",
  fontSize: 14,
  fontWeight: 700,
  lineHeight: 1.3,
  textShadow: "0 2px 8px rgba(0,0,0,0.85)",
  pointerEvents: "none",
};

const aboutOverlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 40, display: "grid", placeItems: "center",
  padding: 24, background: "rgba(5, 7, 14, 0.78)", backdropFilter: "blur(8px)",
};
const aboutCardStyle: React.CSSProperties = {
  position: "relative", width: "min(420px, 100%)", padding: "42px 28px 30px",
  borderRadius: 18, background: "rgba(16, 19, 31, 0.96)", border: "1px solid rgba(255,255,255,0.16)",
  color: "#eef3fb", textAlign: "center", boxShadow: "0 24px 70px rgba(0,0,0,0.45)",
  fontFamily: "monospace",
};
const aboutCloseStyle: React.CSSProperties = { position: "absolute", top: 10, right: 14, border: 0, background: "transparent", color: "#cfd6e2", fontSize: 28, cursor: "pointer" };
const aboutPresenterStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  gap: 8,
};
const aboutPresenterLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
};
const aboutPresenterLogoStyle: React.CSSProperties = {
  display: "block",
  width: "clamp(92px, 21vw, 132px)",
  height: "auto",
};
const aboutPresenterTextStyle: React.CSSProperties = {
  marginBottom: "clamp(0.35rem, 1.1vw, 0.5rem)",
  color: "#c1c9d7",
  fontSize: 10,
  fontVariant: "small-caps",
  letterSpacing: "0.16em",
  lineHeight: 1,
};
const aboutLogoStyle: React.CSSProperties = { display: "block", width: "min(260px, 80%)", height: "auto", margin: "18px auto" };
const aboutTextStyle: React.CSSProperties = { margin: "0 auto 22px", maxWidth: 320, color: "#c1c9d7", lineHeight: 1.55, fontSize: 14 };
const aboutLinkStyle: React.CSSProperties = { color: "#fff", fontFamily: "monospace", fontSize: 12, textDecoration: "underline" };

const photoLightboxNavStyle: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  width: 48,
  height: 48,
  display: "grid",
  placeItems: "center",
  padding: 0,
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 999,
  background: "rgba(10,10,20,0.82)",
  color: "#eef2f8",
  boxShadow: "0 10px 26px rgba(0,0,0,0.28)",
  cursor: "pointer",
};

const photoLightboxNavIconStyle: React.CSSProperties = {
  width: 20,
  height: 20,
};

const photoLightboxCloseIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
};
