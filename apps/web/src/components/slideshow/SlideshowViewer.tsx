import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fetchSlideshow, fetchUploadOptions, type ActivityOption, type Photo, type UploadPlacement } from "../../api/client";
import LoadingIndicator from "../ui/LoadingIndicator";

const ANECDOTE_DWELL_MS = 10_000;
const MIN_IMAGE_DWELL_MS = 10_000;
const MAX_IMAGE_DWELL_MS = 16_000;
const MIN_DWELL_CHARACTER_COUNT = 200;
const MAX_DWELL_CHARACTER_COUNT = 500;
const MAX_RECENT_IDS = 12;
const MAX_HISTORY_LENGTH = 120;
const UPCOMING_BUFFER_LENGTH = 3;
const REFRESH_INTERVAL_MS = 10 * 60 * 1_000;
const ANECDOTE_SLIDE_PROBABILITY = 0.2;
const CUSTOM_ACTIVITY_COLOURS = ["#8e1d58", "#c45b2c", "#367b76", "#6b5aa8", "#9a7b1f"];
const ROTATION_STORAGE_KEY = "atlas-slideshow-rotation";

type SlideshowViewerProps = {
  placementId?: number;
};

type SlideshowBadge = {
  label: string;
  colour?: string;
  isProcess?: boolean;
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

function getFirstDocumentationParagraph(html?: string): string | undefined {
  if (!html?.trim()) return undefined;
  const document = new DOMParser().parseFromString(html, "text/html");
  const paragraph = Array.from(document.querySelectorAll("p"))
    .map((element) => element.textContent?.trim() ?? "")
    .find(Boolean);
  return paragraph || document.body.textContent?.trim() || undefined;
}

function getFirstSentence(text?: string): string | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  const sentenceEndPattern = /[.!?](?=\s|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = sentenceEndPattern.exec(value))) {
    const sentence = value.slice(0, match.index + 1).trim();
    if (/\bSt\.$/iu.test(sentence)) continue;
    return sentence;
  }
  return value;
}

function removeLeadingSentence(text: string | undefined, sentence: string | undefined): string | undefined {
  if (!text || !sentence) return text;
  const remainder = text.slice(sentence.length).trim();
  return remainder || undefined;
}

function getImageDwellMs(characterCount: number): number {
  const progress = Math.min(
    1,
    Math.max(
      0,
      (characterCount - MIN_DWELL_CHARACTER_COUNT) /
        (MAX_DWELL_CHARACTER_COUNT - MIN_DWELL_CHARACTER_COUNT),
    ),
  );
  return Math.round(
    MIN_IMAGE_DWELL_MS + progress * (MAX_IMAGE_DWELL_MS - MIN_IMAGE_DWELL_MS),
  );
}

function getHtmlTextLength(html?: string): number {
  if (!html?.trim()) return 0;
  const document = new DOMParser().parseFromString(html, "text/html");
  return document.body.textContent?.replace(/\s+/g, " ").trim().length ?? 0;
}

function getAnecdoteFontSizing(characterCount: number) {
  if (characterCount <= 500) {
    return { floor: "28px", cap: "52px" };
  }

  const cap = Math.max(22, Math.min(52, (52 * 500) / characterCount));
  return { floor: "22px", cap: `${cap}px` };
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
  const anecdotes = candidates.filter((photo) => photo.mediaKind === "anecdote");
  const assets = candidates.filter((photo) => photo.mediaKind !== "anecdote");
  const pool = anecdotes.length > 0 && (
    assets.length === 0 || Math.random() < ANECDOTE_SLIDE_PROBABILITY
  )
    ? anecdotes
    : assets.length > 0
      ? assets
      : anecdotes;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function mergePhotos(existing: Photo[], incoming: Photo[]): Photo[] {
  const merged = new Map(existing.map((photo) => [photo.id, photo]));
  for (const photo of incoming) merged.set(photo.id, photo);
  return [...merged.values()];
}

function getInitialRotation(): boolean {
  try {
    return window.localStorage.getItem(ROTATION_STORAGE_KEY) === "-90";
  } catch {
    return false;
  }
}

export default function SlideshowViewer({ placementId }: SlideshowViewerProps) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [history, setHistory] = useState<Photo[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [activityOptions, setActivityOptions] = useState<ActivityOption[]>([]);
  const [placements, setPlacements] = useState<UploadPlacement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isRotated, setIsRotated] = useState(getInitialRotation);
  const photosRef = useRef<Photo[]>([]);
  const historyRef = useRef<Photo[]>([]);
  const historyIndexRef = useRef(-1);
  const recentIdsRef = useRef<string[]>([]);
  const upcomingRef = useRef<Photo[]>([]);
  const preloadCacheRef = useRef(new Map<string, Promise<void>>());
  const fullscreenRequestedRef = useRef(false);
  const metadataDiagnosticsLoggedRef = useRef(new Set<string>());
  const placementDiagnosticsLoggedRef = useRef(new Set<string>());

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
      const metadataMissingPhotos = incoming
        .filter((photo) => photo.mediaKind === "image")
        .filter((photo) =>
          !photo.exifInfo?.description?.trim() &&
          !(photo.activityIds?.length || photo.customActivities?.length) &&
          photo.assetType !== "process",
        );
      if (metadataMissingPhotos.length > 0) {
        const metadataMissingIds = metadataMissingPhotos
          .map((photo) => photo.id)
          .slice(0, 10);
        console.info("[slideshow] images without caption or activity metadata", {
          count: metadataMissingPhotos.length,
          sampleAssetIds: metadataMissingIds,
          placementId,
        });
      }
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
          if (!cancelled) {
            setActivityOptions(options.activities);
            setPlacements(options.placements);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setActivityOptions([]);
            setPlacements([]);
          }
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
    try {
      window.localStorage.setItem(ROTATION_STORAGE_KEY, isRotated ? "-90" : "0");
    } catch {
      // Rotation still works for this session when browser storage is unavailable.
    }
  }, [isRotated]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditableTarget = target?.isContentEditable ||
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT";

      if (event.key === "Escape") {
        event.preventDefault();
        exitSlideshow();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        selectPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        selectNext();
      } else if (
        event.key.toLowerCase() === "r" &&
        !event.repeat &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !isEditableTarget
      ) {
        event.preventDefault();
        setIsRotated((rotated) => !rotated);
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
  const isProcessAsset = currentPhoto?.assetType === "process";
  const assetCaption = currentPhoto?.exifInfo?.description?.trim();
  const caption = assetCaption || (isProcessAsset ? undefined : activityDescriptions[0]);
  const activityDescriptionHeading = assetCaption || isProcessAsset
    ? undefined
    : getFirstSentence(activityDescriptions[0]);
  const activityDescriptionBody = assetCaption || isProcessAsset
    ? undefined
    : removeLeadingSentence(activityDescriptions[0], activityDescriptionHeading);
  const supportingActivityDescriptions = isProcessAsset
    ? []
    : assetCaption
      ? activityDescriptions
      : [
          ...(activityDescriptionBody ? [activityDescriptionBody] : []),
          ...activityDescriptions.slice(1),
        ];
  const activityColour = currentActivities[0]?.colour ?? (
    customActivities.length > 0 ? CUSTOM_ACTIVITY_COLOURS[0] : undefined
  );
  const activityBadges: SlideshowBadge[] = [
    ...currentActivities.map((activity) => ({ label: activity.label, colour: activity.colour })),
    ...customActivities.map((activity, index) => ({
      label: activity,
      colour: CUSTOM_ACTIVITY_COLOURS[index % CUSTOM_ACTIVITY_COLOURS.length],
    })),
  ];
  const currentPlacement = placements.find(
    (candidate) => candidate.placement_id === currentPhoto?.placementId,
  );
  const placementPeople = [
    currentPlacement?.team_member_name?.trim(),
    currentPlacement?.secondary_team_member_name?.trim(),
  ].filter((person): person is string => Boolean(person));
  const placementPeopleLabel =
    placementPeople.length > 1 ? "Artist Educators" : "Artist Educator";
  const placementAgeRange = currentPlacement?.participant_age?.trim();
  const displayBadges: SlideshowBadge[] = isProcessAsset
    ? [{ label: "Creative Process", isProcess: true }]
    : activityBadges;
  const documentationParagraph = isProcessAsset
    ? getFirstDocumentationParagraph(currentPlacement?.documentation_content_html)
    : undefined;
  const documentationPullQuote = isProcessAsset
    ? currentPlacement?.documentation_pull_quote?.trim()
    : undefined;
  const documentationFirstSentence = isProcessAsset
    ? getFirstSentence(documentationParagraph)
    : undefined;
  const documentationAttribution = isProcessAsset
    ? currentPlacement?.documentation_attribution?.trim()
    : undefined;
  const documentationBody = documentationPullQuote
    ? documentationParagraph
    : removeLeadingSentence(documentationParagraph, documentationFirstSentence);
  const metadataHeading =
    documentationPullQuote ||
    documentationFirstSentence ||
    activityDescriptionHeading ||
    assetCaption;
  const metadataDescriptions = [
    ...(documentationPullQuote && caption && caption !== documentationPullQuote
      ? [caption]
      : []),
    ...supportingActivityDescriptions,
    ...(documentationBody && !supportingActivityDescriptions.includes(documentationBody)
      ? [documentationBody]
      : []),
  ];
  const metadataCharacterCount = [
    metadataHeading,
    ...metadataDescriptions,
    documentationAttribution,
  ]
    .filter((text): text is string => Boolean(text))
    .join(" ")
    .length;
  const imageDwellMs = getImageDwellMs(metadataCharacterCount);
  const anecdoteCharacterCount = currentPhoto?.mediaKind === "anecdote"
    ? getHtmlTextLength(currentPhoto.anecdoteHtml) + (currentPhoto.attribution?.trim().length ?? 0)
    : 0;
  const anecdoteFontSizing = getAnecdoteFontSizing(anecdoteCharacterCount);

  useEffect(() => {
    if (!currentPhoto) return;
    const dwell = currentPhoto.mediaKind === "anecdote"
      ? ANECDOTE_DWELL_MS
      : imageDwellMs;
    const timer = window.setTimeout(selectNext, dwell);
    return () => window.clearTimeout(timer);
  }, [currentPhoto, imageDwellMs, selectNext]);

  useEffect(() => {
    if (!currentPhoto || currentPhoto.mediaKind !== "image") return;

    const hasRawMetadata = Boolean(
      isProcessAsset ||
      currentPhoto.exifInfo?.description?.trim() ||
      currentPhoto.activityIds?.length ||
      currentPhoto.customActivities?.length ||
      documentationParagraph,
    );
    const activityMetadataUnavailable = Boolean(
      currentPhoto.activityIds?.length &&
      activityOptions.length > 0 &&
      activityBadges.length === 0,
    );
    if (
      (!hasRawMetadata || activityMetadataUnavailable) &&
      !metadataDiagnosticsLoggedRef.current.has(currentPhoto.id)
    ) {
      metadataDiagnosticsLoggedRef.current.add(currentPhoto.id);
      console.warn("[slideshow] current image has no renderable metadata", {
        assetId: currentPhoto.id,
        fileName: currentPhoto.fileName,
        caption: currentPhoto.exifInfo?.description ?? null,
        activityIds: currentPhoto.activityIds ?? [],
        customActivities: currentPhoto.customActivities ?? [],
        resolvedActivityBadges: activityBadges.map((badge) => badge.label),
      });
    }

    if (currentPhoto.placementId == null) {
      if (!placementDiagnosticsLoggedRef.current.has(currentPhoto.id)) {
        placementDiagnosticsLoggedRef.current.add(currentPhoto.id);
        console.info("[slideshow] current image has no placement mapping", {
          assetId: currentPhoto.id,
          fileName: currentPhoto.fileName,
        });
      }
    } else if (placements.length > 0 && !currentPlacement) {
      if (!placementDiagnosticsLoggedRef.current.has(currentPhoto.id)) {
        placementDiagnosticsLoggedRef.current.add(currentPhoto.id);
        console.warn("[slideshow] placement data was not found for current image", {
          assetId: currentPhoto.id,
          placementId: currentPhoto.placementId,
          loadedPlacementCount: placements.length,
        });
      }
    } else if (
      currentPlacement &&
      !currentPlacement.partner_white_logo?.url &&
      !placementDiagnosticsLoggedRef.current.has(currentPhoto.id)
    ) {
      placementDiagnosticsLoggedRef.current.add(currentPhoto.id);
      console.info("[slideshow] current placement has no white partner logo", {
        assetId: currentPhoto.id,
        placementId: currentPhoto.placementId,
        partnerName: currentPlacement.partner_name ?? null,
      });
    }
  }, [activityBadges, activityOptions.length, currentPhoto, currentPlacement, placements.length]);

  if (!currentPhoto && (loading || !error)) {
    return (
      <div
        className={`atlas-slideshow${isRotated ? " atlas-slideshow--rotated" : ""}`}
        aria-label="Atlas slideshow"
        aria-keyshortcuts="R"
      >
        <style>{slideshowStyles}</style>
        <div className="atlas-slideshow-canvas">
          <div className="atlas-slideshow-status" role="status" aria-label="Loading slideshow">
            <LoadingIndicator label="Loading" borderless />
          </div>
        </div>
      </div>
    );
  }

  return (
    <main
      className={`atlas-slideshow${isRotated ? " atlas-slideshow--rotated" : ""}`}
      aria-label="Atlas slideshow"
      aria-keyshortcuts="R"
      onContextMenu={(event) => event.preventDefault()}
    >
      <style>{slideshowStyles}</style>
      <div className="atlas-slideshow-canvas">
      <div
        className="atlas-slideshow-brand"
        aria-label={[
          "Arts for All",
          "Artasia",
          currentPlacement?.partner_name,
          currentPlacement?.placement_name,
        ].filter(Boolean).join(", ")}
      >
        <img
          className="atlas-slideshow-afa-logo"
          src="/afa.svg"
          alt="Arts for All"
        />
        <img
          className="atlas-slideshow-artasia-logo"
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
        {currentPlacement?.placement_name && (
          <div className="atlas-slideshow-placement-details">
            <div className="atlas-slideshow-placement-name">
              <span className="atlas-slideshow-meta-icon" aria-hidden="true">
                location_on
              </span>
              <span>{currentPlacement.placement_name}</span>
            </div>
            {placementPeople.length > 0 && (
              <div className="atlas-slideshow-placement-people">
                <span className="atlas-slideshow-meta-icon" aria-hidden="true">
                  person
                </span>
                <span>
                  {placementPeopleLabel}: {placementPeople.join(", ")}
                </span>
              </div>
            )}
            {placementAgeRange && (
              <div className="atlas-slideshow-placement-age">
                <span className="atlas-slideshow-meta-icon" aria-hidden="true">
                  child_hat
                </span>
                <span>Age range: {placementAgeRange}</span>
              </div>
            )}
          </div>
        )}
      </div>
      <img
        className="atlas-slideshow-qr-code"
        src="/atlas-qr-code.svg"
        alt="Scan to open the Artasia Atlas"
      />
      {currentPhoto ? (
        <div className="atlas-slideshow-slide" key={currentPhoto.id}>
          {currentPhoto.mediaKind === "image" ? (
            <img
              className={`atlas-slideshow-image atlas-slideshow-image-${currentPhoto.orientation}`}
              src={currentPhoto.previewUrl}
              alt={caption || currentPhoto.fileName}
              style={{ animationDuration: `${imageDwellMs}ms` }}
            />
          ) : (
            <article
              className="atlas-slideshow-anecdote"
              style={{
                "--atlas-slideshow-accent": activityColour ?? "#b7bac3",
                "--atlas-slideshow-accent-text": getContrastingTextColour(activityColour),
                "--atlas-slideshow-anecdote-font-floor": anecdoteFontSizing.floor,
                "--atlas-slideshow-anecdote-font-cap": anecdoteFontSizing.cap,
              } as CSSProperties}
            >
              {displayBadges.length > 0 && (
                <div className="atlas-slideshow-anecdote-badges" aria-label="Activities">
                  {displayBadges.map((badge) => (
                    <span
                      key={badge.label}
                      className={`atlas-slideshow-badge${badge.isProcess ? " atlas-slideshow-process-badge" : ""}`}
                      style={badge.isProcess ? undefined : {
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
            displayBadges.length + metadataDescriptions.length > 0 || Boolean(metadataHeading) || Boolean(documentationAttribution)
          ) ? (
            <section
              className="atlas-slideshow-metadata"
              style={{ "--atlas-slideshow-accent": activityColour ?? "#b7bac3" } as CSSProperties}
              aria-live="polite"
            >
              {displayBadges.length > 0 && (
                <div className="atlas-slideshow-badges" aria-label="Activities">
                  {displayBadges.map((badge) => (
                    <span
                      key={badge.label}
                      className={`atlas-slideshow-badge${badge.isProcess ? " atlas-slideshow-process-badge" : ""}`}
                      style={badge.isProcess ? undefined : {
                        backgroundColor: badge.colour ?? "#5c626e",
                        color: getContrastingTextColour(badge.colour),
                      }}
                    >
                      {badge.label}
                    </span>
                  ))}
                </div>
              )}
              {metadataHeading && (
                <h1 className={documentationPullQuote || documentationFirstSentence
                  ? "atlas-slideshow-documentation-pullquote"
                  : undefined}>
                  {metadataHeading}
                </h1>
              )}
              {metadataDescriptions.map((description, index) => (
                <p
                  key={`${description}-${index}`}
                  className={description === documentationBody
                    ? "atlas-slideshow-documentation-paragraph"
                    : undefined}
                >
                  {description}
                </p>
              ))}
              {documentationAttribution && (
                <p className="atlas-slideshow-documentation-attribution">— {documentationAttribution}</p>
              )}
            </section>
          ) : null}
        </div>
      ) : (
        <div className="atlas-slideshow-status" role="alert">{error}</div>
      )}
      </div>
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

  @keyframes atlas-slideshow-pan-vertical {
    from {
      object-position: 50% 0%;
      transform: scale(1.03);
    }
    to {
      object-position: 50% 100%;
      transform: scale(1.13);
    }
  }

  @keyframes atlas-slideshow-pan-horizontal {
    from {
      object-position: 0% 50%;
      transform: scale(1.03);
    }
    to {
      object-position: 100% 50%;
      transform: scale(1.13);
    }
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

  .atlas-slideshow-canvas {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #0b0a0d;
    container: atlas-slideshow / size;
    transform-origin: center;
  }

  .atlas-slideshow--rotated .atlas-slideshow-canvas {
    inset: auto;
    top: 50%;
    left: 50%;
    width: 100dvh;
    height: 100vw;
    /* The browser's left edge becomes the physical top when the monitor is mounted clockwise. */
    transform: translate(-50%, -50%) rotate(-90deg);
  }

  .atlas-slideshow-canvas::before {
    content: "";
    position: absolute;
    inset: 0 0 auto;
    z-index: 1;
    height: 15cqh;
    pointer-events: none;
    background: linear-gradient(180deg, rgba(0, 0, 0, 0.5) 0%, rgba(0, 0, 0, 0) 100%);
  }

  .atlas-slideshow-slide {
    position: absolute;
    inset: 0;
    z-index: 0;
    animation: atlas-slideshow-fade-in 900ms ease both;
  }

  .atlas-slideshow-brand {
    position: absolute;
    top: clamp(20px, 3.5cqh, 48px);
    left: clamp(20px, 3.5cqw, 64px);
    z-index: 10;
    display: flex;
    align-items: flex-start;
    width: max-content;
    max-width: min(90cqw, 1700px);
    max-height: none;
    gap: clamp(16px, 2cqw, 34px);
    box-sizing: border-box;
    filter: drop-shadow(0 3px 10px rgba(0,0,0,0.9));
    pointer-events: none;
  }

  .atlas-slideshow-brand img {
    display: block;
    flex: 0 0 auto;
    max-width: 100%;
    max-height: 56px;
    object-fit: contain;
  }

  .atlas-slideshow-afa-logo {
    width: clamp(96px, 7cqw, 150px);
    height: 56px;
    max-width: none !important;
  }

  .atlas-slideshow-artasia-logo {
    width: clamp(170px, 11.75cqw, 226px);
    height: 56px;
    max-width: none !important;
  }

  .atlas-slideshow-partner-logo {
    width: min(22cqw, 260px);
    height: 56px;
    max-width: none !important;
  }

  .atlas-slideshow-placement-name {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    color: #ffffff;
    font-size: clamp(15px, 1.15cqw, 22px);
    font-weight: 700;
    line-height: 1.15;
    text-shadow: 0 3px 10px rgba(0,0,0,0.9);
  }

  .atlas-slideshow-placement-details {
    display: flex;
    flex: 0 1 auto;
    flex-direction: column;
    gap: 7px;
    width: min(45cqw, 760px);
    max-width: 45cqw;
    padding-top: 2px;
  }

  .atlas-slideshow-placement-name > span:last-child,
  .atlas-slideshow-placement-people > span:last-child,
  .atlas-slideshow-placement-age > span:last-child {
    min-width: 0;
    text-wrap: balance;
  }

  .atlas-slideshow-placement-people,
  .atlas-slideshow-placement-age {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    color: #ffffff;
    font-size: clamp(13px, 0.95cqw, 18px);
    font-weight: 600;
    line-height: 1.2;
    text-shadow: 0 3px 10px rgba(0,0,0,0.9);
  }

  .atlas-slideshow-meta-icon {
    flex: 0 0 auto;
    font-family: "Material Symbols Outlined", sans-serif;
    font-size: 1.05em;
    font-style: normal;
    font-variation-settings: "FILL" 0, "wght" 500, "GRAD" 0, "opsz" 20;
    line-height: 1.05;
  }

  .atlas-slideshow-qr-code {
    position: absolute;
    right: clamp(20px, 3.5cqw, 64px);
    bottom: clamp(20px, 3.5cqh, 48px);
    z-index: 10;
    display: block;
    width: clamp(112px, 11cqw, 210px);
    height: auto;
    aspect-ratio: 1;
    object-fit: contain;
    filter: drop-shadow(0 3px 10px rgba(0,0,0,0.9));
    pointer-events: none;
  }

  .atlas-slideshow-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    animation: atlas-slideshow-ken-burns 10s ease-in-out both;
    filter: saturate(1.02);
  }

  @container atlas-slideshow (orientation: landscape) {
    .atlas-slideshow-image-portrait {
      animation-name: atlas-slideshow-pan-vertical;
    }
  }

  @container atlas-slideshow (orientation: portrait) {
    .atlas-slideshow-image-landscape {
      animation-name: atlas-slideshow-pan-horizontal;
    }
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
    left: clamp(20px, 3.5cqw, 64px);
    bottom: clamp(20px, 3.5cqh, 48px);
    z-index: 1;
    width: fit-content;
    max-width: min(62cqw, 1100px);
    max-height: none;
    overflow: visible;
    padding: 0;
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
    font-size: clamp(15px, 1.1cqw, 21px);
    font-weight: 700;
    line-height: 1.2;
  }

  .atlas-slideshow-process-badge {
    background: rgba(199, 236, 157, 0.16);
    border: 1px solid rgba(199, 236, 157, 0.64);
    color: #d9f5b7;
  }

  .atlas-slideshow-metadata h1 {
    margin: 0;
    font-size: clamp(22px, 1.84cqw, 38px);
    line-height: 1.1;
    font-weight: 650;
    text-wrap: balance;
    text-shadow: 0 3px 14px rgba(0,0,0,0.96);
  }

  .atlas-slideshow-metadata .atlas-slideshow-documentation-pullquote {
    font-weight: 750;
  }

  .atlas-slideshow-metadata p {
    margin: 18px 0 0;
    color: #f0edf3;
    font-size: clamp(20px, 1.45cqw, 29px);
    line-height: 1.4;
    text-shadow: 0 3px 12px rgba(0,0,0,0.96);
  }

  .atlas-slideshow-metadata .atlas-slideshow-documentation-attribution {
    color: #ddd7e1;
    font-style: italic;
  }

  .atlas-slideshow-metadata .atlas-slideshow-documentation-paragraph {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 5;
    overflow: hidden;
  }

  .atlas-slideshow-anecdote {
    position: absolute;
    inset: 0;
    z-index: 1;
    display: flex;
    flex-direction: column;
    justify-content: center;
    width: 100%;
    height: 100%;
    max-width: none;
    max-height: none;
    margin: 0;
    padding: clamp(28px, 6cqw, 64px);
    box-sizing: border-box;
    overflow: hidden;
    border: 0;
    background: color-mix(in srgb, var(--atlas-slideshow-accent) 30%, rgba(8, 7, 10, 0.88));
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
    display: block;
    margin-bottom: 8px;
    color: var(--atlas-slideshow-accent);
    font-family: "Material Symbols Outlined", sans-serif;
    font-size: clamp(38px, 4cqw, 72px);
    font-variation-settings: "FILL" 1, "wght" 400, "GRAD" 0, "opsz" 48;
    line-height: 1;
  }

  .atlas-slideshow-anecdote-content {
    color: #ffffff;
    font-size: clamp(
      var(--atlas-slideshow-anecdote-font-floor, 28px),
      2.5cqw,
      var(--atlas-slideshow-anecdote-font-cap, 52px)
    );
    line-height: 1.25;
    overflow: hidden;
  }

  .atlas-slideshow-anecdote-content p { margin: 0 0 0.75em; }
  .atlas-slideshow-anecdote-content p:last-child { margin-bottom: 0; }

  .atlas-slideshow-anecdote-attribution {
    margin-top: 28px;
    color: #ddd7e1;
    font-size: clamp(19px, 1.4cqw, 28px);
    line-height: 1.35;
  }

  .atlas-slideshow-status {
    position: absolute;
    inset: 0;
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

  @container atlas-slideshow (orientation: portrait) or (max-width: 900px) {
    .atlas-slideshow-brand {
      top: 16px;
      left: 16px;
      width: calc(100cqw - 32px);
      max-width: calc(100cqw - 32px);
      max-height: none;
      flex-wrap: wrap;
      column-gap: 12px;
      row-gap: 6px;
    }

    .atlas-slideshow-afa-logo {
      width: 88px;
      height: 44px;
    }

    .atlas-slideshow-artasia-logo {
      width: 134px;
      height: 44px;
    }

    .atlas-slideshow-partner-logo {
      width: min(18cqw, 120px);
      height: 44px;
    }

    .atlas-slideshow-placement-name {
      font-size: 14px;
    }

    .atlas-slideshow-placement-details {
      flex: 0 0 100%;
      gap: 4px;
      width: 100%;
      max-width: none;
      padding-top: 0;
    }

    .atlas-slideshow-placement-people,
    .atlas-slideshow-placement-age {
      font-size: 11px;
    }

    .atlas-slideshow-qr-code {
      display: none;
    }

    .atlas-slideshow-metadata {
      left: 0;
      right: 0;
      bottom: 0;
      width: 100cqw;
      max-width: none;
      max-height: none;
      overflow: visible;
      padding: 16px 20px 20px;
      border-left-width: 5px;
    }

    .atlas-slideshow-anecdote {
      width: 100%;
      height: 100%;
      max-height: none;
      margin: 0;
      padding: 28px;
      border: 0;
    }
  }

  @container atlas-slideshow (max-width: 640px) {
    .atlas-slideshow-metadata {
      left: 0;
      right: 0;
      bottom: 0;
      width: 100cqw;
      max-height: none;
      padding: 14px 16px 18px;
    }

    .atlas-slideshow-metadata p { margin-top: 10px; }
    .atlas-slideshow-anecdote { width: 100%; height: 100%; max-height: none; margin: 0; padding: 22px; }
    .atlas-slideshow-anecdote-content { font-size: clamp(var(--atlas-slideshow-anecdote-font-floor, 28px), 4cqw, var(--atlas-slideshow-anecdote-font-cap, 52px)); }
  }

  .atlas-slideshow--rotated .atlas-slideshow-brand {
    width: calc(100% - clamp(40px, 7cqw, 128px));
    max-width: none;
    justify-content: space-between;
    align-items: flex-start;
  }

  .atlas-slideshow--rotated .atlas-slideshow-placement-details {
    flex: 0 1 auto;
    width: auto;
    max-width: min(50cqw, 600px);
    padding-top: 4px;
    align-items: flex-end;
    text-align: right;
  }

  .atlas-slideshow--rotated .atlas-slideshow-placement-name,
  .atlas-slideshow--rotated .atlas-slideshow-placement-people,
  .atlas-slideshow--rotated .atlas-slideshow-placement-age {
    justify-content: flex-end;
  }
`;
