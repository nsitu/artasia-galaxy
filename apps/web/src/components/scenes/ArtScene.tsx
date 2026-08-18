import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { MapControls, Preload } from "@react-three/drei";
import * as THREE from "three";
import { fetchAuthUser, fetchUploadOptions, type ActivityOption, type AuthUser, type MapPlacement, type Photo } from "../../api/client";
import { useGalleryStore } from "../../stores/galleryStore";
import LoadingIndicator from "../ui/LoadingIndicator";
import AudioLightboxPlayer from "../ui/AudioLightboxPlayer";
import WelcomeOverlay from "../ui/WelcomeOverlay";
import { loadMaterialSymbols } from "../../modules/iconLoader";
import TerrainGallery, {
  FocusedPlacementOverlay,
  type PartnerFilterOption,
  PlacementHoverLabel,
  PlacementPreviewPanel,
  type PlacementNavigationActions,
  type TerrainNotice,
} from "./TerrainGallery";
import {
  atlasControlSurfaceStyle,
  atlasPanelSurfaceStyle,
} from "./atlasSurfaceStyles";

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
  antialias: true,
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

function getTranslucentActivityColour(colour?: string): string {
  const hex = colour?.trim().replace(/^#/, "") ?? "";
  const expandedHex = /^[0-9a-f]{3}$/i.test(hex)
    ? hex.split("").map((character) => character.repeat(2)).join("")
    : hex;

  return /^[0-9a-f]{6}$/i.test(expandedHex)
    ? `#${expandedHex}66`
    : "#8e1d5866";
}

function getPhotoActivityColour(
  photo: Photo | null,
  activities: ActivityOption[],
): string | undefined {
  return photo?.activityIds
    ?.map((activityId) => activities.find((activity) => activity.id === activityId))
    .find((activity) => activity?.colour?.trim())
    ?.colour;
}

function getWordPressPostEditUrl(postId?: number): string | undefined {
  if (postId == null || !Number.isFinite(postId)) return undefined;
  return `https://artsforall.co/wp-admin/post.php?post=${encodeURIComponent(String(postId))}&action=edit`;
}

function LightboxMedia({
  photo,
  active,
  zoom = 1,
  pan = { x: 0, y: 0 },
  activityColour,
  hasNavigation,
  wordpressEditUrl,
  documentationUrl,
  style,
  onClick,
}: {
  photo: Photo;
  active: boolean;
  zoom?: number;
  pan?: { x: number; y: number };
  activityColour?: string;
  hasNavigation: boolean;
  wordpressEditUrl?: string;
  documentationUrl?: string;
  style: React.CSSProperties;
  onClick: React.MouseEventHandler<HTMLElement>;
}) {
  const [loading, setLoading] = useState(active);
  const mediaStyle: React.CSSProperties = {
    ...style,
    transform: active
      ? `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoom})`
      : undefined,
    transformOrigin: "center",
    cursor: active && zoom > 1.01 ? "grab" : style.cursor,
  };

  if (photo.mediaKind === "anecdote") {
    return (
      <article
        className="atlas-photo-lightbox-media atlas-anecdote-lightbox"
        aria-hidden={!active}
        style={{
          ...anecdoteLightboxStyle,
          width: hasNavigation
            ? "min(100%, calc(100vw - 13rem))"
            : "100%",
          background: getTranslucentActivityColour(activityColour),
          transform: mediaStyle.transform,
          transformOrigin: mediaStyle.transformOrigin,
        }}
        onClick={onClick}
        onWheel={(event) => event.stopPropagation()}
      >
        <span
          aria-hidden="true"
          style={{
            ...anecdoteLightboxIconStyle,
            color: activityColour ?? "#b7bac3",
          }}
        >
          format_quote
        </span>
        <div
          className="atlas-anecdote-lightbox-content"
          style={anecdoteLightboxContentStyle}
          dangerouslySetInnerHTML={{ __html: photo.anecdoteHtml ?? "" }}
        />
        {photo.attribution && (
          <footer style={anecdoteLightboxAttributionStyle}>
            — {photo.attribution}
          </footer>
        )}
        {active && (wordpressEditUrl || documentationUrl) && (
          <div
            style={anecdoteLightboxActionsStyle}
            onClick={(event) => event.stopPropagation()}
          >
            {documentationUrl && (
              <a
                href={documentationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="atlas-control-surface"
                style={anecdoteLightboxActionLinkStyle}
              >
                Documentation
              </a>
            )}
            {wordpressEditUrl && (
              <a
                href={wordpressEditUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="atlas-control-surface"
                style={anecdoteLightboxActionLinkStyle}
              >
                Edit anecdote
              </a>
            )}
          </div>
        )}
      </article>
    );
  }

  if (active && photo.mediaKind === "audio" && photo.audioUrl) {
    return (
      <>
        {loading && <LightboxLoadingSpinner />}
        <AudioLightboxPlayer
          assetId={photo.id}
          audioUrl={photo.audioUrl}
          iconName={photo.iconName}
          activityColour={activityColour}
          style={mediaStyle}
          onReady={() => setLoading(false)}
          onError={() => setLoading(false)}
        />
      </>
    );
  }

  if (photo.mediaKind === "video" && photo.videoUrl) {
    return (
      <>
        {active && loading && <LightboxLoadingSpinner />}
        <video
          className="atlas-photo-lightbox-media"
          src={photo.videoUrl}
          poster={photo.previewUrl}
          draggable={false}
          controls={active}
          autoPlay={active}
          playsInline
          preload={active ? "metadata" : "auto"}
          aria-label={active ? photo.fileName : undefined}
          aria-hidden={!active}
          style={mediaStyle}
          onLoadedData={() => setLoading(false)}
          onError={() => setLoading(false)}
          onClick={onClick}
        />
      </>
    );
  }

  return (
    <>
      {active && loading && <LightboxLoadingSpinner />}
      <img
        className="atlas-photo-lightbox-media"
        src={photo.previewUrl}
        alt={active ? photo.fileName : ""}
        draggable={false}
        aria-hidden={!active}
        loading="eager"
        decoding="async"
        style={mediaStyle}
        onLoad={() => setLoading(false)}
        onError={() => setLoading(false)}
        onClick={onClick}
      />
    </>
  );
}

function LightboxLoadingSpinner() {
  return (
    <div role="status" aria-label="Loading artwork" style={lightboxLoadingStyle}>
      <span aria-hidden="true" style={lightboxLoadingSpinnerStyle} />
    </div>
  );
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
  const photoScope = useGalleryStore((s) => s.photoScope);
  const selectedPhotoIndex = useGalleryStore((s) => s.selectedPhotoIndex);
  const selectPhoto = useGalleryStore((s) => s.selectPhoto);
  const error = useGalleryStore((s) => s.error);
  const [terrainNotice, setTerrainNotice] = useState<TerrainNotice | null>(null);
  const [backAction, setBackAction] = useState<(() => void) | null>(null);
  const [focusedPlacementDetails, setFocusedPlacementDetails] = useState<MapPlacement | null>(null);
  const [hoveredPlacementDetails, setHoveredPlacementDetails] = useState<MapPlacement | null>(null);
  const [previewPlacementDetails, setPreviewPlacementDetails] = useState<MapPlacement | null>(null);
  const [previewPlacementAction, setPreviewPlacementAction] = useState<(() => void) | null>(null);
  const [placementNavigation, setPlacementNavigation] = useState<PlacementNavigationActions | null>(null);
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
  const lightboxDragStartRef = useRef<{
    x: number;
    y: number;
    panX: number;
    panY: number;
    mode: "swipe" | "pan";
  } | null>(null);
  const lightboxSwipeTimerRef = useRef<number | null>(null);
  const [lightboxSwipeOffset, setLightboxSwipeOffset] = useState(0);
  const [lightboxSwipeSettling, setLightboxSwipeSettling] = useState(false);
  const [lightboxZoom, setLightboxZoom] = useState(1);
  const [lightboxPan, setLightboxPan] = useState({ x: 0, y: 0 });
  const [lightboxMetadataExpanded, setLightboxMetadataExpanded] = useState(true);
  const lightboxZoomRef = useRef(1);
  const lightboxPanRef = useRef({ x: 0, y: 0 });
  const lightboxStageRef = useRef<HTMLDivElement | null>(null);
  const lightboxTouchPointsRef = useRef(new Map<number, { x: number; y: number }>());
  const lightboxPinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const lightboxSuppressClickRef = useRef(false);
  const introPanOffsetRef = useRef(false);

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
  const selectedActivityId = selectedActivityFilter
    ? Number.parseInt(selectedActivityFilter, 10)
    : undefined;
  const lightboxPhotos = useMemo(() => {
    if (
      photoScope.mode !== "placement" ||
      selectedActivityId == null ||
      !Number.isFinite(selectedActivityId)
    ) {
      return photos;
    }
    return photos.filter((photo) => photo.activityIds?.includes(selectedActivityId));
  }, [photoScope.mode, photos, selectedActivityId]);
  const selectedLightboxIndex = selectedPhoto
    ? lightboxPhotos.findIndex((photo) => photo.id === selectedPhoto.id)
    : -1;
  const lightboxPreviousPhoto =
    selectedLightboxIndex >= 0 && lightboxPhotos.length > 1
      ? lightboxPhotos[
          (selectedLightboxIndex - 1 + lightboxPhotos.length) % lightboxPhotos.length
        ]
      : null;
  const lightboxNextPhoto =
    selectedLightboxIndex >= 0 && lightboxPhotos.length > 1
      ? lightboxPhotos[(selectedLightboxIndex + 1) % lightboxPhotos.length]
      : null;
  const selectedDescription = selectedPhoto?.exifInfo?.description?.trim();
  const selectedAnecdoteEditUrl = selectedPhoto?.mediaKind === "anecdote" &&
    authUser?.authenticated
    ? getWordPressPostEditUrl(selectedPhoto.wordpressPostId)
    : undefined;
  const selectedAnecdoteDocumentationUrl = selectedPhoto?.mediaKind === "anecdote" &&
    focusedPlacementDetails &&
    (selectedPhoto.placementId == null ||
      selectedPhoto.placementId === focusedPlacementDetails.placement_id)
    ? focusedPlacementDetails.documentation_url?.trim() || undefined
    : undefined;
  const selectedPhotoActivities = selectedPhoto?.activityIds
    ?.map((activityId) =>
      activityFilterOptions.find((activity) => activity.id === activityId),
    )
    .filter((activity): activity is ActivityOption => Boolean(activity)) ?? [];
  const selectedActivityDescriptions = selectedPhotoActivities.flatMap((activity) => {
    const description = activity.description?.trim();
    return description ? [{ id: activity.id, description }] : [];
  });
  const selectedActivityPreview = selectedActivityDescriptions[0]?.description;
  const selectedPhotoActivityColour = getPhotoActivityColour(
    selectedPhoto,
    activityFilterOptions,
  );
  const previousActivityColour = getPhotoActivityColour(
    lightboxPreviousPhoto,
    activityFilterOptions,
  );
  const nextActivityColour = getPhotoActivityColour(
    lightboxNextPhoto,
    activityFilterOptions,
  );
  useEffect(() => {
    if (lightboxSwipeTimerRef.current !== null) {
      window.clearTimeout(lightboxSwipeTimerRef.current);
      lightboxSwipeTimerRef.current = null;
    }
    lightboxZoomRef.current = 1;
    lightboxPanRef.current = { x: 0, y: 0 };
    setLightboxZoom(1);
    setLightboxPan({ x: 0, y: 0 });
    setLightboxSwipeSettling(false);
    setLightboxSwipeOffset(0);
    lightboxTouchPointsRef.current.clear();
    lightboxPinchRef.current = null;
    lightboxDragStartRef.current = null;
    lightboxSuppressClickRef.current = false;
    return () => {
      if (lightboxSwipeTimerRef.current !== null) {
        window.clearTimeout(lightboxSwipeTimerRef.current);
        lightboxSwipeTimerRef.current = null;
      }
    };
  }, [selectedPhoto?.id]);
  const selectedActivityColour =
    activityFilterOptions.find(
      (activity) => String(activity.id) === selectedActivityFilter,
    )?.colour;

  useEffect(() => {
    if (
      selectedPhotoIndex === null ||
      !selectedPhoto ||
      photoScope.mode !== "placement" ||
      selectedActivityId == null ||
      !Number.isFinite(selectedActivityId) ||
      selectedLightboxIndex >= 0
    ) {
      return;
    }
    const firstMatchingPhoto = lightboxPhotos[0];
    const firstMatchingIndex = firstMatchingPhoto
      ? photos.findIndex((photo) => photo.id === firstMatchingPhoto.id)
      : -1;
    selectPhoto(firstMatchingIndex >= 0 ? firstMatchingIndex : null);
  }, [
    lightboxPhotos,
    photos,
    photoScope.mode,
    selectPhoto,
    selectedActivityId,
    selectedLightboxIndex,
    selectedPhoto,
    selectedPhotoIndex,
  ]);

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
    if (
      selectedPhotoIndex === null ||
      selectedLightboxIndex < 0 ||
      lightboxPhotos.length < 2
    ) {
      return;
    }
    const nextPhoto = lightboxPhotos[
      (selectedLightboxIndex + direction + lightboxPhotos.length) % lightboxPhotos.length
    ];
    const nextIndex = nextPhoto
      ? photos.findIndex((photo) => photo.id === nextPhoto.id)
      : -1;
    if (nextIndex >= 0) selectPhoto(nextIndex);
  }, [lightboxPhotos, photos, selectPhoto, selectedLightboxIndex, selectedPhotoIndex]);

  useEffect(() => {
    if (!selectedPhoto) return;

    const handleLightboxKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        selectPhoto(null);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        selectAdjacentPhoto(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        selectAdjacentPhoto(1);
      }
    };

    document.addEventListener("keydown", handleLightboxKeyDown);
    return () => document.removeEventListener("keydown", handleLightboxKeyDown);
  }, [selectAdjacentPhoto, selectPhoto, selectedPhoto]);

  const setClampedLightboxPan = useCallback((
    nextPan: { x: number; y: number },
    zoom = lightboxZoomRef.current,
  ) => {
    const stage = lightboxStageRef.current;
    const media = stage?.querySelector<HTMLElement>(
      ".atlas-photo-lightbox-slide:nth-child(2) .atlas-photo-lightbox-media",
    );
    const maxX = stage && media
      ? Math.max(0, (media.offsetWidth * zoom - stage.clientWidth) / 2)
      : 0;
    const maxY = stage && media
      ? Math.max(0, (media.offsetHeight * zoom - stage.clientHeight) / 2)
      : 0;
    const clampedPan = {
      x: THREE.MathUtils.clamp(nextPan.x, -maxX, maxX),
      y: THREE.MathUtils.clamp(nextPan.y, -maxY, maxY),
    };
    lightboxPanRef.current = clampedPan;
    setLightboxPan(clampedPan);
  }, []);

  const handleLightboxPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const canPan = lightboxZoomRef.current > 1.01;
    if (event.pointerType !== "touch" && !canPan) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    if ((event.target as Element).closest("button, a, .atlas-photo-lightbox-metadata")) return;
    if (canPan) event.preventDefault();
    if (lightboxSwipeTimerRef.current !== null) {
      window.clearTimeout(lightboxSwipeTimerRef.current);
      lightboxSwipeTimerRef.current = null;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    if (event.pointerType === "touch") {
      lightboxTouchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
    if (event.pointerType === "touch" && lightboxTouchPointsRef.current.size === 2) {
      const [first, second] = [...lightboxTouchPointsRef.current.values()];
      lightboxPinchRef.current = {
        distance: Math.hypot(second.x - first.x, second.y - first.y),
        zoom: lightboxZoomRef.current,
      };
      lightboxDragStartRef.current = null;
      setLightboxSwipeOffset(0);
      return;
    }
    lightboxDragStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: lightboxPanRef.current.x,
      panY: lightboxPanRef.current.y,
      mode: canPan ? "pan" : "swipe",
    };
    setLightboxSwipeSettling(false);
    if (!canPan) setLightboxSwipeOffset(0);
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
      setClampedLightboxPan(lightboxPanRef.current, nextZoom);
      lightboxSuppressClickRef.current = true;
      return;
    }
    const start = lightboxDragStartRef.current;
    if (!start) return;
    if (start.mode === "pan") {
      const deltaX = event.clientX - start.x;
      const deltaY = event.clientY - start.y;
      setClampedLightboxPan(
        { x: start.panX + deltaX, y: start.panY + deltaY },
        lightboxZoomRef.current,
      );
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        lightboxSuppressClickRef.current = true;
      }
      return;
    }
    if (event.pointerType !== "touch") return;
    setLightboxSwipeOffset(event.clientX - start.x);
  }, [setClampedLightboxPan]);

  const handleLightboxPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    lightboxTouchPointsRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (lightboxPinchRef.current) {
      if (lightboxTouchPointsRef.current.size < 2) lightboxPinchRef.current = null;
      lightboxDragStartRef.current = null;
      lightboxSuppressClickRef.current = true;
      window.setTimeout(() => {
        lightboxSuppressClickRef.current = false;
      }, 0);
      return;
    }
    const start = lightboxDragStartRef.current;
    lightboxDragStartRef.current = null;
    if (!start) return;

    if (start.mode === "pan") {
      if (
        Math.abs(event.clientX - start.x) > 3 ||
        Math.abs(event.clientY - start.y) > 3
      ) {
        lightboxSuppressClickRef.current = true;
        window.setTimeout(() => {
          lightboxSuppressClickRef.current = false;
        }, 0);
      }
      return;
    }
    if (event.pointerType !== "touch") return;

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
    lightboxSwipeTimerRef.current = window.setTimeout(() => {
      lightboxSwipeTimerRef.current = null;
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
    setClampedLightboxPan(lightboxPanRef.current, nextZoom);
  }, [setClampedLightboxPan]);
  const handleBackActionChange = useCallback((action: (() => void) | null) => {
    setBackAction(action ? () => action : null);
  }, []);
  const handleHomeLogoClick = useCallback((event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!backAction) return;
    event.preventDefault();
    backAction();
  }, [backAction]);
  const handlePreviewPlacementChange = useCallback((placement: MapPlacement | null, action?: (() => void) | null) => {
    setPreviewPlacementDetails(placement);
    setPreviewPlacementAction(action ? () => action : null);
  }, []);
  const handlePlacementNavigationChange = useCallback((navigation: PlacementNavigationActions | null) => {
    setPlacementNavigation(navigation);
  }, []);
  const handleFocusedPlacementChange = useCallback((placement: MapPlacement | null) => {
    setSelectedActivityFilter("");
    setFocusedPlacementDetails(placement);
  }, []);
  const handlePartnerNavigation = useCallback((partner: string) => {
    setSelectedPartnerFilter(partner);
    updatePartnerPath(partner);
  }, []);
  const handleTopPartnerLogoClick = useCallback((
    event: React.MouseEvent<HTMLAnchorElement>,
    partner: string,
  ) => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    handlePartnerNavigation(partner);
  }, [handlePartnerNavigation]);

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
    if (!focusedPlacementDetails) return;
    if (
      photoScope.mode !== "placement" ||
      photoScope.placementId !== focusedPlacementDetails.placement_id
    ) return;
    if (!activityFilterOptions.length) return;

    const counts = new Map<number, number>();
    for (const photo of photos) {
      for (const activityId of photo.activityIds ?? []) {
        counts.set(activityId, (counts.get(activityId) ?? 0) + 1);
      }
    }

    setActivityFilterOptions((prev) =>
      prev.map((option) => ({
        ...option,
        count: counts.get(option.id) ?? 0,
      })),
    );
  }, [focusedPlacementDetails, photoScope, photos, activityFilterOptions.length]);

  useEffect(() => {
    if (!focusedPlacementDetails) setSelectedActivityFilter("");
  }, [focusedPlacementDetails]);

  const selectedPartnerOption = !focusedPlacementDetails && selectedPartnerFilter
    ? partnerFilterOptions.find((option) => option.value === selectedPartnerFilter)
    : undefined;
  const topNavPartner = focusedPlacementDetails?.partner_name?.trim()
    ? {
        label: focusedPlacementDetails.partner_name.trim(),
        whiteLogo: focusedPlacementDetails.partner_white_logo,
      }
    : selectedPartnerOption;

  return (
    <div className={window.location.pathname.startsWith("/sites/") ? "atlas-site-view" : undefined} style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <style>{responsiveTopNavStyles}</style>
      <div className="atlas-top-nav" style={topNavStyle}>
        <div className="atlas-home-brand" style={homeBrandStyle}>
          <a
            className="atlas-home-logo-link"
            href="/"
            aria-label={backAction ? "Back to regional view" : "Artasia home"}
            onClick={handleHomeLogoClick}
            style={homeLogoLinkStyle}
          >
            <img src="/artasia-atlas.svg" alt="Artasia Atlas" style={homeLogoImageStyle} />
          </a>
        </div>

        {topNavPartner?.whiteLogo?.url && (
          <a
            className="atlas-selected-partner-logo"
            href={getPartnerPath(topNavPartner.label)}
            aria-label={`View ${topNavPartner.label} placements`}
            onClick={(event) => handleTopPartnerLogoClick(event, topNavPartner.label)}
            style={selectedPartnerLogoWrapStyle}
          >
            <img
              src={topNavPartner.whiteLogo.url}
              alt={topNavPartner.whiteLogo.alt || `${topNavPartner.label} logo`}
              style={selectedPartnerLogoImageStyle}
            />
          </a>
        )}

        <div ref={topControlsRef} className="atlas-top-controls" style={topControlGroupStyle}>
          {!focusedPlacementDetails && partnerFilterOptions.length > 0 && (
            <div className="atlas-partner-filter-control" style={filterControlStyle}>
              <button
                type="button"
                className="atlas-partner-filter-trigger atlas-control-surface"
                aria-expanded={openFilter === "partner"}
                aria-haspopup="listbox"
                onClick={() => setOpenFilter((current) => current === "partner" ? null : "partner")}
                style={{ ...filterTriggerStyle, ...partnerFilterTriggerStyle }}
              >
                <span>
                  {partnerFilterOptions.find(
                    (option) => option.value === selectedPartnerFilter,
                  )?.label || "Partners"}
                </span>
                <ChevronIcon expanded={openFilter === "partner"} />
              </button>
              {openFilter === "partner" && (
                <div className="atlas-partner-filter-menu" role="listbox" aria-label="Filter placements by partner" style={filterMenuStyle}>
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
                className="atlas-activity-filter-trigger atlas-control-surface"
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
                  {activityFilterOptions.find((option) => String(option.id) === selectedActivityFilter)?.label || "Activities"}
                </span>
                <ChevronIcon expanded={openFilter === "activity"} />
              </button>
              {openFilter === "activity" && (
                <div role="listbox" aria-label="Filter photos by activity" style={filterMenuStyle}>
                  <FilterOption active={!selectedActivityFilter} onSelect={() => {
                    setSelectedActivityFilter(""); setOpenFilter(null);
                  }}>All Activities ({photos.length})</FilterOption>
                  {activityFilterOptions.map((option) => {
                    const disabled = option.count === 0;
                    return (
                      <FilterOption
                        key={option.id}
                        active={selectedActivityFilter === String(option.id)}
                        colour={option.colour}
                        disabled={disabled}
                        onSelect={() => {
                          setSelectedActivityFilter(String(option.id));
                          setOpenFilter(null);
                        }}
                      >
                        {option.label} ({option.count ?? 0})
                      </FilterOption>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        <div ref={menuRef} className="atlas-menu-wrap" style={menuWrapStyle}>
          <button
            type="button"
            className="atlas-control-surface"
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
                    className="atlas-control-surface"
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
                  className="atlas-control-surface"
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
          partnerHref={getPartnerPath(focusedPlacementDetails.partner_name || "")}
          onPartnerSelect={handlePartnerNavigation}
          previousAction={placementNavigation?.previous}
          nextAction={placementNavigation?.next}
          adminHref={
            authUser?.authenticated
              ? `/admin/browse?site=${encodeURIComponent(String(focusedPlacementDetails.placement_id))}`
              : undefined
          }
        />
      )}
      {!focusedPlacementDetails && previewPlacementDetails && previewPlacementAction && (
        <PlacementPreviewPanel
          placement={previewPlacementDetails}
          onOpen={previewPlacementAction}
          partnerHref={getPartnerPath(previewPlacementDetails.partner_name || "")}
          onPartnerSelect={handlePartnerNavigation}
          previousAction={placementNavigation?.previous}
          nextAction={placementNavigation?.next}
          adminHref={
            authUser?.authenticated
              ? `/admin/browse?site=${encodeURIComponent(String(previewPlacementDetails.placement_id))}`
              : undefined
          }
        />
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
          onDragStart={(event) => event.preventDefault()}
          onWheel={handleLightboxWheel}
          onClick={() => {
            if (lightboxSuppressClickRef.current) {
              lightboxSuppressClickRef.current = false;
              return;
            }
            selectPhoto(null);
          }}
          style={{
            ...photoLightboxStyle,
            touchAction: selectedPhoto.mediaKind === "anecdote" ? "pan-y" : "none",
          }}
        >
          {focusedPlacementDetails && (
            <div style={photoLightboxPlacementStyle}>
              {focusedPlacementDetails.placement_name}
              {focusedPlacementDetails.section?.trim()
                ? ` - ${focusedPlacementDetails.section.trim()}`
                : ""}
            </div>
          )}
          <div
            ref={lightboxStageRef}
            className="atlas-photo-lightbox-stage"
            style={photoLightboxStageStyle}
          >
            <div
              className="atlas-photo-lightbox-track"
              style={{
                ...photoLightboxTrackStyle,
                transform: `translate3d(calc(-33.333333% + ${lightboxSwipeOffset}px), 0, 0)`,
                transition: lightboxSwipeSettling ? "transform 180ms ease-out" : "none",
              }}
            >
              <div className="atlas-photo-lightbox-slide" style={photoLightboxSlideStyle}>
                {lightboxPreviousPhoto && (
                  <LightboxMedia
                    key={`${lightboxPreviousPhoto.id}-adjacent`}
                    photo={lightboxPreviousPhoto}
                    active={false}
                    activityColour={previousActivityColour}
                    hasNavigation={lightboxPhotos.length > 1}
                    style={{
                      ...photoLightboxImageStyle,
                      ...photoAdjustmentFilterStyle(lightboxPreviousPhoto.adjustments),
                    }}
                    onClick={(event) => event.stopPropagation()}
                  />
                )}
              </div>
              <div className="atlas-photo-lightbox-slide" style={photoLightboxSlideStyle}>
                <LightboxMedia
                  key={`${selectedPhoto.id}-active`}
                  photo={selectedPhoto}
                  active
                  zoom={lightboxZoom}
                  pan={lightboxPan}
                  activityColour={selectedPhotoActivityColour}
                  hasNavigation={lightboxPhotos.length > 1}
                  wordpressEditUrl={selectedAnecdoteEditUrl}
                  documentationUrl={selectedAnecdoteDocumentationUrl}
                  style={{
                    ...photoLightboxImageStyle,
                    ...photoAdjustmentFilterStyle(selectedPhoto.adjustments),
                  }}
                  onClick={(event) => event.stopPropagation()}
                />
              </div>
              <div className="atlas-photo-lightbox-slide" style={photoLightboxSlideStyle}>
                {lightboxNextPhoto && (
                  <LightboxMedia
                    key={`${lightboxNextPhoto.id}-adjacent`}
                    photo={lightboxNextPhoto}
                    active={false}
                    activityColour={nextActivityColour}
                    hasNavigation={lightboxPhotos.length > 1}
                    style={{
                      ...photoLightboxImageStyle,
                      ...photoAdjustmentFilterStyle(lightboxNextPhoto.adjustments),
                    }}
                    onClick={(event) => event.stopPropagation()}
                  />
                )}
              </div>
            </div>
            {lightboxPhotos.length > 1 && (
              <>
                <button
                  type="button"
                  className="atlas-lightbox-nav-button atlas-control-surface"
                  onClick={(event) => {
                    event.stopPropagation();
                    selectAdjacentPhoto(-1);
                  }}
                  aria-label="Previous artwork"
                  style={{ ...photoLightboxNavStyle, left: 0 }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true" style={photoLightboxNavIconStyle}>
                    <path d="m10.5 2.5-5.5 5.5 5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="atlas-lightbox-nav-button atlas-control-surface"
                  onClick={(event) => {
                    event.stopPropagation();
                    selectAdjacentPhoto(1);
                  }}
                  aria-label="Next artwork"
                  style={{ ...photoLightboxNavStyle, right: 0 }}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true" style={photoLightboxNavIconStyle}>
                    <path d="m5.5 2.5 5.5 5.5-5.5 5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </>
            )}
          </div>
          <div
            className={`atlas-photo-lightbox-metadata ${
              lightboxMetadataExpanded
                ? "atlas-photo-lightbox-metadata-expanded"
                : "atlas-photo-lightbox-metadata-collapsed"
            }`}
            style={{
              ...photoLightboxMetadataStyle,
              ...(selectedPhoto.mediaKind === "anecdote" ? { display: "none" } : {}),
            }}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onWheel={(event) => event.stopPropagation()}
          >
            <div
              style={{
                ...photoLightboxMetadataHeaderStyle,
                ...(!lightboxMetadataExpanded
                  ? photoLightboxMetadataHeaderCollapsedStyle
                  : {}),
              }}
            >
              <div
                className="atlas-lightbox-caption-header-content"
                style={photoLightboxCaptionHeaderContentStyle}
              >
                {selectedPhotoActivities.length > 0 ? (
                  <>
                    <div style={photoLightboxHeaderBadgeListStyle}>
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
                    {!lightboxMetadataExpanded && selectedActivityPreview && (
                      <div
                        className="atlas-lightbox-activity-preview"
                        style={photoLightboxActivityPreviewStyle}
                      >
                        {selectedActivityPreview}
                      </div>
                    )}
                  </>
                ) : selectedDescription ? (
                  <div style={photoLightboxTitleStyle}>{selectedDescription}</div>
                ) : null}
              </div>
              <button
                type="button"
                className="atlas-control-surface"
                aria-expanded={lightboxMetadataExpanded}
                aria-controls="atlas-lightbox-caption-details"
                aria-label={lightboxMetadataExpanded ? "Collapse asset details" : "Expand asset details"}
                onClick={() => setLightboxMetadataExpanded((current) => !current)}
                style={photoLightboxMetadataToggleStyle}
              >
                <svg viewBox="0 0 16 16" aria-hidden="true" style={photoLightboxMetadataChevronStyle}>
                  <path
                    d={lightboxMetadataExpanded ? "m3 6 5 5 5-5" : "m3 10 5-5 5 5"}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </div>
            {lightboxMetadataExpanded && (
              <div id="atlas-lightbox-caption-details" style={photoLightboxMetadataBodyStyle}>
            {selectedActivityDescriptions.length > 0 && (
              <div style={photoLightboxActivityListStyle}>
                {selectedActivityDescriptions.map((activity) => (
                  <div
                    key={activity.id}
                    style={photoLightboxActivityDescriptionStyle}
                  >
                    {activity.description}
                  </div>
                ))}
              </div>
            )}
            {selectedDescription && selectedPhotoActivities.length > 0 && (
              <div
                style={{
                  ...photoLightboxAssetCaptionStyle,
                  ...(selectedActivityDescriptions.length > 0
                    ? photoLightboxAssetCaptionSeparatedStyle
                    : {}),
                }}
              >
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
                  className="atlas-control-surface"
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
                <div style={photoLightboxActionRowStyle}>
                <a
                  href={`/api/v1/assets/${selectedPhoto.id}/original`}
                  className="atlas-control-surface"
                  download={selectedPhoto.fileName}
                  aria-label={`Download original asset: ${selectedPhoto.fileName}`}
                  title="Download original asset"
                  style={photoLightboxActionLinkStyle}
                >
                  <svg viewBox="0 0 16 16" aria-hidden="true" style={photoLightboxActionIconStyle}>
                    <path
                      d="M8 2.5v7m-3-3 3 3 3-3M3 12.5h10"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  <span>Download</span>
                </a>
                {authUser?.authenticated && (
                  <a
                    href={`/edit/${selectedPhoto.id}`}
                    className="atlas-control-surface"
                    aria-label={`Edit asset: ${selectedPhoto.fileName}`}
                    style={photoLightboxActionLinkStyle}
                  >
                    <svg viewBox="0 0 16 16" aria-hidden="true" style={photoLightboxActionIconStyle}>
                      <path
                        d="m3 11.5-.5 2 2-.5 7.6-7.6-1.5-1.5L3 11.5Zm6.6-6.6 1.5 1.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                    <span>Edit</span>
                  </a>
                )}
                </div>
              </div>
            )}
          </div>
              <button
                type="button"
                className="atlas-control-surface"
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
              authenticated={authUser?.authenticated ?? null}
              introEnabled={showWelcomeIntro}
              introPhase={introPhase}
              onIntroReady={handleIntroReady}
              onIntroComplete={handleIntroComplete}
              introPanOffsetRef={introPanOffsetRef}
              onNoticeChange={setTerrainNotice}
              onBackActionChange={handleBackActionChange}
              onFocusedPlacementChange={handleFocusedPlacementChange}
              onHoveredPlacementChange={setHoveredPlacementDetails}
              onPreviewPlacementChange={handlePreviewPlacementChange}
              onPlacementNavigationChange={handlePlacementNavigationChange}
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
  disabled = false,
  onSelect,
}: {
  children: React.ReactNode;
  active: boolean;
  colour?: string;
  disabled?: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className="atlas-filter-menu-option"
      role="option"
      aria-selected={active}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onSelect}
      style={{
        ...filterMenuOptionStyle,
        ...(active ? filterMenuOptionActiveStyle : {}),
        ...(disabled ? filterMenuOptionDisabledStyle : {}),
      }}
    >
      {colour && (
        <span
          aria-hidden="true"
          style={{
            ...activityColourDotStyle,
            background: colour,
            ...(disabled ? filterMenuOptionDisabledDotStyle : {}),
          }}
        />
      )}
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
  const path = getPartnerPath(partner);
  if (window.location.pathname === path) return;
  window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function getPartnerPath(partner: string) {
  const slug = slugifyPartnerName(partner);
  return slug
    ? `${PARTNER_PATH_PREFIX}${encodeURIComponent(slug)}`
    : "/";
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
  padding: 0,
  boxSizing: "border-box",
  fontWeight: 500,
  color: "#aaa",
  pointerEvents: "none",
};

const responsiveTopNavStyles = `
  @keyframes atlas-lightbox-loading-spin {
    to { transform: rotate(360deg); }
  }

  @media (hover: hover) {
    .atlas-control-surface:hover {
      background-color: rgba(142, 29, 88, 0.3);
      background-image: linear-gradient(45deg, rgba(142, 29, 88, 0.3) 0%, rgba(242, 139, 32, 0.3) 100%) !important;
      
    }

    .atlas-filter-menu-option:not(:disabled):hover {
      background-color: rgba(142, 29, 88, 0.3) !important;
      background-image: linear-gradient(45deg, rgba(142, 29, 88, 0.3) 0%, rgba(242, 139, 32, 0.3) 100%) !important;
    }
  }

  .atlas-control-surface:focus-visible {
    background-color: rgba(142, 29, 88, 0.3);
      background-image: linear-gradient(45deg, rgba(142, 29, 88, 0.3) 0%, rgba(242, 139, 32, 0.3) 100%) !important;
  }

  .atlas-filter-menu-option:not(:disabled):focus-visible {
    background-color: rgba(142, 29, 88, 0.3) !important;
    background-image: linear-gradient(45deg, rgba(142, 29, 88, 0.3) 0%, rgba(242, 139, 32, 0.3) 100%) !important;
  }

  .atlas-top-nav::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    background: rgba(0, 0, 0, 0.42);
    -webkit-backdrop-filter: blur(8px);
    backdrop-filter: blur(8px);
  }

  .atlas-home-logo-link {
    padding-bottom: 8px;
    box-sizing: border-box;
  }

  @media (max-width: 640px) {
    .atlas-home-logo-link {
      padding-bottom: 12px;
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
      gap: 0;
      padding: 0 !important;
      overflow: hidden;
    }
    .atlas-photo-lightbox-media {
      min-height: 0;
      max-width: 100% !important;
      max-height: none !important;
      flex: 1 1 auto;
    }
    .atlas-anecdote-lightbox {
      width: 100% !important;
      height: 100%;
      max-height: 100% !important;
      overflow-y: auto;
      overscroll-behavior: contain;
      -webkit-overflow-scrolling: touch;
    }
    .atlas-photo-lightbox-audio {
      width: 100% !important;
      max-width: 100% !important;
    }
    .atlas-audio-lightbox-controls {
      grid-template-columns: minmax(0, 1fr) auto !important;
      grid-template-areas:
        "waveform waveform"
        "play time" !important;
      column-gap: 12px !important;
      row-gap: 8px !important;
    }
    .atlas-audio-lightbox-play {
      justify-self: start;
    }
    .atlas-audio-lightbox-time {
      justify-self: end;
    }
    .atlas-photo-lightbox-track {
      padding: 0 !important;
      box-sizing: border-box;
    }
    .atlas-photo-lightbox-slide {
      padding: max(72px, env(safe-area-inset-top)) 12px max(12px, env(safe-area-inset-bottom)) !important;
    }
    .atlas-photo-lightbox-metadata {
      width: 100% !important;
      max-height: min(42dvh, 360px) !important;
      overflow: hidden;
    }

    .atlas-lightbox-caption-header-content {
      flex-direction: column !important;
      align-items: flex-start !important;
      justify-content: center !important;
      gap: 4px !important;
    }

    .atlas-photo-lightbox-metadata-collapsed .atlas-lightbox-caption-header-content {
      flex-direction: row !important;
      align-items: center !important;
      gap: 10px !important;
    }

    .atlas-photo-lightbox-metadata-collapsed .atlas-lightbox-activity-preview {
      width: auto !important;
    }

    .atlas-top-nav {
      left: 0 !important;
      right: 0 !important;
      padding: 0 !important;
      box-sizing: border-box;
      background: transparent;
      flex-wrap: wrap;
      align-items: flex-start !important;
      gap: 0 !important;
    }

    .atlas-home-brand {
      flex: 1 1 auto !important;
      min-width: 0;
      padding-left: 12px;
      box-sizing: border-box;
    }

    .atlas-selected-partner-logo {
      order: 1;
      flex: 0 1 clamp(5rem, 24vw, 9rem) !important;
      width: clamp(5rem, 24vw, 9rem) !important;
      height: 5rem !important;
      padding: 0.75rem !important;
    }

    .atlas-home-logo-link {
      padding-left: 0 !important;
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

  @media (min-width: 800px) {
    .atlas-partner-filter-control {
      width: clamp(460px, 45vw, 560px) !important;
    }

    .atlas-partner-filter-trigger > span,
    .atlas-partner-filter-menu [role="option"] {
      white-space: nowrap;
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
  ...atlasControlSurfaceStyle,
  pointerEvents: "auto",
  width: "5rem",
  height: "5rem",
  display: "grid",
  placeItems: "center",
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
  ...atlasPanelSurfaceStyle,
  position: "absolute",
  top: "100%",
  right: 0,
  minWidth: 184,
  padding: 0,
  borderRadius: 0,
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
  fontWeight: 500,
  background: "transparent",
  borderBottom: "1px solid rgba(255,255,255,0.12)",
};

const homeLogoLinkStyle: React.CSSProperties = {
  padding: "0 1rem",
  height: "4.5rem",
  pointerEvents: "auto",
};

const homeBrandStyle: React.CSSProperties = {
  flex: "0 1 auto",
  minWidth: 0,
  display: "flex",
  alignSelf: "flex-start",
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

const selectedPartnerLogoWrapStyle: React.CSSProperties = {
  flex: "0 1 clamp(7rem, 14vw, 12rem)",
  width: "clamp(7rem, 14vw, 12rem)",
  height: "5rem",
  minWidth: 0,
  alignSelf: "flex-start",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0.625rem 1rem",
  boxSizing: "border-box",
  color: "inherit",
  textDecoration: "none",
  pointerEvents: "auto",
};

const selectedPartnerLogoImageStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: "100%",
  maxWidth: "100%",
  maxHeight: "100%",
  objectFit: "contain",
  objectPosition: "center",
};

const filterControlStyle: React.CSSProperties = {
  pointerEvents: "auto",
  minWidth: 0,
  width: "clamp(180px, 28vw, 320px)",
  position: "relative",
};

const filterTriggerStyle: React.CSSProperties = {
  ...atlasControlSurfaceStyle,
  width: "100%",
  height: 40,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 16,
  color: "#f4f7fb",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 0,
  padding: "0 14px",
  fontSize: 12,
  fontWeight: 500,
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
  ...atlasPanelSurfaceStyle,
  position: "absolute",
  top: "100%",
  left: 0,
  right: 0,
  zIndex: 20,
  display: "flex",
  flexDirection: "column",
  maxHeight: "min(55vh, 420px)",
  overflowY: "auto",
  border: "1px solid rgba(255,255,255,0.18)",
  borderTop: 0,
};

const filterMenuOptionStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 40,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "9px 14px",
  border: 0,
  borderBottom: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 0,
  background: "transparent",
  color: "#f4f7fb",
  fontSize: 12,
  fontWeight: 500,
  textAlign: "left",
  cursor: "pointer",
};

const filterMenuOptionActiveStyle: React.CSSProperties = {
  boxShadow: "inset 4px 0 0 #ffffff",
};

const filterMenuOptionDisabledStyle: React.CSSProperties = {
  color: "rgba(244, 247, 251, 0.5)",
  cursor: "not-allowed",
};

const filterMenuOptionDisabledDotStyle: React.CSSProperties = {
  opacity: 0.5,
};

const activityFilterLabelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  minWidth: 0,
};

const activityColourDotStyle: React.CSSProperties = {
  width: 11,
  height: 11,
  flex: "0 0 11px",
  borderRadius: "50%",
  boxShadow: "0 0 0 1px rgba(255,255,255,0.25)",
};

const errorStyle: React.CSSProperties = {
  position: "absolute",
  bottom: 20,
  left: "50%",
  transform: "translateX(-50%)",
  zIndex: 10,
  color: "#f66",
  fontSize: 13,
  fontWeight: 500,
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
  fontSize: 10,
  fontVariantNumeric: "tabular-nums",
  lineHeight: 1,
  textShadow: "0 1px 3px rgba(0,0,0,0.7)",
};

const photoLightboxStyle: React.CSSProperties = {
  ...atlasPanelSurfaceStyle,
  position: "fixed",
  inset: 0,
  zIndex: 30,
  display: "grid",
  gridTemplateRows: "minmax(0, 1fr) auto",
  width: "100vw",
  height: "100dvh",
  padding: 0,
  boxSizing: "border-box",
  overflow: "hidden",
  cursor: "zoom-out",
};

const photoLightboxStageStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
  overflow: "hidden",
};

const photoLightboxImageStyle: React.CSSProperties = {
  maxWidth: "calc(100vw - 48px)",
  maxHeight: "100%",
  objectFit: "contain",
  boxShadow: "0 18px 60px rgba(0,0,0,0.5)",
  cursor: "default",
  userSelect: "none",
};

const anecdoteLightboxStyle: React.CSSProperties = {
  width: "100%",
  maxHeight: "calc(100% - 32px)",
  boxSizing: "border-box",
  overflowY: "auto",
  padding: "clamp(28px, 6vw, 64px)",
  border: 0,
  borderRadius: 0,
  background: "#8e1d5866",
  boxShadow: "0 18px 60px rgba(0,0,0,0.5)",
  color: "#eef2f8",
  cursor: "default",
  touchAction: "pan-y",
  scrollbarWidth: "thin",
};

const anecdoteLightboxIconStyle: React.CSSProperties = {
  display: "block",
  marginBottom: 20,
  fontFamily: "'Material Symbols Outlined'",
  fontSize: "clamp(72px, 14vw, 132px)",
  fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 48",
  lineHeight: 0.72,
};

const anecdoteLightboxContentStyle: React.CSSProperties = {
  fontSize: "clamp(18px, 2.4vw, 26px)",
  lineHeight: 1.55,
  overflowWrap: "anywhere",
};

const anecdoteLightboxAttributionStyle: React.CSSProperties = {
  marginTop: 28,
  color: "#c7ccd6",
  fontSize: "clamp(15px, 1.8vw, 19px)",
  fontStyle: "italic",
  lineHeight: 1.4,
  textAlign: "right",
};

const anecdoteLightboxActionsStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 32,
};

const anecdoteLightboxActionLinkStyle: React.CSSProperties = {
  ...atlasControlSurfaceStyle,
  minHeight: 44,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "0 16px",
  border: "1px solid rgba(255,255,255,0.28)",
  borderRadius: 0,
  color: "#eef2f8",
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1,
  textDecoration: "none",
  whiteSpace: "nowrap",
};

const photoLightboxTrackStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  bottom: 0,
  left: 0,
  width: "300%",
  display: "flex",
  alignItems: "center",
  zIndex: 0,
  willChange: "transform",
};

const photoLightboxSlideStyle: React.CSSProperties = {
  position: "relative",
  flex: "0 0 33.333333%",
  width: "33.333333%",
  height: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 24,
  overflow: "hidden",
};

const lightboxLoadingStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 2,
  display: "grid",
  placeItems: "center",
  pointerEvents: "none",
};

const lightboxLoadingSpinnerStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  border: "3px solid rgba(255,255,255,0.22)",
  borderTopColor: "#f5f7fb",
  borderRadius: "50%",
  animation: "atlas-lightbox-loading-spin 0.85s linear infinite",
};

const photoLightboxMetadataStyle: React.CSSProperties = {
  ...atlasPanelSurfaceStyle,
  background: "transparent",
  position: "relative",
  zIndex: 3,
  width: "100%",
  maxHeight: "min(42dvh, 360px)",
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
  padding: 0,
  color: "#ddd",
  fontSize: 13,
  lineHeight: 1.45,
  cursor: "default",
  touchAction: "pan-y",
  boxShadow: "0 -12px 34px rgba(0,0,0,0.26)",
};

const photoLightboxMetadataHeaderStyle: React.CSSProperties = {
  flex: "0 0 5rem",
  height: "5rem",
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: 12,
  paddingLeft: 16,
  borderBottom: "1px solid rgba(255,255,255,0.12)",
};

const photoLightboxMetadataHeaderCollapsedStyle: React.CSSProperties = {
  borderBottom: "none",
};

const photoLightboxCaptionHeaderContentStyle: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  height: "100%",
  display: "flex",
  alignItems: "center",
  gap: 10,
  overflow: "hidden",
};

const photoLightboxHeaderBadgeListStyle: React.CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
};

const photoLightboxActivityPreviewStyle: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  width: "100%",
  overflow: "hidden",
  color: "#d8dce4",
  fontSize: 12,
  lineHeight: 1.4,
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const photoLightboxTitleStyle: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  display: "-webkit-box",
  WebkitBoxOrient: "vertical",
  WebkitLineClamp: 3,
  overflow: "hidden",
  color: "#fff",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const photoLightboxActionRowStyle: React.CSSProperties = {
  flex: "0 0 auto",
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  marginTop: 10,
};

const photoLightboxActionLinkStyle: React.CSSProperties = {
  ...atlasControlSurfaceStyle,
  flex: "0 0 auto",
  minHeight: 44,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "0 16px",
  borderRadius: 0,
  color: "#eef2f8",
  border: "1px solid rgba(255,255,255,0.22)",
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1,
  textDecoration: "none",
  whiteSpace: "nowrap",
  cursor: "pointer",
};

const photoLightboxActionIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
};

const photoLightboxMetadataToggleStyle: React.CSSProperties = {
  ...atlasControlSurfaceStyle,
  flex: "0 0 5rem",
  alignSelf: "stretch",
  marginLeft: "auto",
  width: "5rem",
  height: "100%",
  display: "grid",
  placeItems: "center",
  padding: 0,
  borderRadius: 0,
  color: "#eef2f8",
  border: 0,
  cursor: "pointer",
};

const photoLightboxMetadataChevronStyle: React.CSSProperties = {
  width: 16,
  height: 16,
};

const photoLightboxMetadataBodyStyle: React.CSSProperties = {
  minHeight: 0,
  overflowY: "auto",
  padding: "10px 16px max(12px, env(safe-area-inset-bottom))",
};

const photoLightboxActivityListStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 8,
};

const photoLightboxActivityDescriptionStyle: React.CSSProperties = {
  color: "#d8dce4",
  fontSize: 13,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const photoLightboxAssetCaptionStyle: React.CSSProperties = {
  color: "#c7ccd6",
  fontSize: 13,
  lineHeight: 1.45,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const photoLightboxAssetCaptionSeparatedStyle: React.CSSProperties = {
  marginTop: 10,
  paddingTop: 10,
  borderTop: "1px solid rgba(255,255,255,0.12)",
};

const photoLightboxActivityBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  flex: "0 0 auto",
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
  ...atlasControlSurfaceStyle,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 11px",
  border: "1px solid rgba(255,255,255,0.28)",
  borderRadius: 999,
  color: "#fff",
  font: "inherit",
  fontWeight: 700,
  cursor: "pointer",
};

const photoLightboxCloseStyle: React.CSSProperties = {
  ...atlasControlSurfaceStyle,
  pointerEvents: "auto",
  width: "5rem",
  height: "5rem",
  display: "grid",
  placeItems: "center",
  padding: 0,
  color: "#eef2f8",
  border: "none",
  borderRadius: 0,
  cursor: "pointer",
  position: "absolute",
  top: 0,
  right: 0,
  boxShadow: "none",
};

const photoLightboxPlacementStyle: React.CSSProperties = {
  position: "absolute",
  top: "max(16px, env(safe-area-inset-top))",
  left: 16,
  zIndex: 2,
  maxWidth: "calc(100vw - 96px)",
  color: "#fff",
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
const aboutLinkStyle: React.CSSProperties = { color: "#fff", fontSize: 12, fontWeight: 600, textDecoration: "underline" };

const photoLightboxNavStyle: React.CSSProperties = {
  ...atlasControlSurfaceStyle,
  pointerEvents: "auto",
  position: "absolute",
  top: "50%",
  transform: "translateY(-50%)",
  width: "5rem",
  height: "5rem",
  display: "grid",
  placeItems: "center",
  padding: 0,
  color: "#eef2f8",
  border: "none",
  borderRadius: 0,
  cursor: "pointer",
  boxShadow: "none",
};

const photoLightboxNavIconStyle: React.CSSProperties = {
  width: 20,
  height: 20,
};

const photoLightboxCloseIconStyle: React.CSSProperties = {
  width: 16,
  height: 16,
};
