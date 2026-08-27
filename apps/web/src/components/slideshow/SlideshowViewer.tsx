import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fetchMapPlacements, fetchSlideshow, fetchUploadOptions, type ActivityOption, type MapPlacement, type Photo } from "../../api/client";

const IMAGE_DWELL_MS = 10_000;
const ANECDOTE_DWELL_MS = 10_000;
const MAX_RECENT_IDS = 12;
const MAX_HISTORY_LENGTH = 120;
const UPCOMING_BUFFER_LENGTH = 3;
const REFRESH_INTERVAL_MS = 10 * 60 * 1_000;
const CUSTOM_ACTIVITY_COLOURS = ["#8e1d58", "#c45b2c", "#367b76", "#6b5aa8", "#9a7b1f"];

type SlideshowViewerProps = {
  placementId?: number;
};

function getUniqueCustomActivities(values?: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const label = value.trim();
    const key = label.toLocaleLowerCase();
    if (!label || seen.has(key)) continue;
    seen.add(key);
    result.push(label);
  }
  return result;
}

function getContrastingTextColour(backgroundColour?: string): string {
  const hex = backgroundColour?.trim().replace(/^#/, "") ?? "";
  const expanded = /^[0-9a-f]{3}$/i.test(hex)
    ? hex.split("").map((character) => character.repeat(2)).join("")
    : hex;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return "#ffffff";

  const [red, green, blue] = [0, 2, 4].map((offset) =>
    Number.parseInt(expanded.slice(offset, offset + 2), 16) / 255,
  );
  const luminance = [red, green, blue].map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * luminance[0] + 0.7152 * luminance[1] + 0.0722 * luminance[2] > 0.48
    ? "#16131a"
    : "#ffffff";
}

function pickRandomPhoto(
  photos: Photo[],
  currentId: string | undefined,
  recentIds: string[],
): Photo | null {
  const notCurrent = photos.filter((photo) => photo.id !== currentId);
  if (notCurrent.length === 0) return null;
  const notRecent = notCurrent.filter((photo) => !recentIds.includes(photo.id));
  const candidates = notRecent.length > 0 ? notRecent : notCurrent;
  return candidates[Math.floor(Math.random() * candidates.length)] ?? null;
}

function mergePhotos(existing: Photo[], incoming: Photo[]): Photo[] {
  const merged = new Map(existing.map((photo) => [photo.id, photo]));
  for (const photo of incoming) merged.set(photo.id, photo);
  return [...merged.values()];
}

export default function SlideshowViewer({ placementId }: SlideshowViewerProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [history, setHistory] = useState<Photo[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [activityOptions, setActivityOptions] = useState<ActivityOption[]>([]);
  const [placements, setPlacements] = useState<MapPlacement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const photosRef = useRef<Photo[]>([]);
  const historyRef = useRef<Photo[]>([]);
  const historyIndexRef = useRef(-1);
  const recentIdsRef = useRef<string[]>([]);
  const upcomingRef = useRef<Photo[]>([]);
  const preloadCacheRef = useRef(new Map<string, Promise<void>>());
  const fullscreenRequestedRef = useRef(false);

  const setHistoryPosition = useCallback((nextHistory: Photo[], nextIndex: number) => {
    historyRef.current = nextHistory;
    historyIndexRef.current = nextIndex;
    setHistory(nextHistory);
    setHistoryIndex(nextIndex);
  }, []);

  const preloadPhoto = useCallback((photo: Photo) => {
    if (photo.mediaKind !== "image" || !photo.previewUrl) return Promise.resolve();
    const cached = preloadCacheRef.current.get(photo.id);
    if (cached) return cached;

    const promise = new Promise<void>((resolve) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => resolve();
      image.src = photo.previewUrl;
    });
    preloadCacheRef.current.set(photo.id, promise);
    return promise;
  }, []);

  const requestFullscreen = useCallback(() => {
    if (document.fullscreenElement || !document.documentElement.requestFullscreen) return;
    fullscreenRequestedRef.current = true;
    void document.documentElement.requestFullscreen().catch(() => {
      fullscreenRequestedRef.current = false;
    });
  }, []);

  const fillUpcomingBuffer = useCallback((currentId?: string) => {
    const excludedIds = new Set([
      ...(currentId ? [currentId] : []),
      ...recentIdsRef.current,
      ...upcomingRef.current.map((photo) => photo.id),
    ]);
    while (upcomingRef.current.length < UPCOMING_BUFFER_LENGTH) {
      const next = pickRandomPhoto(
        photosRef.current,
        currentId,
        [...excludedIds],
      );
      if (!next) break;
      upcomingRef.current.push(next);
      excludedIds.add(next.id);
      void preloadPhoto(next);
    }
  }, [preloadPhoto]);

  const loadPhotos = useCallback(async (replace = false) => {
    try {
      const result = await fetchSlideshow({
        limit: 500,
        seed: Math.floor(Math.random() * 2_147_483_646) + 1,
        placementFocus: placementId == null ? undefined : { placementId },
      });
      const incoming = result.photos.filter(
        (photo) => photo.mediaKind === "image" || photo.mediaKind === "anecdote",
      );
      const nextPhotos = replace ? incoming : mergePhotos(photosRef.current, incoming);
      photosRef.current = nextPhotos;
      setPhotos(nextPhotos);
      setError(nextPhotos.length > 0 ? null : "No images or anecdotes are available for this slideshow.");

      if (historyRef.current.length === 0 && nextPhotos.length > 0) {
        const first = pickRandomPhoto(nextPhotos, undefined, []);
        if (first) {
          recentIdsRef.current = [first.id];
          setHistoryPosition([first], 0);
          void preloadPhoto(first);
          upcomingRef.current = [];
          fillUpcomingBuffer(first.id);
        }
      } else {
        fillUpcomingBuffer(historyRef.current[historyIndexRef.current]?.id);
      }
    } catch (loadError) {
      if (photosRef.current.length === 0) {
        setError((loadError as Error).message);
      } else {
        console.warn(`[slideshow] refresh failed: ${(loadError as Error).message}`);
      }
    } finally {
      setLoading(false);
    }
  }, [fillUpcomingBuffer, placementId, preloadPhoto, setHistoryPosition]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    photosRef.current = [];
    historyRef.current = [];
    historyIndexRef.current = -1;
    recentIdsRef.current = [];
    upcomingRef.current = [];
    setPhotos([]);
    setHistory([]);
    setHistoryIndex(-1);
    setPlacements([]);

    void Promise.all([
      loadPhotos(true),
      fetchUploadOptions()
        .then((options) => {
          if (!cancelled) setActivityOptions(options.activities);
        })
        .catch(() => {
          if (!cancelled) setActivityOptions([]);
        }),
      fetchMapPlacements()
        .then((nextPlacements) => {
          if (!cancelled) setPlacements(nextPlacements);
        })
        .catch(() => {
          if (!cancelled) setPlacements([]);
        }),
    ]);

    requestFullscreen();
    return () => {
      cancelled = true;
    };
  }, [loadPhotos, placementId, requestFullscreen]);

  useEffect(() => {
    const refresh = window.setInterval(() => {
      void loadPhotos(false);
    }, REFRESH_INTERVAL_MS);
    return () => window.clearInterval(refresh);
  }, [loadPhotos]);

  const currentPhoto = history[historyIndex] ?? null;

  const selectNext = useCallback(() => {
    const currentHistory = historyRef.current;
    const currentIndex = historyIndexRef.current;
    if (currentIndex < currentHistory.length - 1) {
      setHistoryPosition(currentHistory, currentIndex + 1);
      return;
    }

    const current = currentHistory[currentIndex];
    const next = upcomingRef.current.shift() ?? pickRandomPhoto(
      photosRef.current,
      current?.id,
      recentIdsRef.current,
    );
    if (!next) return;
    recentIdsRef.current = [...recentIdsRef.current.slice(-(MAX_RECENT_IDS - 1)), next.id];
    void preloadPhoto(next);
    fillUpcomingBuffer(next.id);
    const nextHistory = [...currentHistory, next];
    const trimmedHistory = nextHistory.length > MAX_HISTORY_LENGTH
      ? nextHistory.slice(-MAX_HISTORY_LENGTH)
      : nextHistory;
    setHistoryPosition(trimmedHistory, trimmedHistory.length - 1);
  }, [fillUpcomingBuffer, preloadPhoto, setHistoryPosition]);

  const selectPrevious = useCallback(() => {
    const currentIndex = historyIndexRef.current;
    if (currentIndex > 0) {
      setHistoryPosition(historyRef.current, currentIndex - 1);
    }
  }, [setHistoryPosition]);

  const exitSlideshow = useCallback(() => {
    fullscreenRequestedRef.current = false;
    if (document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
    if (window.history.length > 1) window.history.back();
    else window.location.assign("/");
  }, []);

  useEffect(() => {
    if (!currentPhoto) return;
    const dwell = currentPhoto.mediaKind === "anecdote"
      ? ANECDOTE_DWELL_MS
      : IMAGE_DWELL_MS;
    const timer = window.setTimeout(selectNext, dwell);
    return () => window.clearTimeout(timer);
  }, [currentPhoto, selectNext]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        exitSlideshow();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        selectPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        selectNext();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [exitSlideshow, selectNext, selectPrevious]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && fullscreenRequestedRef.current) {
        exitSlideshow();
      }
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [exitSlideshow]);

  useEffect(() => () => {
    if (fullscreenRequestedRef.current && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  const currentActivities = useMemo(() => {
    if (!currentPhoto) return [];
    return (currentPhoto.activityIds ?? [])
      .map((id) => activityOptions.find((activity) => activity.id === id))
      .filter((activity): activity is ActivityOption => Boolean(activity));
  }, [activityOptions, currentPhoto]);
  const customActivities = useMemo(
    () => getUniqueCustomActivities(currentPhoto?.customActivities),
    [currentPhoto],
  );
  const activityDescriptions = currentActivities
    .map((activity) => activity.description?.trim())
    .filter((description): description is string => Boolean(description));
  const assetCaption = currentPhoto?.exifInfo?.description?.trim();
  const caption = assetCaption || activityDescriptions[0];
  const supportingActivityDescriptions = assetCaption
    ? activityDescriptions
    : activityDescriptions.slice(1);
  const activityColour = currentActivities[0]?.colour ?? (
    customActivities.length > 0 ? CUSTOM_ACTIVITY_COLOURS[0] : undefined
  );
  const activityBadges = [
    ...currentActivities.map((activity) => ({ label: activity.label, colour: activity.colour })),
    ...customActivities.map((activity, index) => ({
      label: activity,
      colour: CUSTOM_ACTIVITY_COLOURS[index % CUSTOM_ACTIVITY_COLOURS.length],
    })),
  ];
  const currentPlacement = placements.find(
    (candidate) => candidate.placement_id === currentPhoto?.placementId,
  );

  if (!currentPhoto && (loading || !error)) {
    return <div className="atlas-slideshow atlas-slideshow-status" role="status">Loading slideshow…</div>;
  }

  return (
    <main
      className="atlas-slideshow"
      aria-label="Atlas slideshow"
      onContextMenu={(event) => event.preventDefault()}
    >
      <style>{slideshowStyles}</style>
      <div
        className="atlas-slideshow-brand"
        aria-label={currentPlacement?.partner_name
          ? `Artasia and ${currentPlacement.partner_name}`
          : "Artasia"}
      >
        <img
          src="/artasia-white.svg"
          alt="Artasia"
        />
        {currentPlacement?.partner_white_logo?.url && (
          <img
            className="atlas-slideshow-partner-logo"
            src={currentPlacement.partner_white_logo.url}
            alt={currentPlacement.partner_white_logo.alt || currentPlacement.partner_name || "Partner"}
          />
        )}
      </div>
      {currentPhoto ? (
        <div className="atlas-slideshow-slide" key={currentPhoto.id}>
          {currentPhoto.mediaKind === "image" ? (
            <img
              className="atlas-slideshow-image"
              src={currentPhoto.previewUrl}
              alt={caption || currentPhoto.fileName}
              style={{ animationDuration: `${IMAGE_DWELL_MS}ms` }}
            />
          ) : (
            <article
              className="atlas-slideshow-anecdote"
              style={{
                "--atlas-slideshow-accent": activityColour ?? "#b7bac3",
                "--atlas-slideshow-accent-text": getContrastingTextColour(activityColour),
              } as CSSProperties}
            >
              {activityBadges.length > 0 && (
                <div className="atlas-slideshow-anecdote-badges" aria-label="Activities">
                  {activityBadges.map((badge) => (
                    <span
                      key={badge.label}
                      className="atlas-slideshow-badge"
                      style={{
                        backgroundColor: badge.colour ?? "#5c626e",
                        color: getContrastingTextColour(badge.colour),
                      }}
                    >
                      {badge.label}
                    </span>
                  ))}
                </div>
              )}
              <span className="atlas-slideshow-quote-mark" aria-hidden="true">format_quote</span>
              <div
                className="atlas-slideshow-anecdote-content"
                dangerouslySetInnerHTML={{ __html: currentPhoto.anecdoteHtml ?? "" }}
              />
              {currentPhoto.attribution && (
                <footer className="atlas-slideshow-anecdote-attribution">— {currentPhoto.attribution}</footer>
              )}
            </article>
          )}

          {currentPhoto.mediaKind === "image" && (
            activityBadges.length + activityDescriptions.length > 0 || Boolean(caption)
          ) ? (
            <section
              className="atlas-slideshow-metadata"
              style={{ "--atlas-slideshow-accent": activityColour ?? "#b7bac3" } as CSSProperties}
              aria-live="polite"
            >
              {activityBadges.length > 0 && (
                <div className="atlas-slideshow-badges" aria-label="Activities">
                  {activityBadges.map((badge) => (
                    <span
                      key={badge.label}
                      className="atlas-slideshow-badge"
                      style={{
                        backgroundColor: badge.colour ?? "#5c626e",
                        color: getContrastingTextColour(badge.colour),
                      }}
                    >
                      {badge.label}
                    </span>
                  ))}
                </div>
              )}
              {caption && <h1>{caption}</h1>}
              {supportingActivityDescriptions.map((description, index) => (
                <p key={`${description}-${index}`}>{description}</p>
              ))}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="atlas-slideshow-status" role="alert">{error}</div>
      )}
    </main>
  );
}

const slideshowStyles = `
  @keyframes atlas-slideshow-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @keyframes atlas-slideshow-ken-burns {
    from { transform: scale(1.03) translate3d(-0.4%, -0.3%, 0); }
    to { transform: scale(1.13) translate3d(0.4%, 0.3%, 0); }
  }

  .atlas-slideshow {
    position: fixed;
    inset: 0;
    z-index: 1000;
    width: 100vw;
    height: 100dvh;
    min-height: 100svh;
    overflow: hidden;
    background: #0b0a0d;
    color: #ffffff;
    cursor: none;
    font-family: inherit;
  }

  .atlas-slideshow-slide {
    position: absolute;
    inset: 0;
    z-index: 0;
    animation: atlas-slideshow-fade-in 900ms ease both;
  }

  .atlas-slideshow-brand {
    position: absolute;
    top: clamp(20px, 3.5vh, 48px);
    left: clamp(20px, 3.5vw, 64px);
    z-index: 10;
    display: flex;
    align-items: center;
    max-width: min(40vw, 520px);
    max-height: 80px;
    gap: clamp(16px, 2vw, 34px);
    box-sizing: border-box;
    filter: drop-shadow(0 3px 10px rgba(0,0,0,0.9));
    pointer-events: none;
  }

  .atlas-slideshow-brand img {
    display: block;
    flex: 0 0 auto;
    width: auto;
    max-width: 100%;
    max-height: 56px;
    object-fit: contain;
  }

  .atlas-slideshow-partner-logo {
    max-width: min(22vw, 260px) !important;
  }

  .atlas-slideshow-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    animation: atlas-slideshow-ken-burns 10s ease-in-out both;
    filter: saturate(1.02);
  }

  .atlas-slideshow-slide::after {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: linear-gradient(90deg, rgba(0,0,0,0.35), transparent 45%), linear-gradient(0deg, rgba(0,0,0,0.32), transparent 38%);
  }

  .atlas-slideshow-metadata {
    position: absolute;
    left: clamp(28px, 5vw, 96px);
    bottom: clamp(28px, 6vh, 88px);
    z-index: 1;
    width: fit-content;
    max-width: min(62vw, 1100px);
    max-height: 42vh;
    overflow: hidden;
    padding: clamp(22px, 2.5vw, 42px);
    box-sizing: border-box;
    border: 0;
    background: transparent;
    box-shadow: none;
    backdrop-filter: none;
    filter: drop-shadow(0 4px 12px rgba(0,0,0,0.9));
  }

  .atlas-slideshow-badges,
  .atlas-slideshow-anecdote-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-bottom: 16px;
  }

  .atlas-slideshow-badge {
    display: inline-flex;
    align-items: center;
    min-height: 32px;
    padding: 5px 11px;
    box-sizing: border-box;
    border-radius: 999px;
    font-size: clamp(15px, 1.1vw, 21px);
    font-weight: 700;
    line-height: 1.2;
  }

  .atlas-slideshow-metadata h1 {
    margin: 0;
    font-size: clamp(22px, 1.84vw, 38px);
    line-height: 1.1;
    font-weight: 650;
    text-wrap: balance;
    text-shadow: 0 3px 14px rgba(0,0,0,0.96);
  }

  .atlas-slideshow-metadata p {
    margin: 18px 0 0;
    color: #f0edf3;
    font-size: clamp(20px, 1.45vw, 29px);
    line-height: 1.4;
    text-shadow: 0 3px 12px rgba(0,0,0,0.96);
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 4;
    overflow: hidden;
  }

  .atlas-slideshow-anecdote {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: min(74vw, 1060px);
    height: fit-content;
    max-height: calc(100% - 96px);
    margin: auto;
    padding: clamp(32px, 5vw, 88px);
    box-sizing: border-box;
    overflow: auto;
    border-left: 10px solid var(--atlas-slideshow-accent);
    background: rgba(8, 7, 10, 0.9);
    box-shadow: 0 18px 60px rgba(0,0,0,0.4);
    animation: atlas-slideshow-fade-in 900ms ease both;
  }

  .atlas-slideshow-anecdote::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    background: radial-gradient(circle at 75% 15%, color-mix(in srgb, var(--atlas-slideshow-accent) 32%, transparent), transparent 52%);
  }

  .atlas-slideshow-quote-mark {
    margin-bottom: 8px;
    color: var(--atlas-slideshow-accent);
    font-family: "Material Symbols Rounded", sans-serif;
    font-size: clamp(38px, 4vw, 72px);
    line-height: 1;
  }

  .atlas-slideshow-anecdote-content {
    color: #ffffff;
    font-size: clamp(28px, 2.5vw, 52px);
    line-height: 1.25;
  }

  .atlas-slideshow-anecdote-content p { margin: 0 0 0.75em; }
  .atlas-slideshow-anecdote-content p:last-child { margin-bottom: 0; }

  .atlas-slideshow-anecdote-attribution {
    margin-top: 28px;
    color: #ddd7e1;
    font-size: clamp(19px, 1.4vw, 28px);
    line-height: 1.35;
  }

  .atlas-slideshow-status {
    display: grid;
    place-items: center;
    padding: 24px;
    box-sizing: border-box;
    color: #ffffff;
    font-size: 22px;
    text-align: center;
  }

  @media (prefers-reduced-motion: reduce) {
    .atlas-slideshow-slide,
    .atlas-slideshow-image,
    .atlas-slideshow-anecdote { animation-duration: 1ms !important; }
  }

  @media (max-width: 900px) {
    .atlas-slideshow-brand {
      top: 16px;
      left: 16px;
      max-width: min(42vw, 240px);
      max-height: 64px;
      gap: 12px;
    }

    .atlas-slideshow-brand img { max-height: 44px; }

    .atlas-slideshow-metadata {
      left: 20px;
      right: 20px;
      bottom: 20px;
      width: auto;
      max-height: 38vh;
      padding: 18px 20px;
      border-left-width: 5px;
    }

    .atlas-slideshow-anecdote {
      width: calc(100% - 40px);
      max-height: calc(100% - 40px);
      padding: 28px;
      border-left-width: 6px;
    }
  }

  @media (max-width: 640px) {
    .atlas-slideshow-metadata {
      left: 12px;
      right: 12px;
      bottom: 12px;
      padding: 14px 16px;
    }

    .atlas-slideshow-metadata p { margin-top: 10px; }
    .atlas-slideshow-anecdote { width: calc(100% - 24px); max-height: calc(100% - 24px); padding: 22px; }
  }
`;
