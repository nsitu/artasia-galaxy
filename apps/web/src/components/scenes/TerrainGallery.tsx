import { useThree } from "@react-three/fiber";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  fetchMapPlacements,
  type ActivityOption,
  type MapPlacement,
  type Photo,
} from "../../api/client";
import { useGalleryStore } from "../../stores/galleryStore";
import {
  OrbitingAudioMarker,
  OrbitingPhotoBanner,
  TerrainPhotoFlower,
} from "./TerrainPhotoMarker";
import PlaceMarker, { FlowerLayoutCoordinator } from "./PlaceMarker";
import {
  createMaxDetailTerrainRequest,
  createTerrainRequest,
  getGeoPhotos,
} from "./terrainLayout";
import { loadThreeGeo, type ThreeGeoProjection } from "./threeGeoRuntime";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN ?? "";
const REGIONAL_TERRAIN_ELEVATION_SCALE = 8;
const LOCAL_TERRAIN_ELEVATION_SCALE = 1.25;
const DEFAULT_TERRAIN_CAMERA_POSITION = new THREE.Vector3(0, -12, 10);
const LOCAL_PLACEMENT_RADIUS_KM = 0.5;
const SAME_LOCATION_THRESHOLD_METERS = 15;
const REGIONAL_CAMERA_FIT_SCALE = 0.5;
const LOCAL_CAMERA_FIT_SCALE = 0.55;
const REGIONAL_DEM_ZOOM_OFFSET = 5;
const LOCAL_DEM_ZOOM_OFFSET = 3;
const INTRO_CAMERA_DURATION_MS = 3000;

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
type LocalPhotoLayoutItem =
  | {
      kind: "flower";
      photo: Photo;
      index: number;
      position: [number, number, number];
    }
  | {
      kind: "orbit";
      photo: Photo;
      index: number;
      center: [number, number, number];
      orbitRadius: number;
      orbitColour?: string;
      activityId?: number;
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
};

const SITE_PATH_PREFIX = "/sites/";

interface TerrainGalleryProps {
  introEnabled?: boolean;
  introPhase?: IntroPhase;
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
  introEnabled = false,
  introPhase = "complete",
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
  const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);
  const [terrain, setTerrain] = useState<THREE.Group | null>(null);
  const [projection, setProjection] = useState<ThreeGeoProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [phase, setPhase] = useState<TerrainPhase>("idle");
  const [renderedTerrainKey, setRenderedTerrainKey] = useState<string | null>(
    null,
  );
  const [placements, setPlacements] = useState<MapPlacement[]>([]);
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
  const introStartSetRef = useRef(false);

  const partnerFilterOptions = useMemo<PartnerFilterOption[]>(() => {
    const counts = new Map<string, number>();
    for (const placement of placements) {
      const partner = placement.partner_name?.trim();
      if (!partner) continue;
      counts.set(partner, (counts.get(partner) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([partner, count]) => ({ value: partner, label: partner, count }));
  }, [placements]);
  const filteredRegionalPlacements = useMemo(() => {
    if (!selectedPartnerFilter) return placements;
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
      return isMatchingPlacementPhotoScope(
        photoScope,
        focusedPlacement.placement_id,
        selectedActivityId,
      )
        ? photos
        : [];
    }
    return photoScope.mode === "regional" ? photos : [];
  }, [focusedPlacement, photoScope, photos, selectedActivityId]);
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
  const localPhotoLayout = useMemo<LocalPhotoLayoutItem[]>(() => {
    if (!focusedPlacement || !projection) return [];
    const [placementX, placementY, placementZ = 0] = projection.proj([
      focusedPlacement.lat,
      focusedPlacement.lng,
    ]);
    const placementCenter = [
      placementX,
      placementY,
      terrain
        ? (sampleTerrainZ(terrain, placementX, placementY) ?? placementZ)
        : placementZ,
    ] as [number, number, number];
    const orbitForPhoto = (photo: Photo) => {
      const activity = activityOptions.find((option) =>
        photo.activityIds?.includes(option.id),
      );
      const rank = activity
        ? activityOptions.findIndex((option) => option.id === activity.id)
        : -1;
      return {
        orbitRadius: rank >= 0 ? 0.78 + rank * 0.3 : 0.78,
        ...(activity ? { activityId: activity.id } : {}),
        ...(activity?.colour ? { orbitColour: activity.colour } : {}),
      };
    };

    return photosForCurrentView.map((photo, index) => {
      if (photo.mediaKind === "audio") {
        return {
          kind: "orbit",
          photo,
          index,
          center: placementCenter,
          ...orbitForPhoto(photo),
        };
      }
      const lat = photo.exifInfo?.latitude;
      const lng = photo.exifInfo?.longitude;
      if (
        photo.useGpsLocation !== false &&
        Number.isFinite(lat) &&
        Number.isFinite(lng)
      ) {
        const photoLatLng = [lat as number, lng as number] as [number, number];
        const placementLatLng = [
          focusedPlacement.lat,
          focusedPlacement.lng,
        ] as [number, number];
        const distanceFromPlacementMeters = haversineMeters(
          placementLatLng,
          photoLatLng,
        );
        const isPlantableOnLocalTerrain =
          distanceFromPlacementMeters > SAME_LOCATION_THRESHOLD_METERS &&
          distanceFromPlacementMeters <= LOCAL_PLACEMENT_RADIUS_KM * 1000;

        if (isPlantableOnLocalTerrain) {
          const [x, y, z = 0] = projection.proj(photoLatLng);
          return {
            kind: "flower",
            photo,
            index,
            position: [
              x,
              y,
              terrain ? (sampleTerrainZ(terrain, x, y) ?? z) : z,
            ] as [number, number, number],
          };
        }
      }

      return {
        kind: "orbit",
        photo,
        index,
        center: placementCenter,
        ...orbitForPhoto(photo),
      };
    });
  }, [activityOptions, focusedPlacement, photosForCurrentView, projection, terrain]);
  const activityOrbitRings = useMemo(() => {
    const rings = new Map<number, {
      radius: number;
      colour: string;
      center: [number, number, number];
    }>();
    for (const item of localPhotoLayout) {
      if (item.kind !== "orbit" || item.activityId == null) continue;
      rings.set(item.activityId, {
        radius: item.orbitRadius,
        colour: item.orbitColour ?? "#ffffff",
        center: item.center,
      });
    }
    return [...rings.values()];
  }, [localPhotoLayout]);

  useEffect(() => {
    if (
      playingAudioId &&
      !photosForCurrentView.some(
        (photo) => photo.id === playingAudioId && photo.mediaKind === "audio",
      )
    ) {
      setPlayingAudioId(null);
    }
  }, [photosForCurrentView, playingAudioId]);
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
      const endPosition = startPosition.clone().add(nextTarget.clone().sub(startTarget));
      const startedAt = performance.now();
      const animatePan = (timestamp: number) => {
        const progress = Math.min(1, (timestamp - startedAt) / 300);
        const eased = 1 - Math.pow(1 - progress, 3);
        controls.target!.lerpVectors(startTarget, nextTarget, eased);
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
      cancelled = true;
      abortController.abort();
      if (renderFrame !== null) window.cancelAnimationFrame(renderFrame);
      longTaskObserver?.disconnect();
      uninstallTileDispatchProbe();
      if (stagedGroup && !committedToCache) disposeObject(stagedGroup);
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
      if (!introStartSetRef.current) {
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
      const cameraPanOffset = new THREE.Vector3();
      const lastRenderedTarget = startTarget.clone();
      const lastRenderedPosition = startPosition.clone();
      const animate = (now: number) => {
        if (controls?.target) {
          panOffset.add(controls.target.clone().sub(lastRenderedTarget));
        }
        // Orbit controls can move both the target and camera while the intro
        // zoom is running. Preserve both user deltas so the closing frame does
        // not snap back to the original map center.
        cameraPanOffset.add(camera.position.clone().sub(lastRenderedPosition));
        const progress = Math.min(
          1,
          (now - startedAt) / INTRO_CAMERA_DURATION_MS,
        );
        const eased = 1 - (1 - progress) ** 3;
        camera.position
          .lerpVectors(startPosition, finalFrame.position, eased)
          .add(panOffset)
          .add(cameraPanOffset);
        const target = startTarget
          .clone()
          .lerp(finalFrame.target, eased)
          .add(panOffset);
        camera.up.set(0, 1, 0);
        camera.lookAt(target);
        controls?.target?.copy(target);
        lastRenderedTarget.copy(target);
        lastRenderedPosition.copy(camera.position);
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

    applyTerrainCameraFrame(camera, finalFrame, controls);
  }, [
    camera,
    controls,
    focusedPlacement,
    introEnabled,
    introPhase,
    onIntroComplete,
    onIntroReady,
    terrain,
    terrainMatchesRequest,
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
    if (!introEnabled || focusedPlacement || introStartSetRef.current) return;
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
    introEnabled,
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
      activityId: selectedActivityId,
    });
  }, [fetchPlacementFocus, focusedPlacement, selectedActivityId]);

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
    onHoveredPlacementChange?.(focusedPlacement ? null : hoveredPlacement);
  }, [focusedPlacement, hoveredPlacement, onHoveredPlacementChange]);

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
        usesTouchPreview && previewPlacement
          ? () => setPreviewPlacement(null)
          : undefined
      }
    >
      <FlowerLayoutCoordinator />
      {terrain && terrainMatchesRequest && <primitive object={terrain} />}
      {sceneReadyForMarkers && focusedPlacement &&
        activityOrbitRings.map((ring) => (
          <mesh
            key={`${ring.radius}:${ring.colour}`}
            position={[ring.center[0], ring.center[1], ring.center[2] + 0.72]}
            renderOrder={1}
          >
            <ringGeometry args={[ring.radius - 0.012, ring.radius + 0.012, 96]} />
            <meshBasicMaterial
              color={ring.colour}
              transparent
              opacity={0.72}
              side={THREE.DoubleSide}
              depthWrite={false}
            />
          </mesh>
        ))}

      {sceneReadyForMarkers &&
        showPhotoPins &&
        localPhotoLayout.map((item) =>
          item.photo.mediaKind === "audio" && item.photo.audioUrl ? (
            <OrbitingAudioMarker
              key={item.photo.id}
              id={item.photo.id}
              audioUrl={item.photo.audioUrl}
              iconName={item.photo.iconName}
              center={item.kind === "orbit" ? item.center : item.position}
              orbitRadius={item.kind === "orbit" ? item.orbitRadius : undefined}
              isPlaying={playingAudioId === item.photo.id}
              isHighlighted={item.index === hoveredIndex}
              onPlaybackStart={() => setPlayingAudioId(item.photo.id)}
              onPlaybackStop={() =>
                setPlayingAudioId((current) =>
                  current === item.photo.id ? null : current,
                )
              }
              onPointerEnter={() => setHoveredIndex(item.index)}
              onPointerLeave={() => setHoveredIndex(null)}
            />
          ) : item.kind === "flower" ? (
            <TerrainPhotoFlower
              key={item.photo.id}
              id={item.photo.id}
              url={item.photo.thumbnailUrl}
              width={item.photo.width}
              height={item.photo.height}
              adjustments={item.photo.adjustments}
              borderColour={selectedActivityColour}
              position={item.position}
              isSelected={item.index === selectedIndex}
              isHighlighted={item.index === hoveredIndex}
              onClick={() =>
                selectPhoto(item.index === selectedIndex ? null : item.index)
              }
              onPointerEnter={() => setHoveredIndex(item.index)}
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
              borderColour={selectedActivityColour}
              center={item.center}
              orbitRadius={item.orbitRadius}
              isSelected={item.index === selectedIndex}
              isHighlighted={item.index === hoveredIndex}
              onClick={() =>
                selectPhoto(item.index === selectedIndex ? null : item.index)
              }
              onPointerEnter={() => setHoveredIndex(item.index)}
              onPointerLeave={() => setHoveredIndex(null)}
            />
          ),
        )}

      {sceneReadyForMarkers &&
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
            isSelected={
              (
                usesTouchPreview
                  ? previewPlacement
                  : hoveredPlacement
              )?.placement_id === placement.placement_id
            }
            onClick={
              focusedPlacement
                ? undefined
                : () => {
                    if (usesTouchPreview) {
                      setHoveredPlacement(null);
                      setPreviewPlacement((current) =>
                        current?.placement_id === placement.placement_id
                          ? null
                          : placement,
                      );
                      panToPlacement(position);
                      return;
                    }
                    focusPlacement(placement);
                  }
            }
            onPointerEnter={
              focusedPlacement || usesTouchPreview
                ? undefined
                : () => setHoveredPlacement(placement)
            }
            onPointerLeave={
              focusedPlacement || usesTouchPreview
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
}: {
  placement: MapPlacement;
  adminHref?: string;
}) {
  const isMobile = useIsMobileBreakpoint();
  const [expanded, setExpanded] = useState(!isMobile);
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

  useEffect(() => {
    setExpanded(!isMobile);
  }, [isMobile, placement.placement_id]);

  return (
    <section
      style={{
        ...siteDetailsStyle,
        ...(isMobile ? mobileSiteDetailsStyle : {}),
        ...(isMobile && !expanded ? mobileSiteDetailsCollapsedStyle : {}),
      }}
      aria-label="Placement details"
    >
      <div
        style={{
          ...siteDetailsHeaderStyle,
          ...(!expanded ? siteDetailsHeaderCollapsedStyle : {}),
        }}
      >
        {partnerLogo?.url && (
          <img
            src={partnerLogo.url}
            alt={
              partnerLogo.alt ||
              placement.partner_name ||
              "Partner logo"
            }
            style={placement.partner_white_logo?.url ? partnerWhiteLogoStyle : partnerLogoStyle}
          />
        )}
        <div style={siteDetailsTitleWrapStyle}>
          <div style={siteNameStyle}>{placement.placement_name}</div>
          <div style={sitePartnerStyle}>
            {placement.partner_name || "Partner organization"}
          </div>
        </div>
        <button
          type="button"
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
        <>
          <div style={siteDetailsGridStyle}>
            <SiteDetail label="Site" value={siteDetails || "Not specified"} />
            <SiteDetail
              label={peopleLabel}
              value={
                people.map((person) => person.name).join(", ") || "Unassigned"
              }
            />
            {participantDetails && (
              <SiteDetail label="Age range" value={participantDetails} />
            )}
          </div>
          {adminHref && (
            <div style={siteDetailsAdminActionStyle}>
              <a href={adminHref} style={siteDetailsAdminLinkStyle}>
                Admin
              </a>
            </div>
          )}
        </>
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
      <div style={placementHoverNameStyle}>{placement.placement_name}</div>
    </section>
  );
}

export function PlacementPreviewPanel({
  placement,
  onOpen,
}: {
  placement: MapPlacement;
  onOpen: () => void;
}) {
  const isMobile = useIsMobileBreakpoint();
  const siteDetails = formatSiteDetails(placement);
  const participantDetails = formatParticipantDetails(placement);
  const partnerLogo = placement.partner_white_logo?.url
    ? placement.partner_white_logo
    : placement.partner_logo;

  return (
    <section
      style={{
        ...placementPreviewPanelStyle,
        ...(isMobile ? placementPreviewMobilePanelStyle : {}),
      }}
      aria-label="Placement preview"
    >
      <button
        type="button"
        onClick={onOpen}
        style={{
          ...placementPreviewButtonStyle,
          ...(isMobile ? placementPreviewMobileButtonStyle : {}),
        }}
      >
        {(partnerLogo?.url || (isMobile && placement.is_earlyon)) && (
          <span style={isMobile ? placementPreviewMobileLogoRowStyle : placementPreviewDesktopLogoRowStyle}>
            {partnerLogo?.url && (
              <img
                src={partnerLogo.url}
                alt={
                  partnerLogo.alt ||
                  placement.partner_name ||
                  "Partner logo"
                }
                style={{
                  ...(placement.partner_white_logo?.url ? placementPreviewWhiteLogoStyle : placementPreviewLogoStyle),
                  ...(isMobile ? placementPreviewMobileLogoStyle : {}),
                }}
              />
            )}
            {isMobile && placement.is_earlyon && (
              <img
                src="/early-on-white.svg"
                alt="EarlyON"
                style={placementPreviewEarlyOnLogoStyle}
              />
            )}
          </span>
        )}
        <span style={{ ...placementPreviewContentStyle, ...(isMobile ? placementPreviewMobileContentStyle : {}) }}>
          <span style={placementPreviewNameStyle}>
            {formatPlacementDisplayName(placement)}
          </span>
          {siteDetails && (
            <span style={placementPreviewMetaStyle}>{siteDetails}</span>
          )}
          {participantDetails && (
            <span style={placementPreviewMetaStyle}>{participantDetails}</span>
          )}
        </span>
        <span style={{ ...placementPreviewActionStyle, ...(isMobile ? placementPreviewMobileActionStyle : {}) }}>View</span>
      </button>
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
  const ageRange = placement.participant_age?.trim();
  return ageRange
    ? (/\d/.test(ageRange) ? `age ${ageRange}` : ageRange)
    : "";
}

function SiteDetail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={siteDetailLabelStyle}>{label}</div>
      <div style={siteDetailValueStyle}>{value}</div>
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
    | { mode: "placement"; placementId: number; activityId?: number },
  placementId: number,
  activityId?: number,
) {
  return (
    scope.mode === "placement" &&
    scope.placementId === placementId &&
    (scope.activityId ?? null) === (activityId ?? null)
  );
}

const siteDetailsStyle: React.CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: 16,
  transform: "translateX(-50%)",
  zIndex: 13,
  width: "min(560px, calc(100vw - 32px))",
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

const mobileSiteDetailsStyle: React.CSSProperties = {
  bottom: 0,
  left: 0,
  right: 0,
  transform: "none",
  width: "auto",
  maxWidth: "none",
  zIndex: 13,
  borderRadius: 0,
  padding: 12,
  overflow: "hidden",
};

const mobileSiteDetailsCollapsedStyle: React.CSSProperties = {
  maxHeight: 86,
};

const placementHoverLabelStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  bottom: 18,
  transform: "translateX(-50%)",
  width: "max-content",
  maxWidth: "min(460px, calc(100vw - 32px))",
  pointerEvents: "none",
  background: "rgba(10,10,20,0.82)",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 6,
  padding: "10px 14px",
  color: "#eef2f8",
  fontFamily: "monospace",
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

const placementPreviewPanelStyle: React.CSSProperties = {
  position: "fixed",
  left: 12,
  right: 12,
  bottom: 44,
  zIndex: 15,
  pointerEvents: "auto",
  fontFamily: "monospace",
};

const placementPreviewButtonStyle: React.CSSProperties = {
  width: "100%",
  minHeight: 82,
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: 12,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.18)",
  background: "rgba(10,10,20,0.9)",
  color: "#eef2f8",
  boxShadow: "0 12px 32px rgba(0,0,0,0.32)",
  textAlign: "left",
  cursor: "pointer",
};

const placementPreviewLogoStyle: React.CSSProperties = {
  flex: "0 0 auto",
  width: 56,
  height: 42,
  objectFit: "contain",
  background: "rgba(255,255,255,0.92)",
  borderRadius: 4,
  padding: 5,
};

const placementPreviewMobilePanelStyle: React.CSSProperties = {
  left: 0,
  right: 0,
  bottom: 0,
  width: "100vw",
  margin: 0,
  overflow: "hidden",
  zIndex: 17,
};

const placementPreviewMobileButtonStyle: React.CSSProperties = {
  flexDirection: "column",
  alignItems: "stretch",
  gap: 10,
  padding: 14,
  boxSizing: "border-box",
  borderRadius: 0,
};

const placementPreviewMobileLogoStyle: React.CSSProperties = {
  width: "min(50vw, 280px)",
  height: 72,
  alignSelf: "flex-start",
  objectPosition: "left center",
};

const placementPreviewDesktopLogoRowStyle: React.CSSProperties = {
  display: "contents",
};

const placementPreviewMobileLogoRowStyle: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-start",
  gap: 16,
};

const placementPreviewEarlyOnLogoStyle: React.CSSProperties = {
  width: "min(30vw, 160px)",
  height: 58,
  flex: "0 1 auto",
  objectFit: "contain",
  objectPosition: "left center",
};

const placementPreviewMobileContentStyle: React.CSSProperties = {
  width: "100%",
};

const placementPreviewMobileActionStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "11px 12px",
  borderRadius: 8,
  textAlign: "center",
  background: "rgba(255,255,255,0.12)",
};

const placementPreviewWhiteLogoStyle: React.CSSProperties = {
  ...placementPreviewLogoStyle,
  background: "transparent",
  padding: 0,
};

const placementPreviewContentStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
  display: "grid",
  gap: 3,
};

const placementPreviewPartnerStyle: React.CSSProperties = {
  color: "#aeb7c6",
  fontSize: 11,
  fontWeight: 400,
  lineHeight: 1.25,
  overflowWrap: "anywhere",
};

const placementPreviewNameStyle: React.CSSProperties = {
  color: "#f4f7fb",
  fontSize: 14,
  fontWeight: 700,
  lineHeight: 1.3,
  overflowWrap: "anywhere",
};

const placementPreviewMetaStyle: React.CSSProperties = {
  color: "#8f9bad",
  fontSize: 10,
  lineHeight: 1.25,
  overflowWrap: "anywhere",
};

const placementPreviewActionStyle: React.CSSProperties = {
  flex: "0 0 auto",
  color: "#ffffff",
  fontSize: 12,
  fontWeight: 700,
  paddingLeft: 6,
};

const siteDetailsHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  paddingBottom: 10,
  borderBottom: "1px solid rgba(255,255,255,0.12)",
};

const siteDetailsHeaderCollapsedStyle: React.CSSProperties = {
  paddingBottom: 0,
  borderBottom: "none",
};

const siteDetailsTitleWrapStyle: React.CSSProperties = {
  minWidth: 0,
  flex: "1 1 auto",
};

const siteDetailsToggleStyle: React.CSSProperties = {
  pointerEvents: "auto",
  flex: "0 0 auto",
  width: 30,
  height: 30,
  display: "grid",
  placeItems: "center",
  borderRadius: 999,
  background: "rgba(255,255,255,0.08)",
  color: "#eef2f8",
  border: "1px solid rgba(255,255,255,0.14)",
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
  width: 54,
  height: 40,
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

const sitePartnerStyle: React.CSSProperties = {
  color: "#aeb7c6",
  fontSize: 12,
  fontWeight: 400,
  lineHeight: 1.25,
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
  gap: 9,
  paddingTop: 10,
};

const siteDetailsAdminActionStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  marginTop: 10,
  pointerEvents: "auto",
};

const siteDetailsAdminLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 30,
  padding: "5px 9px",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: 4,
  color: "#eef2f8",
  textDecoration: "none",
  fontSize: 12,
  lineHeight: 1.2,
  pointerEvents: "auto",
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

function formatPlacementDisplayName(placement: MapPlacement) {
  const section = placement.section?.trim();
  return section
    ? `${placement.placement_name} - ${section}`
    : placement.placement_name;
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
