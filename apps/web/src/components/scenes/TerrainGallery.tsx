import { useThree } from "@react-three/fiber";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from "react";
import * as THREE from "three";
import {
  fetchMapPlacements,
  fetchSiteActivityStats,
  type ActivityOption,
  type MapPlacement,
  type Photo,
} from "../../api/client";
import { useGalleryStore } from "../../stores/galleryStore";
import {
  ORBIT_HEIGHT,
  OrbitingActivityRing,
  OrbitingIconMarker,
  OrbitingPhotoBanner,
  createOrbitGapMotion,
  type OrbitGapMotion,
} from "./TerrainPhotoMarker";
import PlacementSignpost, {
  getPlacementSignStackHeight,
  type PlacementSign,
} from "./PlacementSignpost";
import PlaceMarker, { FlowerLayoutCoordinator } from "./PlaceMarker";
import DocumentationPullQuotePanel from "./DocumentationPullQuotePanel";
import {
  createMaxDetailTerrainRequest,
  createTerrainRequest,
  getGeoPhotos,
} from "./terrainLayout";
import { loadThreeGeo, type ThreeGeoProjection } from "./threeGeoRuntime";
import {
  atlasControlSurfaceStyle,
  atlasPanelSurfaceStyle,
} from "./atlasSurfaceStyles";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? "";
const REGIONAL_TERRAIN_ELEVATION_SCALE = 8;
const FLOWER_PREVIEW_VERTICAL_NDC = 1 / 3;
const LOCAL_TERRAIN_ELEVATION_SCALE = 1.25;
const DEFAULT_TERRAIN_CAMERA_POSITION = new THREE.Vector3(0, -12, 10);
const LOCAL_PLACEMENT_RADIUS_KM = 0.5;
const REGIONAL_CAMERA_FIT_SCALE = 0.5;
const LOCAL_CAMERA_FIT_SCALE = 0.55;
const REGIONAL_DEM_ZOOM_OFFSET = 5;
const LOCAL_DEM_ZOOM_OFFSET = 3;
const ORBIT_TERRAIN_CLEARANCE = 0.12;
const ORBIT_VISUAL_HALF_HEIGHT = 0.5;
const SIGNPOST_TERRAIN_CLEARANCE = 0.35;
const SIGNPOST_MIN_HEIGHT = 2.8;
const SIGNPOST_MAX_DIRECTION_ANGLE = THREE.MathUtils.degToRad(30);
const INTRO_CAMERA_DURATION_MS = 3000;
const PLACEMENT_ORBIT_FIT_DURATION_MS = 100;

type TerrainBenchmark = {
  key: string;
  start: number;
  rgbDemAt: number | null;
  firstSatMatAt: number | null;
  lastSatMatAt: number | null;
  satMatCount: number;
  readyAt: number | null;
  totalTiles: number | null;
};

function createTerrainBenchmark(key: string): TerrainBenchmark {
  return {
    key,
    start: performance.now(),
    rgbDemAt: null,
    firstSatMatAt: null,
    lastSatMatAt: null,
    satMatCount: 0,
    readyAt: null,
    totalTiles: null,
  };
}

function logTerrainBenchmark(
  stage: string,
  bench: TerrainBenchmark,
  extra?: Record<string, unknown>,
) {
  const now = performance.now();
  const elapsed = now - bench.start;
  const payload = { ...extra, elapsedMs: Math.round(elapsed) };
  console.info(`[terrain:${stage}] ${bench.key}`, payload);
}

function summarizeTerrainBenchmark(bench: TerrainBenchmark) {
  const demLatency =
    bench.rgbDemAt !== null ? Math.round(bench.rgbDemAt - bench.start) : null;
  const firstTexLatency =
    bench.firstSatMatAt !== null
      ? Math.round(bench.firstSatMatAt - bench.start)
      : null;
  const lastTexLatency =
    bench.lastSatMatAt !== null
      ? Math.round(bench.lastSatMatAt - bench.start)
      : null;
  const readyLatency =
    bench.readyAt !== null ? Math.round(bench.readyAt - bench.start) : null;
  const textureSpread =
    bench.lastSatMatAt !== null && bench.firstSatMatAt !== null
      ? Math.round(bench.lastSatMatAt - bench.firstSatMatAt)
      : null;
  console.info(`[terrain:summary] ${bench.key}`, {
    demLatencyMs: demLatency,
    firstTextureLatencyMs: firstTexLatency,
    lastTextureLatencyMs: lastTexLatency,
    textureSpreadMs: textureSpread,
    readyLatencyMs: readyLatency,
    texturesLoaded: bench.satMatCount,
    totalTiles: bench.totalTiles,
  });
}

const MAPBOX_TILE_PATTERN =
  /api\.mapbox\.com\/(v4\/mapbox\.terrain-rgb|styles\/v1\/mapbox\/satellite-v9)/;
const MAPBOX_SAT_PATTERN = /api\.mapbox\.com\/styles\/v1\/mapbox\/satellite-v9/;
const MAPBOX_DEM_PATTERN = /api\.mapbox\.com\/v4\/mapbox\.terrain-rgb/;

type TileTimings = {
  started: number;
  done: number;
  inflight: number;
  totalBytes: number;
  firstFetchAt: number | null;
  lastResponseEndAt: number | null;
  duration: { p50: number; p90: number; max: number };
  queue: { p50: number; p90: number; max: number };
  server: { p50: number; p90: number; max: number };
  download: { p50: number; p90: number; max: number };
};

function pickPercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return Math.round(sorted[idx]);
}

function collectTileTimings(
  bench: TerrainBenchmark,
  pattern: RegExp,
): TileTimings | null {
  if (typeof performance === "undefined" || !performance.getEntriesByType)
    return null;
  const entries = performance.getEntriesByType(
    "resource",
  ) as PerformanceResourceTiming[];
  const matched = entries.filter(
    (e) => e.fetchStart >= bench.start && pattern.test(e.name),
  );
  if (matched.length === 0) return null;

  const started = matched.length;
  const done = matched.filter((e) => e.responseEnd > 0).length;
  const inflight = started - done;
  const totalBytes = matched.reduce((sum, e) => sum + (e.transferSize || 0), 0);
  const firstFetchAt = Math.min(...matched.map((e) => e.fetchStart));
  const finished = matched.filter((e) => e.responseEnd > 0);
  const lastResponseEndAt =
    finished.length > 0
      ? Math.max(...finished.map((e) => e.responseEnd))
      : null;

  const durations = matched
    .map((e) => e.duration)
    .filter((d) => d > 0)
    .sort((a, b) => a - b);
  const queueTimes = matched
    .filter((e) => e.requestStart > 0)
    .map((e) => e.requestStart - e.fetchStart)
    .sort((a, b) => a - b);
  const serverTimes = matched
    .filter((e) => e.responseStart > 0)
    .map((e) => e.responseStart - e.requestStart)
    .sort((a, b) => a - b);
  const downloadTimes = matched
    .filter((e) => e.responseEnd > 0 && e.responseStart > 0)
    .map((e) => e.responseEnd - e.responseStart)
    .sort((a, b) => a - b);

  return {
    started,
    done,
    inflight,
    totalBytes,
    firstFetchAt: Math.round(firstFetchAt - bench.start),
    lastResponseEndAt:
      lastResponseEndAt !== null
        ? Math.round(lastResponseEndAt - bench.start)
        : null,
    duration: {
      p50: pickPercentile(durations, 0.5),
      p90: pickPercentile(durations, 0.9),
      max: pickPercentile(durations, 1),
    },
    queue: {
      p50: pickPercentile(queueTimes, 0.5),
      p90: pickPercentile(queueTimes, 0.9),
      max: pickPercentile(queueTimes, 1),
    },
    server: {
      p50: pickPercentile(serverTimes, 0.5),
      p90: pickPercentile(serverTimes, 0.9),
      max: pickPercentile(serverTimes, 1),
    },
    download: {
      p50: pickPercentile(downloadTimes, 0.5),
      p90: pickPercentile(downloadTimes, 0.9),
      max: pickPercentile(downloadTimes, 1),
    },
  };
}

function logTileTimings(
  stage: string,
  bench: TerrainBenchmark,
  label: string,
  pattern: RegExp,
) {
  const timings = collectTileTimings(bench, pattern);
  if (!timings) {
    console.info(
      `[terrain:${stage}] ${bench.key} ${label}: no resource timings`,
    );
    return;
  }
  console.info(`[terrain:${stage}] ${bench.key} ${label}`, {
    started: timings.started,
    done: timings.done,
    inflight: timings.inflight,
    totalBytes: timings.totalBytes,
    firstFetchAtMs: timings.firstFetchAt,
    lastResponseEndAtMs: timings.lastResponseEndAt,
    duration: timings.duration,
    queueMs: timings.queue,
    serverLatencyMs: timings.server,
    downloadMs: timings.download,
  });
}

function startLongTaskObserver(
  bench: TerrainBenchmark,
): PerformanceObserver | null {
  if (
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("longtask")
  ) {
    return null;
  }
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      const startMs = Math.round(entry.startTime - bench.start);
      console.info(`[terrain:longtask] ${bench.key}`, {
        startMs,
        durationMs: Math.round(entry.duration),
        elapsedAtEndMs: Math.round(
          entry.startTime + entry.duration - bench.start,
        ),
      });
    }
  });
  observer.observe({ entryTypes: ["longtask"] });
  return observer;
}

type TileDispatchProbe = {
  active: boolean;
  satCount: number;
  demCount: number;
  firstSatDispatchAt: number | null;
  lastSatDispatchAt: number | null;
  lastBench: TerrainBenchmark | null;
};

function installTileDispatchProbe(bench: TerrainBenchmark): () => void {
  const probe: TileDispatchProbe = {
    active: true,
    satCount: 0,
    demCount: 0,
    firstSatDispatchAt: null,
    lastSatDispatchAt: null,
    lastBench: bench,
  };

  const patchXHR = () => {
    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (
      method: string,
      url: string,
      ...rest: unknown[]
    ) {
      (this as XMLHttpRequest & { __artasiaUrl?: string }).__artasiaUrl = url;
      return origOpen.call(
        this as XMLHttpRequest,
        method,
        url,
        ...(rest as [boolean, string | null]),
      );
    };
    XMLHttpRequest.prototype.send = function (...args: unknown[]) {
      const self = this as XMLHttpRequest & { __artasiaUrl?: string };
      if (
        probe.active &&
        typeof self.__artasiaUrl === "string" &&
        probe.lastBench
      ) {
        const url = self.__artasiaUrl;
        const b = probe.lastBench;
        if (MAPBOX_SAT_PATTERN.test(url)) {
          probe.satCount += 1;
          const now = performance.now();
          if (probe.firstSatDispatchAt === null) probe.firstSatDispatchAt = now;
          probe.lastSatDispatchAt = now;
          if (probe.satCount === 1 || probe.satCount % 10 === 0) {
            console.info(`[terrain:xhr-sat-dispatch] ${b.key}`, {
              dispatch: probe.satCount,
              elapsedMs: Math.round(now - b.start),
              url: url.slice(0, 120),
            });
          }
        } else if (MAPBOX_DEM_PATTERN.test(url)) {
          probe.demCount += 1;
          if (probe.demCount === 1 || probe.demCount % 5 === 0) {
            console.info(`[terrain:xhr-dem-dispatch] ${b.key}`, {
              dispatch: probe.demCount,
              elapsedMs: Math.round(performance.now() - b.start),
            });
          }
        }
      }
      return origSend.apply(
        self as XMLHttpRequest,
        args as [XMLHttpRequestBodyInit | Document | null],
      );
    };
    return () => {
      XMLHttpRequest.prototype.open = origOpen;
      XMLHttpRequest.prototype.send = origSend;
    };
  };

  let restoreFetch: (() => void) | null = null;
  if (typeof window.fetch === "function") {
    const origFetch = window.fetch;
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
      if (probe.active && probe.lastBench) {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input?.url;
        if (url && MAPBOX_SAT_PATTERN.test(url)) {
          probe.satCount += 1;
          const now = performance.now();
          if (probe.firstSatDispatchAt === null) probe.firstSatDispatchAt = now;
          probe.lastSatDispatchAt = now;
          if (probe.satCount === 1 || probe.satCount % 10 === 0) {
            console.info(
              `[terrain:fetch-sat-dispatch] ${probe.lastBench.key}`,
              {
                dispatch: probe.satCount,
                elapsedMs: Math.round(now - probe.lastBench.start),
                url: url.slice(0, 120),
              },
            );
          }
        } else if (url && MAPBOX_DEM_PATTERN.test(url)) {
          probe.demCount += 1;
          if (probe.demCount === 1 || probe.demCount % 5 === 0) {
            console.info(
              `[terrain:fetch-dem-dispatch] ${probe.lastBench.key}`,
              {
                dispatch: probe.demCount,
                elapsedMs: Math.round(
                  performance.now() - probe.lastBench.start,
                ),
              },
            );
          }
        }
      }
      return origFetch.call(this, input, init);
    };
    restoreFetch = () => {
      window.fetch = origFetch;
    };
  }

  const restoreXHR = patchXHR();

  // three-geo (via get-pixels) loads raster tiles as `new Image()` with
  // `crossOrigin="Anonymous"` and assigns `img.src = url` — see three-geo.min
  // .js:99052. Neither fetch() nor XHR is involved, which is why the XHR probe
  // above records zero dispatches while Resource Timing still shows the tiles.
  // To timestamp the actual `img.src = url` assignment we override the
  // `HTMLImageElement.prototype.src` setter for the duration of this terrain
  // load.
  let restoreImageSrc: (() => void) | null = null;
  const imgDescriptor = Object.getOwnPropertyDescriptor(
    HTMLImageElement.prototype,
    "src",
  );
  if (imgDescriptor?.set) {
    const origSet = imgDescriptor.set;
    Object.defineProperty(HTMLImageElement.prototype, "src", {
      configurable: true,
      enumerable: true,
      get: imgDescriptor.get,
      set(value: string) {
        if (probe.active && probe.lastBench && typeof value === "string") {
          const b = probe.lastBench;
          if (MAPBOX_SAT_PATTERN.test(value)) {
            probe.satCount += 1;
            const now = performance.now();
            if (probe.firstSatDispatchAt === null)
              probe.firstSatDispatchAt = now;
            probe.lastSatDispatchAt = now;
            if (probe.satCount === 1 || probe.satCount % 10 === 0) {
              console.info(`[terrain:image-sat-dispatch] ${b.key}`, {
                dispatch: probe.satCount,
                elapsedMs: Math.round(now - b.start),
                url: value.slice(0, 120),
              });
            }
          } else if (MAPBOX_DEM_PATTERN.test(value)) {
            probe.demCount += 1;
            if (probe.demCount === 1 || probe.demCount % 5 === 0) {
              console.info(`[terrain:image-dem-dispatch] ${b.key}`, {
                dispatch: probe.demCount,
                elapsedMs: Math.round(performance.now() - b.start),
              });
            }
          }
        }
        return origSet.call(this as HTMLImageElement, value);
      },
    });
    restoreImageSrc = () => {
      Object.defineProperty(HTMLImageElement.prototype, "src", {
        configurable: true,
        enumerable: true,
        get: imgDescriptor.get,
        set: origSet,
      });
    };
  }

  return () => {
    probe.active = false;
    restoreXHR();
    restoreFetch?.();
    restoreImageSrc?.();
    if (probe.lastBench) {
      console.info(`[terrain:tile-dispatch-summary] ${probe.lastBench.key}`, {
        satDispatches: probe.satCount,
        demDispatches: probe.demCount,
        firstSatDispatchAtMs:
          probe.firstSatDispatchAt !== null
            ? Math.round(probe.firstSatDispatchAt - probe.lastBench.start)
            : null,
        lastSatDispatchAtMs:
          probe.lastSatDispatchAt !== null
            ? Math.round(probe.lastSatDispatchAt - probe.lastBench.start)
            : null,
      });
    }
  };
}
type TerrainPhase =
  | "idle"
  | "projecting"
  | "fetching"
  | "rendering"
  | "ready"
  | "flat"
  | "error";
type LocalPhotoLayoutItem = {
  kind: "orbit";
  photo: Photo;
  sourceIndex: number;
  center: [number, number, number];
  orbitRadius: number;
  orbitAssetCount: number;
  orbitColour?: string;
  activityId: number;
};
type TerrainOrbitControls = {
  target?: THREE.Vector3;
  update?: () => void;
};
type IntroPhase = "loading" | "ready" | "exiting" | "complete";
type TerrainCameraFrame = {
  position: THREE.Vector3;
  target: THREE.Vector3;
};
type TerrainCacheEntry = {
  terrain: THREE.Group | null;
  projection: ThreeGeoProjection;
  phase: Extract<TerrainPhase, "ready" | "flat">;
};
type TerrainRun = {
  subscribers: number;
  releaseTimer: number | null;
  release: () => void;
};
export type TerrainNotice = {
  label: string;
  detail?: string;
  tone?: "loading" | "error" | "muted";
  busy?: boolean;
};
export type PartnerFilterOption = {
  value: string;
  label: string;
  count: number;
  whiteLogo?: {
    url: string;
    alt: string;
  } | null;
};

const SITE_PATH_PREFIX = "/sites/";
const EARLY_ON_PARTNER_FILTER = "__earlyon__";

interface TerrainGalleryProps {
  authenticated?: boolean | null;
  introEnabled?: boolean;
  introPhase?: IntroPhase;
  introPanOffsetRef?: { current: boolean };
  onIntroReady?: () => void;
  onIntroComplete?: () => void;
  onNoticeChange?: (notice: TerrainNotice | null) => void;
  onBackActionChange?: (action: (() => void) | null) => void;
  onFocusedPlacementChange?: (placement: MapPlacement | null) => void;
  onHoveredPlacementChange?: (placement: MapPlacement | null) => void;
  onPreviewPlacementChange?: (
    placement: MapPlacement | null,
    openAction?: (() => void) | null,
  ) => void;
  onPartnerFilterOptionsChange?: (options: PartnerFilterOption[]) => void;
  selectedPartnerFilter?: string;
  selectedActivityFilter?: string;
  selectedActivityColour?: string;
  activityOptions?: ActivityOption[];
}

export default function TerrainGallery({
  authenticated = null,
  introEnabled = false,
  introPhase = "complete",
  introPanOffsetRef,
  onIntroReady,
  onIntroComplete,
  onNoticeChange,
  onBackActionChange,
  onFocusedPlacementChange,
  onHoveredPlacementChange,
  onPreviewPlacementChange,
  onPartnerFilterOptionsChange,
  selectedPartnerFilter = "",
  selectedActivityFilter = "",
  selectedActivityColour,
  activityOptions = [],
}: TerrainGalleryProps = {}) {
  const camera = useThree((state) => state.camera);
  const controls = useThree(
    (state) =>
      (state as unknown as { controls?: TerrainOrbitControls }).controls,
  );
  const usesTouchPreview = useTouchPreviewMode();
  const panAnimationFrame = useRef<number | null>(null);
  const photos = useGalleryStore((s) => s.photos);
  const photoScope = useGalleryStore((s) => s.photoScope);
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
  const [renderedTerrainKey, setRenderedTerrainKey] = useState<string | null>(
    null,
  );
  const [placements, setPlacements] = useState<MapPlacement[]>([]);
  const [placementsWithAssets, setPlacementsWithAssets] = useState<Set<number>>(
    () => new Set(),
  );
  const [placementError, setPlacementError] = useState<string | null>(null);
  const [placementsResolved, setPlacementsResolved] = useState(false);
  const [requestedSiteSlug, setRequestedSiteSlug] = useState(() =>
    getSiteSlugFromPath(window.location.pathname),
  );
  const [focusedPlacement, setFocusedPlacement] = useState<MapPlacement | null>(
    null,
  );
  const [hoveredPlacement, setHoveredPlacement] = useState<MapPlacement | null>(
    null,
  );
  const [previewPlacement, setPreviewPlacement] = useState<MapPlacement | null>(
    null,
  );
  const terrainCacheRef = useRef<Map<string, TerrainCacheEntry>>(new Map());
  const terrainRunsRef = useRef<Map<string, TerrainRun>>(new Map());
  const introStartSetRef = useRef(false);
  const previousPartnerFilterRef = useRef(selectedPartnerFilter);
  const partnerFitAnimationRef = useRef<number | null>(null);
  const lastFramedActivityFilterRef = useRef(selectedActivityFilter);
  const activityFitPlacementRef = useRef<number | null>(null);
  const activityFitAnimationRef = useRef<number | null>(null);
  const placementOrbitFitPlacementRef = useRef<number | null>(null);
  const placementOrbitFitAnimationRef = useRef<number | null>(null);

  const partnerFilterOptions = useMemo<PartnerFilterOption[]>(() => {
    const partners = new Map<
      string,
      { count: number; whiteLogo?: PartnerFilterOption["whiteLogo"] }
    >();
    for (const placement of placements) {
      const partner = placement.partner_name?.trim();
      if (!partner) continue;
      const current = partners.get(partner);
      partners.set(partner, {
        count: (current?.count ?? 0) + 1,
        whiteLogo:
          current?.whiteLogo ??
          (placement.partner_white_logo?.url
            ? {
                url: placement.partner_white_logo.url,
                alt: placement.partner_white_logo.alt,
              }
            : null),
      });
    }
    const options = [...partners.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([partner, { count, whiteLogo }]) => ({
        value: partner,
        label: partner,
        count,
        whiteLogo,
      }));
    const earlyOnCount = placements.filter((placement) => placement.is_earlyon).length;
    if (earlyOnCount > 0) {
      options.push({
        value: EARLY_ON_PARTNER_FILTER,
        label: "EarlyON",
        count: earlyOnCount,
        whiteLogo: null,
      });
    }
    return options;
  }, [placements]);
  const filteredRegionalPlacements = useMemo(() => {
    if (!selectedPartnerFilter) return placements;
    if (selectedPartnerFilter === EARLY_ON_PARTNER_FILTER) {
      return placements.filter((placement) => placement.is_earlyon);
    }
    return placements.filter(
      (placement) => placement.partner_name?.trim() === selectedPartnerFilter,
    );
  }, [placements, selectedPartnerFilter]);
  const selectedActivityId = useMemo(() => {
    if (!selectedActivityFilter) return undefined;
    const value = parseInt(selectedActivityFilter, 10);
    return Number.isFinite(value) ? value : undefined;
  }, [selectedActivityFilter]);
  const photosForCurrentView = useMemo(() => {
    if (focusedPlacement) {
      if (!isMatchingPlacementPhotoScope(photoScope, focusedPlacement.placement_id)) {
        return [];
      }
      if (selectedActivityId == null) return photos;
      return photos.filter((photo) => photo.activityIds?.includes(selectedActivityId));
    }
    return photoScope.mode === "regional" ? photos : [];
  }, [focusedPlacement, photoScope, photos, selectedActivityId]);
  const photoIndexById = useMemo(
    () => new Map(photos.map((photo, index) => [photo.id, index])),
    [photos],
  );
  const geoPhotos = useMemo(() => {
    return getGeoPhotos(
      photosForCurrentView.filter((photo) => photo.mediaKind === "image"),
    );
  }, [photosForCurrentView]);
  const geoPlacements = useMemo(
    () =>
      (focusedPlacement ? [focusedPlacement] : placements)
        .filter(
          (placement) =>
            Number.isFinite(placement.lat) && Number.isFinite(placement.lng),
        )
        .map((placement) => ({ lat: placement.lat, lng: placement.lng })),
    [focusedPlacement, placements],
  );
  const visiblePlacements = useMemo(
    () => (focusedPlacement ? [focusedPlacement] : filteredRegionalPlacements),
    [filteredRegionalPlacements, focusedPlacement],
  );
  const request = useMemo(() => {
    if (focusedPlacement) {
      return createMaxDetailTerrainRequest(
        [focusedPlacement.lat, focusedPlacement.lng],
        LOCAL_PLACEMENT_RADIUS_KM,
      );
    }
    // Don't fall back to geoPhotos until the placements fetch has actually
    // resolved; otherwise we'd fire a regional terrain load on photos alone,
    // get evicted a moment later when placements arrive, and re-fetch with a
    // different region (the double map-load issue).
    if (geoPlacements.length > 0) return createTerrainRequest(geoPlacements);
    if (placementsResolved) return createTerrainRequest(geoPhotos);
    return null;
  }, [focusedPlacement, geoPhotos, geoPlacements, placementsResolved]);
  const requestKey = useMemo(() => {
    if (!request) return null;
    const mode = focusedPlacement
      ? `placement:${focusedPlacement.placement_id}`
      : "regional";
    const demZoomOffset = focusedPlacement
      ? LOCAL_DEM_ZOOM_OFFSET
      : REGIONAL_DEM_ZOOM_OFFSET;
    return [
      mode,
      request.origin[0],
      request.origin[1],
      request.radiusKm,
      request.zoom,
      request.unitsSide,
      `dem${demZoomOffset}`,
    ].join(":");
  }, [focusedPlacement, request]);
  const terrainElevationScale = focusedPlacement
    ? LOCAL_TERRAIN_ELEVATION_SCALE
    : REGIONAL_TERRAIN_ELEVATION_SCALE;
  const terrainDemZoomOffset = focusedPlacement
    ? LOCAL_DEM_ZOOM_OFFSET
    : REGIONAL_DEM_ZOOM_OFFSET;
  const terrainBounds = useMemo(() => {
    if (!terrain) return null;
    terrain.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(terrain);
    return Number.isFinite(bounds.max.z) ? bounds : null;
  }, [terrain]);
  const terrainMaxZ = terrainBounds?.max.z ?? null;
  const orbitHeight = useMemo(() => {
    if (!focusedPlacement || !projection || !terrain || terrainMaxZ == null) return ORBIT_HEIGHT;

    const [placementX, placementY, placementZ = 0] = projection.proj([
      focusedPlacement.lat,
      focusedPlacement.lng,
    ]);
    const placementTerrainZ = sampleTerrainZ(terrain, placementX, placementY) ?? placementZ;

    return Math.max(
      ORBIT_HEIGHT,
      terrainMaxZ - placementTerrainZ + ORBIT_VISUAL_HALF_HEIGHT + ORBIT_TERRAIN_CLEARANCE,
    );
  }, [focusedPlacement, projection, terrain, terrainMaxZ]);
  const focusedPlacementCenter = useMemo<[number, number, number] | null>(() => {
    if (!focusedPlacement || !projection) return null;
    const [placementX, placementY, placementZ = 0] = projection.proj([
      focusedPlacement.lat,
      focusedPlacement.lng,
    ]);
    return [
      placementX,
      placementY,
      terrain
        ? (sampleTerrainZ(terrain, placementX, placementY) ?? placementZ)
        : placementZ,
    ];
  }, [focusedPlacement, projection, terrain]);
  const localPhotoLayout = useMemo<LocalPhotoLayoutItem[]>(() => {
    if (!focusedPlacementCenter) return [];
    const orbitForPhoto = (photo: Photo) => {
      const activity = activityOptions.find((option) =>
        photo.activityIds?.includes(option.id),
      );
      const rank = activity
        ? activityOptions.findIndex((option) => option.id === activity.id)
        : -1;
      const outerRank = Math.max(0, activityOptions.length - 1);
      const currentOuterRadius = 0.78 + outerRank * 0.3;
      const expandedStep = outerRank > 0
        ? (currentOuterRadius * 2 - 0.78) / outerRank
        : 0.6;
      const untaggedRadius = currentOuterRadius * 2 + expandedStep;
      return {
        orbitRadius: rank >= 0
          ? 0.78 + rank * expandedStep
          : untaggedRadius,
        orbitAssetCount: 0,
        activityId: activity?.id ?? -1,
        orbitColour: activity?.colour ?? "#8a9099",
      };
    };

    const orbitItems = photosForCurrentView.flatMap<LocalPhotoLayoutItem>(
      (photo) => {
        const sourceIndex = photoIndexById.get(photo.id);
        if (sourceIndex == null) return [];
        return [
          {
            kind: "orbit",
            photo,
            sourceIndex,
            center: focusedPlacementCenter,
            ...orbitForPhoto(photo),
          },
        ];
      },
    );
    const orbitCounts = new Map<number, number>();
    for (const item of orbitItems) {
      orbitCounts.set(item.activityId, (orbitCounts.get(item.activityId) ?? 0) + 1);
    }
    return orbitItems.map((item) => ({
      ...item,
      orbitAssetCount: orbitCounts.get(item.activityId) ?? 1,
    }));
  }, [
    activityOptions,
    focusedPlacementCenter,
    photoIndexById,
    photosForCurrentView,
  ]);
  const activityOrbitRings = useMemo(() => {
    const rings = new Map<number, {
      radius: number;
      colour: string;
      center: [number, number, number];
      gaps: OrbitGapMotion[];
    }>();
    for (const item of localPhotoLayout) {
      const gap = createOrbitGapMotion({
        id: item.photo.id,
        radius: item.orbitRadius,
        mediaKind: item.photo.mediaKind,
        width: item.photo.width,
        height: item.photo.height,
        isDenseOrbit: item.orbitAssetCount >= 5,
        isEngaged: item.sourceIndex === hoveredIndex || (
          item.photo.mediaKind !== "audio" &&
          item.photo.mediaKind !== "anecdote" &&
          item.sourceIndex === selectedIndex
        ),
      });
      const existingRing = rings.get(item.activityId);
      if (existingRing) {
        existingRing.gaps.push(gap);
        continue;
      }
      rings.set(item.activityId, {
        radius: item.orbitRadius,
        colour: item.orbitColour ?? "#ffffff",
        center: item.center,
        gaps: [gap],
      });
    }
    return [...rings.values()];
  }, [hoveredIndex, localPhotoLayout, selectedIndex]);
  const documentationQuoteLayout = useMemo(() => {
    const quote = focusedPlacement?.documentation_pull_quote?.trim();
    if (!quote || !focusedPlacementCenter || !request) return null;

    const halfTerrain = request.unitsSide / 2;
    const minX = terrainBounds?.min.x ?? -halfTerrain;
    const maxX = terrainBounds?.max.x ?? halfTerrain;
    const minY = terrainBounds?.min.y ?? -halfTerrain;
    const maxY = terrainBounds?.max.y ?? halfTerrain;
    const terrainWidth = Math.max(1, maxX - minX);
    const terrainHeight = Math.max(1, maxY - minY);
    const width = THREE.MathUtils.clamp(terrainWidth * 0.38, 3.8, 4.8);
    const height = THREE.MathUtils.clamp(terrainHeight * 0.78, 5.2, 9.2);
    const gap = Math.max(0.38, terrainWidth * 0.035);
    const x = maxX + gap + width / 2;
    const y = (minY + maxY) / 2;

    return {
      quote,
      width,
      height,
      position: [
        x,
        y,
        focusedPlacementCenter[2] + orbitHeight,
      ] as [number, number, number],
      fitBounds: {
        minX,
        maxX: x + width / 2,
        minY: Math.min(minY, y - height / 2),
        maxY: Math.max(maxY, y + height / 2),
      },
    };
  }, [
    focusedPlacement,
    focusedPlacementCenter,
    orbitHeight,
    request,
    terrainBounds,
  ]);

  useEffect(() => {
    const placementId = focusedPlacement?.placement_id ?? null;
    if (activityFitPlacementRef.current !== placementId) {
      activityFitPlacementRef.current = placementId;
      lastFramedActivityFilterRef.current = selectedActivityFilter;
      return;
    }
    if (
      !focusedPlacement ||
      lastFramedActivityFilterRef.current === selectedActivityFilter ||
      activityOrbitRings.length === 0 ||
      galleryLoading ||
      !controls?.target
    ) return;

    if (documentationQuoteLayout) {
      lastFramedActivityFilterRef.current = selectedActivityFilter;
      return;
    }

    const center = new THREE.Vector3(...activityOrbitRings[0].center);
    center.z += 0.72;
    const outerRadius = Math.max(...activityOrbitRings.map((ring) => ring.radius));
    const contentRadius = Math.max(1, outerRadius + 0.75);
    const verticalFov = camera instanceof THREE.PerspectiveCamera
      ? THREE.MathUtils.degToRad(camera.fov)
      : THREE.MathUtils.degToRad(50);
    const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const limitingFov = Math.min(verticalFov, horizontalFov);
    const distance = THREE.MathUtils.clamp(
      contentRadius * 1.35 / Math.tan(limitingFov / 2),
      2.4,
      70,
    );
    const startTarget = controls.target.clone();
    const startPosition = camera.position.clone();
    const direction = startPosition.clone().sub(startTarget).normalize();
    const endPosition = center.clone().addScaledVector(direction, distance);
    const startedAt = performance.now();
    if (activityFitAnimationRef.current !== null) {
      cancelAnimationFrame(activityFitAnimationRef.current);
    }
    const animateFit = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startedAt) / 550);
      const eased = 1 - Math.pow(1 - progress, 3);
      controls.target!.lerpVectors(startTarget, center, eased);
      camera.position.lerpVectors(startPosition, endPosition, eased);
      camera.lookAt(controls.target!);
      controls.update?.();
      activityFitAnimationRef.current = progress < 1
        ? requestAnimationFrame(animateFit)
        : null;
    };
    lastFramedActivityFilterRef.current = selectedActivityFilter;
    activityFitAnimationRef.current = requestAnimationFrame(animateFit);
    return () => {
      if (activityFitAnimationRef.current !== null) {
        cancelAnimationFrame(activityFitAnimationRef.current);
        activityFitAnimationRef.current = null;
      }
    };
  }, [
    activityOrbitRings,
    camera,
    controls,
    documentationQuoteLayout,
    focusedPlacement,
    galleryLoading,
    selectedActivityFilter,
  ]);

  const placementLayout = useMemo(() => {
    if (!projection) return [];
    const projected = visiblePlacements.flatMap((placement) => {
      if (!Number.isFinite(placement.lat) || !Number.isFinite(placement.lng))
        return [];
      const [x, y, z = 0] = projection.proj([placement.lat, placement.lng]);
      return [
        {
          placement,
          x,
          y,
          z,
        },
      ];
    });
    const anchorGroups = new Map<string, typeof projected>();
    for (const item of projected) {
      const key = getPlacementAnchorKey(item.placement);
      const group = anchorGroups.get(key);
      if (group) group.push(item);
      else anchorGroups.set(key, [item]);
    }

    return projected.map(({ placement, x, y, z }) => {
      const anchorGroup =
        anchorGroups.get(getPlacementAnchorKey(placement)) ?? [];
      const orderedAnchorGroup = [...anchorGroup].sort(
        (a, b) => a.placement.placement_id - b.placement.placement_id,
      );
      const anchorX = anchorGroup.length > 1
        ? anchorGroup.reduce((sum, item) => sum + item.x, 0) / anchorGroup.length
        : x;
      const anchorY = anchorGroup.length > 1
        ? anchorGroup.reduce((sum, item) => sum + item.y, 0) / anchorGroup.length
        : y;
      const anchorZ = terrain
        ? (sampleTerrainZ(terrain, anchorX, anchorY) ?? z)
        : z;
      return {
        placement,
        isForked: anchorGroup.length > 1,
        clusterIndex: orderedAnchorGroup.findIndex(
          (item) =>
            item.placement.placement_id === placement.placement_id,
        ),
        clusterCount: orderedAnchorGroup.length,
        position: [
          anchorX,
          anchorY,
          anchorZ,
        ] as [number, number, number],
      };
    });
  }, [focusedPlacement, projection, terrain, visiblePlacements]);

  const placementSigns = useMemo(() => {
    const signsByPlacementId = new Map<number, PlacementSign[]>();
    const signTargets = focusedPlacement && projection
      ? placements
        .filter((placement) => Number.isFinite(placement.lat) && Number.isFinite(placement.lng))
        .map((placement) => {
          const [x, y, z = 0] = projection.proj([placement.lat, placement.lng]);
          return {
            placement,
            position: [x, y, z] as [number, number, number],
          };
        })
      : placementLayout;
    const signposts = focusedPlacement ? placementLayout : signTargets;

    for (const current of signposts) {
      const currentAnchor = getPlacementAnchorKey(current.placement);
      const samePlace = signTargets
        .filter(
          (candidate) =>
            candidate.placement.placement_id !== current.placement.placement_id &&
            getPlacementAnchorKey(candidate.placement) === currentAnchor,
        )
        .sort((a, b) => a.placement.placement_id - b.placement.placement_id);
      const nearbyAnchors = new Set<string>();
      const nearby = signTargets
        .filter(
          (candidate) =>
            candidate.placement.placement_id !== current.placement.placement_id &&
            getPlacementAnchorKey(candidate.placement) !== currentAnchor,
        )
        .sort(
          (a, b) =>
            haversineMeters(
              [a.placement.lat, a.placement.lng],
              [current.placement.lat, current.placement.lng],
            ) -
            haversineMeters(
              [b.placement.lat, b.placement.lng],
              [current.placement.lat, current.placement.lng],
            ) || a.placement.placement_id - b.placement.placement_id,
        )
        .filter((candidate) => {
          const anchorKey = getPlacementAnchorKey(candidate.placement);
          if (nearbyAnchors.has(anchorKey)) return false;
          nearbyAnchors.add(anchorKey);
          return true;
        })
        .slice(0, 3);

      const signs = [
        ...nearby.map<PlacementSign>((target) => ({
          id: `nearby:${target.placement.placement_id}`,
          label: getPlacementSignLabel(
            target.placement,
            haversineMeters(
              [current.placement.lat, current.placement.lng],
              [target.placement.lat, target.placement.lng],
            ),
          ),
          direction: target.position[0] >= current.position[0] ? "right" : "left",
          angle: getPlacementSignAngle(current, target),
          onClick: () => updatePlacementPath(target.placement),
        })),
        ...samePlace.map<PlacementSign>((target) => ({
          id: `same-place:${target.placement.placement_id}`,
          label: getSharedPlacementSignLabel(target.placement),
          direction: "down",
          angle: 0,
          onClick: () => updatePlacementPath(target.placement),
        })),
      ];
      signsByPlacementId.set(current.placement.placement_id, signs);
    }
    return signsByPlacementId;
  }, [focusedPlacement, placementLayout, placements, projection]);

  useEffect(() => {
    const filterChanged = previousPartnerFilterRef.current !== selectedPartnerFilter;
    if (
      !filterChanged ||
      focusedPlacement ||
      placementLayout.length === 0 ||
      !controls?.target ||
      (introEnabled && introPhase !== "complete")
    ) return;

    previousPartnerFilterRef.current = selectedPartnerFilter;

    const bounds = new THREE.Box3();
    for (const item of placementLayout) {
      bounds.expandByPoint(new THREE.Vector3(...item.position));
    }
    const target = bounds.getCenter(new THREE.Vector3());
    const clusterRadius = Math.max(
      0.8,
      bounds.getBoundingSphere(new THREE.Sphere()).radius + 0.75,
    );
    const verticalFov = camera instanceof THREE.PerspectiveCamera
      ? THREE.MathUtils.degToRad(camera.fov)
      : THREE.MathUtils.degToRad(50);
    const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    const limitingFov = Math.min(verticalFov, horizontalFov);
    const distance = THREE.MathUtils.clamp(
      clusterRadius * 1.25 / Math.tan(limitingFov / 2),
      2.2,
      65,
    );
    const startTarget = controls.target.clone();
    const startPosition = camera.position.clone();
    const direction = startPosition.clone().sub(startTarget).normalize();
    const endPosition = target.clone().addScaledVector(direction, distance);
    const startedAt = performance.now();
    if (partnerFitAnimationRef.current !== null) {
      cancelAnimationFrame(partnerFitAnimationRef.current);
    }
    const animateFit = (timestamp: number) => {
      const progress = Math.min(1, (timestamp - startedAt) / 550);
      const eased = 1 - Math.pow(1 - progress, 3);
      controls.target!.lerpVectors(startTarget, target, eased);
      camera.position.lerpVectors(startPosition, endPosition, eased);
      camera.lookAt(controls.target!);
      controls.update?.();
      partnerFitAnimationRef.current = progress < 1
        ? requestAnimationFrame(animateFit)
        : null;
    };
    partnerFitAnimationRef.current = requestAnimationFrame(animateFit);
    return () => {
      if (partnerFitAnimationRef.current !== null) {
        cancelAnimationFrame(partnerFitAnimationRef.current);
        partnerFitAnimationRef.current = null;
      }
    };
  }, [camera, controls, focusedPlacement, introEnabled, introPhase, placementLayout, selectedPartnerFilter]);

  const focusPlacement = useCallback(
    (
      placement: MapPlacement,
      options?: { replaceUrl?: boolean; skipUrlUpdate?: boolean },
    ) => {
      document.body.style.cursor = "";
      setHoveredPlacement(null);
      setPreviewPlacement(null);
      setFocusedPlacement(placement);
      setRenderedTerrainKey(null);
      selectPhoto(null);
      if (!options?.skipUrlUpdate) {
        updatePlacementPath(placement, Boolean(options?.replaceUrl));
      }
    },
    [selectPhoto],
  );

  const returnToRegional = useCallback(
    (options?: { replaceUrl?: boolean; skipUrlUpdate?: boolean }) => {
      document.body.style.cursor = "";
      setFocusedPlacement(null);
      setPreviewPlacement(null);
      setRenderedTerrainKey(null);
      selectPhoto(null);
      if (!options?.skipUrlUpdate) {
        updateViewerPath("/", Boolean(options?.replaceUrl));
      }
      void fetchPhotos();
    },
    [fetchPhotos, selectPhoto],
  );

  const openPreviewPlacement = useCallback(() => {
    if (!previewPlacement) return;
    focusPlacement(previewPlacement);
  }, [focusPlacement, previewPlacement]);

  const panToPlacement = useCallback(
    (position: [number, number, number]) => {
      if (!usesTouchPreview || !controls?.target) return;
      const nextTarget = new THREE.Vector3(position[0], position[1], position[2] + 0.65);
      if (panAnimationFrame.current !== null) cancelAnimationFrame(panAnimationFrame.current);
      const startTarget = controls.target.clone();
      const startPosition = camera.position.clone();
      const centeredEndPosition = startPosition
        .clone()
        .add(nextTarget.clone().sub(startTarget));
      const cameraDistance = centeredEndPosition.distanceTo(nextTarget);
      const halfViewHeight = camera instanceof THREE.PerspectiveCamera
        ? Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * cameraDistance
        : camera instanceof THREE.OrthographicCamera
          ? (camera.top - camera.bottom) / (2 * camera.zoom)
          : 0;
      const previewOffset = new THREE.Vector3(0, 1, 0)
        .applyQuaternion(camera.quaternion)
        .normalize()
        .multiplyScalar(halfViewHeight * FLOWER_PREVIEW_VERTICAL_NDC);
      const endTarget = nextTarget.clone().sub(previewOffset);
      const endPosition = centeredEndPosition.sub(previewOffset);
      const startedAt = performance.now();
      const animatePan = (timestamp: number) => {
        const progress = Math.min(1, (timestamp - startedAt) / 300);
        const eased = 1 - Math.pow(1 - progress, 3);
        controls.target!.lerpVectors(startTarget, endTarget, eased);
        camera.position.lerpVectors(startPosition, endPosition, eased);
        camera.lookAt(controls.target!);
        controls.update?.();
        panAnimationFrame.current = progress < 1 ? requestAnimationFrame(animatePan) : null;
      };
      panAnimationFrame.current = requestAnimationFrame(animatePan);
    },
    [camera, controls, usesTouchPreview],
  );

  useEffect(() => {
    const onPopState = () => {
      setRequestedSiteSlug(getSiteSlugFromPath(window.location.pathname));
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (authenticated !== true) {
      setPlacementsWithAssets(new Set());
      return;
    }

    let cancelled = false;
    fetchSiteActivityStats()
      .then((result) => {
        if (cancelled) return;
        setPlacementsWithAssets(new Set(
          Object.entries(result.sites)
            .filter(([, stats]) => stats.totalPublished > 0)
            .map(([placementId]) => Number(placementId)),
        ));
      })
      .catch((statsError) => {
        console.warn(`[viewer] failed to load placement asset stats: ${(statsError as Error).message}`);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  useEffect(() => {
    if (!placementsResolved) return;

    if (!requestedSiteSlug) {
      if (focusedPlacement) returnToRegional({ skipUrlUpdate: true });
      return;
    }

    const placement = placements.find(
      (candidate) =>
        normalizeRouteSlug(siteRouteSlug(candidate)) ===
        normalizeRouteSlug(requestedSiteSlug),
    );
    if (!placement) {
      setPlacementError(`No site found for "${requestedSiteSlug}".`);
      return;
    }
    if (focusedPlacement?.placement_id === placement.placement_id) return;
    focusPlacement(placement, { skipUrlUpdate: true });
  }, [
    focusPlacement,
    focusedPlacement,
    placements,
    placementsResolved,
    requestedSiteSlug,
    returnToRegional,
  ]);

  useEffect(() => {
    let cancelled = false;
    fetchMapPlacements()
      .then((data) => {
        if (!cancelled) {
          setPlacements(data);
          setPlacementError(null);
          setPlacementsResolved(true);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setPlacementError((err as Error).message);
          setPlacementsResolved(true);
        }
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
      setRenderedTerrainKey(null);
      return;
    }

    const cached = requestKey
      ? terrainCacheRef.current.get(requestKey)
      : undefined;
    if (cached) {
      console.info(`[terrain:cache-hit] ${requestKey}`);
      setTerrain(cached.terrain);
      setProjection(cached.projection);
      setLoading(false);
      setError(null);
      setPhase(cached.phase);
      setRenderedTerrainKey(requestKey);
      return;
    }

    const existingRun = requestKey
      ? terrainRunsRef.current.get(requestKey)
      : undefined;
    if (existingRun) {
      existingRun.subscribers += 1;
      if (existingRun.releaseTimer !== null) {
        window.clearTimeout(existingRun.releaseTimer);
        existingRun.releaseTimer = null;
      }
      return () => {
        existingRun.subscribers -= 1;
        if (existingRun.subscribers === 0) {
          existingRun.releaseTimer = window.setTimeout(existingRun.release, 0);
        }
      };
    }

    let cancelled = false;
    let renderFrame: number | null = null;
    let requestProjection: ThreeGeoProjection | null = null;
    let stagedGroup: THREE.Group | null = null;
    let committedToCache = false;
    const abortController = new AbortController();
    const bench = requestKey
      ? createTerrainBenchmark(requestKey)
      : createTerrainBenchmark("unknown");
    const longTaskObserver = startLongTaskObserver(bench);
    const uninstallTileDispatchProbe = installTileDispatchProbe(bench);
    let terrainRun: TerrainRun;
    const releaseTerrainRun = () => {
      if (terrainRun.subscribers > 0) return;
      cancelled = true;
      abortController.abort();
      if (renderFrame !== null) window.cancelAnimationFrame(renderFrame);
      longTaskObserver?.disconnect();
      uninstallTileDispatchProbe();
      if (stagedGroup && !committedToCache) disposeObject(stagedGroup);
      if (requestKey && terrainRunsRef.current.get(requestKey) === terrainRun) {
        terrainRunsRef.current.delete(requestKey);
      }
    };
    terrainRun = {
      subscribers: 1,
      releaseTimer: null,
      release: releaseTerrainRun,
    };
    if (requestKey) terrainRunsRef.current.set(requestKey, terrainRun);
    setLoading(Boolean(MAPBOX_TOKEN));
    setError(null);
    setPhase("projecting");
    setRenderedTerrainKey(null);
    setTerrain(null);
    setProjection(null);

    loadThreeGeo()
      .then((ThreeGeo) => {
        if (cancelled) return null;
        const tgeo = new ThreeGeo({
          tokenMapbox: MAPBOX_TOKEN,
          unitsSide: request.unitsSide,
        });
        logTerrainBenchmark("request", bench, {
          radiusKm: request.radiusKm,
          zoom: request.zoom,
          demZoomOffset: terrainDemZoomOffset,
          estimatedSatelliteTiles: request.estimatedSatelliteTiles,
          mode: focusedPlacement ? "placement" : "regional",
        });
        requestProjection = tgeo.getProjection(
          request.origin,
          request.radiusKm,
          request.unitsSide,
        );
        setProjection(requestProjection);
        logTerrainBenchmark("projected", bench, {
          unitsSide: request.unitsSide,
        });
        if (!MAPBOX_TOKEN) {
          setTerrain(null);
          setError("Set VITE_MAPBOX_TOKEN to load terrain.");
          setPhase("flat");
          setRenderedTerrainKey(requestKey);
          if (requestKey && requestProjection) {
            terrainCacheRef.current.set(requestKey, {
              terrain: null,
              projection: requestProjection,
              phase: "flat",
            });
          }
          return null;
        }
        setPhase("fetching");
        logTerrainBenchmark("fetching", bench);
        return tgeo.getTerrain(
          request.origin,
          request.radiusKm,
          request.zoom,
          {
            onRgbDem: (meshes) => {
              if (cancelled) return;
              bench.rgbDemAt = performance.now();
              bench.totalTiles = meshes.length;
              logTerrainBenchmark("rgb-dem", bench, {
                meshCount: meshes.length,
                verticesPerMesh:
                  meshes[0]?.geometry.attributes.position?.count ?? null,
              });
              logTileTimings("rgb-dem", bench, "dem-tiles", MAPBOX_DEM_PATTERN);
              logTileTimings("rgb-dem", bench, "sat-tiles", MAPBOX_SAT_PATTERN);
              stagedGroup = createTerrainGroup(meshes, terrainElevationScale);
              setTerrain(stagedGroup);
              setRenderedTerrainKey(requestKey);
              setPhase("rendering");
            },
            onSatelliteMat: (mesh) => {
              if (cancelled) return;
              const now = performance.now();
              const isFirst = bench.firstSatMatAt === null;
              if (isFirst) bench.firstSatMatAt = now;
              bench.lastSatMatAt = now;
              bench.satMatCount += 1;
              if (isFirst) {
                logTerrainBenchmark("satellite-mat", bench, {
                  loaded: bench.satMatCount,
                });
                logTileTimings(
                  "satellite-mat",
                  bench,
                  "first-texture-snapshot",
                  MAPBOX_SAT_PATTERN,
                );
              } else if (bench.satMatCount % 5 === 0) {
                logTerrainBenchmark("satellite-mat", bench, {
                  loaded: bench.satMatCount,
                });
                logTileTimings(
                  "satellite-mat",
                  bench,
                  `at-${bench.satMatCount}-textures`,
                  MAPBOX_SAT_PATTERN,
                );
              }
              normalizeTerrainMaterials(mesh);
            },
          },
          {
            signal: abortController.signal,
            demZoomOffset: terrainDemZoomOffset,
          },
        );
      })
      .then((result) => {
        if (!result) return;
        const group =
          stagedGroup ??
          createTerrainGroup(result.rgbDem ?? [], terrainElevationScale);
        if (cancelled) {
          disposeObject(group);
          return;
        }
        normalizeTerrainMaterials(group);
        if (requestKey && requestProjection) {
          terrainCacheRef.current.set(requestKey, {
            terrain: group,
            projection: requestProjection,
            phase: "ready",
          });
          committedToCache = true;
        }
        if (!stagedGroup) {
          setTerrain(group);
          setRenderedTerrainKey(requestKey);
        }
        renderFrame = window.requestAnimationFrame(() => {
          if (!cancelled) {
            setRenderedTerrainKey(requestKey);
            setPhase("ready");
            bench.readyAt = performance.now();
            if (bench.totalTiles === null) {
              bench.totalTiles = result.rgbDem?.length ?? null;
            }
            summarizeTerrainBenchmark(bench);
            logTileTimings(
              "ready",
              bench,
              "dem-tiles-final",
              MAPBOX_DEM_PATTERN,
            );
            logTileTimings(
              "ready",
              bench,
              "sat-tiles-final",
              MAPBOX_SAT_PATTERN,
            );
          }
        });
      })
      .catch((err) => {
        if ((err as Error).name === "AbortError") return;
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
      terrainRun.subscribers -= 1;
      if (terrainRun.subscribers === 0) {
        terrainRun.releaseTimer = window.setTimeout(terrainRun.release, 0);
      }
    };
  }, [request, requestKey, terrainElevationScale, terrainDemZoomOffset]);

  useEffect(() => {
    return () => {
      document.body.style.cursor = "";
      for (const entry of terrainCacheRef.current.values()) {
        if (entry.terrain) disposeObject(entry.terrain);
      }
      terrainCacheRef.current.clear();
    };
  }, []);

  const terrainMatchesRequest = Boolean(
    request && requestKey && renderedTerrainKey === requestKey,
  );
  const sceneReadyForMarkers = terrainMatchesRequest || phase === "flat";
  const showPhotoPins = Boolean(focusedPlacement);

  useEffect(() => {
    if (!terrain || !terrainMatchesRequest) return;
    const finalFrame = getTerrainCameraFrame(
      camera,
      terrain,
      focusedPlacement ? LOCAL_CAMERA_FIT_SCALE : REGIONAL_CAMERA_FIT_SCALE,
    );
    if (!finalFrame) {
      resetTerrainCamera(camera, controls);
      if (introPhase === "exiting") onIntroComplete?.();
      return;
    }

    if (
      introEnabled &&
      !focusedPlacement &&
      (introPhase === "loading" || introPhase === "ready")
    ) {
      const startPosition = finalFrame.target.clone().add(
        finalFrame.position.clone().sub(finalFrame.target).multiplyScalar(3), //1.55
      );
      applyTerrainCameraFrame(
        camera,
        { position: startPosition, target: finalFrame.target },
        controls,
      );
      if (
        !introStartSetRef.current &&
        placementsResolved &&
        !galleryLoading &&
        !loading
      ) {
        introStartSetRef.current = true;
        onIntroReady?.();
      }
      return;
    }

    if (introEnabled && !focusedPlacement && introPhase === "exiting") {
      let frameId = 0;
      const startedAt = performance.now();
      const startPosition = camera.position.clone();
      const startTarget =
        controls?.target?.clone() ?? finalFrame.target.clone();
      const panOffset = new THREE.Vector3();
      const lastRenderedTarget = startTarget.clone();
      const animate = (now: number) => {
        if (controls?.target) {
          const userPanDelta = controls.target.clone().sub(lastRenderedTarget);
          if (userPanDelta.lengthSq() > 1e-10) {
            panOffset.add(userPanDelta);
            if (introPanOffsetRef) introPanOffsetRef.current = true;
          }
        }
        const progress = Math.min(
          1,
          (now - startedAt) / INTRO_CAMERA_DURATION_MS,
        );
        const eased = 1 - (1 - progress) ** 3;
        camera.position
          .lerpVectors(startPosition, finalFrame.position, eased)
          .add(panOffset);
        const target = startTarget
          .clone()
          .lerp(finalFrame.target, eased)
          .add(panOffset);
        camera.up.set(0, 1, 0);
        camera.lookAt(target);
        controls?.target?.copy(target);
        lastRenderedTarget.copy(target);
        controls?.update?.();
        if (progress < 1) {
          frameId = window.requestAnimationFrame(animate);
        } else {
          onIntroComplete?.();
        }
      };
      frameId = window.requestAnimationFrame(animate);
      return () => window.cancelAnimationFrame(frameId);
    }

    if (
      introEnabled &&
      !focusedPlacement &&
      introPhase === "complete" &&
      introPanOffsetRef?.current
    ) {
      introPanOffsetRef.current = false;
      return;
    }

    applyTerrainCameraFrame(camera, finalFrame, controls);
  }, [
    camera,
    controls,
    focusedPlacement,
    galleryLoading,
    introEnabled,
    introPhase,
    introPanOffsetRef,
    loading,
    onIntroComplete,
    onIntroReady,
    placementsResolved,
    terrain,
    terrainMatchesRequest,
  ]);

  useEffect(() => {
    if (!focusedPlacement) {
      placementOrbitFitPlacementRef.current = null;
      return;
    }
    if (
      placementOrbitFitPlacementRef.current === focusedPlacement.placement_id ||
      !sceneReadyForMarkers ||
      galleryLoading ||
      (
        activityOrbitRings.length === 0 &&
        placementLayout.length === 0 &&
        !focusedPlacementCenter
      ) ||
      !controls?.target
    ) return;

    const placementCenter = activityOrbitRings[0]?.center
      ?? focusedPlacementCenter
      ?? placementLayout[0].position;
    const center = new THREE.Vector3(...placementCenter);
    const signpostHeight = getPlacementSignpostHeight(
      center.z,
      terrainMaxZ,
      placementSigns.get(focusedPlacement.placement_id) ?? [],
    );
    center.z += Math.max(ORBIT_HEIGHT, signpostHeight * 0.5);
    const outerRadius = activityOrbitRings.length > 0
      ? Math.max(...activityOrbitRings.map((ring) => ring.radius))
      : 1;
    const signpostBaseZ = placementCenter[2];
    const signpostTopZ = signpostBaseZ + signpostHeight;
    const verticalContentRadius = Math.max(
      Math.abs(center.z - signpostBaseZ),
      Math.abs(signpostTopZ - center.z),
      Math.abs(signpostBaseZ + ORBIT_HEIGHT - center.z),
    ) + 0.35;
    const verticalFov = camera instanceof THREE.PerspectiveCamera
      ? THREE.MathUtils.degToRad(camera.fov)
      : THREE.MathUtils.degToRad(50);
    const aspect = camera instanceof THREE.PerspectiveCamera ? camera.aspect : 1;
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
    let distance: number;
    if (documentationQuoteLayout) {
      const { fitBounds } = documentationQuoteLayout;
      center.x = (fitBounds.minX + fitBounds.maxX) / 2;
      center.y = (fitBounds.minY + fitBounds.maxY) / 2;
      const halfWidth = (fitBounds.maxX - fitBounds.minX) / 2;
      const halfHeight = (fitBounds.maxY - fitBounds.minY) / 2;
      distance = THREE.MathUtils.clamp(
        Math.max(
          halfWidth * 1.18 / Math.tan(horizontalFov / 2),
          Math.max(halfHeight, verticalContentRadius) * 1.25
            / Math.tan(verticalFov / 2),
        ),
        2.4,
        70,
      );
    } else {
      const contentRadius = Math.max(1, outerRadius + 0.75, verticalContentRadius);
      const limitingFov = Math.min(verticalFov, horizontalFov);
      distance = THREE.MathUtils.clamp(
        contentRadius * 1.35 / Math.tan(limitingFov / 2),
        2.4,
        70,
      );
    }
    const startTarget = controls.target.clone();
    const startPosition = camera.position.clone();
    const direction = startPosition.clone().sub(startTarget).normalize();
    const endPosition = center.clone().addScaledVector(direction, distance);
    const startedAt = performance.now();

    if (placementOrbitFitAnimationRef.current !== null) {
      cancelAnimationFrame(placementOrbitFitAnimationRef.current);
    }
    placementOrbitFitPlacementRef.current = focusedPlacement.placement_id;
    const animateFit = (timestamp: number) => {
      const progress = Math.min(
        1,
        (timestamp - startedAt) / PLACEMENT_ORBIT_FIT_DURATION_MS,
      );
      const eased = 1 - Math.pow(1 - progress, 3);
      controls.target!.lerpVectors(startTarget, center, eased);
      camera.position.lerpVectors(startPosition, endPosition, eased);
      camera.lookAt(controls.target!);
      controls.update?.();
      placementOrbitFitAnimationRef.current = progress < 1
        ? requestAnimationFrame(animateFit)
        : null;
    };
    placementOrbitFitAnimationRef.current = requestAnimationFrame(animateFit);

    return () => {
      if (placementOrbitFitAnimationRef.current !== null) {
        cancelAnimationFrame(placementOrbitFitAnimationRef.current);
        placementOrbitFitAnimationRef.current = null;
      }
    };
  }, [
    activityOrbitRings,
    camera,
    controls,
    documentationQuoteLayout,
    focusedPlacement,
    focusedPlacementCenter,
    galleryLoading,
    placementSigns,
    placementLayout,
    sceneReadyForMarkers,
    terrainMaxZ,
  ]);

  useEffect(() => {
    if (
      !introEnabled ||
      introPhase !== "exiting" ||
      (terrain && terrainMatchesRequest)
    ) {
      return;
    }
    onIntroComplete?.();
  }, [
    introEnabled,
    introPhase,
    onIntroComplete,
    terrain,
    terrainMatchesRequest,
  ]);

  useEffect(() => {
    if (
      !introEnabled ||
      focusedPlacement ||
      introStartSetRef.current ||
      galleryLoading ||
      loading ||
      !placementsResolved
    ) return;
    if (
      phase === "flat" ||
      phase === "error" ||
      (!request && placementsResolved)
    ) {
      introStartSetRef.current = true;
      onIntroReady?.();
    }
  }, [
    focusedPlacement,
    galleryLoading,
    introEnabled,
    loading,
    onIntroReady,
    phase,
    placementsResolved,
    request,
  ]);

  const isPreparingTerrain =
    photosForCurrentView.length === 0 &&
    placements.length === 0 &&
    !placementError;
  const hasNoTerrainLocations =
    !isPreparingTerrain && geoPhotos.length === 0 && geoPlacements.length === 0;

  const notice = useMemo<TerrainNotice | null>(() => {
    if (focusedPlacement && galleryLoading) {
      return {
        label: "Loading artworks",
      };
    }

    if (isPreparingTerrain) {
      return {
        label: galleryLoading ? "Loading gallery" : "Preparing terrain",
      };
    }

    if (hasNoTerrainLocations) {
      return {
        label: placementError
          ? "Placement locations failed"
          : "No terrain locations",
        detail:
          placementError ?? "No GPS photos or placements for terrain mode.",
        tone: placementError ? "error" : "muted",
        busy: false,
      };
    }

    if (loading || error) {
      return {
        label: loading ? "Loading..." : "Terrain failed",
        detail: error ?? undefined,
        tone: error ? "error" : "loading",
        busy: loading,
      };
    }

    return null;
  }, [
    error,
    focusedPlacement,
    galleryLoading,
    hasNoTerrainLocations,
    isPreparingTerrain,
    loading,
    placementError,
  ]);

  useEffect(() => {
    onNoticeChange?.(notice);
  }, [notice, onNoticeChange]);

  useEffect(() => {
    if (!focusedPlacement) return;
    void fetchPlacementFocus({
      placementId: focusedPlacement.placement_id,
      lat: focusedPlacement.lat,
      lng: focusedPlacement.lng,
      radiusKm: LOCAL_PLACEMENT_RADIUS_KM,
    });
  }, [fetchPlacementFocus, focusedPlacement]);

  useEffect(() => {
    return () => onNoticeChange?.(null);
  }, [onNoticeChange]);

  useEffect(() => {
    onBackActionChange?.(focusedPlacement ? returnToRegional : null);
  }, [focusedPlacement, onBackActionChange, returnToRegional]);

  useEffect(() => {
    return () => onBackActionChange?.(null);
  }, [onBackActionChange]);

  useEffect(() => {
    onFocusedPlacementChange?.(focusedPlacement);
  }, [focusedPlacement, onFocusedPlacementChange]);

  useEffect(() => {
    return () => onFocusedPlacementChange?.(null);
  }, [onFocusedPlacementChange]);

  useEffect(() => {
    onHoveredPlacementChange?.(
      focusedPlacement || previewPlacement ? null : hoveredPlacement,
    );
  }, [
    focusedPlacement,
    hoveredPlacement,
    onHoveredPlacementChange,
    previewPlacement,
  ]);

  useEffect(() => {
    return () => onHoveredPlacementChange?.(null);
  }, [onHoveredPlacementChange]);

  useEffect(() => {
    onPreviewPlacementChange?.(
      focusedPlacement ? null : previewPlacement,
      focusedPlacement || !previewPlacement ? null : openPreviewPlacement,
    );
  }, [
    focusedPlacement,
    onPreviewPlacementChange,
    openPreviewPlacement,
    previewPlacement,
  ]);

  useEffect(() => {
    return () => onPreviewPlacementChange?.(null, null);
  }, [onPreviewPlacementChange]);

  useEffect(() => {
    if (!hoveredPlacement) return;
    if (focusedPlacement) return;
    if (
      !visiblePlacements.some(
        (placement) => placement.placement_id === hoveredPlacement.placement_id,
      )
    ) {
      setHoveredPlacement(null);
    }
  }, [focusedPlacement, hoveredPlacement, visiblePlacements]);

  useEffect(() => {
    if (!previewPlacement) return;
    if (focusedPlacement) return;
    if (
      !visiblePlacements.some(
        (placement) => placement.placement_id === previewPlacement.placement_id,
      )
    ) {
      setPreviewPlacement(null);
    }
  }, [focusedPlacement, previewPlacement, visiblePlacements]);

  useEffect(() => {
    onPartnerFilterOptionsChange?.(partnerFilterOptions);
  }, [onPartnerFilterOptionsChange, partnerFilterOptions]);

  useEffect(() => {
    return () => onPartnerFilterOptionsChange?.([]);
  }, [onPartnerFilterOptionsChange]);

  if (isPreparingTerrain || hasNoTerrainLocations) return null;

  return (
    <group
      onClick={
        previewPlacement
          ? () => setPreviewPlacement(null)
          : undefined
      }
    >
      {!focusedPlacement && <FlowerLayoutCoordinator />}
      {terrain && terrainMatchesRequest && <primitive object={terrain} />}
      {sceneReadyForMarkers && focusedPlacement && documentationQuoteLayout && (
        <DocumentationPullQuotePanel
          quote={documentationQuoteLayout.quote}
          position={documentationQuoteLayout.position}
          width={documentationQuoteLayout.width}
          height={documentationQuoteLayout.height}
          accentColour={focusedPlacement.partner_brand_color_two}
        />
      )}
      {sceneReadyForMarkers && focusedPlacement &&
        activityOrbitRings.map((ring) => (
          <OrbitingActivityRing
            key={`${ring.radius}:${ring.colour}`}
            center={ring.center}
            radius={ring.radius}
            colour={ring.colour}
            orbitHeight={orbitHeight}
            gaps={ring.gaps}
          />
        ))}

      {sceneReadyForMarkers &&
        showPhotoPins &&
        localPhotoLayout.map((item) =>
          item.photo.mediaKind === "anecdote" ||
          (item.photo.mediaKind === "audio" && item.photo.audioUrl) ? (
            <OrbitingIconMarker
              key={item.photo.id}
              id={item.photo.id}
              iconName={item.photo.iconName}
              center={item.center}
              orbitRadius={item.orbitRadius}
              orbitHeight={orbitHeight}
              activityColour={item.orbitColour}
              isDenseOrbit={item.orbitAssetCount >= 5}
              isHighlighted={item.sourceIndex === hoveredIndex}
              onClick={() => selectPhoto(item.sourceIndex)}
              onPointerEnter={() => setHoveredIndex(item.sourceIndex)}
              onPointerLeave={() => setHoveredIndex(null)}
            />
          ) : (
            <OrbitingPhotoBanner
              key={item.photo.id}
              id={item.photo.id}
              url={item.photo.thumbnailUrl}
              width={item.photo.width}
              height={item.photo.height}
              adjustments={item.photo.adjustments}
              borderColour={selectedActivityColour ?? item.orbitColour}
              center={item.center}
              orbitRadius={item.orbitRadius}
              orbitHeight={orbitHeight}
              isDenseOrbit={item.orbitAssetCount >= 5}
              isSelected={item.sourceIndex === selectedIndex}
              isHighlighted={item.sourceIndex === hoveredIndex}
              onClick={() =>
                selectPhoto(
                  item.sourceIndex === selectedIndex ? null : item.sourceIndex,
                )
              }
              onPointerEnter={() => setHoveredIndex(item.sourceIndex)}
              onPointerLeave={() => setHoveredIndex(null)}
            />
          ),
        )}

      {sceneReadyForMarkers && focusedPlacement &&
        placementLayout.map(({ placement, position }) => (
          <PlacementSignpost
            key={placement.placement_id}
            markerId={String(placement.placement_id)}
            position={position}
            height={getPlacementSignpostHeight(position[2], terrainMaxZ, placementSigns.get(placement.placement_id) ?? [])}
            signs={placementSigns.get(placement.placement_id) ?? []}
            placementName={formatPlacementPlaqueName(placement)}
            partnerBrandColor={placement.partner_brand_color_one}
            partnerBrandColorTwo={placement.partner_brand_color_two}
            isSelected={
              (
                usesTouchPreview
                  ? previewPlacement
                  : hoveredPlacement
              )?.placement_id === placement.placement_id
            }
          />
        ))}
      {sceneReadyForMarkers && !focusedPlacement &&
        placementLayout.map(({
          placement,
          position,
          isForked,
          clusterIndex,
          clusterCount,
        }) => (
          <PlaceMarker
            key={placement.placement_id}
            markerId={String(placement.placement_id)}
            stemColorSeed={getPlacementAnchorKey(placement)}
            position={position}
            brandColorOne={placement.partner_brand_color_one}
            brandColorTwo={placement.partner_brand_color_two}
            isForked={isForked}
            clusterIndex={clusterIndex}
            clusterCount={clusterCount}
            hasAssets={placementsWithAssets.has(placement.placement_id)}
            isSelected={
              (previewPlacement ?? hoveredPlacement)?.placement_id ===
              placement.placement_id
            }
            onClick={() => {
              setHoveredPlacement(null);
              setPreviewPlacement((current) =>
                current?.placement_id === placement.placement_id
                  ? null
                  : placement,
              );
              if (usesTouchPreview) {
                panToPlacement(position);
              }
            }}
            onPointerEnter={
              usesTouchPreview
                ? undefined
                : () => setHoveredPlacement(placement)
            }
            onPointerLeave={
              usesTouchPreview
                ? undefined
                : () => setHoveredPlacement(null)
            }
          />
        ))}
    </group>
  );
}

function resetTerrainCamera(
  camera: THREE.Camera,
  controls?: TerrainOrbitControls,
  target = new THREE.Vector3(0, 0, 0),
) {
  camera.position.copy(target).add(DEFAULT_TERRAIN_CAMERA_POSITION);
  camera.up.set(0, 1, 0);
  camera.lookAt(target);
  controls?.target?.copy(target);
  controls?.update?.();
}

function getTerrainCameraFrame(
  camera: THREE.Camera,
  terrain: THREE.Group,
  fitScale = 0.72,
): TerrainCameraFrame | null {
  terrain.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(terrain);
  if (!Number.isFinite(box.min.x) || !Number.isFinite(box.max.x)) return null;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const target = new THREE.Vector3(
    center.x,
    center.y,
    Math.max(center.z, box.min.z),
  );
  const direction = DEFAULT_TERRAIN_CAMERA_POSITION.clone().normalize();
  const fitSize = Math.max(size.x, size.y, 1);
  const fov = camera instanceof THREE.PerspectiveCamera ? camera.fov : 50;
  const fitDistance =
    (fitSize * fitScale) / Math.tan(THREE.MathUtils.degToRad(fov / 2));

  return {
    position: target.clone().add(direction.multiplyScalar(fitDistance)),
    target,
  };
}

function applyTerrainCameraFrame(
  camera: THREE.Camera,
  frame: TerrainCameraFrame,
  controls?: TerrainOrbitControls,
) {
  camera.position.copy(frame.position);
  camera.up.set(0, 1, 0);
  camera.lookAt(frame.target);
  controls?.target?.copy(frame.target);
  controls?.update?.();
}

export function FocusedPlacementOverlay({
  placement,
  adminHref,
  partnerHref,
  onPartnerSelect,
}: {
  placement: MapPlacement;
  adminHref?: string;
  partnerHref?: string;
  onPartnerSelect?: (partner: string) => void;
}) {
  return (
    <PlacementInfoPanel
      placement={placement}
      adminHref={adminHref}
      partnerHref={partnerHref}
      onPartnerSelect={onPartnerSelect}
    />
  );
}

function PlacementInfoPanel({
  placement,
  adminHref,
  partnerHref,
  onPartnerSelect,
  onView,
  preview = false,
}: {
  placement: MapPlacement;
  adminHref?: string;
  partnerHref?: string;
  onPartnerSelect?: (partner: string) => void;
  onView?: () => void;
  preview?: boolean;
}) {
  const isMobile = useIsMobileBreakpoint();
  const [expanded, setExpanded] = useState(preview || !isMobile);
  const people = [
    placement.team_member,
    placement.secondary_team_member,
  ].filter((person): person is NonNullable<MapPlacement["team_member"]> =>
    Boolean(person?.name),
  );
  const participantDetails = formatParticipantDetails(placement);
  const peopleLabel =
    people.length > 1 ? "Artist Educators" : "Artist Educator";
  const siteDetails = formatSiteDetails(placement);
  const partnerLogo = placement.partner_white_logo?.url
    ? placement.partner_white_logo
    : placement.partner_logo;
  const partnerName = placement.partner_name?.trim();
  const partnerLinkEnabled = Boolean(
    partnerName && partnerHref && onPartnerSelect,
  );
  const handlePartnerLinkClick = (
    event: MouseEvent<HTMLAnchorElement>,
  ) => {
    if (
      !partnerLinkEnabled ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onPartnerSelect?.(partnerName!);
  };

  useEffect(() => {
    setExpanded(preview || !isMobile);
  }, [isMobile, placement.placement_id, preview]);

  return (
    <section
      style={{
        ...siteDetailsStyle,
        ...(isMobile ? mobileSiteDetailsStyle : {}),
        ...(isMobile && !expanded ? mobileSiteDetailsCollapsedStyle : {}),
        ...(preview ? placementPreviewSharedPanelStyle : {}),
      }}
      aria-label="Placement details"
    >
      <div
        style={{
          ...siteDetailsHeaderStyle,
          ...(isMobile ? mobileSiteDetailsHeaderStyle : {}),
          ...(!expanded ? siteDetailsHeaderCollapsedStyle : {}),
        }}
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={
            expanded ? "Collapse placement details" : "Expand placement details"
          }
          onClick={() => setExpanded((current) => !current)}
          style={siteDetailsTitleWrapStyle}
        >
          <div style={siteNameStyle}>{formatPlacementDisplayName(placement)}</div>
        </button>
        <button
          type="button"
          className="atlas-control-surface"
          aria-expanded={expanded}
          aria-label={
            expanded ? "Collapse placement details" : "Expand placement details"
          }
          onClick={() => setExpanded((current) => !current)}
          style={siteDetailsToggleStyle}
        >
          <ChevronIcon direction={expanded ? "down" : "up"} />
        </button>
      </div>

      {expanded && (
        <div
          style={{
            ...siteDetailsBodyStyle,
            ...(isMobile ? mobileSiteDetailsBodyStyle : {}),
          }}
        >
          <div style={siteDetailsGridStyle}>
            <div
              style={{
                ...siteDetailLabelStyle,
                ...siteDetailRowSeparatorStyle,
              }}
            >
              {partnerLogo?.url && (
                partnerLinkEnabled ? (
                  <a
                    href={partnerHref}
                    onClick={handlePartnerLinkClick}
                    aria-label={`View ${partnerName} placements`}
                    style={siteDetailsPartnerLogoLinkStyle}
                  >
                    <img
                      src={partnerLogo.url}
                      alt={partnerLogo.alt || `${partnerName} logo`}
                      style={
                        placement.partner_white_logo?.url
                          ? partnerWhiteLogoStyle
                          : partnerLogoStyle
                      }
                    />
                  </a>
                ) : (
                  <img
                    src={partnerLogo.url}
                    alt={partnerLogo.alt || ""}
                    style={
                      placement.partner_white_logo?.url
                        ? partnerWhiteLogoStyle
                        : partnerLogoStyle
                    }
                  />
                )
              )}
            </div>
            <div
              style={{
                ...siteDetailValueStyle,
                ...siteDetailRowSeparatorStyle,
              }}
            >
              {partnerLinkEnabled ? (
                <a
                  href={partnerHref}
                  onClick={handlePartnerLinkClick}
                  style={siteDetailsPartnerNameLinkStyle}
                >
                  {partnerName}
                </a>
              ) : (
                placement.partner_name || "Partner organization"
              )}
            </div>
            {placement.is_earlyon && (
              <>
                <div
                  style={{
                    ...siteDetailLabelStyle,
                    ...siteDetailRowSeparatorStyle,
                  }}
                >
                  <img
                    src="/early-on-white.svg"
                    alt=""
                    style={siteDetailEarlyOnLogoStyle}
                  />
                </div>
                <div
                  style={{
                    ...siteDetailValueStyle,
                    ...siteDetailRowSeparatorStyle,
                  }}
                >
                  EarlyON Child and Family Centre
                </div>
              </>
            )}
            <SiteDetail
              label="Location"
              icon="location_on"
              value={siteDetails || "Not specified"}
              separated
            />
            <SiteDetail
              label={peopleLabel}
              icon="person"
              value={
                people.map((person) => person.name).join(", ") || "Unassigned"
              }
              separated={Boolean(participantDetails)}
            />
            {participantDetails && (
              <SiteDetail
                label="Age range"
                icon="child_hat"
                value={participantDetails}
              />
            )}
          </div>
          {(placement.documentation_url || adminHref || onView) && (
            <div style={siteDetailsActionsStyle}>
              {placement.documentation_url && (
                <a
                  href={placement.documentation_url}
                  className="atlas-control-surface"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={siteDetailsActionLinkStyle}
                >
                  Documentation
                </a>
              )}
              {adminHref && (
                <a
                  href={adminHref}
                  className="atlas-control-surface"
                  style={siteDetailsActionLinkStyle}
                >
                  Admin
                </a>
              )}
              {onView && (
                <button
                  type="button"
                  className="atlas-control-surface"
                  onClick={onView}
                  style={siteDetailsActionLinkStyle}
                >
                  Gallery
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function PlacementHoverLabel({
  placement,
}: {
  placement: MapPlacement;
}) {
  return (
    <section style={placementHoverLabelStyle} aria-live="polite">
      <div style={placementHoverPartnerStyle}>
        {placement.partner_name || "Placement"}
      </div>
      <div style={placementHoverNameStyle}>{formatPlacementDisplayName(placement)}</div>
      <div style={placementHoverMetaStyle}>{formatArtistEducatorDetails(placement)}</div>
    </section>
  );
}

export function PlacementPreviewPanel({
  placement,
  onOpen,
  adminHref,
  partnerHref,
  onPartnerSelect,
}: {
  placement: MapPlacement;
  onOpen: () => void;
  adminHref?: string;
  partnerHref?: string;
  onPartnerSelect?: (partner: string) => void;
}) {
  return (
    <PlacementInfoPanel
      placement={placement}
      adminHref={adminHref}
      partnerHref={partnerHref}
      onPartnerSelect={onPartnerSelect}
      onView={onOpen}
      preview
    />
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
  const ageRange = placement.participant_age?.trim();
  return ageRange
    ? (/\d/.test(ageRange) ? `age ${ageRange}` : ageRange)
    : "";
}

function formatArtistEducatorDetails(placement: MapPlacement) {
  const people = [
    placement.team_member,
    placement.secondary_team_member,
  ].filter((person): person is NonNullable<MapPlacement["team_member"]> =>
    Boolean(person?.name),
  );
  const label = people.length > 1 ? "Artist Educators" : "Artist Educator";
  return `${label}: ${people.map((person) => person.name).join(", ") || "Unassigned"}`;
}

function SiteDetail({
  label,
  icon,
  value,
  separated = false,
}: {
  label: string;
  icon: string;
  value: string;
  separated?: boolean;
}) {
  return (
    <div style={siteDetailRowStyle}>
      <div
        style={{
          ...siteDetailLabelStyle,
          ...(separated ? siteDetailRowSeparatorStyle : {}),
        }}
      >
        <span aria-hidden="true" style={siteDetailIconStyle}>
          {icon}
        </span>
        <span style={siteDetailLabelTextStyle}>{label}</span>
      </div>
      <div
        style={{
          ...siteDetailValueStyle,
          ...(separated ? siteDetailRowSeparatorStyle : {}),
        }}
      >
        {value}
      </div>
    </div>
  );
}

function ChevronIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      style={{
        ...siteDetailsChevronStyle,
        transform: direction === "up" ? "rotate(180deg)" : "none",
      }}
    >
      <path
        d="M3.5 5.75 8 10.25l4.5-4.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function useIsMobileBreakpoint(breakpointPx = 720) {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(`(max-width: ${breakpointPx}px)`).matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${breakpointPx}px)`);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);

    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, [breakpointPx]);

  return isMobile;
}

function useTouchPreviewMode() {
  const query = "(hover: none), (pointer: coarse)";
  const [usesTouchPreview, setUsesTouchPreview] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mediaQuery = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) =>
      setUsesTouchPreview(event.matches);

    setUsesTouchPreview(mediaQuery.matches);
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, []);

  return usesTouchPreview;
}

function siteRouteSlug(placement: MapPlacement) {
  return (
    placement.placement_slug?.trim() ||
    slugifyPlacementName(placement.placement_name)
  );
}

function getSiteSlugFromPath(pathname: string) {
  if (!pathname.startsWith(SITE_PATH_PREFIX)) return null;
  const slug = pathname.slice(SITE_PATH_PREFIX.length).split("/")[0] ?? "";
  return slug ? decodeURIComponent(slug) : null;
}

function normalizeRouteSlug(value: string) {
  return value.trim().toLowerCase();
}

function slugifyPlacementName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function updatePlacementPath(placement: MapPlacement, replace = false) {
  const slug = siteRouteSlug(placement);
  if (!slug) return;
  updateViewerPath(`${SITE_PATH_PREFIX}${encodeURIComponent(slug)}`, replace);
}

function updateViewerPath(path: string, replace = false) {
  if (window.location.pathname === path) return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

function isMatchingPlacementPhotoScope(
  scope:
    | { mode: "regional" }
    | { mode: "placement"; placementId: number },
  placementId: number,
) {
  return (
    scope.mode === "placement" &&
    scope.placementId === placementId
  );
}

const siteDetailsStyle: React.CSSProperties = {
  ...atlasPanelSurfaceStyle,
  position: "fixed",
  left: 0,
  right: 0,
  bottom: 0,
  transform: "none",
  zIndex: 13,
  width: "100vw",
  maxWidth: "none",
  boxSizing: "border-box",
  pointerEvents: "auto",
  userSelect: "text",
  WebkitUserSelect: "text",
  border: "none",
  borderRadius: 0,
  padding: 0,
  color: "#d8dde7",
  boxShadow: "none",
};

const mobileSiteDetailsStyle: React.CSSProperties = {
  bottom: 0,
  left: 0,
  right: 0,
  transform: "none",
  width: "auto",
  maxWidth: "none",
  zIndex: 13,
  borderRadius: 0,
  padding: 0,
  overflow: "hidden",
};

const mobileSiteDetailsCollapsedStyle: React.CSSProperties = {
  maxHeight: 86,
};

const placementPreviewSharedPanelStyle: React.CSSProperties = {
  zIndex: 17,
};

const placementHoverLabelStyle: React.CSSProperties = {
  ...atlasPanelSurfaceStyle,
  position: "absolute",
  left: "50%",
  bottom: 18,
  transform: "translateX(-50%)",
  width: "max-content",
  maxWidth: "min(460px, calc(100vw - 32px))",
  pointerEvents: "none",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 6,
  padding: "10px 14px",
  color: "#eef2f8",
  boxShadow: "0 12px 32px rgba(0,0,0,0.28)",
  textAlign: "center",
  zIndex: 14,
};

const placementHoverPartnerStyle: React.CSSProperties = {
  color: "#aeb7c6",
  fontSize: 11,
  lineHeight: 1.3,
  marginBottom: 3,
  overflowWrap: "anywhere",
};

const placementHoverNameStyle: React.CSSProperties = {
  color: "#f4f7fb",
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.3,
  overflowWrap: "anywhere",
};

const placementHoverMetaStyle: React.CSSProperties = {
  ...placementHoverPartnerStyle,
  marginTop: 4,
  marginBottom: 0,
};

const siteDetailsHeaderStyle: React.CSSProperties = {
  height: "5rem",
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  gap: 10,
  paddingLeft: 16,
  borderBottom: "1px solid rgba(255,255,255,0.12)",
};

const mobileSiteDetailsHeaderStyle: React.CSSProperties = {
  paddingLeft: 12,
};

const siteDetailsHeaderCollapsedStyle: React.CSSProperties = {
  borderBottom: "none",
};

const siteDetailsBodyStyle: React.CSSProperties = {
  padding: "10px 16px 12px",
};

const mobileSiteDetailsBodyStyle: React.CSSProperties = {
  padding: "10px 12px max(12px, env(safe-area-inset-bottom))",
};

const siteDetailsTitleWrapStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  alignSelf: "stretch",
  display: "flex",
  alignItems: "center",
  padding: 0,
  color: "inherit",
  font: "inherit",
  textAlign: "left",
  background: "transparent",
  border: 0,
  cursor: "pointer",
  pointerEvents: "auto",
};

const siteDetailsToggleStyle: React.CSSProperties = {
  ...atlasControlSurfaceStyle,
  pointerEvents: "auto",
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
  fontSize: 18,
  lineHeight: 1,
};

const siteDetailsChevronStyle: React.CSSProperties = {
  width: 16,
  height: 16,
};

const partnerLogoStyle: React.CSSProperties = {
  flex: "0 0 auto",
  width: "8rem",
  maxWidth: "100%",
  height: "3rem",
  boxSizing: "border-box",
  objectFit: "contain",
  background: "rgba(255,255,255,0.9)",
  borderRadius: 4,
  padding: 5,
};

const partnerWhiteLogoStyle: React.CSSProperties = {
  ...partnerLogoStyle,
  background: "transparent",
  padding: 0,
};

const siteDetailsPartnerLogoLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "flex-start",
  maxWidth: "100%",
  color: "inherit",
  textDecoration: "none",
  pointerEvents: "auto",
};

const siteDetailsPartnerNameLinkStyle: React.CSSProperties = {
  color: "inherit",
  textDecoration: "underline",
  textDecorationColor: "rgba(255,255,255,0.38)",
  textUnderlineOffset: 3,
  pointerEvents: "auto",
};

const siteNameStyle: React.CSSProperties = {
  color: "#f4f7fb",
  fontSize: 16,
  fontWeight: 700,
  lineHeight: 1.35,
  marginTop: 3,
};

const siteDetailsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "max-content minmax(0, 1fr)",
  alignItems: "stretch",
  columnGap: 0,
  rowGap: 0,
};

const siteDetailsActionsStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "nowrap",
  gap: 8,
  width: "100%",
  marginTop: 10,
  pointerEvents: "auto",
};

const siteDetailsActionLinkStyle: React.CSSProperties = {
  ...atlasControlSurfaceStyle,
  flex: "1 1 0",
  minWidth: 0,
  minHeight: 44,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  boxSizing: "border-box",
  padding: "11px 8px",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: 0,
  color: "#ffffff",
  fontSize: "clamp(10px, 2.5vw, 12px)",
  fontWeight: 600,
  lineHeight: 1,
  textAlign: "center",
  textDecoration: "none",
  cursor: "pointer",
  pointerEvents: "auto",
  whiteSpace: "nowrap",
};

const siteDetailRowStyle: React.CSSProperties = {
  display: "contents",
};

const siteDetailLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: 6,
  color: "#eef2f8",
  fontSize: 10,
  lineHeight: 1.35,
  textAlign: "left",
  letterSpacing: 0,
  padding: "5px 10px 5px 0",
  boxSizing: "border-box",
  borderRight: "1px solid rgba(255,255,255,0.14)",
};

const siteDetailIconStyle: React.CSSProperties = {
  flex: "0 0 auto",
  fontFamily: "'Material Symbols Outlined'",
  fontSize: 16,
  fontWeight: 400,
  fontStyle: "normal",
  fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 20",
  lineHeight: 1,
};

const siteDetailEarlyOnLogoStyle: React.CSSProperties = {
  display: "block",
  width: "6rem",
  maxWidth: "100%",
  height: "2.5rem",
  objectFit: "contain",
  objectPosition: "left center",
};

const siteDetailLabelTextStyle: React.CSSProperties = {
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const siteDetailValueStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  minWidth: 0,
  color: "#eef2f8",
  fontSize: 12,
  lineHeight: 1.35,
  textAlign: "left",
  overflowWrap: "anywhere",
  padding: "5px 0 5px 10px",
  boxSizing: "border-box",
};

const siteDetailRowSeparatorStyle: React.CSSProperties = {
  borderBottom: "1px solid rgba(255,255,255,0.12)",
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
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
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

function formatRadius(radiusKm: number) {
  return `${radiusKm.toFixed(radiusKm >= 10 ? 0 : 1)} km`;
}

function getPlacementAnchorKey(placement: MapPlacement) {
  const normalize = (value?: string) =>
    value?.trim().toLocaleLowerCase().replace(/\s+/g, " ") ?? "";
  const placeName = normalize(placement.place_name);
  const address = normalize(placement.address);
  const city = normalize(placement.place_city);

  if (placeName) return `place:${placeName}|${city}`;
  if (address) return `address:${address}|${city}`;
  return `coordinates:${placement.lat.toFixed(5)}:${placement.lng.toFixed(5)}`;
}

function getPlacementSignLabel(placement: MapPlacement, distanceMeters?: number) {
  const label = placement.partner_acronym?.trim() ||
    getPartnerAcronym(placement.partner_name || placement.placement_name);
  if (distanceMeters == null || !Number.isFinite(distanceMeters)) return label;
  const distanceKm = distanceMeters / 1000;
  const distanceLabel = distanceKm < 1
    ? `${Math.round(distanceMeters)} m`
    : `${distanceKm.toFixed(distanceKm < 10 ? 1 : 0)} km`;
  return `${label} · ${distanceLabel}`;
}

function getSharedPlacementSignLabel(placement: MapPlacement) {
  const acronym = getPlacementSignLabel(placement);
  const section = placement.section?.trim();
  return section ? `${acronym} · ${section}` : acronym;
}

function getPlacementSignAngle(
  current: { placement: MapPlacement; position: [number, number, number] },
  target: { placement: MapPlacement; position: [number, number, number] },
) {
  const direction = target.position[0] >= current.position[0] ? 1 : -1;
  const horizontalOffset = Math.abs(target.position[0] - current.position[0]);
  const northSouthOffset = target.position[1] - current.position[1];
  return THREE.MathUtils.clamp(
    Math.atan2(northSouthOffset * direction, Math.max(horizontalOffset, 0.001)),
    -SIGNPOST_MAX_DIRECTION_ANGLE,
    SIGNPOST_MAX_DIRECTION_ANGLE,
  );
}

function getPartnerAcronym(value?: string) {
  const name = value?.trim().replace(/\s+/g, " ");
  if (!name) return "SITE";
  if (
    /^[A-Z0-9]+$/.test(name) ||
    (/^[A-Za-z0-9]+$/.test(name) && /[a-z][A-Z]/.test(name))
  ) {
    return name;
  }

  const words = name
    .replace(/&/g, " and ")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .filter((word) => !/^(and|of|the|for|at|on|in)$/i.test(word));
  const acronym = words
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("")
    .slice(0, 8);
  return acronym || "SITE";
}

function getPlacementSignpostHeight(
  baseZ: number,
  terrainMaxZ: number | null,
  signs: PlacementSign[],
) {
  const terrainClearanceHeight = terrainMaxZ == null
    ? 0
    : terrainMaxZ - baseZ + SIGNPOST_TERRAIN_CLEARANCE;
  return Math.max(
    SIGNPOST_MIN_HEIGHT,
    getPlacementSignStackHeight(signs),
    terrainClearanceHeight,
  );
}

function formatPlacementDisplayName(placement: MapPlacement) {
  const section = placement.section?.trim();
  return section
    ? `${placement.placement_name} - ${section}`
    : placement.placement_name;
}

function formatPlacementPlaqueName(placement: MapPlacement) {
  const acronym = placement.partner_acronym?.trim() ||
    getPartnerAcronym(placement.partner_name || placement.placement_name);
  return `${acronym} \u00b7 ${formatPlacementDisplayName(placement)}`;
}

function haversineMeters(a: [number, number], b: [number, number]) {
  const earthRadiusMeters = 6371000;
  const dLat = degToRad(b[0] - a[0]);
  const dLng = degToRad(b[1] - a[1]);
  const lat1 = degToRad(a[0]);
  const lat2 = degToRad(b[0]);
  const value =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return (
    2 * earthRadiusMeters * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value))
  );
}

function degToRad(deg: number) {
  return (deg * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material;
    disposeMaterial(material);
  });
}

function createTerrainGroup(
  meshes: THREE.Mesh[],
  terrainElevationScale: number,
) {
  const group = new THREE.Group();
  group.name = "artasia-terrain";
  group.scale.z = terrainElevationScale;
  for (const mesh of meshes) {
    applyTerrainWireframeMaterial(mesh);
    group.add(mesh);
  }
  normalizeTerrainMaterials(group);
  return group;
}

const TERRAIN_OUTLINE_NAME = "artasia-tile-outline";

function disposeOutline(mesh: THREE.Mesh) {
  const outline = mesh.getObjectByName(
    TERRAIN_OUTLINE_NAME,
  ) as THREE.LineSegments | null;
  if (!outline) return;
  mesh.remove(outline);
  outline.geometry.dispose();
  const outlineMaterial = outline.material as THREE.Material | THREE.Material[];
  if (Array.isArray(outlineMaterial))
    outlineMaterial.forEach((m) => m.dispose());
  else outlineMaterial.dispose();
}

function applyTerrainWireframeMaterial(
  mesh: THREE.Mesh,
  disposeExisting = true,
) {
  if (disposeExisting) disposeMaterial(mesh.material);
  // Render the actual terrain triangulation while satellite textures arrive.
  // This mirrors three-geo's viewer wireframe mode without allocating expensive
  // EdgesGeometry for every dense terrain tile.
  mesh.material = new THREE.MeshBasicMaterial({
    color: 0xc8e88a,
    wireframe: true,
    transparent: true,
    opacity: 0.38,
    depthWrite: false,
    toneMapped: false,
  });

  disposeOutline(mesh);
}

function disposeMaterial(material?: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
  } else {
    material?.dispose();
  }
}

function normalizeTerrainMaterials(object: THREE.Object3D) {
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const material = mesh.material;
    const materials = Array.isArray(material)
      ? material
      : material
        ? [material]
        : [];

    for (const item of materials) {
      item.toneMapped = false;
      const map = (item as THREE.MeshBasicMaterial).map;
      if (map) {
        map.colorSpace = THREE.SRGBColorSpace;
        map.needsUpdate = true;
        // Satellite texture is now bound: restore an opaque, dept-writing
        // surface and drop the placeholder wireframe outline.
        const basic = item as THREE.MeshBasicMaterial;
        basic.transparent = false;
        basic.opacity = 1;
        basic.depthWrite = true;
        disposeOutline(mesh);
      }
      item.needsUpdate = true;
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
    Math.max(20, box.max.z - box.min.z + 20),
  );
  const hits = raycaster.intersectObject(terrain, true);
  return hits[0]?.point.z ?? null;
}
