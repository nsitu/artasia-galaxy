import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  assignAssetActivityTag,
  assignAssetDisplayPlacement,
  assignAssetPlacement,
  assignAssetUploader,
  createAudioTrim,
  createVideoRotation,
  cropUploadAsset,
  deleteUploadAsset,
  deleteUploadAssets,
  fetchAssetEdits,
  fetchAudioTrimJob,
  fetchVideoRotationJob,
  fetchAuthUser,
  fetchDriveFiles,
  fetchDriveFolder,
  fetchDriveFolderStats,
  fetchDriveFolders,
  flattenUploadAsset,
  fetchLinkedAudioOptions,
  fetchPlacementAssetSet,
  fetchPlacementAssets,
  fetchSiteActivityStats,
  fetchUploadOptions,
  fetchUploadAssetAdjustments,
  fetchUploadAsset,
  fetchUntaggedPlacementAssets,
  lookupMissingUploadAssetDriveSources,
  lookupUploadAssetDriveSource,
  logoutAuthUser,
  reimportUploadAssetFromDrive,
  resetUploadAssetEdits,
  setAssetArchived,
  setAssetsArchived,
  setAssetIcon,
  setAssetLinkedAudio,
  setAssetPublished,
  setAssetsPublished,
  syncDriveFiles,
  updateAssetCaption,
  updateAssetGpsUsage,
  updateAssetLocation,
  updateUploadAssetAdjustments,
  uploadFiles,
  type AssetAdjustments,
  type ActivityOption,
  type AudioTrimJob,
  type AuthUser,
  type CropParameters,
  type DriveFile,
  type DriveFolder,
  type DriveFolderStats,
  type DriveSyncResult,
  type LinkedAudioOption,
  type RotationDegrees,
  type UploadOptions,
  type PlacementAsset,
  type SiteActivityStats,
  type VideoRotationJob,
} from "../../api/client";
import AudioTrimEditor from "./AudioTrimEditor";
import MaterialIconPicker from "./MaterialIconPicker";
import RetryableUploadThumbnail from "./RetryableUploadThumbnail";

interface UploadItem {
  id: string;
  source: "upload" | "drive";
  file?: File;
  fileName: string;
  fileSize?: number;
  status:
    | "queued"
    | "uploading"
    | "processing"
    | "completed"
    | "failed"
    | "retrying";
  progress: number;
  error?: string;
  assetId?: string;
  caption?: string;
  captionStatus?: "idle" | "saving" | "saved" | "failed";
  captionError?: string;
  openingEditor?: boolean;
  published?: boolean;
  publishStatus?: "idle" | "publishing" | "published" | "failed";
  publishError?: string;
}

type NoticeTone = "success" | "warning";
type BrowseContextFilter = "all" | "earlyon" | "nonEarlyon";
type DeliveryDayFilter =
  | ""
  | "monday"
  | "tuesday"
  | "wednesday"
  | "thursday"
  | "friday";
type SiteScope = "select" | "all" | "placement";
type SiteSort = "alphabetical" | "published-assets";
type WorkspaceMode = "sites" | "browse" | "edit" | "upload" | "import";
type BrowseAssetStatus = "draft" | "published" | "archived";
const CUSTOM_ACTIVITY_OPTION = "__custom_activity__";
type PlacementMetaLine = {
  text: string;
  icon?: string;
  href?: string;
  variant?: "location";
};

function ClearFilterButton({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      style={clearSingleFilterButtonStyle}
    >
      <span style={clearSingleFilterIconStyle} aria-hidden="true">
        close
      </span>
    </button>
  );
}

interface UploadPanelProps {
  initialError?: string | null;
  initialAssetId?: string;
  adminPath?: string;
  adminSearch?: string;
  onSignedOut?: () => void;
}

type CropRect = CropParameters;
type CropHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const MEDIA_REFRESH_DELAYS_MS = [1500, 3000, 6000, 10000, 15000];
const DEFAULT_ADJUSTMENTS: AssetAdjustments = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
};
const MIN_ADJUSTMENT = 50;
const MAX_ADJUSTMENT = 150;
const UPLOAD_ACCEPT_TYPES = "image/*,video/*,.heic,.heif,image/heic,image/heif";
const DEFAULT_SHARED_DRIVE_NAME = "artasia 2026";
const DEFAULT_SHARED_DRIVE_FOLDER = "documentation";
const GLOBAL_AUDIO_PLACEMENT_ID = 21639;

function integersIn(value: string) {
  return (value.match(/\d+/g) ?? [])
    .map(Number)
    .filter((number) => Number.isSafeInteger(number));
}

function activityWeekNumbers(activity: ActivityOption) {
  if (Number.isSafeInteger(activity.week) && (activity.week ?? 0) > 0) {
    return [activity.week as number];
  }
  return integersIn(activity.label);
}

function folderActivityMatchScore(folderName: string, activity: ActivityOption) {
  const folderNumbers = new Set(integersIn(folderName));
  let score = 0;

  for (const week of activityWeekNumbers(activity)) {
    if (!folderNumbers.has(week)) continue;
    const explicitWeekPattern = new RegExp(`\\bweek\\s*0*${week}\\b`, "i");
    score = Math.max(score, explicitWeekPattern.test(folderName) ? 2 : 1);
  }

  return score;
}

function uniqueBestMatch<T>(candidates: T[], score: (candidate: T) => number) {
  let bestScore = 0;
  let bestMatches: T[] = [];
  for (const candidate of candidates) {
    const candidateScore = score(candidate);
    if (candidateScore > bestScore) {
      bestScore = candidateScore;
      bestMatches = [candidate];
    } else if (candidateScore > 0 && candidateScore === bestScore) {
      bestMatches.push(candidate);
    }
  }
  return bestMatches.length === 1 ? bestMatches[0] : null;
}

function activityFolderMatch(activity: ActivityOption, folders: DriveFolder[]) {
  return uniqueBestMatch(folders, (folder) =>
    folderActivityMatchScore(folder.name, activity),
  );
}

function folderActivityMatch(folderName: string, activities: ActivityOption[]) {
  return uniqueBestMatch(activities, (activity) =>
    folderActivityMatchScore(folderName, activity),
  );
}

function driveFolderStatsLabel(stats: DriveFolderStats) {
  const parts: string[] = [];
  if (stats.totalFileCount > 0) {
    parts.push(
      `${stats.totalFileCount} file${stats.totalFileCount === 1 ? "" : "s"}`,
    );
  }
  if (stats.subfolderCount > 0) {
    parts.push(
      `${stats.subfolderCount} subfolder${stats.subfolderCount === 1 ? "" : "s"}`,
    );
  }
  return parts.length > 0 ? parts.join(" · ") : "Empty";
}
const BROWSE_ASSET_STATUSES: Array<{
  value: BrowseAssetStatus;
  label: string;
}> = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];
const coordinateInputValue = (value?: number | null) =>
  Number.isFinite(value) ? String(value) : "";
const DELIVERY_DAY_OPTIONS: Array<{ value: DeliveryDayFilter; label: string }> =
  [
    { value: "", label: "All Delivery Days" },
    { value: "monday", label: "Monday" },
    { value: "tuesday", label: "Tuesday" },
    { value: "wednesday", label: "Wednesday" },
    { value: "thursday", label: "Thursday" },
    { value: "friday", label: "Friday" },
  ];

export default function UploadPanel({
  initialError,
  initialAssetId,
  adminPath,
  adminSearch,
  onSignedOut,
}: UploadPanelProps) {
  const [options, setOptions] = useState<UploadOptions | null>(null);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [uploaderKey, setUploaderKey] = useState("");
  const [browsePartnerKey, setBrowsePartnerKey] = useState("");
  const [browseContextFilter, setBrowseContextFilter] =
    useState<BrowseContextFilter>("all");
  const [deliveryDayFilter, setDeliveryDayFilter] =
    useState<DeliveryDayFilter>("");
  const [timeOfDayFilter, setTimeOfDayFilter] = useState("");
  const [ageRangeFilter, setAgeRangeFilter] = useState("");
  const [siteSearchFilter, setSiteSearchFilter] = useState("");
  const [placementKey, setPlacementKey] = useState("");
  const [activityTagFilter, setActivityTagFilter] = useState("");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [placementAssets, setPlacementAssets] = useState<PlacementAsset[]>([]);
  const [assetMode, setAssetMode] = useState<"placements" | "untagged">(
    "placements",
  );
  const [browseAssetStatus, setBrowseAssetStatus] = useState<BrowseAssetStatus>(
    () => {
      const requestedStatus = new URLSearchParams(
        adminSearch ?? window.location.search,
      ).get("status");
      return BROWSE_ASSET_STATUSES.some(
        (status) => status.value === requestedStatus,
      )
        ? requestedStatus as BrowseAssetStatus
        : "draft";
    },
  );
  const browseAssetStatusIsAutomaticRef = useRef(
    !BROWSE_ASSET_STATUSES.some(
      (status) =>
        status.value === new URLSearchParams(
          adminSearch ?? window.location.search,
        ).get("status"),
    ),
  );
  const browseAssetStatusWasManuallySelectedRef = useRef(false);
  const [siteScope, setSiteScope] = useState<SiteScope>("select");
  const [siteSort, setSiteSort] = useState<SiteSort>("published-assets");
  const [siteActivityStats, setSiteActivityStats] = useState<
    SiteActivityStats["sites"]
  >({});
  const [siteActivityStatsLoading, setSiteActivityStatsLoading] =
    useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("sites");
  const [selectedAsset, setSelectedAsset] = useState<PlacementAsset | null>(
    null,
  );
  const [editNavigationAssets, setEditNavigationAssets] = useState<PlacementAsset[]>([]);
  const [managePlacementKey, setManagePlacementKey] = useState("");
  const [manageDisplayPlacementKey, setManageDisplayPlacementKey] = useState("");
  const [manageUploaderKey, setManageUploaderKey] = useState("");
  const [manageActivityTag, setManageActivityTag] = useState("");
  const [manageCustomActivity, setManageCustomActivity] = useState("");
  const [manageIconName, setManageIconName] = useState<string | null>(null);
  const [manageLinkedAudioAssetId, setManageLinkedAudioAssetId] = useState("");
  const [linkedAudioOptions, setLinkedAudioOptions] = useState<LinkedAudioOption[]>(
    [],
  );
  const [linkedAudioLoading, setLinkedAudioLoading] = useState(false);
  const [linkedAudioPreviewPlaying, setLinkedAudioPreviewPlaying] =
    useState(false);
  const linkedAudioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const [managePublished, setManagePublished] = useState(false);
  const [manageArchived, setManageArchived] = useState(false);
  const [manageCaption, setManageCaption] = useState("");
  const [manageLatitude, setManageLatitude] = useState("");
  const [manageLongitude, setManageLongitude] = useState("");
  const [manageUseGpsLocation, setManageUseGpsLocation] = useState(true);
  const [captionSaving, setCaptionSaving] = useState(false);
  const [captionSaveStatus, setCaptionSaveStatus] = useState<
    "idle" | "saved" | "failed"
  >("idle");
  const [captionSaveError, setCaptionSaveError] = useState<string | null>(null);
  const [savingAsset, setSavingAsset] = useState(false);
  const [selectedBrowseAssetIds, setSelectedBrowseAssetIds] = useState<Set<string>>(
    new Set(),
  );
  const [publishingBrowseAssets, setPublishingBrowseAssets] = useState(false);
  const [archivingBrowseAssets, setArchivingBrowseAssets] = useState(false);
  const [deletingBrowseAssets, setDeletingBrowseAssets] = useState(false);
  const [publishingItemIds, setPublishingItemIds] = useState<Set<string>>(
    new Set(),
  );
  const [publishingAllItems, setPublishingAllItems] = useState(false);
  const [audioTrimStart, setAudioTrimStart] = useState(0);
  const [audioTrimEnd, setAudioTrimEnd] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioTrimStatus, setAudioTrimStatus] = useState<string | null>(null);
  const [videoRotationStatus, setVideoRotationStatus] = useState<string | null>(null);
  const [videoPreviewPlaying, setVideoPreviewPlaying] = useState(false);
  const [deletingAsset, setDeletingAsset] = useState(false);
  const [driveAssetAction, setDriveAssetAction] = useState<
    "lookup" | "reimport" | "reimport-audio" | null
  >(null);
  const [driveBulkLookupRunning, setDriveBulkLookupRunning] = useState(false);
  const [cropEditing, setCropEditing] = useState(false);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const [cropSourceDimensions, setCropSourceDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [straightenDegrees, setStraightenDegrees] = useState(0);
  const [rotationDegrees, setRotationDegrees] = useState<RotationDegrees>(0);
  const [cropLoading, setCropLoading] = useState(false);
  const [cropSaving, setCropSaving] = useState(false);
  const [manageBrightness, setManageBrightness] = useState(
    DEFAULT_ADJUSTMENTS.brightness,
  );
  const [manageContrast, setManageContrast] = useState(
    DEFAULT_ADJUSTMENTS.contrast,
  );
  const [manageSaturation, setManageSaturation] = useState(
    DEFAULT_ADJUSTMENTS.saturation,
  );
  const [adjustmentsLoading, setAdjustmentsLoading] = useState(false);
  const [adjustmentsSaving, setAdjustmentsSaving] = useState(false);
  const [cropRefreshKey, setCropRefreshKey] = useState(0);
  const [mediaRefreshAssetId, setMediaRefreshAssetId] = useState<string | null>(
    null,
  );
  const [mediaRefreshAttempt, setMediaRefreshAttempt] = useState(0);
  const [assetsLoading, setAssetsLoading] = useState(false);
  const [routeSelectionResolved, setRouteSelectionResolved] = useState(false);
  const [directAssetLoading, setDirectAssetLoading] = useState(
    Boolean(initialAssetId),
  );
  const hydratedEditAssetIdsRef = useRef(new Set<string>());
  const [notice, setNotice] = useState<{
    tone: NoticeTone;
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);

  const appPath = adminPath ?? window.location.pathname;
  const appSearch = adminSearch ?? window.location.search;

  function routeWorkspaceMode(path: string): WorkspaceMode {
    if (path === "/admin" || path === "/admin/sites") return "sites";
    if (path === "/admin/browse") return "browse";
    if (path === "/admin/upload") return "upload";
    if (path === "/admin/import") return "import";
    if (path.startsWith("/admin/edit")) return "edit";
    if (/^\/edit\/[0-9a-f-]{36}$/i.test(path)) return "edit";
    return "sites";
  }

  useEffect(() => {
    const nextMode = routeWorkspaceMode(appPath);
    if (
      nextMode === "browse" ||
      nextMode === "upload" ||
      nextMode === "import"
    ) {
      setRouteSelectionResolved(false);
    }
    if (nextMode === workspaceMode) {
      return;
    }

    setWorkspaceMode(nextMode);
    setSelectedAsset(null);
    setItems([]);
    setNotice(null);

  }, [appPath]);

  const cropResizeRef = useRef<{
    handle: CropHandle;
    start: { x: number; y: number };
    rect: CropRect;
  } | null>(null);
  const cropMoveRef = useRef<{
    start: { x: number; y: number };
    rect: CropRect;
  } | null>(null);
  const uploadInProgressRef = useRef(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Drive import state
  const [driveType, setDriveType] = useState<
    "chooser" | "myDrive" | "sharedDrives"
  >("chooser");
  const [currentDriveId, setCurrentDriveId] = useState<string | undefined>();
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([]);
  const [driveFiles, setDriveFiles] = useState<DriveFile[]>([]);
  const [driveFolderStats, setDriveFolderStats] = useState<
    Record<string, DriveFolderStats>
  >({});
  const [driveFolderStatsFailed, setDriveFolderStatsFailed] = useState(false);
  const [selectedDriveFolder, setSelectedDriveFolder] = useState("root");
  const [folderPath, setFolderPath] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [selectedDriveFiles, setSelectedDriveFiles] = useState<Set<string>>(
    new Set(),
  );
  const [driveSyncing, setDriveSyncing] = useState(false);
  const [driveSyncProgress, setDriveSyncProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveDefaultOpening, setDriveDefaultOpening] = useState(false);
  const drivePlacementIdRef = useRef<number | null>(null);
  const driveDefaultRequestRef = useRef(0);

  function placementLabel(location: UploadOptions["placements"][number]) {
    const section = location.section?.trim();
    return section
      ? `${location.placement_name} - ${section}`
      : location.placement_name;
  }

  function groupedPlacementsByPartner(placements: UploadOptions["placements"]) {
    const collator = new Intl.Collator(undefined, {
      sensitivity: "base",
      numeric: true,
    });
    const groups = new Map<string, UploadOptions["placements"]>();
    for (const placement of placements) {
      const partner = placement.partner_name?.trim() || "No Partner";
      const group = groups.get(partner) ?? [];
      group.push(placement);
      groups.set(partner, group);
    }
    return Array.from(groups.entries())
      .sort(([partnerA], [partnerB]) => collator.compare(partnerA, partnerB))
      .map(([partner, group]) => ({
        partner,
        placements: [...group].sort((a, b) =>
          collator.compare(placementLabel(a), placementLabel(b)),
        ),
      }));
  }

  function placementMetaLabel(placement: UploadOptions["placements"][number]) {
    const people = [
      placement.team_member_name ?? "Unassigned",
      placement.secondary_team_member_name,
    ]
      .filter(Boolean)
      .join(" + ");
    return [
      placement.partner_name,
      people,
      placement.delivery_schedule,
      placement.participant_age ? `(${placement.participant_age})` : undefined,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function placementMetaLines(placement: UploadOptions["placements"][number]) {
    const people = [
      placement.team_member_name ?? "Unassigned",
      placement.secondary_team_member_name,
    ]
      .filter(Boolean)
      .join(" + ");
    const ageRange = formatParticipantAge(placement.participant_age);
    const address =
      placement.address?.trim() ||
      [placement.place_name, placement.place_city].filter(Boolean).join(", ");
    const locationDisplay = formatPlacementLocationDisplay(
      placement.partner_name,
      placement.place_name,
      address,
    );

    const lines: Array<PlacementMetaLine | null> = [
      people ? { text: people, icon: "person" } : null,
      placement.delivery_schedule
        ? { text: placement.delivery_schedule, icon: "schedule" }
        : null,
      ageRange ? { text: ageRange, icon: "child_hat" } : null,
      locationDisplay
        ? {
            text: locationDisplay,
            href: googleMapsUrl(address),
            variant: "location",
          }
        : null,
    ];

    return lines.filter((line): line is PlacementMetaLine => Boolean(line));
  }

  function formatParticipantAge(value?: string) {
    const trimmed = value?.trim();
    if (!trimmed) return "";
    return /\d/.test(trimmed) ? `Ages ${trimmed}` : trimmed;
  }

  function formatPlacementLocationDisplay(
    partnerName?: string,
    placeName?: string,
    address?: string,
  ) {
    const trimmedAddress = address?.trim();
    const trimmedPlaceName = placeName?.trim();
    const trimmedPartnerName = partnerName?.trim();
    const lines = [
      trimmedPartnerName,
      trimmedPlaceName &&
      !trimmedAddress
        ?.toLocaleLowerCase()
        .includes(trimmedPlaceName.toLocaleLowerCase())
        ? trimmedPlaceName
        : undefined,
      trimmedAddress,
    ].filter(Boolean);

    return lines.join("\n");
  }

  function googleMapsUrl(address: string) {
    const queryBase = address.trim();
    const query = /\bontario\b|\bon\b/i.test(queryBase)
      ? queryBase
      : `${queryBase}, Ontario`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  useEffect(() => {
    if (options) return;
    const authFallback: AuthUser = { authenticated: false };
    Promise.all([
      fetchUploadOptions(),
      fetchAuthUser().catch(() => authFallback),
    ])
      .then(([data, auth]) => {
        setOptions(data);
        const currentUser = data.currentUser ?? auth;
        setAuthUser(currentUser);
      })
      .catch((err) => setError((err as Error).message));
  }, [options]);

  useEffect(() => {
    if (!options) return;
    const mode = routeWorkspaceMode(appPath);
    if (mode !== "browse" && mode !== "upload" && mode !== "import") return;

    const params = new URLSearchParams(appSearch);
    const requestedSite = params.get("site");
    const requestedSiteId = Number(requestedSite);
    const requestedUntagged = mode === "browse" && requestedSite === "untagged";
    const requestedActivityId = Number(params.get("activity"));
    const requestedStatus = params.get("status");
    const site = options.placements.find(
      (placement) =>
        params.has("site") &&
        Number.isInteger(requestedSiteId) &&
        placement.placement_id === requestedSiteId,
    );
    const activity = options.activities.find(
      (candidate) =>
        params.has("activity") &&
        Number.isInteger(requestedActivityId) &&
        candidate.id === requestedActivityId,
    );

    setPlacementKey(site ? String(site.placement_id) : "");
    setSiteScope(site ? "placement" : mode === "browse" && !requestedUntagged ? "all" : "select");
    setAssetMode(requestedUntagged ? "untagged" : "placements");
    setActivityTagFilter(!requestedUntagged && activity ? String(activity.id) : "");
    if (mode === "browse") {
      const hasRequestedStatus = BROWSE_ASSET_STATUSES.some(
        (status) => status.value === requestedStatus,
      );
      browseAssetStatusIsAutomaticRef.current = hasRequestedStatus
        ? false
        : !browseAssetStatusWasManuallySelectedRef.current;
      setBrowseAssetStatus(
        hasRequestedStatus
          ? requestedStatus as BrowseAssetStatus
          : "draft",
      );
    }
    setSelectedAsset(null);
    setSelectedBrowseAssetIds(new Set());
    setItems([]);
    setNotice(null);
    setError(null);
    setRouteSelectionResolved(true);
  }, [appPath, appSearch, options]);

  useEffect(() => {
    if (workspaceMode !== "sites" || !authUser?.authenticated) return;
    let cancelled = false;
    setSiteActivityStatsLoading(true);
    fetchSiteActivityStats()
      .then((result) => {
        if (!cancelled) setSiteActivityStats(result.sites);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setSiteActivityStatsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [authUser?.authenticated, workspaceMode]);

  useEffect(() => {
    if (!initialAssetId) {
      setDirectAssetLoading(false);
      const baseAdminPaths = ["/admin", "/admin/browse"];
      if (baseAdminPaths.includes(window.location.pathname) && selectedAsset) {
        closeAssetManager();
        setWorkspaceMode("browse");
      }
      return;
    }
    setWorkspaceMode("edit");
    if (
      selectedAsset?.id === initialAssetId &&
      hydratedEditAssetIdsRef.current.has(initialAssetId)
    ) {
      setDirectAssetLoading(false);
      return;
    }
    if (!authUser) return;
    if (!authUser.authenticated) {
      setDirectAssetLoading(false);
      setError("Sign in to edit this upload.");
      return;
    }

    let cancelled = false;
    setDirectAssetLoading(true);
    fetchUploadAsset(initialAssetId)
      .then((asset) => {
        hydratedEditAssetIdsRef.current.add(asset.id);
        if (cancelled) return;
        if (selectedAsset?.id === asset.id) {
          setSelectedAsset((current) =>
            current?.id === asset.id
              ? { ...current, driveFileId: asset.driveFileId }
              : current,
          );
          setPlacementAssets((current) =>
            current.map((currentAsset) =>
              currentAsset.id === asset.id
                ? { ...currentAsset, driveFileId: asset.driveFileId }
                : currentAsset,
            ),
          );
        } else {
          openAssetManager(asset, false);
        }
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setDirectAssetLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialAssetId, authUser?.authenticated, selectedAsset?.id]);

  useEffect(() => {
    if (
      workspaceMode !== "edit" ||
      selectedAsset?.type !== "IMAGE" ||
      !selectedAsset.placement_id
    ) {
      setEditNavigationAssets([]);
      return;
    }

    let cancelled = false;
    setEditNavigationAssets([]);
    fetchPlacementAssets(selectedAsset.placement_id)
      .then((assets) => {
        if (!cancelled) setEditNavigationAssets(assets);
      })
      .catch((navigationError) => {
        console.warn(
          `[asset-navigation] ${(navigationError as Error).message}`,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAsset?.placement_id, selectedAsset?.type, workspaceMode]);

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB"];
    let value = bytes / 1024;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
  }

  function placementViewerUrl(placement: UploadOptions["placements"][number]) {
    const slug =
      placement.placement_slug?.trim() ||
      slugifyPlacementName(placement.placement_name);
    return slug ? `/sites/${encodeURIComponent(slug)}` : "/";
  }

  function placementEditUrl(placement: UploadOptions["placements"][number]) {
    return `https://artsforall.co/wp-admin/post.php?post=${encodeURIComponent(String(placement.placement_id))}&action=edit`;
  }

  function slugifyPlacementName(value: string) {
    return value
      .trim()
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  useEffect(() => {
    if (initialError) setError(initialError);
  }, [initialError]);

  useEffect(() => {
    function onDocumentPointerDown(event: PointerEvent) {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener("pointerdown", onDocumentPointerDown);
    return () =>
      document.removeEventListener("pointerdown", onDocumentPointerDown);
  }, []);

  const menuItems = useMemo(
    () => [
      { href: "/", label: "Viewer" },
      { href: "/partners", label: "Partners" },
    ],
    [],
  );

  // Load Drive folders when switching to Import tab or changing drive type
  useEffect(() => {
    if (workspaceMode !== "import") return;
    if (driveDefaultOpening) return;
    if (driveType === "chooser") {
      setDriveFolders([
        {
          id: "__my_drive__",
          name: "My Drive",
          mimeType: "application/vnd.google-apps.folder",
        },
        {
          id: "__shared_drives__",
          name: "Shared Drives",
          mimeType: "application/vnd.google-apps.folder",
        },
      ]);
      setDriveFiles([]);
      setSelectedDriveFiles(new Set());
      setDriveLoading(false);
      return;
    }

    setDriveLoading(true);
    fetchDriveFolders(driveType, selectedDriveFolder, currentDriveId)
      .then((response) => {
        if (driveType === "myDrive") {
          setDriveFolders(response.subfolders ?? response.folders ?? []);
        } else {
          // Shared Drives
          setDriveFolders(response.folders ?? []);
        }
        setSelectedDriveFiles(new Set()); // Clear selection when navigating
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setDriveLoading(false));
  }, [
    workspaceMode,
    driveType,
    selectedDriveFolder,
    currentDriveId,
    driveDefaultOpening,
  ]);

  const activityDriveFolders = useMemo(() => {
    if (!options) return [];
    const matchingPlacements = options.placements.filter(
      (placement) =>
        placement.google_drive_folder_id?.trim() === selectedDriveFolder,
    );
    if (matchingPlacements.length !== 1) return [];
    return driveFolders.filter((folder) =>
      Boolean(folderActivityMatch(folder.name, options.activities)),
    );
  }, [driveFolders, options, selectedDriveFolder]);

  useEffect(() => {
    if (
      workspaceMode !== "import" ||
      driveDefaultOpening ||
      activityDriveFolders.length === 0 ||
      (driveType === "sharedDrives" && !currentDriveId)
    ) {
      setDriveFolderStats({});
      setDriveFolderStatsFailed(false);
      return;
    }

    let cancelled = false;
    setDriveFolderStats({});
    setDriveFolderStatsFailed(false);
    fetchDriveFolderStats(
      activityDriveFolders.map((folder) => folder.id),
      currentDriveId,
    )
      .then((stats) => {
        if (cancelled) return;
        setDriveFolderStats(
          Object.fromEntries(stats.map((item) => [item.folderId, item])),
        );
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn("[drive] Failed to load folder counts", err);
        setDriveFolderStatsFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activityDriveFolders,
    currentDriveId,
    driveDefaultOpening,
    driveType,
    workspaceMode,
  ]);

  // Load files for current Drive folder
  useEffect(() => {
    if (workspaceMode !== "import") return;
    if (driveDefaultOpening) return;
    if (driveType === "chooser") {
      setDriveFiles([]);
      setDriveLoading(false);
      return;
    }
    if (driveType === "sharedDrives" && !currentDriveId) {
      setDriveFiles([]);
      setDriveLoading(false);
      return;
    }

    setDriveLoading(true);
    fetchDriveFiles(selectedDriveFolder, undefined, currentDriveId)
      .then(({ files }) =>
        setDriveFiles(files.filter((file) => !file.isFolder)),
      )
      .catch((err) => setError((err as Error).message))
      .finally(() => setDriveLoading(false));
  }, [
    workspaceMode,
    driveType,
    selectedDriveFolder,
    currentDriveId,
    driveDefaultOpening,
  ]);

  const selectedUploader = useMemo(() => {
    if (!options) return null;
    return (
      options.uploaders.find(
        (uploader) => String(uploader.id) === uploaderKey,
      ) ?? null
    );
  }, [options, uploaderKey]);

  function placementIncludesUploader(
    placement: UploadOptions["placements"][number],
    uploaderId: number,
  ) {
    return (
      placement.team_member_id === uploaderId ||
      placement.secondary_team_member_id === uploaderId
    );
  }

  function matchedAuthUploaderId() {
    return authUser?.uploader_id ?? authUser?.uploader?.id ?? null;
  }

  function selectMySites() {
    const matchedUploaderId = matchedAuthUploaderId();
    if (!matchedUploaderId) {
      setError(
        "No matching Artasia Team Member email was found for your account.",
      );
      return;
    }

    setUploaderKey(String(matchedUploaderId));
    setBrowsePartnerKey("");
    setPlacementKey("");
    setSiteScope("select");
    setWorkspaceMode("sites");
    setSelectedAsset(null);
    setItems([]);
    setNotice(null);
    setError(null);
  }

  function placementMatchesBrowseContext(
    placement: UploadOptions["placements"][number],
  ) {
    if (
      workspaceMode === "upload" ||
      workspaceMode === "import" ||
      browseContextFilter === "all"
    )
      return true;
    return browseContextFilter === "earlyon"
      ? placement.is_earlyon
      : !placement.is_earlyon;
  }

  function placementMatchesDeliveryDay(
    placement: UploadOptions["placements"][number],
  ) {
    if (workspaceMode !== "sites" || !deliveryDayFilter) return true;
    return placement.delivery_weekday === deliveryDayFilter;
  }

  function placementMatchesTimeOfDay(
    placement: UploadOptions["placements"][number],
  ) {
    if (workspaceMode !== "sites" || !timeOfDayFilter) return true;
    return placement.delivery_start_time === timeOfDayFilter;
  }

  function placementMatchesAgeRange(
    placement: UploadOptions["placements"][number],
  ) {
    if (workspaceMode !== "sites" || !ageRangeFilter) return true;
    return placement.participant_age?.trim() === ageRangeFilter;
  }

  function formatTimeOfDay(value: string) {
    const [hoursRaw, minutesRaw = "00"] = value.split(":");
    const hours = Number.parseInt(hoursRaw, 10);
    const minutes = Number.parseInt(minutesRaw, 10);
    if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
    const suffix = hours >= 12 ? "PM" : "AM";
    const displayHours = hours % 12 || 12;
    return `${displayHours}:${String(minutes).padStart(2, "0")} ${suffix}`;
  }

  const filteredPlacements = useMemo(() => {
    if (!options) return [];
    const uploaderFilteredPlacements =
      selectedUploader &&
      workspaceMode !== "upload" &&
      workspaceMode !== "import"
        ? options.placements.filter((placement) =>
            placementIncludesUploader(placement, selectedUploader.id),
          )
        : options.placements;
    const contextFilteredPlacements = uploaderFilteredPlacements
      .filter(placementMatchesBrowseContext)
      .filter(placementMatchesDeliveryDay)
      .filter(placementMatchesTimeOfDay)
      .filter(placementMatchesAgeRange);
    const partnerFilteredPlacements =
      workspaceMode === "upload" ||
      workspaceMode === "import" ||
      !browsePartnerKey
        ? contextFilteredPlacements
        : contextFilteredPlacements.filter(
            (placement) =>
              placement.partner_name?.trim() === browsePartnerKey,
          );
    const normalizedSiteSearch = siteSearchFilter.trim().toLocaleLowerCase();
    const searchedPlacements =
      workspaceMode === "sites" && normalizedSiteSearch
        ? partnerFilteredPlacements.filter((placement) =>
            [
              placement.placement_name,
              placement.partner_name,
              placement.team_member_name,
              placement.secondary_team_member_name,
            ].some((value) =>
              value?.toLocaleLowerCase().includes(normalizedSiteSearch),
            ),
          )
        : partnerFilteredPlacements;
    if (workspaceMode !== "sites") {
      return searchedPlacements;
    }

    return [...searchedPlacements].sort((a, b) => {
      const alphabetical =
        placementLabel(a).localeCompare(placementLabel(b));
      if (siteSort === "alphabetical") return alphabetical;

      const countA =
        siteActivityStats[String(a.placement_id)]?.totalPublished ?? 0;
      const countB =
        siteActivityStats[String(b.placement_id)]?.totalPublished ?? 0;
      return countB - countA || alphabetical;
    });
  }, [
    ageRangeFilter,
    browseContextFilter,
    browsePartnerKey,
    deliveryDayFilter,
    options,
    selectedUploader,
    siteActivityStats,
    siteSearchFilter,
    siteSort,
    timeOfDayFilter,
    workspaceMode,
  ]);

  const browsePartnerOptions = useMemo(() => {
    if (!options) return [];
    const counts = new Map<string, number>();
    const uploaderFilteredPlacements = selectedUploader
      ? options.placements.filter((placement) =>
          placementIncludesUploader(placement, selectedUploader.id),
        )
      : options.placements;
    const contextFilteredPlacements = uploaderFilteredPlacements
      .filter(placementMatchesBrowseContext)
      .filter(placementMatchesDeliveryDay)
      .filter(placementMatchesTimeOfDay)
      .filter(placementMatchesAgeRange);

    for (const placement of contextFilteredPlacements) {
      const partnerName = placement.partner_name?.trim();
      if (!partnerName) continue;
      counts.set(partnerName, (counts.get(partnerName) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([partnerName, count]) => ({ partnerName, count }));
  }, [
    ageRangeFilter,
    browseContextFilter,
    deliveryDayFilter,
    options,
    selectedUploader,
    timeOfDayFilter,
    workspaceMode,
  ]);

  const timeOfDayOptions = useMemo(() => {
    if (!options) return [];
    const times = new Set<string>();
    const placements = options.placements
      .filter(placementMatchesBrowseContext)
      .filter(placementMatchesDeliveryDay);

    for (const placement of placements) {
      const startTime = placement.delivery_start_time?.trim();
      if (startTime) times.add(startTime);
    }

    return Array.from(times)
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: formatTimeOfDay(value) }));
  }, [browseContextFilter, deliveryDayFilter, options, workspaceMode]);

  const ageRangeOptions = useMemo(() => {
    if (!options) return [];
    const ageRanges = new Set<string>();
    const placements = options.placements
      .filter(placementMatchesBrowseContext)
      .filter(placementMatchesDeliveryDay)
      .filter(placementMatchesTimeOfDay);

    for (const placement of placements) {
      const ageRange = placement.participant_age?.trim();
      if (ageRange) ageRanges.add(ageRange);
    }

    return Array.from(ageRanges)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .map((value) => ({ value, label: formatParticipantAge(value) }));
  }, [
    browseContextFilter,
    deliveryDayFilter,
    options,
    timeOfDayFilter,
    workspaceMode,
  ]);

  const browseUploaderOptions = useMemo(() => {
    if (!options) return [];

    const placements = options.placements
      .filter(placementMatchesBrowseContext)
      .filter(placementMatchesDeliveryDay)
      .filter(placementMatchesTimeOfDay)
      .filter(placementMatchesAgeRange)
      .filter(
        (placement) =>
          !browsePartnerKey ||
          placement.partner_name?.trim() === browsePartnerKey,
      );
    const counts = new Map<number, number>();

    for (const placement of placements) {
      const uploaderIds = [
        placement.team_member_id,
        placement.secondary_team_member_id,
      ].filter((id): id is number => typeof id === "number");

      for (const uploaderId of new Set(uploaderIds)) {
        counts.set(uploaderId, (counts.get(uploaderId) ?? 0) + 1);
      }
    }

    return options.uploaders
      .filter((uploader) => counts.has(uploader.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((uploader) => ({ uploader, count: counts.get(uploader.id) ?? 0 }));
  }, [
    ageRangeFilter,
    browseContextFilter,
    browsePartnerKey,
    deliveryDayFilter,
    options,
    timeOfDayFilter,
    workspaceMode,
  ]);
  const showMySitesButton = browseUploaderOptions.some(
    ({ uploader }) => uploader.id === matchedAuthUploaderId(),
  );

  const selectedPlacement = useMemo(() => {
    if (!options || !placementKey) return null;
    return (
      options.placements.find(
        (placement) => String(placement.placement_id) === placementKey,
      ) ?? null
    );
  }, [options, placementKey]);

  const selectedActivity = useMemo(() => {
    if (!options || !activityTagFilter) return null;
    return (
      options.activities.find(
        (activity) => String(activity.id) === activityTagFilter,
      ) ?? null
    );
  }, [activityTagFilter, options]);

  const driveFolderPlacement = useMemo(() => {
    if (!options || selectedDriveFolder === "root") return null;
    const matches = options.placements.filter(
      (placement) =>
        placement.google_drive_folder_id?.trim() === selectedDriveFolder,
    );
    return matches.length === 1 ? matches[0] : null;
  }, [options, selectedDriveFolder]);

  useEffect(() => {
    if (
      workspaceMode !== "import" ||
      !routeSelectionResolved ||
      !driveFolderPlacement ||
      driveFolderPlacement.placement_id === selectedPlacement?.placement_id
    ) {
      return;
    }

    const placementId = String(driveFolderPlacement.placement_id);
    setPlacementKey(placementId);
    setSiteScope("placement");
    setAssetMode("placements");
    setActivityTagFilter("");
    setSelectedAsset(null);
    setItems([]);
    setNotice(null);
    setError(null);
    setApplicationPath(
      `/admin/import?site=${encodeURIComponent(placementId)}`,
    );
  }, [
    driveFolderPlacement,
    routeSelectionResolved,
    selectedPlacement?.placement_id,
    workspaceMode,
  ]);

  useLayoutEffect(() => {
    if (workspaceMode !== "import" || !routeSelectionResolved) return;
    void openDriveImportDefault(
      selectedPlacement?.google_drive_folder_id,
      selectedPlacement?.placement_id ?? null,
      selectedActivity,
    );
  }, [
    routeSelectionResolved,
    selectedActivity?.id,
    selectedActivity?.week,
    selectedPlacement?.google_drive_folder_id,
    selectedPlacement?.placement_id,
    workspaceMode,
  ]);

  useEffect(() => {
    if (workspaceMode !== "import" || !options || !selectedPlacement) return;
    if (
      driveFolderPlacement &&
      driveFolderPlacement.placement_id !== selectedPlacement.placement_id
    ) {
      return;
    }
    const placementFolderId = selectedPlacement.google_drive_folder_id?.trim();
    if (!placementFolderId) return;

    const placementFolderIndex = folderPath.findIndex(
      (folder) => folder.id === placementFolderId,
    );
    if (
      placementFolderIndex < 0 ||
      folderPath.length !== placementFolderIndex + 2
    ) {
      return;
    }

    const currentFolder = folderPath[folderPath.length - 1];
    const matchedActivity = folderActivityMatch(
      currentFolder.name,
      options.activities,
    );
    if (
      matchedActivity &&
      String(matchedActivity.id) !== activityTagFilter
    ) {
      setActivityTagFilter(String(matchedActivity.id));
      setSelectedAsset(null);
    }
  }, [
    activityTagFilter,
    driveFolderPlacement,
    folderPath,
    options,
    selectedPlacement,
    workspaceMode,
  ]);

  const existingPlacementDriveFileIds = useMemo(() => {
    if (!selectedPlacement) return new Set<string>();
    return new Set(
      placementAssets
        .filter((asset) => asset.placement_id === selectedPlacement.placement_id)
        .map((asset) => asset.driveFileId?.trim())
        .filter((driveFileId): driveFileId is string => Boolean(driveFileId)),
    );
  }, [placementAssets, selectedPlacement]);

  function driveFileIsImported(file: DriveFile) {
    return existingPlacementDriveFileIds.has(file.id);
  }

  const browsePlacementOptions = useMemo(() => {
    const placements =
      selectedPlacement &&
      !filteredPlacements.some(
        (placement) =>
          placement.placement_id === selectedPlacement.placement_id,
      )
        ? [selectedPlacement, ...filteredPlacements]
        : filteredPlacements;

    return [...placements].sort((a, b) =>
      placementLabel(a).localeCompare(placementLabel(b)),
    );
  }, [filteredPlacements, selectedPlacement]);

  const selectedActivityLabel = selectedActivity?.label ?? null;

  const browseAssetStatusCounts = useMemo(
    () => ({
      draft: placementAssets.filter(
        (asset) => !asset.published && !asset.archived,
      ).length,
      published: placementAssets.filter(
        (asset) => Boolean(asset.published) && !asset.archived,
      ).length,
      archived: placementAssets.filter((asset) => Boolean(asset.archived)).length,
    }),
    [placementAssets],
  );

  const displayedPlacementAssets = useMemo(
    () => placementAssets.filter((asset) => {
      if (browseAssetStatus === "archived") return Boolean(asset.archived);
      if (browseAssetStatus === "published") {
        return Boolean(asset.published) && !asset.archived;
      }
      return !asset.published && !asset.archived;
    }),
    [browseAssetStatus, placementAssets],
  );

  useEffect(() => {
    const selectableIds = new Set(
      displayedPlacementAssets
        .filter((asset) => !asset.archived)
        .map((asset) => asset.id),
    );
    setSelectedBrowseAssetIds((current) => {
      const next = new Set(
        Array.from(current).filter((assetId) => selectableIds.has(assetId)),
      );
      if (
        next.size === current.size &&
        Array.from(next).every((assetId) => current.has(assetId))
      ) {
        return current;
      }
      return next;
    });
  }, [displayedPlacementAssets]);

  const browseBreadcrumbParents = useMemo(() => {
    return [
      browsePartnerKey.trim() || null,
      selectedUploader?.name ?? null,
      selectedActivityLabel,
    ].filter((label): label is string => Boolean(label));
  }, [browsePartnerKey, selectedActivityLabel, selectedUploader]);

  const hasActiveSiteFilters = Boolean(
    uploaderKey ||
    browseContextFilter !== "all" ||
    deliveryDayFilter ||
    timeOfDayFilter ||
    ageRangeFilter ||
    browsePartnerKey ||
    siteSearchFilter,
  );

  const visiblePlacementIds = useMemo(() => {
    if (workspaceMode === "edit") return [];
    if (assetMode === "untagged") return [];
    if (
      siteScope === "all" ||
      (workspaceMode === "browse" && siteScope === "select")
    ) {
      return filteredPlacements.map((placement) => placement.placement_id);
    }
    if (siteScope === "placement" && selectedPlacement)
      return [selectedPlacement.placement_id];
    return [];
  }, [
    assetMode,
    filteredPlacements,
    selectedPlacement,
    siteScope,
    workspaceMode,
  ]);

  useEffect(() => {
    if (!mediaRefreshAssetId) return;
    if (mediaRefreshAttempt >= MEDIA_REFRESH_DELAYS_MS.length) return;

    const timeoutId = window.setTimeout(() => {
      setCropRefreshKey((current) => current + 1);
      setMediaRefreshAttempt((current) => current + 1);
      refreshVisibleAssets();
    }, MEDIA_REFRESH_DELAYS_MS[mediaRefreshAttempt]);

    return () => window.clearTimeout(timeoutId);
  }, [
    mediaRefreshAssetId,
    mediaRefreshAttempt,
    assetMode,
    visiblePlacementIds,
    activityTagFilter,
  ]);

  useEffect(() => {
    if (siteScope !== "placement") return;
    if (selectedPlacement) return;
    setPlacementKey("");
    setSiteScope("select");
  }, [selectedPlacement, siteScope]);

  useEffect(() => {
    if (workspaceMode === "upload" || workspaceMode === "import") return;
    if (!browsePartnerKey) return;
    if (
      browsePartnerOptions.some(
        (option) => option.partnerName === browsePartnerKey,
      )
    )
      return;
    setBrowsePartnerKey("");
  }, [browsePartnerKey, browsePartnerOptions, workspaceMode]);

  useEffect(() => {
    if (workspaceMode !== "sites") return;
    if (!timeOfDayFilter) return;
    if (timeOfDayOptions.some((option) => option.value === timeOfDayFilter))
      return;
    setTimeOfDayFilter("");
    setPlacementKey("");
    setSiteScope("select");
    setSelectedAsset(null);
    setItems([]);
  }, [timeOfDayFilter, timeOfDayOptions, workspaceMode]);

  useEffect(() => {
    if (workspaceMode !== "sites") return;
    if (!ageRangeFilter) return;
    if (ageRangeOptions.some((option) => option.value === ageRangeFilter))
      return;
    setAgeRangeFilter("");
    setPlacementKey("");
    setSiteScope("select");
    setSelectedAsset(null);
    setItems([]);
  }, [ageRangeFilter, ageRangeOptions, workspaceMode]);

  useEffect(() => {
    if (workspaceMode === "upload" || workspaceMode === "import") return;
    if (!uploaderKey) return;
    if (
      browseUploaderOptions.some(
        (option) => String(option.uploader.id) === uploaderKey,
      )
    )
      return;
    setUploaderKey("");
    setPlacementKey("");
    setSiteScope("select");
    setSelectedAsset(null);
    setItems([]);
  }, [browseUploaderOptions, uploaderKey, workspaceMode]);

  useEffect(() => {
    if (workspaceMode === "edit") return;
    if (
      (workspaceMode === "browse" ||
        workspaceMode === "upload" ||
        workspaceMode === "import") &&
      !routeSelectionResolved
    ) {
      return;
    }
    if (workspaceMode === "sites") {
      setPlacementAssets([]);
      setAssetsLoading(false);
      return;
    }
    if (assetMode === "untagged") {
      let cancelled = false;
      setAssetsLoading(true);
      fetchUntaggedPlacementAssets()
        .then((assets) => {
          if (!cancelled) {
            setPlacementAssets(assets);
            applyAutomaticBrowseAssetStatus(assets);
          }
        })
        .catch((err) => {
          if (!cancelled) setError((err as Error).message);
        })
        .finally(() => {
          if (!cancelled) setAssetsLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }

    if (visiblePlacementIds.length === 0) {
      setPlacementAssets([]);
      return;
    }

    let cancelled = false;
    setAssetsLoading(true);
    fetchPlacementAssetSet(
      visiblePlacementIds,
      activityTagFilter ? parseInt(activityTagFilter, 10) : undefined,
    )
      .then((assets) => {
        if (!cancelled) {
          setPlacementAssets(assets);
          applyAutomaticBrowseAssetStatus(assets);
        }
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setAssetsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    activityTagFilter,
    assetMode,
    routeSelectionResolved,
    visiblePlacementIds,
    workspaceMode,
  ]);

  function addFiles(fileList: FileList | File[]) {
    if (!selectedPlacement) {
      setError("Select a placement before adding files.");
      return;
    }

    const files = Array.from(fileList);
    setError(null);
    setNotice(null);
    setItems((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        source: "upload" as const,
        file,
        fileName: file.name,
        fileSize: file.size,
        status: "queued" as const,
        progress: 0,
      })),
    ]);
  }

  useEffect(() => {
    const hasQueued = items.some((item) => item.status === "queued");
    if (!hasQueued || uploadInProgressRef.current) return;
    void uploadQueued();
  }, [items, selectedPlacement]);

  async function uploadQueued() {
    if (uploadInProgressRef.current) return;
    if (!selectedPlacement) {
      setError("Select a placement.");
      return;
    }

    uploadInProgressRef.current = true;
    const queued = items.filter(
      (item) =>
        item.file && (item.status === "queued" || item.status === "failed"),
    );
    try {
      for (const item of queued) {
        const file = item.file;
        if (!file) continue;
        setItems((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  status: entry.status === "failed" ? "retrying" : "uploading",
                  progress: 0,
                  error: undefined,
                }
              : entry,
          ),
        );

        try {
          const results = await uploadFiles({
            files: [file],
            location: selectedPlacement,
            activityId: activityTagFilter
              ? parseInt(activityTagFilter, 10)
              : undefined,
            onProgress: (progress) => {
              setItems((current) =>
                current.map((entry) =>
                  entry.id === item.id
                    ? {
                        ...entry,
                        status: progress >= 100 ? "processing" : "uploading",
                        progress,
                      }
                    : entry,
                ),
              );
            },
          });

          const result = results[0];
          setItems((current) =>
            current.map((entry) =>
              entry.id === item.id
                ? result?.status === "completed"
                  ? {
                      ...entry,
                      status: "completed",
                      progress: 100,
                      assetId: result.assetId,
                    }
                  : {
                      ...entry,
                      status: "failed",
                      progress: 100,
                      error: result?.error ?? "Upload failed",
                    }
                : entry,
            ),
          );
        } catch (err) {
          setItems((current) =>
            current.map((entry) =>
              entry.id === item.id
                ? { ...entry, status: "failed", error: (err as Error).message }
                : entry,
            ),
          );
        }
      }
    } finally {
      uploadInProgressRef.current = false;
      if (selectedPlacement) {
        fetchPlacementAssets(selectedPlacement.placement_id)
          .then(setPlacementAssets)
          .catch((err) => setError((err as Error).message));
      }
    }
  }

  function updateItemCaption(itemId: string, value: string) {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              caption: value,
              captionStatus: "idle",
              captionError: undefined,
            }
          : item,
      ),
    );
  }

  async function saveItemCaption(item: UploadItem) {
    if (!item.assetId) return;
    const caption = item.caption?.trim() ?? "";
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? { ...entry, captionStatus: "saving", captionError: undefined }
          : entry,
      ),
    );

    try {
      await updateAssetCaption({ assetId: item.assetId, caption });
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                caption,
                captionStatus: "saved",
                captionError: undefined,
              }
            : entry,
        ),
      );
      refreshVisibleAssets();
    } catch (err) {
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? {
                ...entry,
                captionStatus: "failed",
                captionError: (err as Error).message,
              }
            : entry,
        ),
      );
    }
  }

  async function editUploadedItem(item: UploadItem) {
    if (!item.assetId || item.openingEditor) return;
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id ? { ...entry, openingEditor: true } : entry,
      ),
    );
    setError(null);

    try {
      const asset = await fetchUploadAsset(item.assetId);
      openAssetManager(asset);
    } catch (err) {
      setError((err as Error).message);
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id ? { ...entry, openingEditor: false } : entry,
        ),
      );
    }
  }

  function markAssetsPublished(assetIds: string[]) {
    const publishedIds = new Set(assetIds);
    setItems((current) =>
      current.map((item) =>
        item.assetId && publishedIds.has(item.assetId)
          ? {
              ...item,
              published: true,
              publishStatus: "published",
              publishError: undefined,
            }
          : item,
      ),
    );
    setPlacementAssets((current) =>
      current.map((asset) =>
        publishedIds.has(asset.id) ? { ...asset, published: true } : asset,
      ),
    );
    setSelectedAsset((current) =>
      current && publishedIds.has(current.id)
        ? { ...current, published: true }
        : current,
    );
    if (selectedAsset && publishedIds.has(selectedAsset.id)) {
      setManagePublished(true);
    }
  }

  async function publishUploadedItem(item: UploadItem) {
    if (!item.assetId || item.published || publishingItemIds.has(item.assetId)) return;
    const assetId = item.assetId;
    setPublishingItemIds((current) => new Set(current).add(assetId));
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? { ...entry, publishStatus: "publishing", publishError: undefined }
          : entry,
      ),
    );
    setError(null);
    try {
      await setAssetsPublished([assetId]);
      markAssetsPublished([assetId]);
      setNotice({ tone: "success", message: `Published ${item.fileName}.` });
    } catch (err) {
      const message = (err as Error).message;
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, publishStatus: "failed", publishError: message }
            : entry,
        ),
      );
      setError(message);
    } finally {
      setPublishingItemIds((current) => {
        const next = new Set(current);
        next.delete(assetId);
        return next;
      });
    }
  }

  async function publishAllCurrentItems() {
    const assetIds = Array.from(
      new Set(
        items
          .filter((item) => item.status === "completed" && item.assetId && !item.published)
          .map((item) => item.assetId as string),
      ),
    );
    if (assetIds.length === 0 || publishingAllItems) return;

    const ids = new Set(assetIds);
    setPublishingAllItems(true);
    setPublishingItemIds((current) => new Set([...current, ...assetIds]));
    setItems((current) =>
      current.map((item) =>
        item.assetId && ids.has(item.assetId)
          ? { ...item, publishStatus: "publishing", publishError: undefined }
          : item,
      ),
    );
    setError(null);
    try {
      const publishedIds = await setAssetsPublished(assetIds);
      markAssetsPublished(publishedIds);
      setNotice({
        tone: "success",
        message: `Published ${publishedIds.length} asset${publishedIds.length === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      const message = (err as Error).message;
      setItems((current) =>
        current.map((item) =>
          item.assetId && ids.has(item.assetId)
            ? { ...item, publishStatus: "failed", publishError: message }
            : item,
        ),
      );
      setError(message);
    } finally {
      setPublishingAllItems(false);
      setPublishingItemIds((current) => {
        const next = new Set(current);
        assetIds.forEach((assetId) => next.delete(assetId));
        return next;
      });
    }
  }

  function toggleBrowseAssetSelection(assetId: string) {
    setSelectedBrowseAssetIds((current) => {
      const next = new Set(current);
      if (next.has(assetId)) next.delete(assetId);
      else next.add(assetId);
      return next;
    });
  }

  async function publishBrowseAssets(assetIds: string[]) {
    const uniqueAssetIds = Array.from(new Set(assetIds));
    if (
      uniqueAssetIds.length === 0 ||
      publishingBrowseAssets ||
      archivingBrowseAssets ||
      deletingBrowseAssets
    ) return;
    setPublishingBrowseAssets(true);
    setError(null);
    try {
      const publishedIds = await setAssetsPublished(uniqueAssetIds);
      markAssetsPublished(publishedIds);
      setSelectedBrowseAssetIds((current) => {
        const next = new Set(current);
        publishedIds.forEach((assetId) => next.delete(assetId));
        return next;
      });
      setNotice({
        tone: "success",
        message: `Published ${publishedIds.length} asset${publishedIds.length === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPublishingBrowseAssets(false);
    }
  }

  function markAssetsArchived(assetIds: string[]) {
    const archivedIds = new Set(assetIds);
    setPlacementAssets((current) =>
      current.map((asset) =>
        archivedIds.has(asset.id)
          ? { ...asset, archived: true, published: false }
          : asset,
      ),
    );
    setSelectedAsset((current) =>
      current && archivedIds.has(current.id)
        ? { ...current, archived: true, published: false }
        : current,
    );
    if (selectedAsset && archivedIds.has(selectedAsset.id)) {
      setManageArchived(true);
      setManagePublished(false);
    }
  }

  async function archiveBrowseAssets(assetIds: string[]) {
    const uniqueAssetIds = Array.from(new Set(assetIds));
    if (
      uniqueAssetIds.length === 0 ||
      archivingBrowseAssets ||
      publishingBrowseAssets ||
      deletingBrowseAssets
    ) return;
    setArchivingBrowseAssets(true);
    setError(null);
    try {
      const archivedIds = await setAssetsArchived(uniqueAssetIds);
      markAssetsArchived(archivedIds);
      setSelectedBrowseAssetIds((current) => {
        const next = new Set(current);
        archivedIds.forEach((assetId) => next.delete(assetId));
        return next;
      });
      setNotice({
        tone: "success",
        message: `Archived ${archivedIds.length} asset${archivedIds.length === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setArchivingBrowseAssets(false);
    }
  }

  async function deleteBrowseAssets(assetIds: string[]) {
    const uniqueAssetIds = Array.from(new Set(assetIds));
    if (
      uniqueAssetIds.length === 0 ||
      deletingBrowseAssets ||
      publishingBrowseAssets ||
      archivingBrowseAssets
    ) return;
    const assetLabel = `${uniqueAssetIds.length} selected asset${uniqueAssetIds.length === 1 ? "" : "s"}`;
    if (
      !window.confirm(
        `Permanently delete ${assetLabel}? This cannot be undone.`,
      )
    ) return;

    setDeletingBrowseAssets(true);
    setError(null);
    try {
      const deletedIds = await deleteUploadAssets(uniqueAssetIds);
      const deletedIdSet = new Set(deletedIds);
      setPlacementAssets((current) =>
        current.filter((asset) => !deletedIdSet.has(asset.id)),
      );
      setSelectedBrowseAssetIds((current) => {
        const next = new Set(current);
        deletedIds.forEach((assetId) => next.delete(assetId));
        return next;
      });
      setSelectedAsset((current) =>
        current && deletedIdSet.has(current.id) ? null : current,
      );
      setNotice({
        tone: "success",
        message: `Deleted ${deletedIds.length} asset${deletedIds.length === 1 ? "" : "s"}.`,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingBrowseAssets(false);
    }
  }

  function selectPlacement(placement: UploadOptions["placements"][number]) {
    setPlacementKey(String(placement.placement_id));
    setSiteScope("placement");
    setAssetMode("placements");
    setSelectedAsset(null);
    setItems([]);
    setNotice(null);
    setError(null);
  }

  function browsePlacement(placement: UploadOptions["placements"][number]) {
    selectPlacement(placement);
    setWorkspaceMode("browse");
    setApplicationPath(
      `/admin/browse?site=${encodeURIComponent(String(placement.placement_id))}`,
      true,
    );
  }

  function uploadToPlacement(placement: UploadOptions["placements"][number]) {
    setBrowsePartnerKey("");
    selectPlacement(placement);
    setWorkspaceMode("upload");
  }

  function clearSiteFilters() {
    setUploaderKey("");
    setBrowseContextFilter("all");
    setDeliveryDayFilter("");
    setTimeOfDayFilter("");
    setAgeRangeFilter("");
    setBrowsePartnerKey("");
    setSiteSearchFilter("");
    setPlacementKey("");
    setSiteScope("select");
    setSelectedAsset(null);
    setItems([]);
    setNotice(null);
    setError(null);
  }

  function clearSingleSiteFilter(clearFilter: () => void) {
    clearFilter();
    setPlacementKey("");
    setSiteScope("select");
    setSelectedAsset(null);
    setItems([]);
    setNotice(null);
    setError(null);
  }

  function importToPlacement(placement: UploadOptions["placements"][number]) {
    setBrowsePartnerKey("");
    selectPlacement(placement);
    setWorkspaceMode("import");
    setApplicationPath(
      `/admin/import?site=${encodeURIComponent(String(placement.placement_id))}`,
      true,
    );
  }

  function returnToSiteSelection() {
    setPlacementKey("");
    setSiteScope("select");
    setWorkspaceMode("sites");
    setSelectedAsset(null);
    setItems([]);
    setNotice(null);
  }

  function refreshVisibleAssets() {
    setAssetsLoading(true);
    const activityId = activityTagFilter
      ? parseInt(activityTagFilter, 10)
      : undefined;

    if (assetMode !== "untagged" && visiblePlacementIds.length === 0) {
      setPlacementAssets([]);
      setAssetsLoading(false);
      return;
    }

    const request =
      assetMode === "untagged"
        ? fetchUntaggedPlacementAssets()
        : fetchPlacementAssetSet(visiblePlacementIds, activityId);

    request
      .then((assets) => {
        setPlacementAssets(assets);
        applyAutomaticBrowseAssetStatus(assets);
      })
      .catch((err) => setError((err as Error).message))
      .finally(() => setAssetsLoading(false));
  }

  function mediaUrl(url: string, assetId: string) {
    return mediaRefreshAssetId === assetId
      ? `${url}&mediaRefresh=${cropRefreshKey}&mediaAttempt=${mediaRefreshAttempt}`
      : url;
  }

  function normalizeAdjustments(
    adjustments?: AssetAdjustments | null,
  ): AssetAdjustments {
    return {
      brightness: clampAdjustment(
        adjustments?.brightness ?? DEFAULT_ADJUSTMENTS.brightness,
      ),
      contrast: clampAdjustment(
        adjustments?.contrast ?? DEFAULT_ADJUSTMENTS.contrast,
      ),
      saturation: clampAdjustment(
        adjustments?.saturation ?? DEFAULT_ADJUSTMENTS.saturation,
      ),
    };
  }

  function clampAdjustment(value: number) {
    if (!Number.isFinite(value)) return DEFAULT_ADJUSTMENTS.brightness;
    return Math.max(
      MIN_ADJUSTMENT,
      Math.min(MAX_ADJUSTMENT, Math.round(value)),
    );
  }

  function adjustmentFilterStyle(
    adjustments?: AssetAdjustments | null,
  ): React.CSSProperties {
    const normalized = normalizeAdjustments(adjustments);
    return {
      filter: `brightness(${normalized.brightness / 100}) contrast(${normalized.contrast / 100}) saturate(${normalized.saturation / 100})`,
    };
  }

  function updateAssetAdjustments(
    assetId: string,
    adjustments: AssetAdjustments,
  ) {
    setPlacementAssets((current) =>
      current.map((asset) =>
        asset.id === assetId ? { ...asset, adjustments } : asset,
      ),
    );
    setSelectedAsset((current) =>
      current?.id === assetId ? { ...current, adjustments } : current,
    );
  }

  function updateAssetDescription(assetId: string, description: string) {
    setPlacementAssets((current) =>
      current.map((asset) =>
        asset.id === assetId ? { ...asset, description } : asset,
      ),
    );
    setSelectedAsset((current) =>
      current?.id === assetId ? { ...current, description } : current,
    );
  }

  function queueMediaRefresh(assetId: string) {
    setMediaRefreshAssetId(assetId);
    setMediaRefreshAttempt(0);
    setCropRefreshKey((current) => current + 1);
  }

  function setApplicationPath(
    path: string,
    replace = false,
    retainSelectedSite = true,
  ) {
    const nextUrl = new URL(path, window.location.origin);
    const pathCanRetainSelectedSite = [
      "/admin/browse",
      "/admin/upload",
      "/admin/import",
    ].includes(nextUrl.pathname);
    if (
      retainSelectedSite &&
      pathCanRetainSelectedSite &&
      placementKey &&
      !nextUrl.searchParams.has("site")
    ) {
      nextUrl.searchParams.set("site", placementKey);
    }
    if (
      nextUrl.pathname === "/admin/browse" &&
      browseAssetStatus !== "draft" &&
      !nextUrl.searchParams.has("status")
    ) {
      nextUrl.searchParams.set("status", browseAssetStatus);
    }
    const nextPath = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (currentPath === nextPath) return;
    if (replace) window.history.replaceState(null, "", nextPath);
    else window.history.pushState(null, "", nextPath);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function selectBrowseAssetStatus(status: BrowseAssetStatus) {
    browseAssetStatusWasManuallySelectedRef.current = true;
    browseAssetStatusIsAutomaticRef.current = false;
    setBrowseAssetStatus(status);
    setSelectedBrowseAssetIds(new Set());

    const nextUrl = new URL(window.location.href);
    if (status === "draft") nextUrl.searchParams.delete("status");
    else nextUrl.searchParams.set("status", status);
    window.history.replaceState(
      null,
      "",
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
    );
  }

  function applyAutomaticBrowseAssetStatus(assets: PlacementAsset[]) {
    if (
      workspaceMode !== "browse" ||
      !browseAssetStatusIsAutomaticRef.current
    ) return;

    const hasDrafts = assets.some(
      (asset) => !asset.published && !asset.archived,
    );
    const hasPublished = assets.some(
      (asset) => Boolean(asset.published) && !asset.archived,
    );
    if (hasDrafts || !hasPublished) return;

    browseAssetStatusIsAutomaticRef.current = false;
    setBrowseAssetStatus("published");
    setSelectedBrowseAssetIds(new Set());

    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("status", "published");
    window.history.replaceState(
      null,
      "",
      `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`,
    );
  }

  function openAssetManager(asset: PlacementAsset, updateUrl = true) {
    const adjustments = normalizeAdjustments(asset.adjustments);
    setSelectedAsset(asset);
    setManagePlacementKey(asset.placement_id ? String(asset.placement_id) : "");
    setManageDisplayPlacementKey(
      asset.display_placement_id ? String(asset.display_placement_id) : "",
    );
    setManageUploaderKey(asset.uploader_id ? String(asset.uploader_id) : "");
    setManageActivityTag(
      asset.custom_activity?.trim()
        ? CUSTOM_ACTIVITY_OPTION
        : asset.activity_id
          ? String(asset.activity_id)
          : "",
    );
    setManageCustomActivity(asset.custom_activity?.trim() ?? "");
    setManageIconName(asset.iconName ?? null);
    setManageLinkedAudioAssetId(asset.linkedAudioAssetId ?? "");
    setManagePublished(Boolean(asset.published) && !asset.archived);
    setManageArchived(Boolean(asset.archived));
    setManageCaption(asset.description ?? "");
    setManageLatitude(coordinateInputValue(asset.latitude));
    setManageLongitude(coordinateInputValue(asset.longitude));
    setManageUseGpsLocation(asset.useGpsLocation !== false);
    setCaptionSaveStatus("idle");
    setCaptionSaveError(null);
    setManageBrightness(adjustments.brightness);
    setManageContrast(adjustments.contrast);
    setManageSaturation(adjustments.saturation);
    setCropEditing(asset.type === "IMAGE");
    setCropRect(null);
    setCropSourceDimensions(null);
    setStraightenDegrees(0);
    setRotationDegrees(0);
    const duration = asset.mediaKind === "audio" ? asset.durationSeconds : 0;
    setAudioDuration(duration);
    setAudioTrimStart(0);
    setAudioTrimEnd(duration);
    setAudioTrimStatus(null);
    setVideoRotationStatus(null);
    setVideoPreviewPlaying(false);
    setDriveAssetAction(null);
    setCropRefreshKey((current) => current + 1);
    setMediaRefreshAssetId(null);
    setMediaRefreshAttempt(0);
    setError(null);
    setWorkspaceMode("edit");
    if (asset.placement_id) {
      setPlacementKey(String(asset.placement_id));
      setSiteScope("placement");
    }
    if (updateUrl) setApplicationPath(`/admin/edit/${asset.id}`);
  }

  function closeAssetManager() {
    setSelectedAsset(null);
    setManagePlacementKey("");
    setManageDisplayPlacementKey("");
    setManageUploaderKey("");
    setManageActivityTag("");
    setManageCustomActivity("");
    setManageIconName(null);
    setManageLinkedAudioAssetId("");
    setLinkedAudioOptions([]);
    setLinkedAudioLoading(false);
    setLinkedAudioPreviewPlaying(false);
    setManagePublished(false);
    setManageArchived(false);
    setManageCaption("");
    setManageLatitude("");
    setManageLongitude("");
    setManageUseGpsLocation(true);
    setCaptionSaving(false);
    setCaptionSaveStatus("idle");
    setCaptionSaveError(null);
    setManageBrightness(DEFAULT_ADJUSTMENTS.brightness);
    setManageContrast(DEFAULT_ADJUSTMENTS.contrast);
    setManageSaturation(DEFAULT_ADJUSTMENTS.saturation);
    setCropEditing(false);
    setCropRect(null);
    setStraightenDegrees(0);
    setRotationDegrees(0);
    setAudioDuration(0);
    setAudioTrimStart(0);
    setAudioTrimEnd(0);
    setAudioTrimStatus(null);
    videoPreviewRef.current?.pause();
    setVideoRotationStatus(null);
    setVideoPreviewPlaying(false);
    setDriveAssetAction(null);
    setMediaRefreshAssetId(null);
    setMediaRefreshAttempt(0);
  }

  function cancelAssetManager() {
    closeAssetManager();
    setWorkspaceMode("browse");
    setApplicationPath("/admin/browse", true);
  }

  useEffect(() => {
    if (
      !selectedAsset ||
      selectedAsset.type !== "IMAGE" ||
      !authUser?.authenticated
    )
      return;
    let cancelled = false;
    setAdjustmentsLoading(true);
    fetchUploadAssetAdjustments(selectedAsset.id)
      .then((adjustments) => {
        if (cancelled) return;
        const normalized = normalizeAdjustments(adjustments);
        setManageBrightness(normalized.brightness);
        setManageContrast(normalized.contrast);
        setManageSaturation(normalized.saturation);
        updateAssetAdjustments(selectedAsset.id, normalized);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setAdjustmentsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedAsset?.id, selectedAsset?.type, authUser?.authenticated]);

  useEffect(() => {
    if (
      !selectedAsset ||
      selectedAsset.type !== "IMAGE" ||
      !authUser?.authenticated
    ) {
      setLinkedAudioOptions([]);
      setLinkedAudioLoading(false);
      return;
    }

    const placementId = parseInt(managePlacementKey, 10);
    let cancelled = false;
    setLinkedAudioLoading(true);

    fetchLinkedAudioOptions(
      Number.isFinite(placementId) ? placementId : undefined,
    )
      .then(async (audioOptions) => {
        if (
          manageLinkedAudioAssetId &&
          !audioOptions.some((asset) => asset.id === manageLinkedAudioAssetId)
        ) {
          const linkedAsset = await fetchUploadAsset(
            manageLinkedAudioAssetId,
          ).catch(() => null);
          if (
            linkedAsset?.mediaKind === "audio" &&
            !linkedAsset.archived &&
            !linkedAsset.trashed
          ) {
            audioOptions.push({
              id: linkedAsset.id,
              fileName: linkedAsset.fileName,
            });
          }
        }
        if (cancelled) return;
        const byId = new Map(audioOptions.map((asset) => [asset.id, asset]));
        setLinkedAudioOptions(
          Array.from(byId.values()).sort((a, b) =>
            a.fileName.localeCompare(b.fileName),
          ),
        );
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLinkedAudioLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    authUser?.authenticated,
    managePlacementKey,
    selectedAsset?.id,
    selectedAsset?.type,
  ]);

  useEffect(() => {
    const audio = linkedAudioPreviewRef.current;
    return () => {
      audio?.pause();
      setLinkedAudioPreviewPlaying(false);
    };
  }, [manageLinkedAudioAssetId, selectedAsset?.id]);

  function toggleLinkedAudioPreview() {
    const audio = linkedAudioPreviewRef.current;
    if (!audio) return;
    if (audio.paused) {
      void audio.play()
        .then(() => setLinkedAudioPreviewPlaying(true))
        .catch((playError) => {
          setError(`Could not play linked sound: ${(playError as Error).message}`);
          setLinkedAudioPreviewPlaying(false);
        });
    } else {
      audio.pause();
      setLinkedAudioPreviewPlaying(false);
    }
  }

  async function saveSelectedAssetChanges() {
    if (!selectedAsset) return;
    const placementId = managePlacementKey
      ? parseInt(managePlacementKey, 10)
      : null;
    const uploaderId = manageUploaderKey
      ? parseInt(manageUploaderKey, 10)
      : null;
    const placementChanged =
      Boolean(managePlacementKey) &&
      managePlacementKey !==
        (selectedAsset.placement_id ? String(selectedAsset.placement_id) : "");
    const displayPlacementChanged =
      manageDisplayPlacementKey !==
      (selectedAsset.display_placement_id
        ? String(selectedAsset.display_placement_id)
        : "");
    const uploaderChanged =
      Boolean(manageUploaderKey) &&
      manageUploaderKey !==
        (selectedAsset.uploader_id ? String(selectedAsset.uploader_id) : "");
    const selectedActivityMode = selectedAsset.custom_activity?.trim()
      ? CUSTOM_ACTIVITY_OPTION
      : selectedAsset.activity_id
        ? String(selectedAsset.activity_id)
        : "";
    const customActivityValue = manageActivityTag === CUSTOM_ACTIVITY_OPTION
      ? manageCustomActivity.trim()
      : "";
    const activityTagChanged =
      manageActivityTag !== selectedActivityMode ||
      (manageActivityTag === CUSTOM_ACTIVITY_OPTION &&
        customActivityValue !== (selectedAsset.custom_activity?.trim() ?? ""));
    const iconChanged = manageIconName !== (selectedAsset.iconName ?? null);
    const linkedAudioChanged =
      selectedAsset.type === "IMAGE" &&
      manageLinkedAudioAssetId !== (selectedAsset.linkedAudioAssetId ?? "");
    const publishedChanged =
      managePublished !== Boolean(selectedAsset.published);
    const archivedChanged =
      manageArchived !== Boolean(selectedAsset.archived);

    if (
      !placementChanged &&
      !displayPlacementChanged &&
      !uploaderChanged &&
      !activityTagChanged &&
      !iconChanged &&
      !linkedAudioChanged &&
      !publishedChanged &&
      !archivedChanged
    ) {
      setError(
        "Choose a placement, sharing destination, team member album, program week, or publication status to save.",
      );
      return;
    }
    if (placementChanged && (!placementId || !Number.isFinite(placementId))) {
      setError("Select a placement to assign this upload.");
      return;
    }
    if (
      manageDisplayPlacementKey &&
      manageDisplayPlacementKey === managePlacementKey
    ) {
      setError("Choose a shared placement other than the primary placement.");
      return;
    }
    if (uploaderChanged && (!uploaderId || !Number.isFinite(uploaderId))) {
      setError("Select a team member album for this upload.");
      return;
    }
    if (manageActivityTag === CUSTOM_ACTIVITY_OPTION && !customActivityValue) {
      setError("Enter a custom activity name.");
      return;
    }

    setSavingAsset(true);
    try {
      if (placementChanged && placementId) {
        await assignAssetPlacement({
          assetId: selectedAsset.id,
          placementId,
        });
      }
      if (displayPlacementChanged) {
        await assignAssetDisplayPlacement({
          assetId: selectedAsset.id,
          placementId: manageDisplayPlacementKey
            ? parseInt(manageDisplayPlacementKey, 10)
            : null,
        });
      }
      if (uploaderChanged && uploaderId) {
        await assignAssetUploader({
          assetId: selectedAsset.id,
          uploaderId,
        });
      }
      if (activityTagChanged) {
        await assignAssetActivityTag({
          assetId: selectedAsset.id,
          activityId: manageActivityTag && manageActivityTag !== CUSTOM_ACTIVITY_OPTION
            ? parseInt(manageActivityTag, 10)
            : null,
          customActivity: customActivityValue || null,
        });
      }
      if (iconChanged) {
        await setAssetIcon({
          assetId: selectedAsset.id,
          iconName: manageIconName,
        });
      }
      if (linkedAudioChanged) {
        await setAssetLinkedAudio({
          assetId: selectedAsset.id,
          linkedAudioAssetId: manageLinkedAudioAssetId || null,
        });
      }
      if (publishedChanged) {
        await setAssetPublished({
          assetId: selectedAsset.id,
          published: managePublished,
        });
      }
      if (archivedChanged) {
        await setAssetArchived({
          assetId: selectedAsset.id,
          archived: manageArchived,
        });
      }
      closeAssetManager();
      refreshVisibleAssets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingAsset(false);
    }
  }

  async function saveAllAssetChanges() {
    if (!selectedAsset || !authUser?.authenticated) return;
    const destinationPlacementKey =
      managePlacementKey ||
      (selectedAsset.placement_id ? String(selectedAsset.placement_id) : "");
    const placementChanged =
      Boolean(managePlacementKey) &&
      managePlacementKey !==
        (selectedAsset.placement_id ? String(selectedAsset.placement_id) : "");
    const displayPlacementChanged =
      manageDisplayPlacementKey !==
      (selectedAsset.display_placement_id
        ? String(selectedAsset.display_placement_id)
        : "");
    const uploaderChanged =
      Boolean(manageUploaderKey) &&
      manageUploaderKey !==
        (selectedAsset.uploader_id ? String(selectedAsset.uploader_id) : "");
    const selectedActivityMode = selectedAsset.custom_activity?.trim()
      ? CUSTOM_ACTIVITY_OPTION
      : selectedAsset.activity_id
        ? String(selectedAsset.activity_id)
        : "";
    const customActivityValue = manageActivityTag === CUSTOM_ACTIVITY_OPTION
      ? manageCustomActivity.trim()
      : "";
    const activityChanged =
      manageActivityTag !== selectedActivityMode ||
      (manageActivityTag === CUSTOM_ACTIVITY_OPTION &&
        customActivityValue !== (selectedAsset.custom_activity?.trim() ?? ""));
    const iconChanged = manageIconName !== (selectedAsset.iconName ?? null);
    const linkedAudioChanged =
      selectedAsset.type === "IMAGE" &&
      manageLinkedAudioAssetId !== (selectedAsset.linkedAudioAssetId ?? "");
    const publishedChanged =
      managePublished !== Boolean(selectedAsset.published);
    const archivedChanged =
      manageArchived !== Boolean(selectedAsset.archived);
    const captionChanged =
      manageCaption.trim() !== (selectedAsset.description ?? "").trim();
    const locationChanged =
      manageLatitude.trim() !== coordinateInputValue(selectedAsset.latitude) ||
      manageLongitude.trim() !== coordinateInputValue(selectedAsset.longitude);
    const gpsUsageChanged =
      manageUseGpsLocation !== (selectedAsset.useGpsLocation !== false);
    const selectedAdjustments = normalizeAdjustments(selectedAsset.adjustments);
    const adjustmentChanged =
      manageBrightness !== selectedAdjustments.brightness ||
      manageContrast !== selectedAdjustments.contrast ||
      manageSaturation !== selectedAdjustments.saturation;
    const pixelEditsChanged = hasPendingPixelEdits(selectedAsset);
    const videoRotationChanged =
      selectedAsset.mediaKind === "video" && rotationDegrees !== 0;
    const audioTrimChanged =
      selectedAsset.mediaKind === "audio" &&
      audioDuration > 0 &&
      (audioTrimStart > 0.005 ||
        Math.abs(audioTrimEnd - audioDuration) > 0.005);

    if (
      !placementChanged &&
      !displayPlacementChanged &&
      !uploaderChanged &&
      !activityChanged &&
      !iconChanged &&
      !linkedAudioChanged &&
      !publishedChanged &&
      !archivedChanged &&
      !captionChanged &&
      !locationChanged &&
      !gpsUsageChanged &&
      !adjustmentChanged &&
      !pixelEditsChanged &&
      !videoRotationChanged &&
      !audioTrimChanged
    ) {
      setError("There are no changes to save.");
      return;
    }
    if (pixelEditsChanged && !cropRect) {
      setError("Choose a crop area before saving.");
      return;
    }
    if (
      manageDisplayPlacementKey &&
      manageDisplayPlacementKey === destinationPlacementKey
    ) {
      setError("Choose a shared placement other than the primary placement.");
      return;
    }
    if (videoRotationChanged && manageArchived) {
      setError("Restore this video before rotating it.");
      return;
    }
    if (manageActivityTag === CUSTOM_ACTIVITY_OPTION && !customActivityValue) {
      setError("Enter a custom activity name.");
      return;
    }
    const latitude = Number(manageLatitude);
    const longitude = Number(manageLongitude);
    if (
      locationChanged &&
      (manageLatitude.trim() === "" ||
        !Number.isFinite(latitude) ||
        latitude < -90 ||
        latitude > 90)
    ) {
      setError("Latitude must be between -90 and 90.");
      return;
    }
    if (
      locationChanged &&
      (manageLongitude.trim() === "" ||
        !Number.isFinite(longitude) ||
        longitude < -180 ||
        longitude > 180)
    ) {
      setError("Longitude must be between -180 and 180.");
      return;
    }
    if (
      audioTrimChanged &&
      (audioTrimStart < 0 ||
        audioTrimEnd > audioDuration + 0.05 ||
        audioTrimEnd - audioTrimStart < 0.5)
    ) {
      setError("Choose an audio selection of at least 0.50 seconds.");
      return;
    }

    setSavingAsset(true);
    setError(null);
    try {
      const assetId = selectedAsset.id;
      if (placementChanged)
        await assignAssetPlacement({
          assetId,
          placementId: parseInt(managePlacementKey, 10),
        });
      if (displayPlacementChanged)
        await assignAssetDisplayPlacement({
          assetId,
          placementId: manageDisplayPlacementKey
            ? parseInt(manageDisplayPlacementKey, 10)
            : null,
        });
      if (uploaderChanged)
        await assignAssetUploader({
          assetId,
          uploaderId: parseInt(manageUploaderKey, 10),
        });
      if (activityChanged) {
        await assignAssetActivityTag({
          assetId,
          activityId: manageActivityTag && manageActivityTag !== CUSTOM_ACTIVITY_OPTION
            ? parseInt(manageActivityTag, 10)
            : null,
          customActivity: customActivityValue || null,
        });
      }
      if (iconChanged)
        await setAssetIcon({ assetId, iconName: manageIconName });
      if (linkedAudioChanged)
        await setAssetLinkedAudio({
          assetId,
          linkedAudioAssetId: manageLinkedAudioAssetId || null,
        });
      if (publishedChanged)
        await setAssetPublished({ assetId, published: managePublished });
      if (archivedChanged)
        await setAssetArchived({ assetId, archived: manageArchived });
      if (captionChanged)
        await updateAssetCaption({ assetId, caption: manageCaption.trim() });
      if (locationChanged)
        await updateAssetLocation({ assetId, latitude, longitude });
      if (gpsUsageChanged)
        await updateAssetGpsUsage({
          assetId,
          useGpsLocation: manageUseGpsLocation,
        });
      if (adjustmentChanged) {
        await updateUploadAssetAdjustments({
          assetId,
          adjustments: {
            brightness: manageBrightness,
            contrast: manageContrast,
            saturation: manageSaturation,
          },
        });
      }

      let message = "Upload changes saved.";
      if (pixelEditsChanged && cropRect) {
        const crop = normalizeCropRect(selectedAsset, cropRect);
        const dimensions = imageDimensionsForCrop(selectedAsset);
        const result = await flattenUploadAsset({
          assetId,
          rotationDegrees,
          straightenDegrees,
          cropNormalized: {
            x: crop.x / dimensions.width,
            y: crop.y / dimensions.height,
            width: crop.width / dimensions.width,
            height: crop.height / dimensions.height,
          },
        });
        message = `Upload changes saved. Created ${result.width}×${result.height} edited copy and archived the original.`;
      }
      if (videoRotationChanged) {
        setVideoRotationStatus("Preparing video rotation...");
        let rotationJob: VideoRotationJob = await createVideoRotation({
          assetId,
          rotationDegrees: rotationDegrees as 90 | 180 | 270,
        });
        for (;;) {
          setVideoRotationStatus(
            `${rotationJob.message}${rotationJob.state === "rendering" ? ` (${Math.round(rotationJob.progress)}%)` : "..."}`,
          );
          if (rotationJob.state === "complete") break;
          if (rotationJob.state === "failed") {
            throw new Error(
              `Metadata was saved, but the video rotation failed. The original video remains active. ${rotationJob.error ?? ""}`.trim(),
            );
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1_000));
          rotationJob = await fetchVideoRotationJob(rotationJob.id);
        }
        message = rotationJob.width && rotationJob.height
          ? `Upload changes saved. Created ${rotationJob.width}x${rotationJob.height} rotated video and archived the original.`
          : "Upload changes saved. Created a rotated video and archived the original.";
      }
      if (audioTrimChanged) {
        setAudioTrimStatus("Preparing audio trim…");
        let trimJob: AudioTrimJob = await createAudioTrim({
          assetId,
          startSeconds: audioTrimStart,
          endSeconds: audioTrimEnd,
        });
        for (;;) {
          setAudioTrimStatus(
            `${trimJob.message}${trimJob.state === "rendering" ? ` (${Math.round(trimJob.progress)}%)` : "…"}`,
          );
          if (trimJob.state === "complete") break;
          if (trimJob.state === "failed") {
            throw new Error(
              `Metadata was saved, but the audio trim failed. The original audio remains active. ${trimJob.error ?? ""}`.trim(),
            );
          }
          await new Promise((resolve) => window.setTimeout(resolve, 1_000));
          trimJob = await fetchAudioTrimJob(trimJob.id);
        }
        message = `Upload changes saved. Created a ${trimJob.durationSeconds.toFixed(2)} second trimmed copy and archived the original.`;
      }

      closeAssetManager();
      setWorkspaceMode("browse");
      setRouteSelectionResolved(false);
      setApplicationPath(
        destinationPlacementKey
          ? `/admin/browse?site=${encodeURIComponent(destinationPlacementKey)}`
          : "/admin/browse",
        true,
      );
      setNotice({ tone: "success", message });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingAsset(false);
      setAudioTrimStatus(null);
      setVideoRotationStatus(null);
    }
  }

  async function saveManagedCaption() {
    if (!selectedAsset) return;
    if (!authUser?.authenticated) {
      setError("Sign in to edit captions.");
      return;
    }

    const caption = manageCaption.trim();
    setCaptionSaving(true);
    setCaptionSaveStatus("idle");
    setCaptionSaveError(null);
    setError(null);

    try {
      await updateAssetCaption({ assetId: selectedAsset.id, caption });
      updateAssetDescription(selectedAsset.id, caption);
      setManageCaption(caption);
      setCaptionSaveStatus("saved");
      refreshVisibleAssets();
    } catch (err) {
      setCaptionSaveStatus("failed");
      setCaptionSaveError((err as Error).message);
    } finally {
      setCaptionSaving(false);
    }
  }

  async function deleteSelectedAsset() {
    if (!selectedAsset) return;
    if (!authUser?.authenticated) {
      setError("Sign in to delete uploads.");
      return;
    }
    const confirmed = window.confirm(
      `Delete "${selectedAsset.fileName}" from Immich? This removes the asset entirely.`,
    );
    if (!confirmed) return;

    const assetId = selectedAsset.id;
    const placementId = selectedAsset.placement_id;
    setDeletingAsset(true);
    setError(null);
    try {
      await deleteUploadAsset({ assetId });
      setPlacementAssets((current) =>
        current.filter((asset) => asset.id !== assetId),
      );
      closeAssetManager();
      setWorkspaceMode("browse");
      if (placementId) {
        setPlacementKey(String(placementId));
        setSiteScope("placement");
      }
      setApplicationPath(
        placementId
          ? `/admin/browse?site=${encodeURIComponent(String(placementId))}`
          : "/admin/browse",
        true,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingAsset(false);
    }
  }

  async function lookupSelectedAssetDriveSource() {
    if (!selectedAsset) return;
    if (!authUser?.authenticated) {
      setError("Sign in with Google to look up Drive files.");
      return;
    }

    setDriveAssetAction("lookup");
    setError(null);
    setNotice(null);
    try {
      const result = await lookupUploadAssetDriveSource(selectedAsset.id);
      if (result.status === "ambiguous") {
        setNotice({
          tone: "warning",
          message: result.detail ?? `Found ${result.matchCount ?? "multiple"} matching Google Drive files. Compare them manually, assign this asset to the matching Artasia site, and run the lookup again.`,
        });
        return;
      }
      if (result.status === "not-found") {
        setNotice({
          tone: "warning",
          message: selectedAsset.placement_id
            ? `No matching file was found in this site's Google Drive folder for ${selectedAsset.fileName}.`
            : `No matching file was found in the project Documentation folder for ${selectedAsset.fileName}.`,
        });
        return;
      }
      const driveFileId = result.fileId ?? selectedAsset.driveFileId ?? null;
      const inferredPlacementId = result.placementId ?? selectedAsset.placement_id ?? null;
      const inferredPlacementName = result.placementName ?? selectedAsset.placement_name ?? null;
      const inferredActivityId = result.activityId ?? selectedAsset.activity_id ?? null;
      const inferredActivityLabel = result.activityLabel ?? selectedAsset.activity_label ?? null;
      setSelectedAsset((current) =>
        current?.id === selectedAsset.id
          ? {
              ...current,
              driveFileId,
              placement_id: inferredPlacementId,
              placement_name: inferredPlacementName,
              activity_id: inferredActivityId,
              activity_label: inferredActivityLabel,
            }
          : current,
      );
      setPlacementAssets((current) => current.map((asset) =>
        asset.id === selectedAsset.id
          ? {
              ...asset,
              driveFileId,
              placement_id: inferredPlacementId,
              placement_name: inferredPlacementName,
              activity_id: inferredActivityId,
              activity_label: inferredActivityLabel,
            }
          : asset,
      ));
      if (result.placementId) {
        setManagePlacementKey(String(result.placementId));
      }
      if (result.activityId) {
        setManageActivityTag(String(result.activityId));
      }
      setNotice({
        tone: "success",
        message: result.status === "linked"
          ? `Linked this asset to ${result.fileName ?? "its Google Drive source"}${result.scope === "project-documentation" ? " from the project Documentation folder" : ""}${result.placementName ? ` and assigned it to ${result.placementName}` : ""}${result.activityLabel ? ` (${result.activityLabel})` : ""}.`
          : "This asset is already linked to its Google Drive source.",
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDriveAssetAction(null);
    }
  }

  function toggleVideoPreview() {
    const video = videoPreviewRef.current;
    if (!video) return;
    if (video.paused) {
      void video.play()
        .then(() => setVideoPreviewPlaying(true))
        .catch((playError) => {
          setError(`Could not play video preview: ${(playError as Error).message}`);
          setVideoPreviewPlaying(false);
        });
    } else {
      video.pause();
      setVideoPreviewPlaying(false);
    }
  }

  async function lookupMissingDriveSources() {
    if (!authUser?.authenticated) {
      setError("Sign in with Google to look up Drive files.");
      return;
    }
    if (!window.confirm("Look up Google Drive files for every unlinked asset? This may take a while.")) {
      return;
    }

    setDriveBulkLookupRunning(true);
    setError(null);
    setNotice(null);
    try {
      const summary = await lookupMissingUploadAssetDriveSources();
      console.groupCollapsed(
        `[Drive maintenance] scanned ${summary.scanned} assets: linked ${summary.linked}, not found ${summary.notFound}, ambiguous ${summary.ambiguous}, skipped ${summary.skipped}, failed ${summary.failed}`,
      );
      console.table(summary.results.map((result) => ({
        status: result.status,
        assetId: result.assetId,
        fileName: result.fileName,
        placement: result.placementName
          ? `${result.placementName} (${result.placementId ?? "?"})`
          : result.placementTags?.join(", "),
        folder: result.folderName
          ? `${result.folderName} (${result.folderId ?? "?"})`
          : result.folderId,
        searchedFileName: result.searchedFileName,
        matches: result.matches
          ?.map((match) => `${match.name} (${match.id})`)
          .join(" | "),
        detail: result.error ?? result.driveFileName ?? "",
      })));
      console.log("Full Drive maintenance results", summary.results);
      console.groupEnd();
      refreshVisibleAssets();
      setNotice({
        tone: summary.linked > 0 ? "success" : "warning",
        message: `Drive maintenance scanned ${summary.scanned} assets: linked ${summary.linked}, not found ${summary.notFound}, ambiguous ${summary.ambiguous}, skipped ${summary.skipped}${summary.failed ? `, failed ${summary.failed}` : ""}. Detailed results were logged to the browser console.`,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDriveBulkLookupRunning(false);
    }
  }

  function renderDriveMaintenanceButton() {
    if (!authUser?.authenticated) return null;
    return (
      <button
        type="button"
        onClick={lookupMissingDriveSources}
        disabled={driveBulkLookupRunning || assetsLoading || Boolean(driveAssetAction)}
        title="Look up Drive files for all assets that do not have a known Drive ID"
        style={secondaryButtonStyle}
      >
        <span style={siteActionIconStyle} aria-hidden="true">
          manage_search
        </span>
        {driveBulkLookupRunning ? "Looking up Drive IDs..." : "Lookup missing Drive IDs"}
      </button>
    );
  }

  async function reimportSelectedAssetFromDrive(asAudio = false) {
    if (!selectedAsset) return;
    if (!authUser?.authenticated) {
      setError("Sign in with Google to reimport Drive files.");
      return;
    }

    if (asAudio && !window.confirm(
      "Replace this video with an audio-only version using the standard Artasia audio artwork?",
    )) return;

    setDriveAssetAction(asAudio ? "reimport-audio" : "reimport");
    setError(null);
    setNotice(null);
    try {
      const selectedPlacementId = Number(managePlacementKey);
      const result = await reimportUploadAssetFromDrive(
        selectedAsset.id,
        Number.isSafeInteger(selectedPlacementId) && selectedPlacementId > 0
          ? selectedPlacementId
          : undefined,
        asAudio,
      );
      if (!result.assetId) throw new Error("Google Drive reimport did not create an asset.");
      const replacement = await fetchUploadAsset(result.assetId);
      setPlacementAssets((current) => current.map((asset) =>
        asset.id === selectedAsset.id ? replacement : asset,
      ));
      openAssetManager(replacement);
      refreshVisibleAssets();
      setNotice({
        tone: "success",
        message: asAudio
          ? `Reimported ${result.fileName} as audio and replaced the previous video.`
          : `Reimported ${result.fileName} and replaced the previous asset.`,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDriveAssetAction(null);
    }
  }

  function sourceImageDimensions(asset: PlacementAsset) {
    if (
      cropSourceDimensions &&
      (cropEditing || asset.mediaKind === "video")
    ) return cropSourceDimensions;
    const width = asset.width ?? cropImageRef.current?.naturalWidth ?? 0;
    const height = asset.height ?? cropImageRef.current?.naturalHeight ?? 0;
    return { width, height };
  }

  function rotatedImageDimensions(
    asset: PlacementAsset,
    degrees = effectiveRotationDegrees(),
  ) {
    const source = sourceImageDimensions(asset);
    const radians = (Math.abs(degrees) * Math.PI) / 180;
    return {
      width: Math.max(
        1,
        Math.round(
          Math.abs(source.width * Math.cos(radians)) +
            Math.abs(source.height * Math.sin(radians)),
        ),
      ),
      height: Math.max(
        1,
        Math.round(
          Math.abs(source.width * Math.sin(radians)) +
            Math.abs(source.height * Math.cos(radians)),
        ),
      ),
    };
  }

  function imageDimensionsForCrop(asset: PlacementAsset) {
    return rotatedImageDimensions(asset);
  }

  function normalizeCropRect(asset: PlacementAsset, rect: CropRect): CropRect {
    const dimensions = imageDimensionsForCrop(asset);
    if (dimensions.width <= 0 || dimensions.height <= 0) return rect;
    const x = Math.max(0, Math.min(Math.round(rect.x), dimensions.width - 1));
    const y = Math.max(0, Math.min(Math.round(rect.y), dimensions.height - 1));
    return {
      x,
      y,
      width: Math.max(
        1,
        Math.min(Math.round(rect.width), dimensions.width - x),
      ),
      height: Math.max(
        1,
        Math.min(Math.round(rect.height), dimensions.height - y),
      ),
    };
  }

  function pointerToImagePoint(
    event: React.PointerEvent<HTMLElement>,
    asset: PlacementAsset,
  ) {
    const image = cropImageRef.current;
    if (!image) return null;
    const bounds = image.getBoundingClientRect();
    const dimensions = imageDimensionsForCrop(asset);
    if (
      bounds.width <= 0 ||
      bounds.height <= 0 ||
      dimensions.width <= 0 ||
      dimensions.height <= 0
    )
      return null;

    const x = Math.max(
      0,
      Math.min(
        dimensions.width,
        ((event.clientX - bounds.left) / bounds.width) * dimensions.width,
      ),
    );
    const y = Math.max(
      0,
      Math.min(
        dimensions.height,
        ((event.clientY - bounds.top) / bounds.height) * dimensions.height,
      ),
    );
    return { x, y };
  }

  function defaultCropForAsset(
    asset: PlacementAsset,
    degrees = effectiveRotationDegrees(),
  ): CropRect | null {
    const source = sourceImageDimensions(asset);
    const rotated = rotatedImageDimensions(asset, degrees);
    if (source.width <= 0 || source.height <= 0) return null;
    const angle = (Math.abs(degrees % 180) * Math.PI) / 180;
    if (angle < 1e-8)
      return { x: 0, y: 0, width: source.width, height: source.height };
    const sin = Math.abs(Math.sin(angle));
    const cos = Math.abs(Math.cos(angle));
    const longSide = Math.max(source.width, source.height);
    const shortSide = Math.min(source.width, source.height);
    let width: number;
    let height: number;
    if (shortSide <= 2 * sin * cos * longSide || Math.abs(sin - cos) < 1e-8) {
      const halfShort = 0.5 * shortSide;
      if (source.width >= source.height) {
        width = halfShort / sin;
        height = halfShort / cos;
      } else {
        width = halfShort / cos;
        height = halfShort / sin;
      }
    } else {
      const cos2 = cos * cos - sin * sin;
      width = (source.width * cos - source.height * sin) / cos2;
      height = (source.height * cos - source.width * sin) / cos2;
    }
    width = Math.max(1, Math.min(rotated.width, Math.floor(width)));
    height = Math.max(1, Math.min(rotated.height, Math.floor(height)));
    return {
      x: Math.floor((rotated.width - width) / 2),
      y: Math.floor((rotated.height - height) / 2),
      width,
      height,
    };
  }

  function isCropParameters(value: unknown): value is CropParameters {
    if (!value || typeof value !== "object") return false;
    const candidate = value as Partial<CropParameters>;
    return ["x", "y", "width", "height"].every((key) =>
      Number.isFinite(candidate[key as keyof CropParameters]),
    );
  }

  async function startCropEditing() {
    if (!selectedAsset || selectedAsset.type !== "IMAGE") return;
    if (!authUser?.authenticated) {
      setError("Sign in to crop uploads.");
      return;
    }

    setError(null);
    setStraightenDegrees(0);
    setRotationDegrees(0);
    setCropSourceDimensions(null);
    setCropRect(defaultCropForAsset(selectedAsset, 0));
    setCropEditing(true);
  }

  function beginCropDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!selectedAsset || !cropEditing || cropSaving) return;
    if (cropResizeRef.current || cropMoveRef.current) return;
    const point = pointerToImagePoint(event, selectedAsset);
    if (!point) return;
    cropStartRef.current = point;
    setCropRect(
      normalizeCropRect(selectedAsset, {
        x: Math.round(point.x),
        y: Math.round(point.y),
        width: 1,
        height: 1,
      }),
    );
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function updateCropDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (!selectedAsset || !cropEditing || cropSaving) return;
    const point = pointerToImagePoint(event, selectedAsset);
    if (!point) return;
    const resize = cropResizeRef.current;
    if (resize) {
      const { handle, rect } = resize;
      const right = rect.x + rect.width;
      const bottom = rect.y + rect.height;
      let x = rect.x;
      let y = rect.y;
      let width = rect.width;
      let height = rect.height;
      if (handle.includes("w")) {
        x = Math.min(point.x, right - 1);
        width = right - x;
      }
      if (handle.includes("e")) width = Math.max(1, point.x - rect.x);
      if (handle.includes("n")) {
        y = Math.min(point.y, bottom - 1);
        height = bottom - y;
      }
      if (handle.includes("s")) height = Math.max(1, point.y - rect.y);
      setCropRect(normalizeCropRect(selectedAsset, { x, y, width, height }));
      return;
    }
    const move = cropMoveRef.current;
    if (move) {
      const desired = {
        ...move.rect,
        x: move.rect.x + point.x - move.start.x,
        y: move.rect.y + point.y - move.start.y,
      };
      setCropRect(
        preserveCropAcrossRotation(
          selectedAsset,
          desired,
          straightenDegrees,
          straightenDegrees,
        ),
      );
      return;
    }
    if (!cropStartRef.current) return;
    const start = cropStartRef.current;
    const x = Math.min(start.x, point.x);
    const y = Math.min(start.y, point.y);
    const width = Math.abs(point.x - start.x);
    const height = Math.abs(point.y - start.y);
    setCropRect(
      normalizeCropRect(selectedAsset, {
        x: Math.round(x),
        y: Math.round(y),
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
      }),
    );
  }

  function endCropDrag(event: React.PointerEvent<HTMLDivElement>) {
    cropStartRef.current = null;
    cropResizeRef.current = null;
    cropMoveRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function beginCropResize(
    handle: CropHandle,
    event: React.PointerEvent<HTMLSpanElement>,
  ) {
    if (!selectedAsset || !cropRect || cropSaving) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointerToImagePoint(event, selectedAsset);
    if (!point) return;
    cropResizeRef.current = {
      handle,
      start: point,
      rect: normalizeCropRect(selectedAsset, cropRect),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function beginCropMove(event: React.PointerEvent<HTMLDivElement>) {
    if (!selectedAsset || !cropRect || cropSaving) return;
    event.preventDefault();
    event.stopPropagation();
    const point = pointerToImagePoint(event, selectedAsset);
    if (!point) return;
    cropMoveRef.current = {
      start: point,
      rect: normalizeCropRect(selectedAsset, cropRect),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function cropOverlayStyle(asset: PlacementAsset): React.CSSProperties {
    const dimensions = imageDimensionsForCrop(asset);
    if (!cropRect || dimensions.width <= 0 || dimensions.height <= 0)
      return { display: "none" };
    const rect = normalizeCropRect(asset, cropRect);
    return {
      left: `${(rect.x / dimensions.width) * 100}%`,
      top: `${(rect.y / dimensions.height) * 100}%`,
      width: `${(rect.width / dimensions.width) * 100}%`,
      height: `${(rect.height / dimensions.height) * 100}%`,
    };
  }

  function hasPendingPixelEdits(asset: PlacementAsset) {
    if (asset.type !== "IMAGE") return false;
    if (rotationDegrees !== 0 || Math.abs(straightenDegrees) > 0.0001) {
      return true;
    }
    if (!cropRect) return false;
    const dimensions = imageDimensionsForCrop(asset);
    const rect = normalizeCropRect(asset, cropRect);
    return (
      rect.x > 1 ||
      rect.y > 1 ||
      Math.abs(rect.width - dimensions.width) > 1 ||
      Math.abs(rect.height - dimensions.height) > 1
    );
  }

  async function saveCrop() {
    if (!selectedAsset || !cropRect) return;
    setCropSaving(true);
    setError(null);
    try {
      const result = await flattenUploadAsset({
        assetId: selectedAsset.id,
        rotationDegrees,
        straightenDegrees,
        cropNormalized: (() => {
          const crop = normalizeCropRect(selectedAsset, cropRect);
          const dimensions = imageDimensionsForCrop(selectedAsset);
          return {
            x: crop.x / dimensions.width,
            y: crop.y / dimensions.height,
            width: crop.width / dimensions.width,
            height: crop.height / dimensions.height,
          };
        })(),
      });
      setNotice({
        tone: "success",
        message: `Created ${result.width}×${result.height} edited copy and archived the original.`,
      });
      closeAssetManager();
      refreshVisibleAssets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCropSaving(false);
    }
  }

  function changeStraightenDegrees(value: number) {
    if (!selectedAsset) return;
    const previousDegrees = effectiveRotationDegrees();
    const nextDegrees = effectiveRotationDegrees(value);
    setCropRect((current) =>
      current
        ? preserveCropAcrossRotation(
            selectedAsset,
            current,
            previousDegrees,
            nextDegrees,
          )
        : defaultCropForAsset(selectedAsset, nextDegrees),
    );
    setStraightenDegrees(value);
  }

  function changeRotationDegrees(delta: 90 | -90) {
    if (!selectedAsset) return;
    const nextRotation = ((rotationDegrees + delta + 360) % 360) as RotationDegrees;
    if (selectedAsset.mediaKind === "video") {
      setRotationDegrees(nextRotation);
      return;
    }
    const previousDegrees = effectiveRotationDegrees();
    const nextDegrees = effectiveRotationDegrees(straightenDegrees, nextRotation);
    setCropRect((current) =>
      current
        ? preserveCropAcrossRotation(
            selectedAsset,
            current,
            previousDegrees,
            nextDegrees,
          )
        : defaultCropForAsset(selectedAsset, nextDegrees),
    );
    setRotationDegrees(nextRotation);
  }

  function effectiveRotationDegrees(
    straighten = straightenDegrees,
    rotation = rotationDegrees,
  ) {
    return rotation + straighten;
  }

  function preserveCropAcrossRotation(
    asset: PlacementAsset,
    rect: CropRect,
    previousDegrees: number,
    nextDegrees: number,
  ): CropRect {
    const source = sourceImageDimensions(asset);
    const previousCanvas = rotatedImageDimensions(asset, previousDegrees);
    const nextCanvas = rotatedImageDimensions(asset, nextDegrees);
    if (source.width <= 0 || source.height <= 0) return rect;

    const normalizedCenterX = (rect.x + rect.width / 2) / previousCanvas.width;
    const normalizedCenterY =
      (rect.y + rect.height / 2) / previousCanvas.height;
    let halfWidth =
      ((rect.width / previousCanvas.width) * nextCanvas.width) / 2;
    let halfHeight =
      ((rect.height / previousCanvas.height) * nextCanvas.height) / 2;

    const radians = (nextDegrees * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const absCos = Math.abs(cos);
    const absSin = Math.abs(sin);
    const safeSourceHalfWidth = Math.max(0.5, source.width / 2 - 1);
    const safeSourceHalfHeight = Math.max(0.5, source.height / 2 - 1);

    const horizontalExtent = halfWidth * absCos + halfHeight * absSin;
    const verticalExtent = halfWidth * absSin + halfHeight * absCos;
    const fitScale = Math.min(
      1,
      horizontalExtent > 0 ? safeSourceHalfWidth / horizontalExtent : 1,
      verticalExtent > 0 ? safeSourceHalfHeight / verticalExtent : 1,
    );
    halfWidth *= fitScale;
    halfHeight *= fitScale;

    const limitU = Math.max(
      0,
      safeSourceHalfWidth - (halfWidth * absCos + halfHeight * absSin),
    );
    const limitV = Math.max(
      0,
      safeSourceHalfHeight - (halfWidth * absSin + halfHeight * absCos),
    );
    const desiredX =
      normalizedCenterX * nextCanvas.width - nextCanvas.width / 2;
    const desiredY =
      normalizedCenterY * nextCanvas.height - nextCanvas.height / 2;

    // Transform into the unrotated image axes, clamp there, then rotate back.
    const desiredU = desiredX * cos + desiredY * sin;
    const desiredV = -desiredX * sin + desiredY * cos;
    const clampedU = Math.max(-limitU, Math.min(limitU, desiredU));
    const clampedV = Math.max(-limitV, Math.min(limitV, desiredV));
    const centerX = clampedU * cos - clampedV * sin + nextCanvas.width / 2;
    const centerY = clampedU * sin + clampedV * cos + nextCanvas.height / 2;

    return {
      x: centerX - halfWidth,
      y: centerY - halfHeight,
      width: halfWidth * 2,
      height: halfHeight * 2,
    };
  }

  async function resetCrop() {
    if (!selectedAsset) return;
    const confirmed = window.confirm(
      `Reset all Immich edits for "${selectedAsset.fileName}"?`,
    );
    if (!confirmed) return;
    setCropSaving(true);
    setError(null);
    try {
      await resetUploadAssetEdits(selectedAsset.id);
      setStraightenDegrees(0);
      setRotationDegrees(0);
      setCropRect(defaultCropForAsset(selectedAsset, 0));
      setCropEditing(true);
      queueMediaRefresh(selectedAsset.id);
      refreshVisibleAssets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCropSaving(false);
    }
  }

  async function saveAdjustments(adjustments: AssetAdjustments) {
    if (!selectedAsset) return;
    if (!authUser?.authenticated) {
      setError("Sign in to edit upload adjustments.");
      return;
    }

    const normalized = normalizeAdjustments(adjustments);
    setAdjustmentsSaving(true);
    setError(null);
    try {
      const saved = await updateUploadAssetAdjustments({
        assetId: selectedAsset.id,
        adjustments: normalized,
      });
      const savedNormalized = normalizeAdjustments(saved);
      setManageBrightness(savedNormalized.brightness);
      setManageContrast(savedNormalized.contrast);
      setManageSaturation(savedNormalized.saturation);
      updateAssetAdjustments(selectedAsset.id, savedNormalized);
      refreshVisibleAssets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAdjustmentsSaving(false);
    }
  }

  async function signOut() {
    try {
      await logoutAuthUser();
      setAuthUser({ authenticated: false });
      onSignedOut?.();
      window.location.assign("/");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function syncSelectedDriveFiles() {
    if (selectedDriveFiles.size === 0) {
      setError("Select files to import from Google Drive");
      setNotice(null);
      return;
    }

    setDriveSyncing(true);
    setError(null);
    setNotice(null);

    try {
      const fileIds = Array.from(selectedDriveFiles);
      const results: DriveSyncResult[] = [];
      for (let index = 0; index < fileIds.length; index += 1) {
        setDriveSyncProgress({ current: index + 1, total: fileIds.length });
        const fileResults = await syncDriveFiles({
          fileIds: [fileIds[index]],
          placementId: placementKey ? parseInt(placementKey, 10) : null,
          activityId: activityTagFilter ? parseInt(activityTagFilter, 10) : null,
        });
        results.push(...fileResults);
      }

      const succeeded = results.filter((r) => r.status === "success").length;
      const failed = results.filter((r) => r.status === "failed").length;
      const replaced = results.filter((r) => r.replacedAssetId).length;
      const importedItems: UploadItem[] = results.map((result) => ({
        id: `drive-${result.fileId}-${crypto.randomUUID()}`,
        source: "drive",
        fileName: result.fileName,
        status:
          result.status === "success" && result.assetId
            ? "completed"
            : "failed",
        progress: 100,
        assetId: result.assetId,
        error:
          result.status === "failed"
            ? (result.error ?? "Import failed")
            : undefined,
      }));

      if (importedItems.length > 0) {
        setItems((current) => [...importedItems, ...current]);
      }

      if (succeeded > 0) {
        setNotice({
          tone: failed > 0 ? "warning" : "success",
          message: `Imported ${succeeded} file${succeeded === 1 ? "" : "s"}${
            replaced > 0
              ? ` and replaced ${replaced} existing asset${replaced === 1 ? "" : "s"}`
              : ""
          }${
            failed > 0 ? ` (${failed} failed)` : ""
          }`,
        });
        setSelectedDriveFiles(new Set());
        if (selectedPlacement) {
          fetchPlacementAssets(selectedPlacement.placement_id)
            .then(setPlacementAssets)
            .catch((err) => setError((err as Error).message));
        }
      } else {
        setNotice(null);
        setError(
          `Failed to import files: ${results.map((r) => `${r.fileName}: ${r.error}`).join(", ")}`,
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDriveSyncing(false);
      setDriveSyncProgress(null);
    }
  }

  function toggleDriveFileSelection(fileId: string) {
    const newSelection = new Set(selectedDriveFiles);
    if (newSelection.has(fileId)) {
      newSelection.delete(fileId);
    } else {
      newSelection.add(fileId);
    }
    setSelectedDriveFiles(newSelection);
  }

  function toggleAllDriveFiles() {
    const visibleFileIds = driveFiles.map((file) => file.id);
    if (visibleFileIds.length === 0) return;

    setSelectedDriveFiles((current) => {
      const next = new Set(current);
      const allVisibleFilesSelected = visibleFileIds.every((fileId) =>
        current.has(fileId),
      );
      for (const fileId of visibleFileIds) {
        if (allVisibleFilesSelected) next.delete(fileId);
        else next.add(fileId);
      }
      return next;
    });
  }

  function navigateToDriveFolder(folder: DriveFolder) {
    if (folder.id === "__my_drive__") {
      setDriveType("myDrive");
      setCurrentDriveId(undefined);
      setSelectedDriveFolder("root");
      setFolderPath([{ id: "root", name: "My Drive" }]);
      return;
    }
    if (folder.id === "__shared_drives__") {
      setDriveType("sharedDrives");
      setCurrentDriveId(undefined);
      setSelectedDriveFolder("root");
      setFolderPath([{ id: "__shared_drives__", name: "Shared Drives" }]);
      return;
    }
    if (folder.driveId) {
      // Clicking on a Shared Drive from the list
      setCurrentDriveId(folder.driveId);
      setSelectedDriveFolder("root");
      setFolderPath((current) => [
        ...current,
        { id: folder.id, name: folder.name },
      ]);
    } else {
      // Clicking on a folder within My Drive or within a Shared Drive
      setSelectedDriveFolder(folder.id);
      setFolderPath((current) => [
        ...current,
        { id: folder.id, name: folder.name },
      ]);
    }
  }

  function navigateUpDriveFolder() {
    if (folderPath.length <= 1) {
      resetDriveFolderPath();
      return;
    }
    const newPath = folderPath.slice(0, -1);
    setFolderPath(newPath);
    if (driveType === "sharedDrives" && newPath.length === 1) {
      setCurrentDriveId(undefined);
      setSelectedDriveFolder("root");
    } else if (driveType === "sharedDrives" && newPath.length === 2) {
      setCurrentDriveId(newPath[1].id);
      setSelectedDriveFolder("root");
    } else {
      setSelectedDriveFolder(newPath[newPath.length - 1].id);
    }
  }

  function normalizeDriveName(name: string) {
    return name.trim().toLocaleLowerCase();
  }

  async function openDriveImportDefault(
    configuredFolderId = selectedPlacement?.google_drive_folder_id,
    placementId = selectedPlacement?.placement_id ?? null,
    activity = selectedActivity,
  ) {
    const requestId = ++driveDefaultRequestRef.current;
    const placementChanged = drivePlacementIdRef.current !== placementId;
    drivePlacementIdRef.current = placementId;
    setWorkspaceMode("import");
    setSelectedDriveFiles(new Set());
    setDriveFolders([]);
    setDriveFiles([]);
    if (placementChanged) {
      setFolderPath([]);
      setDriveType("chooser");
      setCurrentDriveId(undefined);
      setSelectedDriveFolder("root");
    }
    setDriveDefaultOpening(true);
    setDriveLoading(true);
    setError(null);
    setNotice(null);

    try {
      if (configuredFolderId) {
        const { folder, path } = await fetchDriveFolder(configuredFolderId);
        if (requestId !== driveDefaultRequestRef.current) return;
        const driveType = folder.driveId ? "sharedDrives" : "myDrive";
        let destinationFolder = folder;
        let destinationPath = path;

        if (activity) {
          const response = await fetchDriveFolders(
            driveType,
            folder.id,
            folder.driveId,
          );
          if (requestId !== driveDefaultRequestRef.current) return;
          const matchingFolder = activityFolderMatch(
            activity,
            response.folders ?? response.subfolders ?? [],
          );
          if (matchingFolder) {
            destinationFolder = matchingFolder;
            destinationPath = [...path, matchingFolder];
          }
        }

        if (folder.driveId) {
          setDriveType("sharedDrives");
          setCurrentDriveId(folder.driveId);
          setFolderPath([
            { id: "__shared_drives__", name: "Shared Drives" },
            ...destinationPath,
          ]);
        } else {
          setDriveType("myDrive");
          setCurrentDriveId(undefined);
          setFolderPath(destinationPath);
        }
        setSelectedDriveFolder(destinationFolder.id);
        return;
      }

      const sharedDrives = await fetchDriveFolders("sharedDrives", "root");
      if (requestId !== driveDefaultRequestRef.current) return;
      const defaultDrive = (sharedDrives.folders ?? []).find((folder) =>
        normalizeDriveName(folder.name).includes(DEFAULT_SHARED_DRIVE_NAME),
      );

      if (!defaultDrive) {
        resetDriveFolderPath();
        return;
      }

      const rootFolders = await fetchDriveFolders(
        "sharedDrives",
        "root",
        defaultDrive.id,
      );
      if (requestId !== driveDefaultRequestRef.current) return;
      const documentationFolder = (rootFolders.folders ?? []).find(
        (folder) =>
          normalizeDriveName(folder.name) === DEFAULT_SHARED_DRIVE_FOLDER,
      );

      if (!documentationFolder) {
        resetDriveFolderPath();
        return;
      }

      setDriveType("sharedDrives");
      setCurrentDriveId(defaultDrive.id);
      setSelectedDriveFolder(documentationFolder.id);
      setFolderPath([
        { id: "__shared_drives__", name: "Shared Drives" },
        { id: defaultDrive.id, name: defaultDrive.name },
        { id: documentationFolder.id, name: documentationFolder.name },
      ]);
    } catch (err) {
      if (requestId !== driveDefaultRequestRef.current) return;
      console.warn(
        "[drive] Failed to open default Artasia Documentation folder",
        err,
      );
      resetDriveFolderPath();
    } finally {
      if (requestId === driveDefaultRequestRef.current) {
        setDriveDefaultOpening(false);
        setDriveLoading(false);
      }
    }
  }

  function resetDriveFolderPath() {
    setDriveType("chooser");
    setFolderPath([]);
    setSelectedDriveFolder("root");
    setCurrentDriveId(undefined);
  }

  function renderAssetCard(asset: PlacementAsset) {
    const activity = options?.activities.find(
      (candidate) => candidate.id === asset.activity_id,
    );
    const activityLabel =
      asset.custom_activity?.trim() || asset.activity_label?.trim() || activity?.label;
    const activityColour = activity?.colour?.trim();
    const isDraft = !asset.published && !asset.archived;
    const isSelected = selectedBrowseAssetIds.has(asset.id);
    return (
      <div
        key={asset.id}
        style={{
          ...assetCardStyle,
          ...(isSelected ? selectedAssetCardStyle : {}),
        }}
      >
        <div
          style={{
            ...assetPreviewStyle,
            cursor: authUser?.authenticated ? "pointer" : "default",
          }}
          onClick={
            authUser?.authenticated
              ? () => toggleBrowseAssetSelection(asset.id)
              : undefined
          }
        >
          {authUser?.authenticated && (
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => toggleBrowseAssetSelection(asset.id)}
              onClick={(event) => event.stopPropagation()}
              aria-label={`Select ${asset.fileName}`}
              style={driveFileCheckboxStyle}
            />
          )}
          <RetryableUploadThumbnail
            assetId={asset.id}
            src={mediaUrl(asset.thumbnailUrl, asset.id)}
            imageStyle={{
              ...assetImageStyle,
              ...adjustmentFilterStyle(asset.adjustments),
            }}
            placeholderStyle={assetThumbnailPlaceholderStyle}
            exhaustedLabel="unavailable"
          />
          <span style={assetBadgeRowStyle}>
            {asset.archived ? (
              <span style={archivedAssetBadgeStyle}>Archived</span>
            ) : asset.published ? (
              <span style={publishedAssetBadgeStyle}>Published</span>
            ) : (
              <span style={draftAssetBadgeStyle}>Draft</span>
            )}
            <span style={mediaKindBadgeStyle}>
              {asset.mediaKind === "audio"
                ? "Audio"
                : asset.mediaKind === "video"
                  ? "Video"
                  : "Image"}
            </span>
            {asset.driveFileId && (
              <span
                style={driveAssetBadgeStyle}
                title="Linked to Google Drive"
                aria-label="Linked to Google Drive"
              >
                <span style={driveAssetBadgeIconStyle} aria-hidden="true">
                  add_to_drive
                </span>
              </span>
            )}
            {activityLabel && (
              <span
                style={{
                  ...activityAssetBadgeStyle,
                  ...(activityColour
                    ? {
                        background: activityColour,
                        borderColor: activityColour,
                        color: readableBadgeTextColour(activityColour),
                      }
                    : {}),
                }}
              >
                {activityLabel}
              </span>
            )}
          </span>
        </div>
        <div style={assetCardMetaStyle}>
          <span style={assetNameStyle}>{asset.fileName}</span>
          {asset.mediaKind === "audio" && (
            <span style={assetDurationStyle}>
              Duration: {formatAssetDuration(asset.durationSeconds)}
            </span>
          )}
          <span style={assetDateStyle}>
            {new Date(asset.createdAt).toLocaleDateString()}
          </span>
        </div>
        <div style={assetCardActionsStyle}>
          <button
            type="button"
            onClick={() => openAssetManager(asset)}
            style={browseEditButtonStyle}
          >
            <span style={materialSymbolStyle} aria-hidden="true">edit</span>
            Edit
          </button>
          {authUser?.authenticated && (
            <>
            {isDraft && (
              <button
                type="button"
                onClick={() => void publishBrowseAssets([asset.id])}
                disabled={
                  publishingBrowseAssets ||
                  archivingBrowseAssets ||
                  deletingBrowseAssets
                }
                style={inlinePublishButtonStyle}
              >
                {publishingBrowseAssets ? "Publishing..." : "Publish"}
              </button>
            )}
            </>
          )}
        </div>
      </div>
    );
  }

  function renderAssetGrid(emptyMessage: string) {
    if (assetsLoading)
      return (
        <div style={loadingUploadsStyle}>
          <span aria-hidden="true" style={loadingSpinnerStyle} />
          <span>Loading uploads...</span>
        </div>
      );
    const selectedDraftAssetIds = displayedPlacementAssets
      .filter(
        (asset) =>
          selectedBrowseAssetIds.has(asset.id) &&
          !asset.published &&
          !asset.archived,
      )
      .map((asset) => asset.id);
    const activeStatusLabel = BROWSE_ASSET_STATUSES.find(
      (status) => status.value === browseAssetStatus,
    )?.label ?? "Draft";

    function handleStatusTabKeyDown(
      event: React.KeyboardEvent<HTMLButtonElement>,
      statusIndex: number,
    ) {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const offset = event.key === "ArrowLeft" ? -1 : 1;
      const nextIndex =
        (statusIndex + offset + BROWSE_ASSET_STATUSES.length) %
        BROWSE_ASSET_STATUSES.length;
      const nextStatus = BROWSE_ASSET_STATUSES[nextIndex].value;
      selectBrowseAssetStatus(nextStatus);
      window.requestAnimationFrame(() => {
        document.getElementById(`atlas-browse-status-${nextStatus}`)?.focus();
      });
    }

    return (
      <div>
        <div
          className="atlas-browse-status-tabs"
          role="tablist"
          aria-label="Asset status"
          style={browseStatusTabsStyle}
        >
          {BROWSE_ASSET_STATUSES.map((status, statusIndex) => {
            const active = browseAssetStatus === status.value;
            return (
              <button
                key={status.value}
                id={`atlas-browse-status-${status.value}`}
                type="button"
                role="tab"
                aria-selected={active}
                aria-controls="atlas-browse-status-panel"
                tabIndex={active ? 0 : -1}
                onClick={() => selectBrowseAssetStatus(status.value)}
                onKeyDown={(event) => handleStatusTabKeyDown(event, statusIndex)}
                style={{
                  ...browseStatusTabStyle,
                  ...(active ? browseStatusTabActiveStyle : {}),
                }}
              >
                <span>{status.label}</span>
                <span style={browseStatusCountStyle}>
                  {browseAssetStatusCounts[status.value]}
                </span>
              </button>
            );
          })}
        </div>
        {selectedBrowseAssetIds.size > 0 && (
          <div style={browseSelectionBarStyle}>
            <span>
              {selectedBrowseAssetIds.size} asset{selectedBrowseAssetIds.size === 1 ? "" : "s"} selected
            </span>
            <div style={detailHeaderActionsStyle}>
              <span style={withSelectedLabelStyle}>With selected</span>
              <button
                type="button"
                onClick={() => void publishBrowseAssets(selectedDraftAssetIds)}
                disabled={
                  selectedDraftAssetIds.length === 0 ||
                  publishingBrowseAssets ||
                  archivingBrowseAssets ||
                  deletingBrowseAssets
                }
                style={primaryActionButtonStyle}
              >
                {publishingBrowseAssets ? "Publishing..." : "Publish"}
              </button>
              <button
                type="button"
                onClick={() => void archiveBrowseAssets(Array.from(selectedBrowseAssetIds))}
                disabled={
                  browseAssetStatus === "archived" ||
                  archivingBrowseAssets ||
                  publishingBrowseAssets ||
                  deletingBrowseAssets
                }
                style={secondaryButtonStyle}
              >
                {archivingBrowseAssets ? "Archiving..." : "Archive"}
              </button>
              <button
                type="button"
                onClick={() =>
                  void deleteBrowseAssets(Array.from(selectedBrowseAssetIds))
                }
                disabled={
                  deletingBrowseAssets ||
                  archivingBrowseAssets ||
                  publishingBrowseAssets
                }
                style={dangerButtonStyle}
              >
                {deletingBrowseAssets ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        )}
        <div
          id="atlas-browse-status-panel"
          role="tabpanel"
          aria-labelledby={`atlas-browse-status-${browseAssetStatus}`}
        >
          {displayedPlacementAssets.length > 0 ? (
            <div style={assetGridStyle}>
              {displayedPlacementAssets.map(renderAssetCard)}
            </div>
          ) : (
            <div style={emptyStateStyle}>
              {placementAssets.length === 0
                ? emptyMessage
                : `No ${activeStatusLabel.toLowerCase()} uploads match the current filters.`}
            </div>
          )}
        </div>
      </div>
    );
  }

  function renderUploadItems() {
    if (items.length === 0) return null;
    const publishableItemCount = items.filter(
      (item) => item.status === "completed" && item.assetId && !item.published,
    ).length;

    return (
      <div style={listStyle}>
        {publishableItemCount > 0 && (
          <div style={uploadPublishAllStyle}>
            <span>
              {publishableItemCount} completed asset{publishableItemCount === 1 ? "" : "s"} ready to publish
            </span>
            <button
              type="button"
              onClick={() => void publishAllCurrentItems()}
              disabled={publishingAllItems || !authUser?.authenticated}
              style={primaryActionButtonStyle}
            >
              {publishingAllItems ? "Publishing..." : "Publish all"}
            </button>
          </div>
        )}
        {items.map((item) => (
          <div key={item.id} style={itemStyle}>
            <div style={thumbStyle}>
              {item.assetId ? (
                <RetryableUploadThumbnail
                  assetId={item.assetId}
                  imageStyle={thumbImageStyle}
                  placeholderStyle={queueThumbPlaceholderStyle}
                />
              ) : (
                <span style={queueThumbPlaceholderStyle}>
                  {item.status === "failed" ? "failed" : "uploading"}
                </span>
              )}
            </div>
            <div style={queueItemContentStyle}>
              <div style={queueItemMainStyle}>
                <div style={{ color: "#eee" }}>{item.fileName}</div>
                <div
                  style={{
                    color: item.status === "failed" ? "#f88" : "#888",
                    fontSize: 12,
                  }}
                >
                  {typeof item.fileSize === "number" && (
                    <>
                      <span>{formatBytes(item.fileSize)}</span>
                      <span
                        style={queueMetaSeparatorStyle}
                        aria-hidden="true"
                      />
                    </>
                  )}
                  {item.status === "completed" ? (
                    <span style={completedStatusStyle}>
                      <CheckIcon />
                      {item.source === "drive"
                        ? "import completed"
                        : "upload completed"}
                    </span>
                  ) : (
                    item.status
                  )}
                  {item.error && (
                    <>
                      <span
                        style={queueMetaSeparatorStyle}
                        aria-hidden="true"
                      />
                      <span>{item.error}</span>
                    </>
                  )}
                </div>
              </div>
              {item.status === "failed" && item.file ? (
                <button
                  type="button"
                  onClick={() => {
                    setItems((current) =>
                      current.map((entry) =>
                        entry.id === item.id
                          ? {
                              ...entry,
                              status: "queued",
                              progress: 0,
                              error: undefined,
                            }
                          : entry,
                      ),
                    );
                  }}
                  style={retryButtonStyle}
                >
                  Retry
                </button>
              ) : item.status !== "completed" ? (
                <div style={progressTrackStyle}>
                  <div
                    style={{ ...progressBarStyle, width: `${item.progress}%` }}
                  />
                </div>
              ) : null}
              {item.assetId && (
                <label style={captionFieldStyle}>
                  <span style={captionLabelStyle}>Caption</span>
                  <div style={captionRowStyle}>
                    <input
                      type="text"
                      value={item.caption ?? ""}
                      onChange={(event) =>
                        updateItemCaption(item.id, event.target.value)
                      }
                      placeholder="Optional caption"
                      style={captionInputStyle}
                    />
                    <button
                      type="button"
                      onClick={() => void saveItemCaption(item)}
                      disabled={
                        item.captionStatus === "saving" ||
                        item.openingEditor ||
                        (item.assetId ? publishingItemIds.has(item.assetId) : false)
                      }
                      style={captionSaveButtonStyle}
                    >
                      {item.captionStatus === "saving" ? "Saving..." : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void editUploadedItem(item)}
                      disabled={
                        item.captionStatus === "saving" ||
                        item.openingEditor ||
                        (item.assetId ? publishingItemIds.has(item.assetId) : false)
                      }
                      style={captionSaveButtonStyle}
                    >
                      {item.openingEditor ? "Opening..." : "Edit"}
                    </button>
                    {!item.published && (
                      <button
                        type="button"
                        onClick={() => void publishUploadedItem(item)}
                        disabled={
                          !authUser?.authenticated ||
                          item.captionStatus === "saving" ||
                          item.openingEditor ||
                          (item.assetId ? publishingItemIds.has(item.assetId) : false)
                        }
                        style={primaryActionButtonStyle}
                      >
                        {item.publishStatus === "publishing" ? "Publishing..." : "Publish"}
                      </button>
                    )}
                    {item.published && (
                      <span style={publishedAssetBadgeStyle}>Published</span>
                    )}
                  </div>
                  {item.captionStatus === "saved" && (
                    <span style={captionStatusStyle}>Saved</span>
                  )}
                  {item.captionStatus === "failed" && (
                    <span style={captionErrorStyle}>
                      {item.captionError ?? "Caption failed"}
                    </span>
                  )}
                  {item.publishStatus === "failed" && (
                    <span style={captionErrorStyle}>
                      {item.publishError ?? "Publishing failed"}
                    </span>
                  )}
                </label>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }

  function renderDriveBrowser() {
    const allDriveFilesSelected =
      driveFiles.length > 0 &&
      driveFiles.every((file) => selectedDriveFiles.has(file.id));
    const googleDriveFolderUrl =
      selectedDriveFolder !== "root" &&
      selectedDriveFolder !== "__shared_drives__"
        ? `https://drive.google.com/drive/folders/${encodeURIComponent(selectedDriveFolder)}`
        : driveType === "sharedDrives" && currentDriveId
          ? `https://drive.google.com/drive/folders/${encodeURIComponent(currentDriveId)}`
          : driveType === "sharedDrives"
            ? "https://drive.google.com/drive/shared-drives"
            : "https://drive.google.com/drive/my-drive";

    return (
      <div style={driveBrowserStyle}>
        {/* Breadcrumb navigation */}
        {folderPath.length > 0 && (
          <div style={driveBrowserHeaderStyle}>
            <div style={driveBreadcrumbsStyle}>
              {folderPath.map((breadcrumb, index) => (
                <div
                  key={breadcrumb.id}
                  style={{ display: "flex", alignItems: "center", gap: 4 }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (index === 0) {
                        if (driveType === "myDrive") {
                          setSelectedDriveFolder("root");
                          setFolderPath([{ id: "root", name: "My Drive" }]);
                        } else {
                          setCurrentDriveId(undefined);
                          setSelectedDriveFolder("root");
                          setFolderPath([
                            { id: "__shared_drives__", name: "Shared Drives" },
                          ]);
                        }
                      } else {
                        const newPath = folderPath.slice(0, index + 1);
                        setFolderPath(newPath);
                        if (driveType === "sharedDrives" && index === 1) {
                          setCurrentDriveId(breadcrumb.id);
                          setSelectedDriveFolder("root");
                        } else {
                          setSelectedDriveFolder(newPath[newPath.length - 1].id);
                        }
                      }
                    }}
                    style={{
                      background: "transparent",
                      color:
                        selectedDriveFolder === breadcrumb.id
                          ? "#d8e7ff"
                          : "#9aa3b3",
                      border: "none",
                      cursor: "pointer",
                      padding: 0,
                      textDecoration:
                        selectedDriveFolder === breadcrumb.id
                          ? "underline"
                          : "none",
                    }}
                  >
                    {breadcrumb.name}
                  </button>
                  {index < folderPath.length - 1 && (
                    <span style={{ color: "#666" }}>/</span>
                  )}
                </div>
              ))}
            </div>
            <div style={driveFolderActionsStyle}>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(googleDriveFolderUrl);
                    setNotice({
                      tone: "success",
                      message: "Google Drive link copied.",
                    });
                  } catch {
                    setNotice({
                      tone: "warning",
                      message: "Could not copy the Google Drive link.",
                    });
                  }
                }}
                style={copyDriveFolderLinkStyle}
              >
                <span style={materialSymbolStyle} aria-hidden="true">content_copy</span>
                Copy Google Drive Link
              </button>
              <a
                href={googleDriveFolderUrl}
                target="_blank"
                rel="noopener noreferrer"
                style={openDriveFolderLinkStyle}
              >
                <span style={materialSymbolStyle} aria-hidden="true">open_in_new</span>
                Open in Google Drive
              </a>
            </div>
          </div>
        )}

        {/* File/Folder list */}
        {driveLoading || driveDefaultOpening ? (
          <div style={emptyStateStyle}>Loading...</div>
        ) : driveFolders.length === 0 && driveFiles.length === 0 ? (
          <div style={emptyStateStyle}>
            No folders or files in this location
          </div>
        ) : (
          <div style={driveFileListStyle}>
            {/* Folders (for hierarchy navigation) */}
            {driveFolders.map((folder) => (
              <div
                key={folder.id}
                style={{
                  ...driveFileItemStyle,
                  display: "flex",
                  alignItems: "center",
                  gridColumn: "1 / -1",
                  background: "rgba(255,255,255,0.08)",
                  cursor: "pointer",
                  fontWeight: 500,
                }}
                onClick={() => navigateToDriveFolder(folder)}
              >
                <span style={{ fontSize: 16 }}>📁</span>
                <span
                  className="atlas-drive-folder-label"
                  style={driveFolderNameAndStatsStyle}
                >
                  <span>{folder.name}</span>
                  {activityDriveFolders.some(
                    (activityFolder) => activityFolder.id === folder.id,
                  ) &&
                    (driveFolderStats[folder.id] || driveFolderStatsFailed) && (
                    <span
                      className="atlas-drive-folder-stats"
                      style={driveFolderStatsStyle}
                    >
                      {driveFolderStats[folder.id]
                        ? driveFolderStatsLabel(driveFolderStats[folder.id])
                        : "Counts unavailable"}
                    </span>
                  )}
                </span>
                <span style={{ color: "#666", fontSize: 12 }}>→</span>
              </div>
            ))}

            {/* Files (selectable for import) */}
            {driveFiles.map((file) => (
              <div
                key={file.id}
                style={{
                  ...driveFileItemStyle,
                  ...(selectedDriveFiles.has(file.id)
                    ? driveFileItemSelectedStyle
                    : {}),
                }}
                onClick={() => toggleDriveFileSelection(file.id)}
              >
                <div style={driveFileThumbStyle}>
                  <input
                    type="checkbox"
                    checked={selectedDriveFiles.has(file.id)}
                    onChange={() => toggleDriveFileSelection(file.id)}
                    onClick={(e) => e.stopPropagation()}
                    style={driveFileCheckboxStyle}
                  />
                  {!assetsLoading && (
                    <span
                      style={
                        driveFileIsImported(file)
                          ? driveFileImportedBadgeStyle
                          : driveFileNewBadgeStyle
                      }
                    >
                      {driveFileIsImported(file) ? "Imported" : "New"}
                    </span>
                  )}
                  {file.thumbnailLink ? (
                    <img
                      src={file.thumbnailLink}
                      alt=""
                      style={driveFileThumbImageStyle}
                      loading="lazy"
                    />
                  ) : file.isAudio ? (
                    <img
                      src="/audio-icon.png"
                      alt=""
                      style={driveFileThumbImageStyle}
                    />
                  ) : (
                    <span style={driveFileTypeStyle}>
                      {file.isVideo ? "VID" : "IMG"}
                    </span>
                  )}
                </div>
                <div style={driveFileMetaStyle}>
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {file.name}
                  </span>
                  <span style={assetDateStyle}>
                    {file.isAudio ? "Audio (imports as video)" : file.isVideo ? "Video" : "Image"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Navigation and import actions */}
        <div style={driveActionsStyle}>
          {folderPath.length > 0 && (
            <button
              type="button"
              onClick={navigateUpDriveFolder}
              disabled={driveLoading}
              style={secondaryButtonStyle}
            >
              ← Back
            </button>
          )}
          {(driveFiles.length > 0 || selectedDriveFiles.size > 0) && (
            <>
              {driveFiles.length > 0 && (
                <button
                  type="button"
                  onClick={toggleAllDriveFiles}
                  disabled={driveLoading || driveSyncing}
                  style={secondaryButtonStyle}
                >
                  {allDriveFilesSelected ? "Clear Selection" : "Select All"}
                </button>
              )}
              <button
                type="button"
                onClick={syncSelectedDriveFiles}
                disabled={
                  selectedDriveFiles.size === 0 ||
                  driveSyncing ||
                  !authUser?.authenticated
                }
                style={primaryActionButtonStyle}
              >
                {driveSyncing && <span aria-hidden="true" style={loadingSpinnerStyle} />}
                {driveSyncing && driveSyncProgress
                  ? `Importing ${driveSyncProgress.current}/${driveSyncProgress.total} files`
                  : driveSyncing
                    ? "Importing files"
                    : `Import ${selectedDriveFiles.size} file${selectedDriveFiles.size === 1 ? "" : "s"}`}
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  function renderSiteSelection() {
    return (
      <div style={siteSelectionPanelStyle}>
        <div className="atlas-site-grid" style={siteChoiceGridStyle}>
          {filteredPlacements.map((placement) => (
            <div key={placement.placement_id} style={siteChoiceCardStyle}>
              <div style={siteCardContentStyle}>
                {(placement.partner_logo?.url || placement.is_earlyon) && (
                  <div style={siteLogoRowStyle}>
                    {placement.partner_logo?.url && (
                      <img
                        src={placement.partner_logo.url}
                        alt={placement.partner_logo.alt || ""}
                        style={sitePartnerLogoStyle}
                        loading="lazy"
                      />
                    )}
                    {placement.is_earlyon && (
                      <img
                        src="/early-on.svg"
                        alt="EarlyON"
                        style={siteEarlyOnLogoStyle}
                        loading="lazy"
                      />
                    )}
                  </div>
                )}
                <span style={placementNameStyle}>
                  {placementLabel(placement)}
                </span>
                <span style={placementMetaGroupStyle}>
                  {placementMetaLines(placement).map((line) =>
                    line.href ? (
                      <a
                        key={line.text}
                        href={line.href}
                        target="_blank"
                        rel="noreferrer"
                        style={
                          line.variant === "location"
                            ? placementLocationLinkStyle
                            : placementMetaLinkStyle
                        }
                      >
                        {line.icon && (
                          <span
                            style={placementMetaIconStyle}
                            aria-hidden="true"
                          >
                            {line.icon}
                          </span>
                        )}
                        {line.text}
                      </a>
                    ) : (
                      <span key={line.text} style={placementMetaStyle}>
                        {line.icon && (
                          <span
                            style={placementMetaIconStyle}
                            aria-hidden="true"
                          >
                            {line.icon}
                          </span>
                        )}
                        {line.text}
                      </span>
                    ),
                  )}
                </span>
                {renderSiteActivityStats(placement.placement_id)}
              </div>
              <div style={siteActionRowStyle}>
                <button
                  type="button"
                  onClick={() => browsePlacement(placement)}
                  style={siteActionButtonStyle}
                >
                  <span style={siteActionIconStyle} aria-hidden="true">
                    browse
                  </span>
                  Browse
                </button>
                <button
                  type="button"
                  onClick={() => uploadToPlacement(placement)}
                  style={siteActionButtonStyle}
                >
                  <span style={siteActionIconStyle} aria-hidden="true">
                    upload
                  </span>
                  Upload
                </button>
                <button
                  type="button"
                  onClick={() => importToPlacement(placement)}
                  style={siteActionButtonStyle}
                >
                  <span style={siteActionIconStyle} aria-hidden="true">
                    add_to_drive
                  </span>
                  {placement.google_drive_folder_id?.trim()
                    ? "Import *"
                    : "Import"}
                </button>
                <a
                  href={placementViewerUrl(placement)}
                  target="_blank"
                  rel="noreferrer"
                  style={siteActionLinkStyle}
                >
                  <span style={siteActionIconStyle} aria-hidden="true">
                    open_in_new
                  </span>
                  View
                </a>
                <a
                  href={placementEditUrl(placement)}
                  target="_blank"
                  rel="noreferrer"
                  style={siteActionLinkStyle}
                >
                  <span style={siteActionIconStyle} aria-hidden="true">
                    edit
                  </span>
                  Edit
                </a>
              </div>
            </div>
          ))}
        </div>

        {filteredPlacements.length === 0 && (
          <div style={emptyStateStyle}>No sites match the current filters.</div>
        )}
      </div>
    );
  }

  function renderSiteActivityStats(placementId: number) {
    if (!authUser?.authenticated) return null;
    if (siteActivityStatsLoading && !siteActivityStats[String(placementId)]) {
      return <div style={siteStatsLoadingStyle}>Loading asset statistics…</div>;
    }

    const stats = siteActivityStats[String(placementId)];
    if (!stats || stats.totalPublished === 0) {
      return <div style={siteStatsEmptyStyle}>No published assets</div>;
    }

    return (
      <div style={siteStatsStyle}>
        <div style={siteStatsTotalStyle}>
          {stats.totalPublished} published asset
          {stats.totalPublished === 1 ? "" : "s"}
        </div>
        {stats.activities.length > 0 ? (
          <ul style={siteStatsListStyle}>
            {stats.activities.map((activity) => (
              <li key={activity.activityId} style={siteStatsItemStyle}>
                <span>{activity.label}</span>
                <span style={siteStatsCountStyle}>
                  {activity.publishedCount} asset
                  {activity.publishedCount === 1 ? "" : "s"} published
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div style={siteStatsEmptyStyle}>No activity tags assigned</div>
        )}
      </div>
    );
  }

  function renderSiteBreadcrumb(label: string, parentLabels: string[] = []) {
    return (
      <div style={breadcrumbStyle}>
        <button
          type="button"
          onClick={returnToSiteSelection}
          style={breadcrumbButtonStyle}
        >
          Sites
        </button>
        <span style={breadcrumbSeparatorStyle}>/</span>
        {parentLabels.map((parentLabel, index) => (
          <span key={`${parentLabel}-${index}`} style={breadcrumbSegmentStyle}>
            <span style={breadcrumbParentStyle}>{parentLabel}</span>
            <span style={breadcrumbSeparatorStyle}>/</span>
          </span>
        ))}
        <span style={breadcrumbCurrentStyle}>{label}</span>
      </div>
    );
  }

  function renderChooseSitePrompt(action: "browse" | "upload" | "import") {
    return (
      <div style={emptyStateStyle}>
        Choose a site from the Sites tab before you {action}.
        <div style={promptActionStyle}>
          <button
            type="button"
            onClick={returnToSiteSelection}
            style={secondaryButtonStyle}
          >
            Go to Sites
          </button>
        </div>
      </div>
    );
  }

  function renderChooseAssetToEditPrompt() {
    return (
      <div style={emptyStateStyle}>
        Choose an image or video from Browse to edit its upload details.
        <div style={promptActionStyle}>
          <button
            type="button"
            onClick={() => {
              setWorkspaceMode("browse");
              setApplicationPath("/admin", true);
            }}
            style={secondaryButtonStyle}
          >
            Go to Browse
          </button>
        </div>
      </div>
    );
  }

  function renderAssetManager() {
    if (!selectedAsset) return null;
    const assignedPlacement = options?.placements.find(
      (placement) => placement.placement_id === selectedAsset.placement_id,
    );
    const navigationSource = editNavigationAssets.length > 0
      ? editNavigationAssets
      : placementAssets;
    const editableImages = navigationSource.filter(
      (asset) =>
        asset.type === "IMAGE" &&
        asset.placement_id === selectedAsset.placement_id,
    );
    const selectedImageIndex = editableImages.findIndex(
      (asset) => asset.id === selectedAsset.id,
    );
    const previousImage = selectedImageIndex > 0
      ? editableImages[selectedImageIndex - 1]
      : null;
    const nextImage =
      selectedImageIndex >= 0 && selectedImageIndex < editableImages.length - 1
        ? editableImages[selectedImageIndex + 1]
        : null;
    const assetNavigationBusy =
      savingAsset ||
      deletingAsset ||
      cropSaving ||
      adjustmentsSaving ||
      captionSaving ||
      Boolean(driveAssetAction);
    const placementChanged =
      Boolean(managePlacementKey) &&
      managePlacementKey !==
        (selectedAsset.placement_id ? String(selectedAsset.placement_id) : "");
    const displayPlacementChanged =
      manageDisplayPlacementKey !==
      (selectedAsset.display_placement_id
        ? String(selectedAsset.display_placement_id)
        : "");
    const uploaderChanged =
      Boolean(manageUploaderKey) &&
      manageUploaderKey !==
        (selectedAsset.uploader_id ? String(selectedAsset.uploader_id) : "");
    const selectedActivityMode = selectedAsset.custom_activity?.trim()
      ? CUSTOM_ACTIVITY_OPTION
      : selectedAsset.activity_id
        ? String(selectedAsset.activity_id)
        : "";
    const activityChanged =
      manageActivityTag !== selectedActivityMode ||
      (manageActivityTag === CUSTOM_ACTIVITY_OPTION &&
        manageCustomActivity.trim() !== (selectedAsset.custom_activity?.trim() ?? ""));
    const iconChanged = manageIconName !== (selectedAsset.iconName ?? null);
    const linkedAudioChanged =
      selectedAsset.type === "IMAGE" &&
      manageLinkedAudioAssetId !== (selectedAsset.linkedAudioAssetId ?? "");
    const publishedChanged =
      managePublished !== Boolean(selectedAsset.published);
    const archivedChanged =
      manageArchived !== Boolean(selectedAsset.archived);
    const selectedAdjustments = normalizeAdjustments(selectedAsset.adjustments);
    const adjustmentChanged =
      manageBrightness !== selectedAdjustments.brightness ||
      manageContrast !== selectedAdjustments.contrast ||
      manageSaturation !== selectedAdjustments.saturation;
    const captionChanged =
      manageCaption.trim() !== (selectedAsset.description ?? "").trim();
    const locationChanged =
      manageLatitude.trim() !== coordinateInputValue(selectedAsset.latitude) ||
      manageLongitude.trim() !== coordinateInputValue(selectedAsset.longitude);
    const gpsUsageChanged =
      manageUseGpsLocation !== (selectedAsset.useGpsLocation !== false);
    const pixelEditsChanged = hasPendingPixelEdits(selectedAsset);
    const videoRotationChanged =
      selectedAsset.mediaKind === "video" && rotationDegrees !== 0;
    const audioTrimChanged =
      selectedAsset.mediaKind === "audio" &&
      audioDuration > 0 &&
      (audioTrimStart > 0.005 ||
        Math.abs(audioTrimEnd - audioDuration) > 0.005);
    const hasAnyChanges =
      placementChanged ||
      displayPlacementChanged ||
      uploaderChanged ||
      activityChanged ||
      iconChanged ||
      linkedAudioChanged ||
      publishedChanged ||
      archivedChanged ||
      adjustmentChanged ||
      captionChanged ||
      locationChanged ||
      gpsUsageChanged ||
      pixelEditsChanged ||
      videoRotationChanged ||
      audioTrimChanged;
    const displayPreviewUrl = mediaUrl(
      selectedAsset.previewUrl,
      selectedAsset.id,
    );
    const cropSourceUrl = `/api/v1/assets/${selectedAsset.id}/preview?v=${encodeURIComponent(
      `${selectedAsset.updatedAt}-${cropRefreshKey}`,
    )}`;
    const cropCanvasDimensions = rotatedImageDimensions(selectedAsset);
    const cropSourceSize = sourceImageDimensions(selectedAsset);
    const videoPreviewDimensions = rotatedImageDimensions(
      selectedAsset,
      rotationDegrees,
    );

    return (
      <div className="atlas-manage-panel" style={managePanelStyle}>
        <div style={managePreviewStyle}>
          {selectedAsset.mediaKind === "audio" ? (
            <AudioTrimEditor
              asset={selectedAsset}
              startSeconds={audioTrimStart}
              endSeconds={audioTrimEnd}
              disabled={savingAsset}
              onChange={(start, end) => {
                setAudioTrimStart(start);
                setAudioTrimEnd(end);
              }}
              onDuration={(duration) => {
                if (!Number.isFinite(duration) || duration <= 0) return;
                setAudioDuration(duration);
                setAudioTrimEnd((current) =>
                  current <= 0 ||
                  Math.abs(current - selectedAsset.durationSeconds) < 0.1
                    ? duration
                    : Math.min(current, duration),
                );
              }}
            />
          ) : selectedAsset.type === "VIDEO" ? (
            <div style={videoRotationEditorStyle}>
              <div
                style={{
                  ...videoRotationPreviewStyle,
                  width: `min(100%, ${Math.round((560 * videoPreviewDimensions.width) / videoPreviewDimensions.height)}px)`,
                  aspectRatio: `${videoPreviewDimensions.width} / ${videoPreviewDimensions.height}`,
                }}
              >
                <video
                  ref={videoPreviewRef}
                  src={selectedAsset.originalUrl}
                  controls={rotationDegrees === 0}
                  preload="metadata"
                  onClick={rotationDegrees === 0 ? undefined : toggleVideoPreview}
                  onPlay={() => setVideoPreviewPlaying(true)}
                  onPause={() => setVideoPreviewPlaying(false)}
                  onEnded={() => setVideoPreviewPlaying(false)}
                  onLoadedMetadata={(event) => {
                    const video = event.currentTarget;
                    if (!video.videoWidth || !video.videoHeight) return;
                    setCropSourceDimensions({
                      width: video.videoWidth,
                      height: video.videoHeight,
                    });
                  }}
                  style={{
                    ...rotatedVideoPreviewStyle,
                    width: `${(cropSourceSize.width / videoPreviewDimensions.width) * 100}%`,
                    height: `${(cropSourceSize.height / videoPreviewDimensions.height) * 100}%`,
                    transform: `translate(-50%, -50%) rotate(${rotationDegrees}deg)`,
                    cursor: rotationDegrees === 0 ? "default" : "pointer",
                  }}
                />
              </div>
              <div style={rotationControlStyle}>
                <span>Rotate video</span>
                <button
                  type="button"
                  aria-label="Rotate video left 90 degrees"
                  title="Rotate left 90 degrees"
                  onClick={() => changeRotationDegrees(-90)}
                  disabled={savingAsset || manageArchived}
                  style={secondaryButtonStyle}
                >
                  <span style={materialSymbolStyle} aria-hidden="true">
                    rotate_left
                  </span>
                  <span aria-hidden="true">90&deg;</span>
                </button>
                <button
                  type="button"
                  aria-label="Rotate video right 90 degrees"
                  title="Rotate right 90 degrees"
                  onClick={() => changeRotationDegrees(90)}
                  disabled={savingAsset || manageArchived}
                  style={secondaryButtonStyle}
                >
                  <span style={materialSymbolStyle} aria-hidden="true">
                    rotate_right
                  </span>
                  <span aria-hidden="true">90&deg;</span>
                </button>
                <span style={rotationValueStyle}>
                  {rotationDegrees === 270 ? -90 : rotationDegrees}&deg;
                </span>
                {rotationDegrees !== 0 && (
                  <button
                    type="button"
                    onClick={toggleVideoPreview}
                    disabled={savingAsset}
                    style={secondaryButtonStyle}
                  >
                    {videoPreviewPlaying ? "Pause preview" : "Play preview"}
                  </button>
                )}
              </div>
              <div style={cropHintStyle}>
                Rotation creates a new MP4 and archives the original after the
                replacement has been verified.
              </div>
              {manageArchived && (
                <div style={fieldHelpStyle}>
                  Restore this video before rotating it.
                </div>
              )}
            </div>
          ) : cropEditing ? (
            <div style={cropEditorStyle}>
              <div
                style={{
                  ...cropStageStyle,
                  width: `min(100%, ${Math.round((560 * cropCanvasDimensions.width) / cropCanvasDimensions.height)}px)`,
                  aspectRatio: `${cropCanvasDimensions.width} / ${cropCanvasDimensions.height}`,
                }}
                onPointerDown={beginCropDrag}
                onPointerMove={updateCropDrag}
                onPointerUp={endCropDrag}
                onPointerCancel={endCropDrag}
              >
                <img
                  ref={cropImageRef}
                  src={cropSourceUrl}
                  alt=""
                  style={{
                    ...cropMediaStyle,
                    ...adjustmentFilterStyle({
                      brightness: manageBrightness,
                      contrast: manageContrast,
                      saturation: manageSaturation,
                    }),
                    width: `${(cropSourceSize.width / cropCanvasDimensions.width) * 100}%`,
                    height: `${(cropSourceSize.height / cropCanvasDimensions.height) * 100}%`,
                    transform: `translate(-50%, -50%) rotate(${effectiveRotationDegrees()}deg)`,
                  }}
                  draggable={false}
                  onLoad={() => {
                    const image = cropImageRef.current;
                    if (!image?.naturalWidth || !image.naturalHeight) return;
                    setCropSourceDimensions({
                      width: image.naturalWidth,
                      height: image.naturalHeight,
                    });
                    setCropRect({
                      x: 0,
                      y: 0,
                      width: image.naturalWidth,
                      height: image.naturalHeight,
                    });
                  }}
                />
                <div
                  style={{
                    ...cropBoxStyle,
                    ...cropOverlayStyle(selectedAsset),
                  }}
                  onPointerDown={beginCropMove}
                >
                  {(
                    ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as CropHandle[]
                  ).map((handle) => (
                    <span
                      key={handle}
                      aria-hidden="true"
                      style={{
                        ...cropHandleStyle,
                        ...cropHandlePositionStyles[handle],
                      }}
                      onPointerDown={(event) => beginCropResize(handle, event)}
                    />
                  ))}
                </div>
              </div>
              <div style={rotationControlStyle}>
                <span>Rotate</span>
                <button
                  type="button"
                  aria-label="Rotate image left 90 degrees"
                  title="Rotate left 90 degrees"
                  onClick={() => changeRotationDegrees(-90)}
                  disabled={cropSaving}
                  style={secondaryButtonStyle}
                >
                  <span style={materialSymbolStyle} aria-hidden="true">
                    rotate_left
                  </span>
                  <span aria-hidden="true">90&deg;</span>
                </button>
                <button
                  type="button"
                  aria-label="Rotate image right 90 degrees"
                  title="Rotate right 90 degrees"
                  onClick={() => changeRotationDegrees(90)}
                  disabled={cropSaving}
                  style={secondaryButtonStyle}
                >
                  <span style={materialSymbolStyle} aria-hidden="true">
                    rotate_right
                  </span>
                  <span aria-hidden="true">90&deg;</span>
                </button>
                <span style={rotationValueStyle}>
                  {rotationDegrees === 270 ? -90 : rotationDegrees}&deg;
                </span>
              </div>
              <label style={adjustmentLabelStyle}>
                <span>
                  Straighten {straightenDegrees.toFixed(1)}&deg;
                </span>
                <input
                  type="range"
                  min={-45}
                  max={45}
                  step={0.1}
                  value={straightenDegrees}
                  disabled={cropSaving}
                  onChange={(event) =>
                    changeStraightenDegrees(Number(event.target.value))
                  }
                  style={rangeInputStyle}
                />
              </label>
              <div style={cropHintStyle}>
                Use the rotation buttons for right-angle changes, then use
                straighten for fine adjustments. Drag over the preview to
                choose a crop.
              </div>
            </div>
          ) : (
            <img
              src={displayPreviewUrl}
              alt=""
              style={{
                ...manageMediaStyle,
                ...adjustmentFilterStyle({
                  brightness: manageBrightness,
                  contrast: manageContrast,
                  saturation: manageSaturation,
                }),
              }}
            />
          )}
        </div>
        <div style={manageDetailsStyle}>
          <div style={manageHeaderStyle}>
            <h2 style={assetHeadingStyle}>{selectedAsset.fileName}</h2>
            <div style={detailHeaderActionsStyle}>
              {selectedAsset.type === "IMAGE" && (
                <>
                  <button
                    type="button"
                    onClick={() => previousImage && openAssetManager(previousImage)}
                    disabled={!previousImage || assetNavigationBusy}
                    aria-label="Edit previous image"
                    title="Previous image"
                    style={{
                      ...assetNavigationButtonStyle,
                      ...(!previousImage || assetNavigationBusy
                        ? assetNavigationButtonDisabledStyle
                        : {}),
                    }}
                  >
                    <span style={assetNavigationIconStyle} aria-hidden="true">
                      arrow_back
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => nextImage && openAssetManager(nextImage)}
                    disabled={!nextImage || assetNavigationBusy}
                    aria-label="Edit next image"
                    title="Next image"
                    style={{
                      ...assetNavigationButtonStyle,
                      ...(!nextImage || assetNavigationBusy
                        ? assetNavigationButtonDisabledStyle
                        : {}),
                    }}
                  >
                    <span style={assetNavigationIconStyle} aria-hidden="true">
                      arrow_forward
                    </span>
                  </button>
                </>
              )}
              {assignedPlacement && (
                <a
                  href={placementViewerUrl(assignedPlacement)}
                  target="_blank"
                  rel="noreferrer"
                  style={siteActionLinkStyle}
                >
                  <span style={siteActionIconStyle} aria-hidden="true">
                    open_in_new
                  </span>
                  View
                </a>
              )}
              {selectedAsset.driveFileId && (
                <a
                  href={`https://drive.google.com/open?id=${encodeURIComponent(selectedAsset.driveFileId)}`}
                  target="_blank"
                  rel="noreferrer"
                  style={siteActionLinkStyle}
                >
                  <span style={siteActionIconStyle} aria-hidden="true">
                    add_to_drive
                  </span>
                  View in Drive
                </a>
              )}
              {authUser?.authenticated && (
                <button
                  type="button"
                  onClick={
                    selectedAsset.driveFileId
                      ? () => void reimportSelectedAssetFromDrive()
                      : lookupSelectedAssetDriveSource
                  }
                  disabled={
                    Boolean(driveAssetAction) ||
                    savingAsset ||
                    deletingAsset ||
                    cropSaving ||
                    adjustmentsSaving ||
                    captionSaving
                  }
                  style={siteActionButtonStyle}
                >
                  <span style={siteActionIconStyle} aria-hidden="true">
                    {selectedAsset.driveFileId ? "sync" : "manage_search"}
                  </span>
                  {driveAssetAction === "lookup"
                    ? "Looking up..."
                    : driveAssetAction === "reimport"
                      ? "Reimporting..."
                      : selectedAsset.driveFileId
                        ? "Reimport"
                        : "Lookup Drive"}
                </button>
              )}
              {authUser?.authenticated &&
                selectedAsset.driveFileId &&
                selectedAsset.mediaKind === "video" && (
                  <button
                    type="button"
                    onClick={() => void reimportSelectedAssetFromDrive(true)}
                    disabled={
                      Boolean(driveAssetAction) ||
                      savingAsset ||
                      deletingAsset ||
                      cropSaving ||
                      adjustmentsSaving ||
                      captionSaving
                    }
                    title="Discard the video picture and replace it with the standard audio artwork"
                    style={siteActionButtonStyle}
                  >
                    <span style={siteActionIconStyle} aria-hidden="true">
                      audio_file
                    </span>
                    {driveAssetAction === "reimport-audio"
                      ? "Converting to audio..."
                      : "Reimport as audio"}
                  </button>
                )}
            </div>
          </div>

          <label style={labelStyle}>
            Artasia Site
            <select
              value={managePlacementKey}
              onChange={(e) => {
                const placementKey = e.target.value;
                setManagePlacementKey(placementKey);
                if (placementKey === manageDisplayPlacementKey) {
                  setManageDisplayPlacementKey("");
                }
              }}
              style={inputStyle}
            >
              <option value="">Select a placement</option>
              {groupedPlacementsByPartner(options?.placements ?? []).map(
                (group) => (
                  <optgroup key={group.partner} label={group.partner}>
                    {group.placements.map((placement) => (
                      <option
                        key={placement.placement_id}
                        value={String(placement.placement_id)}
                      >
                        {placementLabel(placement)}
                      </option>
                    ))}
                  </optgroup>
                ),
              )}
            </select>
          </label>
          <label style={labelStyle}>
            Shared with
            <select
              value={manageDisplayPlacementKey}
              onChange={(e) => setManageDisplayPlacementKey(e.target.value)}
              style={inputStyle}
            >
              <option value="">Not shared</option>
              {groupedPlacementsByPartner(options?.placements ?? []).map(
                (group) => (
                  <optgroup key={group.partner} label={group.partner}>
                    {group.placements
                      .filter(
                        (placement) =>
                          String(placement.placement_id) !== managePlacementKey,
                      )
                      .map((placement) => (
                        <option
                          key={placement.placement_id}
                          value={String(placement.placement_id)}
                        >
                          {placementLabel(placement)}
                        </option>
                      ))}
                  </optgroup>
                ),
              )}
            </select>
            <span style={fieldHelpStyle}>
              Shows this asset at one additional placement while keeping the
              Artasia Site above as its primary placement.
            </span>
          </label>
          <label style={labelStyle}>
            Program Week / Activity
            <select
              value={manageActivityTag}
              onChange={(e) => setManageActivityTag(e.target.value)}
              style={inputStyle}
            >
              <option value="">No activity tag</option>
              <option value={CUSTOM_ACTIVITY_OPTION}>Custom Activity</option>
              {(options?.activities ?? []).map((activity) => (
                <option key={activity.id} value={String(activity.id)}>
                  {activity.label}
                </option>
              ))}
            </select>
          </label>
          {manageActivityTag === CUSTOM_ACTIVITY_OPTION && (
            <label style={labelStyle}>
              Custom Activity
              <input
                type="text"
                value={manageCustomActivity}
                onChange={(event) => setManageCustomActivity(event.target.value)}
                placeholder="e.g. One-off texture exploration"
                maxLength={120}
                disabled={savingAsset}
                style={inputStyle}
              />
              <span style={fieldHelpStyle}>
                Assets with the same custom activity name will share an orbit in
                the Atlas viewer.
              </span>
            </label>
          )}
          {selectedAsset.mediaKind === "audio" && (
            <div style={labelStyle}>
              <span>Asset Icon</span>
              <MaterialIconPicker
                value={manageIconName}
                onChange={setManageIconName}
                disabled={!authUser?.authenticated || savingAsset}
              />
              <span style={fieldHelpStyle}>
                Stored in Immich as an <code>icon:name</code> tag and used by
                the Atlas viewer for sound assets.
              </span>
            </div>
          )}
          {selectedAsset.type === "IMAGE" && (
            <label style={labelStyle}>
              Linked Sound
              <select
                value={manageLinkedAudioAssetId}
                onChange={(event) =>
                  setManageLinkedAudioAssetId(event.target.value)
                }
                disabled={
                  !authUser?.authenticated ||
                  savingAsset ||
                  linkedAudioLoading
                }
                style={inputStyle}
              >
                <option value="">
                  {linkedAudioLoading
                    ? "Loading available sounds..."
                    : "No linked sound"}
                </option>
                {linkedAudioOptions.map((asset) => (
                  <option key={asset.id} value={asset.id}>
                    {asset.fileName}
                  </option>
                ))}
              </select>
              {manageLinkedAudioAssetId && (
                <div style={linkedAudioPreviewStyle}>
                  <audio
                    ref={linkedAudioPreviewRef}
                    src={`/api/v1/assets/${manageLinkedAudioAssetId}/original`}
                    preload="metadata"
                    onEnded={() => setLinkedAudioPreviewPlaying(false)}
                    onPause={() => setLinkedAudioPreviewPlaying(false)}
                    onPlay={() => setLinkedAudioPreviewPlaying(true)}
                  />
                  <button
                    type="button"
                    onClick={toggleLinkedAudioPreview}
                    disabled={savingAsset}
                    style={linkedAudioPreviewButtonStyle}
                    aria-label={
                      linkedAudioPreviewPlaying
                        ? "Pause linked sound"
                        : "Play linked sound"
                    }
                  >
                    <span aria-hidden="true">
                      {linkedAudioPreviewPlaying ? "Ⅱ" : "▶"}
                    </span>
                    {linkedAudioPreviewPlaying ? "Pause sound" : "Play sound"}
                  </button>
                </div>
              )}
              <span style={fieldHelpStyle}>
                Sounds from this image&apos;s Artasia site and the global sound
                library (site {GLOBAL_AUDIO_PLACEMENT_ID}).
              </span>
            </label>
          )}
          <label style={labelStyle}>
            Caption / Description
            <textarea
              value={manageCaption}
              onChange={(e) => {
                setManageCaption(e.target.value);
                setCaptionSaveStatus("idle");
                setCaptionSaveError(null);
              }}
              disabled={!authUser?.authenticated || captionSaving}
              placeholder="Optional caption"
              rows={4}
              style={captionTextareaStyle}
            />
          </label>
          {selectedAsset.mediaKind === "image" && (
            <div style={locationPanelStyle}>
              <div style={coordinateFieldsStyle}>
                <label style={labelStyle}>
                  Latitude
                  <input
                    type="number"
                    min={-90}
                    max={90}
                    step="any"
                    value={manageLatitude}
                    onChange={(event) => setManageLatitude(event.target.value)}
                    disabled={!authUser?.authenticated || savingAsset}
                    placeholder="e.g. 43.2557"
                    style={inputStyle}
                  />
                </label>
                <label style={labelStyle}>
                  Longitude
                  <input
                    type="number"
                    min={-180}
                    max={180}
                    step="any"
                    value={manageLongitude}
                    onChange={(event) => setManageLongitude(event.target.value)}
                    disabled={!authUser?.authenticated || savingAsset}
                    placeholder="e.g. -79.8711"
                    style={inputStyle}
                  />
                </label>
              </div>
            </div>
          )}
          {authUser?.authenticated && selectedAsset.type === "IMAGE" && (
            <div style={adjustmentPanelStyle}>
              <label style={adjustmentLabelStyle}>
                <span style={adjustmentLabelRowStyle}>
                  <span>Brightness {manageBrightness}%</span>
                  <button
                    type="button"
                    aria-label="Reset brightness"
                    title="Reset brightness"
                    onClick={() =>
                      setManageBrightness(DEFAULT_ADJUSTMENTS.brightness)
                    }
                    disabled={adjustmentsLoading || savingAsset}
                    style={adjustmentResetButtonStyle}
                  >
                    reset_brightness
                  </button>
                </span>
                <input
                  type="range"
                  min={MIN_ADJUSTMENT}
                  max={MAX_ADJUSTMENT}
                  step={1}
                  value={manageBrightness}
                  disabled={adjustmentsLoading || adjustmentsSaving}
                  onChange={(e) =>
                    setManageBrightness(clampAdjustment(Number(e.target.value)))
                  }
                  style={rangeInputStyle}
                />
              </label>
              <label style={adjustmentLabelStyle}>
                <span style={adjustmentLabelRowStyle}>
                  <span>Contrast {manageContrast}%</span>
                  <button
                    type="button"
                    aria-label="Reset contrast"
                    title="Reset contrast"
                    onClick={() =>
                      setManageContrast(DEFAULT_ADJUSTMENTS.contrast)
                    }
                    disabled={adjustmentsLoading || savingAsset}
                    style={adjustmentResetButtonStyle}
                  >
                    reset_exposure
                  </button>
                </span>
                <input
                  type="range"
                  min={MIN_ADJUSTMENT}
                  max={MAX_ADJUSTMENT}
                  step={1}
                  value={manageContrast}
                  disabled={adjustmentsLoading || adjustmentsSaving}
                  onChange={(e) =>
                    setManageContrast(clampAdjustment(Number(e.target.value)))
                  }
                  style={rangeInputStyle}
                />
              </label>
              <label style={adjustmentLabelStyle}>
                <span style={adjustmentLabelRowStyle}>
                  <span>Saturation {manageSaturation}%</span>
                  <button
                    type="button"
                    aria-label="Reset saturation"
                    title="Reset saturation"
                    onClick={() =>
                      setManageSaturation(DEFAULT_ADJUSTMENTS.saturation)
                    }
                    disabled={adjustmentsLoading || savingAsset}
                    style={adjustmentResetButtonStyle}
                  >
                    reset_colors
                  </button>
                </span>
                <input
                  type="range"
                  min={MIN_ADJUSTMENT}
                  max={MAX_ADJUSTMENT}
                  step={1}
                  value={manageSaturation}
                  disabled={adjustmentsLoading || adjustmentsSaving}
                  onChange={(e) =>
                    setManageSaturation(clampAdjustment(Number(e.target.value)))
                  }
                  style={rangeInputStyle}
                />
              </label>
            </div>
          )}
          <label
            style={{
              ...checkboxLabelStyle,
              ...(manageArchived ? { opacity: 0.55 } : {}),
            }}
          >
            <input
              type="checkbox"
              checked={managePublished}
              disabled={!authUser?.authenticated || manageArchived}
              onChange={(e) => setManagePublished(e.target.checked)}
            />
            Published
          </label>
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={manageArchived}
              disabled={!authUser?.authenticated}
              onChange={(e) => {
                const archived = e.target.checked;
                setManageArchived(archived);
                if (archived) setManagePublished(false);
              }}
            />
            Archived
          </label>
          {manageArchived && (
            <span style={fieldHelpStyle}>
              Archived assets cannot be published.
            </span>
          )}
          <div style={manageActionsStyle}>
            {savingAsset && (audioTrimStatus || videoRotationStatus) && (
              <div style={audioTrimStatusStyle}>
                <span>{audioTrimStatus ?? videoRotationStatus}</span>
              </div>
            )}
            <button
              type="button"
              onClick={saveAllAssetChanges}
              disabled={
                savingAsset ||
                deletingAsset ||
                cropSaving ||
                adjustmentsSaving ||
                captionSaving ||
                !hasAnyChanges
              }
              style={primaryActionButtonStyle}
            >
              {savingAsset
                ? audioTrimChanged
                  ? "Saving & Trimming Audio..."
                  : videoRotationChanged
                    ? "Saving & Rotating Video..."
                  : pixelEditsChanged
                  ? "Saving & Creating Edited Copy..."
                  : "Saving..."
                : "Save Changes"}
            </button>
            {authUser?.authenticated && selectedAsset.type === "IMAGE" && (
              <button
                type="button"
                onClick={resetCrop}
                disabled={
                  cropSaving ||
                  savingAsset ||
                  deletingAsset ||
                  adjustmentsSaving ||
                  captionSaving
                }
                style={secondaryButtonStyle}
              >
                Reset Edits
              </button>
            )}
            {authUser?.authenticated && (
              <button
                type="button"
                onClick={deleteSelectedAsset}
                disabled={
                  savingAsset ||
                  deletingAsset ||
                  cropSaving ||
                  adjustmentsSaving ||
                  captionSaving
                }
                style={dangerButtonStyle}
              >
                {deletingAsset ? "Deleting..." : "Delete"}
              </button>
            )}
            <button
              type="button"
              onClick={cancelAssetManager}
              disabled={
                deletingAsset ||
                cropSaving ||
                adjustmentsSaving ||
                captionSaving ||
                savingAsset
              }
              style={secondaryButtonStyle}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <main style={pageStyle}>
      <style>
        {`
          @keyframes atlas-loading-spin {
            to {
              transform: rotate(360deg);
            }
          }

          .atlas-drive-folder-stats::before {
            content: "·";
            color: #666;
            margin-right: 8px;
          }

          @media (max-width: 760px) {
            .atlas-drive-folder-label {
              align-items: flex-start !important;
              flex-direction: column !important;
              gap: 3px !important;
            }

            .atlas-drive-folder-stats::before {
              content: none;
            }

            .atlas-admin-layout {
              display: grid !important;
              grid-template-columns: 1fr !important;
              gap: 18px !important;
            }

            .atlas-admin-filters {
              max-height: none !important;
              overflow: visible !important;
              padding: 0 !important;
            }

            .atlas-admin-detail {
              min-height: 0 !important;
            }

            .atlas-manage-panel {
              grid-template-columns: 1fr !important;
              gap: 20px !important;
            }

            .atlas-site-grid {
              grid-template-columns: 1fr !important;
            }

            .atlas-workspace-tabs {
              overflow-x: auto !important;
              overflow-y: hidden !important;
              -webkit-overflow-scrolling: touch;
            }

            .atlas-browse-status-tabs {
              overflow-x: auto !important;
              overflow-y: hidden !important;
              -webkit-overflow-scrolling: touch;
            }
          }
        `}
      </style>
      <section style={panelStyle}>
        <div style={headerStyle}>
          <a
            href="/admin"
            aria-label="Atlas Admin home"
            style={headerBrandStyle}
          >
            <img src="/artasia-atlas.svg" alt="Artasia Atlas" style={logoStyle} />
            <div>
              <h1 style={titleStyle}>Admin</h1>
            </div>
          </a>
          <div ref={menuRef} style={navMenuWrapStyle}>
            <button
              type="button"
              aria-label="Open navigation menu"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              onClick={() => setMenuOpen((current) => !current)}
              style={navMenuButtonStyle}
            >
              <span style={navMenuIconStyle}>
                <span style={navMenuLineStyle} />
                <span style={navMenuLineStyle} />
                <span style={navMenuLineStyle} />
              </span>
            </button>

            {menuOpen && (
              <div role="menu" style={navMenuPanelStyle}>
                {menuItems.map((item) => (
                  <a
                    key={item.href}
                    role="menuitem"
                    href={item.href}
                    style={navMenuItemStyle}
                    onClick={() => setMenuOpen(false)}
                  >
                    {item.label}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={authBarStyle}>
          {authUser?.authenticated ? (
            <>
              <span>
                Hello,{" "}
                {authUser.uploader_name ??
                  authUser.uploader?.name ??
                  authUser.name ??
                  "Artasia user"}
                {authUser.email ? ` (${authUser.email})` : ""}
              </span>
              <div style={authActionGroupStyle}>
                {showMySitesButton && (
                  <button
                    type="button"
                    onClick={selectMySites}
                    style={secondaryButtonStyle}
                  >
                    My Sites
                  </button>
                )}
                <button
                  type="button"
                  onClick={signOut}
                  style={secondaryButtonStyle}
                >
                  Sign out
                </button>
              </div>
            </>
          ) : (
            <>
              <span>
                Sign in with Google to preselect your Artasia Team Member.
              </span>
              <a
                href="/api/v1/auth/google/start"
                style={primaryLinkButtonStyle}
              >
                Sign in with Google
              </a>
            </>
          )}
        </div>

        {notice && (
          <div
            style={
              notice.tone === "success"
                ? successNoticeStyle
                : warningNoticeStyle
            }
          >
            {notice.message}
          </div>
        )}
        {error && <div style={errorStyle}>{error}</div>}

        <div className="atlas-workspace-tabs" style={workspaceTabsStyle}>
          <button
            type="button"
            onClick={() => {
              setWorkspaceMode("sites");
              setSelectedAsset(null);
              setItems([]);
              setNotice(null);
              setApplicationPath("/admin", true);
            }}
            style={{
              ...workspaceTabStyle,
              ...(workspaceMode === "sites" ? workspaceTabActiveStyle : {}),
            }}
          >
            <span style={workspaceTabContentStyle}>
              <span style={materialSymbolStyle} aria-hidden="true">
                location_on
              </span>
              Sites
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setWorkspaceMode("browse");
              setSelectedAsset(null);
              setItems([]);
              setNotice(null);
              setApplicationPath("/admin/browse", true);
            }}
            style={{
              ...workspaceTabStyle,
              ...(workspaceMode === "browse" ? workspaceTabActiveStyle : {}),
            }}
          >
            <span style={workspaceTabContentStyle}>
              <span style={materialSymbolStyle} aria-hidden="true">
                browse
              </span>
              Browse
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setWorkspaceMode("edit");
              setSelectedAsset(null);
              setItems([]);
              setNotice(null);
              setApplicationPath("/admin", true);
            }}
            style={{
              ...workspaceTabStyle,
              ...(workspaceMode === "edit" ? workspaceTabActiveStyle : {}),
            }}
          >
            <span style={workspaceTabContentStyle}>
              <span style={materialSymbolStyle} aria-hidden="true">
                edit
              </span>
              Edit
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setWorkspaceMode("upload");
              setBrowsePartnerKey("");
              setSelectedAsset(null);
              setAssetMode("placements");
              setNotice(null);
              setApplicationPath("/admin/upload", true);
            }}
            style={{
              ...workspaceTabStyle,
              ...(workspaceMode === "upload" ? workspaceTabActiveStyle : {}),
            }}
          >
            <span style={workspaceTabContentStyle}>
              <span style={materialSymbolStyle} aria-hidden="true">
                upload
              </span>
              Upload
            </span>
          </button>
          <button
            type="button"
            onClick={() => {
              setBrowsePartnerKey("");
              setSelectedAsset(null);
              setAssetMode("placements");
              setSelectedDriveFiles(new Set());
              setApplicationPath("/admin/import", true);
            }}
            style={{
              ...workspaceTabStyle,
              ...(workspaceMode === "import" ? workspaceTabActiveStyle : {}),
            }}
          >
            <span style={workspaceTabContentStyle}>
              <span style={materialSymbolStyle} aria-hidden="true">
                add_to_drive
              </span>
              Import
            </span>
          </button>
        </div>

        <div
          className="atlas-admin-layout"
          style={
            workspaceMode === "edit"
              ? { ...adminLayoutStyle, gridTemplateColumns: "minmax(0, 1fr)" }
              : adminLayoutStyle
          }
        >
          {workspaceMode !== "edit" && (
            <aside className="atlas-admin-filters" style={placementMenuStyle}>
              {workspaceMode === "sites" && (
                <label style={labelStyle}>
                  <span style={filterLabelWithIconStyle}>
                    <span style={filterLabelIconStyle} aria-hidden="true">
                      sort
                    </span>
                    Sort by
                  </span>
                  <select
                    value={siteSort}
                    onChange={(event) =>
                      setSiteSort(event.target.value as SiteSort)
                    }
                    style={inputStyle}
                  >
                    <option value="alphabetical">Alphabetical</option>
                    <option value="published-assets">
                      Published asset count
                    </option>
                  </select>
                </label>
              )}

              {workspaceMode === "sites" && (
                <label style={labelStyle}>
                  Search
                  <input
                    type="search"
                    value={siteSearchFilter}
                    onChange={(event) =>
                      setSiteSearchFilter(event.target.value)
                    }
                    placeholder="Site, partner, or person"
                    style={inputStyle}
                  />
                  {siteSearchFilter && (
                    <ClearFilterButton
                      label="Clear site search"
                      onClick={() =>
                        clearSingleSiteFilter(() => setSiteSearchFilter(""))
                      }
                    />
                  )}
                </label>
              )}

              {workspaceMode === "browse" && (
                <label style={labelStyle}>
                  Artasia Site
                  <select
                    value={
                      assetMode === "untagged"
                        ? "untagged"
                        : selectedPlacement
                          ? String(selectedPlacement.placement_id)
                          : ""
                    }
                    onChange={(e) => {
                      const nextPlacementKey = e.target.value;
                      const nextParams = new URLSearchParams();
                      if (nextPlacementKey === "untagged") {
                        nextParams.set("site", "untagged");
                      } else if (nextPlacementKey) {
                        nextParams.set("site", nextPlacementKey);
                      }
                      if (activityTagFilter && nextPlacementKey !== "untagged") {
                        nextParams.set("activity", activityTagFilter);
                      }
                      if (nextPlacementKey === "untagged") {
                        setPlacementKey("");
                        setSiteScope("select");
                        setAssetMode("untagged");
                        setUploaderKey("");
                        setActivityTagFilter("");
                        setBrowseContextFilter("all");
                        setDeliveryDayFilter("");
                        setTimeOfDayFilter("");
                        setAgeRangeFilter("");
                        setBrowsePartnerKey("");
                      } else if (!nextPlacementKey) {
                        setPlacementKey("");
                        setSiteScope("all");
                        setAssetMode("placements");
                      } else {
                        setPlacementKey(nextPlacementKey);
                        setSiteScope("placement");
                        setAssetMode("placements");
                      }
                      const nextQuery = nextParams.toString();
                      setApplicationPath(
                        `/admin/browse${nextQuery ? `?${nextQuery}` : ""}`,
                        true,
                        false,
                      );
                      setSelectedAsset(null);
                      setItems([]);
                      setNotice(null);
                    }}
                    style={inputStyle}
                  >
                    <option value="">All Sites</option>
                    <option value="untagged">No Site (Untagged)</option>
                    {browsePlacementOptions.map((placement) => (
                      <option
                        key={placement.placement_id}
                        value={String(placement.placement_id)}
                      >
                        {placementLabel(placement)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {workspaceMode !== "upload" && workspaceMode !== "import" && (
                <label style={labelStyle}>
                  Team Member
                  <select
                    value={uploaderKey}
                    onChange={(e) => {
                      setUploaderKey(e.target.value);
                      setBrowsePartnerKey("");
                      setPlacementKey("");
                      setSiteScope("select");
                      setSelectedAsset(null);
                      setItems([]);
                      setNotice(null);
                      setError(null);
                    }}
                    style={inputStyle}
                  >
                    <option value="">All Team Members</option>
                    {browseUploaderOptions.map((option) => (
                      <option
                        key={option.uploader.id}
                        value={String(option.uploader.id)}
                      >
                        {option.uploader.name} ({option.count})
                      </option>
                    ))}
                  </select>
                  {uploaderKey && (
                    <ClearFilterButton
                      label="Clear team member filter"
                      onClick={() =>
                        clearSingleSiteFilter(() => setUploaderKey(""))
                      }
                    />
                  )}
                </label>
              )}

              {workspaceMode !== "sites" && (
                <>
                  <label style={labelStyle}>
                    {workspaceMode === "upload" || workspaceMode === "import"
                      ? "Program Week / Activity Tag"
                      : "Program Week / Activity"}
                    <select
                      value={activityTagFilter}
                      onChange={(e) => {
                        setActivityTagFilter(e.target.value);
                        setSelectedAsset(null);
                      }}
                      style={inputStyle}
                    >
                      <option value="">
                        {workspaceMode === "upload" ||
                        workspaceMode === "import"
                          ? "No activity tag"
                          : "All Activities"}
                      </option>
                      {(options?.activities ?? []).map((activity) => (
                        <option key={activity.id} value={String(activity.id)}>
                          {activity.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {(workspaceMode === "upload" || workspaceMode === "import") &&
                    !activityTagFilter && (
                      <div style={activityWarningStyle}>
                        <span
                          style={activityWarningIconStyle}
                          aria-hidden="true"
                        >
                          warning
                        </span>
                        Please add an activity tag first.
                      </div>
                    )}
                </>
              )}

              {workspaceMode !== "upload" && workspaceMode !== "import" && (
                <label style={labelStyle}>
                  Program Context
                  <select
                    value={browseContextFilter}
                    onChange={(e) => {
                      setBrowseContextFilter(
                        e.target.value as BrowseContextFilter,
                      );
                      setBrowsePartnerKey("");
                      setPlacementKey("");
                      setSiteScope("select");
                      setSelectedAsset(null);
                      setItems([]);
                    }}
                    style={inputStyle}
                  >
                    <option value="all">All Sites (EarlyON and Regular)</option>
                    <option value="earlyon">EarlyON Sites Only</option>
                    <option value="nonEarlyon">Regular Sites Only</option>
                  </select>
                  {browseContextFilter !== "all" && (
                    <ClearFilterButton
                      label="Clear program context filter"
                      onClick={() =>
                        clearSingleSiteFilter(() =>
                          setBrowseContextFilter("all"),
                        )
                      }
                    />
                  )}
                </label>
              )}

              {workspaceMode !== "upload" && workspaceMode !== "import" && (
                <label style={labelStyle}>
                  Artasia Partner
                  <select
                    value={browsePartnerKey}
                    onChange={(e) => {
                      setBrowsePartnerKey(e.target.value);
                      setPlacementKey("");
                      setSiteScope("select");
                      setSelectedAsset(null);
                      setItems([]);
                    }}
                    style={inputStyle}
                  >
                    <option value="">All Partners</option>
                    {browsePartnerOptions.map((option) => (
                      <option
                        key={option.partnerName}
                        value={option.partnerName}
                      >
                        {option.partnerName} ({option.count})
                      </option>
                    ))}
                  </select>
                  {browsePartnerKey && (
                    <ClearFilterButton
                      label="Clear Artasia partner filter"
                      onClick={() =>
                        clearSingleSiteFilter(() => setBrowsePartnerKey(""))
                      }
                    />
                  )}
                </label>
              )}

              {workspaceMode === "sites" && (
                <label style={labelStyle}>
                  Delivery Day
                  <select
                    value={deliveryDayFilter}
                    onChange={(e) => {
                      setDeliveryDayFilter(e.target.value as DeliveryDayFilter);
                      setPlacementKey("");
                      setSiteScope("select");
                      setSelectedAsset(null);
                      setItems([]);
                    }}
                    style={inputStyle}
                  >
                    {DELIVERY_DAY_OPTIONS.map((option) => (
                      <option key={option.value || "all"} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {deliveryDayFilter && (
                    <ClearFilterButton
                      label="Clear delivery day filter"
                      onClick={() =>
                        clearSingleSiteFilter(() => setDeliveryDayFilter(""))
                      }
                    />
                  )}
                </label>
              )}

              {workspaceMode === "sites" && (
                <label style={labelStyle}>
                  Time of Day
                  <select
                    value={timeOfDayFilter}
                    onChange={(e) => {
                      setTimeOfDayFilter(e.target.value);
                      setPlacementKey("");
                      setSiteScope("select");
                      setSelectedAsset(null);
                      setItems([]);
                    }}
                    style={inputStyle}
                  >
                    <option value="">All Times</option>
                    {timeOfDayOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {timeOfDayFilter && (
                    <ClearFilterButton
                      label="Clear time of day filter"
                      onClick={() =>
                        clearSingleSiteFilter(() => setTimeOfDayFilter(""))
                      }
                    />
                  )}
                </label>
              )}

              {workspaceMode === "sites" && (
                <label style={labelStyle}>
                  Age Range
                  <select
                    value={ageRangeFilter}
                    onChange={(e) => {
                      setAgeRangeFilter(e.target.value);
                      setPlacementKey("");
                      setSiteScope("select");
                      setSelectedAsset(null);
                      setItems([]);
                    }}
                    style={inputStyle}
                  >
                    <option value="">All Age Ranges</option>
                    {ageRangeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  {ageRangeFilter && (
                    <ClearFilterButton
                      label="Clear age range filter"
                      onClick={() =>
                        clearSingleSiteFilter(() => setAgeRangeFilter(""))
                      }
                    />
                  )}
                </label>
              )}

              {workspaceMode === "sites" && hasActiveSiteFilters && (
                <button
                  type="button"
                  onClick={clearSiteFilters}
                  style={clearFiltersButtonStyle}
                >
                  <span style={siteActionIconStyle} aria-hidden="true">
                    filter_alt_off
                  </span>
                  Clear Filters
                </button>
              )}

              {workspaceMode === "sites" && (
                <div style={sidebarSummaryStyle}>
                  {filteredPlacements.length} visible site
                  {filteredPlacements.length === 1 ? "" : "s"}
                </div>
              )}

            </aside>
          )}

          <section
            className="atlas-admin-detail"
            style={
              workspaceMode === "sites"
                ? sitesDetailStyle
                : workspaceMode === "edit"
                  ? editDetailStyle
                  : detailStyle
            }
          >
            {workspaceMode === "sites" ? (
              renderSiteSelection()
            ) : workspaceMode === "edit" ? (
              directAssetLoading ? (
                <div style={emptyStateStyle}>Loading upload...</div>
              ) : selectedAsset ? (
                renderAssetManager()
              ) : (
                renderChooseAssetToEditPrompt()
              )
            ) : workspaceMode === "upload" ? (
              selectedPlacement ? (
                <>
                  <div style={detailHeaderStyle}>
                    <div>
                      {renderSiteBreadcrumb(placementLabel(selectedPlacement))}
                      <div style={detailMetaStyle}>
                        {activityTagFilter
                          ? `Activity: ${options?.activities.find((activity) => String(activity.id) === activityTagFilter)?.label ?? "Selected activity"}`
                          : "No activity tag"}
                      </div>
                    </div>
                  </div>

                  <div
                    style={dropzoneStyle}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      addFiles(e.dataTransfer.files);
                    }}
                    onClick={() => {
                      inputRef.current?.click();
                    }}
                  >
                    Drop images or videos here
                    <span style={{ color: "#777", marginTop: 6 }}>
                      or click to choose files
                    </span>
                    <input
                      ref={inputRef}
                      type="file"
                      multiple
                      accept={UPLOAD_ACCEPT_TYPES}
                      style={{ display: "none" }}
                      onChange={(e) => {
                        if (e.target.files) addFiles(e.target.files);
                        e.target.value = "";
                      }}
                    />
                  </div>

                  {renderUploadItems()}
                </>
              ) : (
                renderChooseSitePrompt("upload")
              )
            ) : workspaceMode === "import" ? (
              selectedPlacement ? (
                <>
                  <div style={detailHeaderStyle}>
                    <div>
                      {renderSiteBreadcrumb(placementLabel(selectedPlacement))}
                      <div style={detailMetaStyle}>
                        {activityTagFilter
                          ? `Activity: ${options?.activities.find((activity) => String(activity.id) === activityTagFilter)?.label ?? "Selected activity"}`
                          : "No activity tag"}
                      </div>
                    </div>
                  </div>

                  {renderDriveBrowser()}
                  {renderUploadItems()}
                </>
              ) : (
                renderChooseSitePrompt("import")
              )
            ) : selectedPlacement ? (
              <>
                <div style={detailHeaderStyle}>
                  <div>
                    {renderSiteBreadcrumb(
                      placementLabel(selectedPlacement),
                      browseBreadcrumbParents,
                    )}
                    <div style={detailMetaStyle}>
                      Lead: {selectedPlacement.team_member_name ?? "Unassigned"}
                      {selectedPlacement.secondary_team_member_name
                        ? ` | Secondary: ${selectedPlacement.secondary_team_member_name}`
                        : ""}
                    </div>
                    {selectedPlacement.delivery_schedule && (
                      <div style={detailMetaStyle}>
                        {selectedPlacement.delivery_schedule}
                      </div>
                    )}
                  </div>
                  <div style={detailHeaderActionsStyle}>
                    <a
                      href={placementViewerUrl(selectedPlacement)}
                      target="_blank"
                      rel="noreferrer"
                      style={siteActionLinkStyle}
                    >
                      <span style={siteActionIconStyle} aria-hidden="true">
                        open_in_new
                      </span>
                      View
                    </a>
                    <div style={countBadgeStyle}>
                      {assetsLoading ? "..." : placementAssets.length} upload
                      {placementAssets.length === 1 ? "" : "s"}
                    </div>
                    {renderDriveMaintenanceButton()}
                    <button
                      type="button"
                      onClick={refreshVisibleAssets}
                      style={secondaryButtonStyle}
                    >
                      Refresh
                    </button>
                  </div>
                </div>

                {renderAssetGrid("No uploads tagged to this placement yet.")}
              </>
            ) : (
              <>
                <div style={detailHeaderStyle}>
                  {assetMode === "placements" ? (
                    renderSiteBreadcrumb("All Sites", browseBreadcrumbParents)
                  ) : (
                    <h2 style={detailTitleStyle}>No Site (Untagged)</h2>
                  )}
                  <div style={detailHeaderActionsStyle}>
                    <div style={countBadgeStyle}>
                      {assetsLoading ? "..." : placementAssets.length} upload
                      {placementAssets.length === 1 ? "" : "s"}
                    </div>
                    {renderDriveMaintenanceButton()}
                    <button
                      type="button"
                      onClick={refreshVisibleAssets}
                      style={secondaryButtonStyle}
                    >
                      Refresh
                    </button>
                  </div>
                </div>
                {renderAssetGrid(
                  assetMode === "untagged"
                    ? "No uploads need placement right now."
                    : "No uploads tagged to the visible placements yet.",
                )}
              </>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" style={completedCheckStyle}>
      <path
        d="M3.25 8.25 6.5 11.5l6.25-7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0b0d12",
  color: "#ddd",
  padding: "22px 24px 28px",
  boxSizing: "border-box",
};

const panelStyle: React.CSSProperties = {
  width: "100%",
  margin: "0 auto",
  minHeight: "calc(100vh - 50px)",
  background: "transparent",
  border: "none",
  borderRadius: 0,
  padding: 0,
  boxSizing: "border-box",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 16,
  marginBottom: 18,
};

const headerBrandStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 14,
  color: "inherit",
  textDecoration: "none",
};

const logoStyle: React.CSSProperties = {
  height: 40,
  width: "auto",
  flexShrink: 0,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 600,
};

const navMenuWrapStyle: React.CSSProperties = {
  flex: "0 0 auto",
  position: "relative",
};

const navMenuButtonStyle: React.CSSProperties = {
  width: 40,
  height: 40,
  display: "grid",
  placeItems: "center",
  background: "rgba(255,255,255,0.08)",
  color: "#ddd",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 4,
  cursor: "pointer",
};

const navMenuIconStyle: React.CSSProperties = {
  display: "grid",
  gap: 3,
  width: 16,
};

const navMenuLineStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  height: 2,
  borderRadius: 999,
  background: "currentColor",
};

const navMenuPanelStyle: React.CSSProperties = {
  position: "absolute",
  top: 48,
  right: 0,
  minWidth: 152,
  padding: 8,
  borderRadius: 4,
  background: "rgba(12, 14, 22, 0.96)",
  border: "1px solid rgba(255,255,255,0.14)",
  boxShadow: "0 18px 40px rgba(0,0,0,0.35)",
  display: "grid",
  gap: 6,
  zIndex: 20,
};

const navMenuItemStyle: React.CSSProperties = {
  display: "block",
  padding: "10px 12px",
  borderRadius: 4,
  textDecoration: "none",
  color: "#eef3fb",
  fontSize: 13,
  background: "rgba(255,255,255,0.03)",
};

const introStyle: React.CSSProperties = {
  margin: "6px 0 0",
  color: "#b9bfcc",
  fontSize: 14,
  lineHeight: 1.45,
};

const authBarStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
  color: "#b9bfcc",
  background: "#171a22",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 4,
  padding: "9px 10px",
  marginBottom: 12,
  fontSize: 13,
  flexWrap: "wrap",
};

const authActionGroupStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const primaryLinkButtonStyle: React.CSSProperties = {
  color: "#0b0d12",
  background: "#e8edf8",
  border: "1px solid rgba(255,255,255,0.3)",
  borderRadius: 4,
  padding: "7px 10px",
  textDecoration: "none",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const secondaryButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#ddd",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: 4,
  padding: "7px 10px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const secondaryLinkButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  display: "inline-flex",
  alignItems: "center",
  textDecoration: "none",
  color: "#ddd",
};

const dangerButtonStyle: React.CSSProperties = {
  background: "rgba(255, 90, 90, 0.12)",
  color: "#ffb0b0",
  border: "1px solid rgba(255, 90, 90, 0.38)",
  borderRadius: 4,
  padding: "7px 10px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const primaryActionButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 8,
  color: "#0b0d12",
  background: "#e8edf8",
  border: "1px solid rgba(255,255,255,0.3)",
  borderRadius: 4,
  padding: "7px 10px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};

const adminLayoutStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(260px, 340px) 1fr",
  gap: 16,
  alignItems: "start",
  minHeight: 0,
};

const placementMenuStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
  minWidth: 0,
  padding: "1rem",
  boxSizing: "border-box",
};

const sidebarSummaryStyle: React.CSSProperties = {
  color: "#8f98a8",
  fontSize: 12,
  lineHeight: 1.35,
};

const siteSelectionPanelStyle: React.CSSProperties = {
  display: "grid",
  gap: 14,
};

const siteChoiceGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))",
  gap: 10,
};

const siteChoiceCardStyle: React.CSSProperties = {
  display: "grid",
  alignContent: "space-between",
  gap: 14,
  textAlign: "left",
  background: "#171a22",
  color: "#ddd",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: 10,
  minHeight: 96,
};

const siteCardContentStyle: React.CSSProperties = {
  display: "grid",
  gap: 7,
  minWidth: 0,
};

const siteStatsStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  marginTop: 5,
  paddingTop: 9,
  borderTop: "1px solid rgba(255,255,255,0.1)",
};

const siteStatsTotalStyle: React.CSSProperties = {
  color: "#d8e7ff",
  fontSize: 12,
  fontWeight: 600,
};

const siteStatsListStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  margin: 0,
  padding: 0,
  listStyle: "none",
};

const siteStatsItemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  justifyContent: "space-between",
  gap: 10,
  color: "#bfc7d5",
  fontSize: 11,
  lineHeight: 1.35,
};

const siteStatsCountStyle: React.CSSProperties = {
  flex: "0 0 auto",
  color: "#8fc85c",
  textAlign: "right",
};

const siteStatsEmptyStyle: React.CSSProperties = {
  color: "#7f8898",
  fontSize: 11,
  lineHeight: 1.35,
};

const siteStatsLoadingStyle: React.CSSProperties = {
  ...siteStatsEmptyStyle,
  marginTop: 5,
};

const siteLogoRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  marginBottom: 4,
};

const sitePartnerLogoStyle: React.CSSProperties = {
  maxWidth: 200,
  maxHeight: 64,
  objectFit: "contain",
  objectPosition: "left center",
};

const siteEarlyOnLogoStyle: React.CSSProperties = {
  maxWidth: 104,
  maxHeight: 42,
  objectFit: "contain",
  objectPosition: "left center",
};

const siteActionRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  flexWrap: "wrap",
  marginTop: 10,
};

const siteActionButtonStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 5,
  minWidth: 72,
  minHeight: 32,
  background: "transparent",
  color: "#ddd",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: 4,
  padding: "5px 8px",
  cursor: "pointer",
  font: "inherit",
  fontSize: 13,
  lineHeight: 1.2,
  whiteSpace: "nowrap",
  textAlign: "center",
  boxSizing: "border-box",
  appearance: "none",
};

const siteActionLinkStyle: React.CSSProperties = {
  ...siteActionButtonStyle,
  textDecoration: "none",
};

const assetNavigationButtonStyle: React.CSSProperties = {
  ...siteActionButtonStyle,
  flex: "0 0 32px",
  width: 32,
  minWidth: 32,
  padding: 0,
};

const assetNavigationIconStyle: React.CSSProperties = {
  fontFamily: "'Material Symbols Outlined'",
  fontSize: 20,
  fontWeight: 400,
  lineHeight: 1,
  fontStyle: "normal",
  fontVariationSettings: "'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 20",
};

const assetNavigationButtonDisabledStyle: React.CSSProperties = {
  opacity: 0.35,
  cursor: "default",
};

const clearFiltersButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  width: "100%",
  boxSizing: "border-box",
};

const clearSingleFilterButtonStyle: React.CSSProperties = {
  position: "absolute",
  right: 5,
  bottom: 5,
  display: "grid",
  placeItems: "center",
  width: 28,
  height: 28,
  padding: 0,
  border: 0,
  borderRadius: 3,
  background: "#2a2e39",
  color: "#bfc7d5",
  cursor: "pointer",
  zIndex: 1,
};

const clearSingleFilterIconStyle: React.CSSProperties = {
  fontFamily: "'Material Symbols Outlined'",
  fontSize: 17,
  fontWeight: 400,
  lineHeight: 1,
  fontStyle: "normal",
  fontVariationSettings: "'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 20",
};

const siteActionIconStyle: React.CSSProperties = {
  fontFamily: "'Material Symbols Outlined'",
  fontSize: 16,
  fontWeight: 400,
  lineHeight: 1,
  fontStyle: "normal",
  fontVariationSettings: "'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24",
};

const promptActionStyle: React.CSSProperties = {
  marginTop: 12,
};

const placementNameStyle: React.CSSProperties = {
  display: "block",
  color: "#f2f2f2",
  fontSize: 13,
  lineHeight: 1.35,
};

const placementMetaGroupStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
};

const placementMetaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  color: "#8f98a8",
  fontSize: 12,
  lineHeight: 1.3,
};

const placementMetaLinkStyle: React.CSSProperties = {
  ...placementMetaStyle,
  textDecoration: "none",
  whiteSpace: "pre-line",
};

const placementLocationLinkStyle: React.CSSProperties = {
  ...placementMetaLinkStyle,
  borderTop: "1px solid rgba(255,255,255,0.08)",
  paddingTop: 8,
  marginTop: 4,
};

const placementMetaIconStyle: React.CSSProperties = {
  fontFamily: "'Material Symbols Outlined'",
  fontSize: 15,
  fontWeight: 400,
  lineHeight: 1,
  fontStyle: "normal",
  fontVariationSettings: "'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 20",
};

const detailStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: "calc(100vh - 154px)",
  background: "#0f1118",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
  padding: 14,
  overflow: "visible",
};

const editDetailStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: "calc(100vh - 154px)",
  padding: "8px 0 24px",
};

const sitesDetailStyle: React.CSSProperties = {
  minWidth: 0,
  minHeight: "calc(100vh - 154px)",
};

const detailHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 14,
  alignItems: "flex-start",
  marginBottom: 14,
};

const detailTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#f2f2f2",
  fontSize: 18,
  lineHeight: 1.3,
};

const breadcrumbStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const breadcrumbButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "none",
  padding: 0,
  color: "#d8e7ff",
  cursor: "pointer",
  font: "inherit",
  fontSize: 18,
  fontWeight: 600,
  lineHeight: 1.3,
};

const breadcrumbSeparatorStyle: React.CSSProperties = {
  color: "#697181",
  fontSize: 18,
  lineHeight: 1.3,
};

const breadcrumbSegmentStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
};

const breadcrumbParentStyle: React.CSSProperties = {
  color: "#d8e7ff",
  fontSize: 18,
  fontWeight: 600,
  lineHeight: 1.3,
};

const breadcrumbCurrentStyle: React.CSSProperties = {
  color: "#f2f2f2",
  fontSize: 18,
  fontWeight: 600,
  lineHeight: 1.3,
};

const detailMetaStyle: React.CSSProperties = {
  color: "#9aa3b3",
  fontSize: 12,
  marginTop: 5,
};

const detailHeaderActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
  flexWrap: "wrap",
};

const countBadgeStyle: React.CSSProperties = {
  color: "#0b0d12",
  background: "#e8edf8",
  borderRadius: 4,
  padding: "6px 8px",
  fontSize: 12,
  whiteSpace: "nowrap",
};

const uploadControlsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(180px, 260px) 1fr",
  gap: 12,
  alignItems: "end",
};

const fieldGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns:
    "minmax(150px, 0.85fr) minmax(260px, 1.4fr) minmax(150px, 0.85fr)",
  gap: 12,
  alignItems: "end",
};

const labelStyle: React.CSSProperties = {
  position: "relative",
  display: "grid",
  gap: 6,
  fontSize: 13,
  color: "#aaa",
  minWidth: 0,
};

const filterLabelWithIconStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
};

const filterLabelIconStyle: React.CSSProperties = {
  fontFamily: "'Material Symbols Outlined'",
  fontSize: 18,
  fontWeight: 400,
  lineHeight: 1,
  fontStyle: "normal",
  fontVariationSettings: "'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 20",
};

const fieldHelpStyle: React.CSSProperties = {
  color: "#8490a3",
  fontSize: 11,
  lineHeight: 1.35,
};

const activityWarningStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  color: "#f4c95d",
  fontSize: 12,
  lineHeight: 1.35,
};

const activityWarningIconStyle: React.CSSProperties = {
  fontFamily: "'Material Symbols Outlined'",
  fontSize: 17,
  fontWeight: 400,
  lineHeight: 1,
  fontStyle: "normal",
  fontVariationSettings: "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 20",
};

const checkboxLabelStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  color: "#d8e7ff",
  fontSize: 13,
};

const compactLabelStyle: React.CSSProperties = {
  ...labelStyle,
};

const siteLabelStyle: React.CSSProperties = {
  ...labelStyle,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
  background: "#191c25",
  color: "#f2f2f2",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 4,
  padding: "9px 10px",
};

const dropzoneStyle: React.CSSProperties = {
  minHeight: 94,
  border: "1px dashed rgba(255,255,255,0.35)",
  borderRadius: 6,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  color: "#ccc",
  cursor: "pointer",
};

const listStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  marginTop: 14,
};

const uploadPublishAllStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  padding: "10px 12px",
  color: "#dce7ff",
  background: "rgba(85, 126, 214, 0.12)",
  border: "1px solid rgba(117, 151, 224, 0.35)",
  borderRadius: 6,
};

const assetGridHeaderStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  marginTop: 18,
  marginBottom: 10,
};

const sectionTitleStyle: React.CSSProperties = {
  margin: 0,
  color: "#f2f2f2",
  fontSize: 15,
};

const managePanelStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(340px, 46%) minmax(0, 1fr)",
  gap: 28,
  alignItems: "start",
};

const managePreviewStyle: React.CSSProperties = {
  minWidth: 0,
};

const manageMediaStyle: React.CSSProperties = {
  width: "100%",
  maxHeight: 560,
  objectFit: "contain",
  borderRadius: 4,
  background: "#0c0e13",
};

const videoRotationEditorStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const videoRotationPreviewStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  maxWidth: "100%",
  maxHeight: 560,
  overflow: "hidden",
  background: "#0c0e13",
  borderRadius: 4,
};

const rotatedVideoPreviewStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  objectFit: "contain",
  transformOrigin: "center",
};

const cropStageStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  maxWidth: "100%",
  maxHeight: 560,
  display: "block",
  background: "#0c0e13",
  borderRadius: 4,
  overflow: "hidden",
  touchAction: "none",
  cursor: "crosshair",
  userSelect: "none",
};

const cropMediaStyle: React.CSSProperties = {
  position: "absolute",
  left: "50%",
  top: "50%",
  display: "block",
  maxWidth: "none",
  maxHeight: "none",
  pointerEvents: "none",
};

const cropEditorStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const rotationControlStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 8,
};

const rotationValueStyle: React.CSSProperties = {
  color: "#aeb7c8",
  fontSize: 12,
  minWidth: 34,
};

const cropHintStyle: React.CSSProperties = {
  color: "#aeb7c8",
  fontSize: 12,
  lineHeight: 1.4,
};

const cropBoxStyle: React.CSSProperties = {
  position: "absolute",
  border: "2px solid #e8edf8",
  boxShadow: "0 0 0 9999px rgba(0,0,0,0.36)",
  boxSizing: "border-box",
  minWidth: 10,
  minHeight: 10,
  pointerEvents: "auto",
  cursor: "move",
};

const cropHandleStyle: React.CSSProperties = {
  position: "absolute",
  width: 12,
  height: 12,
  border: "2px solid #202632",
  borderRadius: 2,
  background: "#f4f7fb",
  boxSizing: "border-box",
  pointerEvents: "auto",
  zIndex: 2,
};

const cropHandlePositionStyles: Record<CropHandle, React.CSSProperties> = {
  nw: {
    left: 0,
    top: 0,
    transform: "translate(-50%, -50%)",
    cursor: "nwse-resize",
  },
  n: {
    left: "50%",
    top: 0,
    transform: "translate(-50%, -50%)",
    cursor: "ns-resize",
  },
  ne: {
    right: 0,
    top: 0,
    transform: "translate(50%, -50%)",
    cursor: "nesw-resize",
  },
  e: {
    right: 0,
    top: "50%",
    transform: "translate(50%, -50%)",
    cursor: "ew-resize",
  },
  se: {
    right: 0,
    bottom: 0,
    transform: "translate(50%, 50%)",
    cursor: "nwse-resize",
  },
  s: {
    left: "50%",
    bottom: 0,
    transform: "translate(-50%, 50%)",
    cursor: "ns-resize",
  },
  sw: {
    left: 0,
    bottom: 0,
    transform: "translate(-50%, 50%)",
    cursor: "nesw-resize",
  },
  w: {
    left: 0,
    top: "50%",
    transform: "translate(-50%, -50%)",
    cursor: "ew-resize",
  },
};

const manageDetailsStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
  alignContent: "start",
  minWidth: 0,
};

const coordinateFieldsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 12,
};

const locationPanelStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
  padding: 12,
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 6,
};

const manageHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 12,
};

const manageActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
};

const audioTrimStatusStyle: React.CSSProperties = {
  flex: "1 0 100%",
  color: "#d8e7ff",
  background: "rgba(120,170,255,0.12)",
  border: "1px solid rgba(120,170,255,0.28)",
  borderRadius: 4,
  padding: "9px 10px",
};

const adjustmentPanelStyle: React.CSSProperties = {
  display: "grid",
  gap: 10,
};

const adjustmentLabelStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  color: "#cfd6e2",
  fontSize: 13,
};

const adjustmentLabelRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
};

const adjustmentResetButtonStyle: React.CSSProperties = {
  border: 0,
  padding: 2,
  background: "transparent",
  color: "#cfd6e2",
  cursor: "pointer",
  fontFamily: "'Material Symbols Outlined'",
  fontSize: 20,
  fontWeight: 400,
  lineHeight: 1,
  fontStyle: "normal",
  fontVariationSettings: "'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 20",
};

const rangeInputStyle: React.CSSProperties = {
  width: "100%",
};

const assetGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(236px, 1fr))",
  gap: 8,
};

const browseStatusTabsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  marginBottom: 16,
  borderBottom: "1px solid rgba(255,255,255,0.14)",
};

const browseStatusTabStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 7,
  flex: "0 0 auto",
  padding: "9px 12px",
  background: "transparent",
  color: "#9aa3b3",
  border: 0,
  borderBottom: "2px solid transparent",
  cursor: "pointer",
  font: "inherit",
  fontSize: 13,
  fontWeight: 600,
};

const browseStatusTabActiveStyle: React.CSSProperties = {
  color: "#d8e7ff",
  borderBottomColor: "#d8e7ff",
};

const browseStatusCountStyle: React.CSSProperties = {
  display: "inline-grid",
  placeItems: "center",
  minWidth: 20,
  height: 20,
  padding: "0 5px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.1)",
  color: "#aeb8c7",
  fontSize: 11,
};

const assetCardStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "220px auto auto",
  gap: 8,
  color: "#d8e7ff",
  textDecoration: "none",
  background: "rgba(255,255,255,0.05)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(255,255,255,0.12)",
  borderRadius: 4,
  boxShadow: "none",
  padding: 8,
  minWidth: 0,
  cursor: "default",
  textAlign: "left",
  font: "inherit",
  fontSize: 13,
  transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
};

const assetPreviewStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: 220,
  overflow: "hidden",
  borderRadius: 4,
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
};

const assetCardMetaStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  minWidth: 0,
};

const selectedAssetCardStyle: React.CSSProperties = {
  background: "rgba(120, 170, 255, 0.18)",
  borderColor: "rgba(216, 231, 255, 0.9)",
  boxShadow: "0 0 0 2px rgba(120, 170, 255, 0.24)",
};

const assetCardActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  paddingTop: 4,
  borderTop: "1px solid rgba(255,255,255,0.08)",
};

const browseEditButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  padding: "5px 8px",
  fontSize: 12,
};

const inlinePublishButtonStyle: React.CSSProperties = {
  ...primaryActionButtonStyle,
  padding: "5px 8px",
  fontSize: 12,
};

const browseSelectionBarStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  position: "sticky",
  top: 8,
  zIndex: 2,
  padding: "10px 12px",
  color: "#eef3ff",
  background: "rgba(23, 31, 48, 0.96)",
  border: "1px solid rgba(158, 190, 255, 0.45)",
  borderRadius: 6,
};

const withSelectedLabelStyle: React.CSSProperties = {
  color: "#aeb8ca",
  fontSize: 12,
  whiteSpace: "nowrap",
};

const assetImageStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
  background: "#0c0e13",
};

const assetThumbnailPlaceholderStyle: React.CSSProperties = {
  ...assetImageStyle,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#9aa4b5",
  fontSize: 12,
};

const archivedAssetBadgeStyle: React.CSSProperties = {
  padding: "2px 6px",
  borderRadius: 999,
  background: "rgba(120, 53, 15, 0.94)",
  border: "1px solid rgba(251, 191, 36, 0.72)",
  color: "#fde68a",
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1.4,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  boxShadow: "0 2px 7px rgba(0,0,0,0.45)",
};

const assetBadgeRowStyle: React.CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  display: "flex",
  alignItems: "center",
  gap: 5,
  flexWrap: "wrap",
  justifyContent: "flex-end",
  maxWidth: "calc(100% - 48px)",
  zIndex: 1,
};

const publishedAssetBadgeStyle: React.CSSProperties = {
  ...archivedAssetBadgeStyle,
  background: "rgba(20, 83, 45, 0.94)",
  border: "1px solid rgba(74, 222, 128, 0.72)",
  color: "#dcfce7",
};

const draftAssetBadgeStyle: React.CSSProperties = {
  ...archivedAssetBadgeStyle,
  background: "rgba(51, 65, 85, 0.94)",
  border: "1px solid rgba(203, 213, 225, 0.68)",
  color: "#f1f5f9",
};

const mediaKindBadgeStyle: React.CSSProperties = {
  ...archivedAssetBadgeStyle,
  background: "rgba(30, 64, 175, 0.94)",
  border: "1px solid rgba(147, 197, 253, 0.72)",
  color: "#dbeafe",
};

const driveAssetBadgeStyle: React.CSSProperties = {
  ...archivedAssetBadgeStyle,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "2px 5px",
  background: "rgba(20, 83, 45, 0.94)",
  border: "1px solid rgba(134, 239, 172, 0.72)",
  color: "#dcfce7",
};

const driveAssetBadgeIconStyle: React.CSSProperties = {
  fontFamily: "'Material Symbols Outlined'",
  fontSize: 14,
  fontWeight: 400,
  lineHeight: 1,
  fontStyle: "normal",
  fontVariationSettings: "'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24",
};

const assetNameStyle: React.CSSProperties = {
  color: "#eee",
  fontSize: 12,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const assetHeadingStyle: React.CSSProperties = {
  margin: 0,
  color: "#f2f2f2",
  fontSize: 20,
  lineHeight: 1.25,
  overflowWrap: "anywhere",
};

const assetDateStyle: React.CSSProperties = {
  color: "#8f98a8",
  fontSize: 11,
};

const assetDurationStyle: React.CSSProperties = {
  color: "#c6d4e8",
  fontSize: 11,
  fontVariantNumeric: "tabular-nums",
};

const emptyStateStyle: React.CSSProperties = {
  color: "#8f98a8",
  background: "#171a22",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: 16,
};

const loadingUploadsStyle: React.CSSProperties = {
  ...emptyStateStyle,
  display: "flex",
  alignItems: "center",
  gap: 9,
};

const loadingSpinnerStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  flex: "0 0 auto",
  border: "2px solid rgba(148, 163, 184, 0.3)",
  borderTopColor: "#aeb8c7",
  borderRadius: "50%",
  animation: "atlas-loading-spin 0.8s linear infinite",
};

const itemStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "54px minmax(0, 1fr)",
  gap: 12,
  alignItems: "start",
  background: "#171a22",
  borderRadius: 4,
  padding: 10,
};

const queueItemContentStyle: React.CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 8,
};

const queueItemMainStyle: React.CSSProperties = {
  display: "grid",
  gap: 4,
  minWidth: 0,
};

const queueMetaSeparatorStyle: React.CSSProperties = {
  display: "inline-block",
  width: 4,
  height: 4,
  borderRadius: 999,
  background: "currentColor",
  opacity: 0.42,
  margin: "0 7px",
  verticalAlign: "middle",
};

const completedStatusStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  color: "#9df7a8",
  fontWeight: 600,
};

const completedCheckStyle: React.CSSProperties = {
  width: 14,
  height: 14,
  flex: "0 0 auto",
};

const progressTrackStyle: React.CSSProperties = {
  height: 6,
  background: "#2a2e3a",
  borderRadius: 999,
  overflow: "hidden",
};

const progressBarStyle: React.CSSProperties = {
  height: "100%",
  background: "#d8e7ff",
};

const retryButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#ddd",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: 4,
  padding: "7px 10px",
  cursor: "pointer",
};

const thumbStyle: React.CSSProperties = {
  width: 54,
  height: 44,
  background: "#0c0e13",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 4,
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const thumbImageStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const queueThumbPlaceholderStyle: React.CSSProperties = {
  color: "#666",
  fontSize: 11,
};

const captionFieldStyle: React.CSSProperties = {
  display: "grid",
  gap: 5,
};

const captionLabelStyle: React.CSSProperties = {
  color: "#9aa3b3",
  fontSize: 11,
};

const captionRowStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
};

const captionInputStyle: React.CSSProperties = {
  flex: "1 1 auto",
  minWidth: 0,
  background: "#0f1118",
  color: "#f2f2f2",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 4,
  padding: "7px 8px",
};

const captionTextareaStyle: React.CSSProperties = {
  background: "#0f1118",
  color: "#f2f2f2",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 4,
  padding: "9px 10px",
  minHeight: 88,
  resize: "vertical",
  lineHeight: 1.4,
  font: "inherit",
};

const captionSaveButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  padding: "7px 9px",
};

const captionManagerActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
};

const linkedAudioPreviewStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
};

const linkedAudioPreviewButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "7px 11px",
  borderRadius: 999,
};

const captionStatusStyle: React.CSSProperties = {
  color: "#9df7a8",
  fontSize: 11,
};

const captionErrorStyle: React.CSSProperties = {
  color: "#ffb0b0",
  fontSize: 11,
};

const successNoticeStyle: React.CSSProperties = {
  color: "#9df7a8",
  background: "rgba(20,180,80,0.13)",
  border: "1px solid rgba(80,220,120,0.25)",
  padding: 10,
  borderRadius: 4,
  marginBottom: 12,
};

const warningNoticeStyle: React.CSSProperties = {
  color: "#ffe2a8",
  background: "rgba(220,150,40,0.14)",
  border: "1px solid rgba(240,185,80,0.28)",
  padding: 10,
  borderRadius: 4,
  marginBottom: 12,
};

const errorStyle: React.CSSProperties = {
  color: "#ffb0b0",
  background: "rgba(255,0,0,0.12)",
  border: "1px solid rgba(255,0,0,0.22)",
  padding: 10,
  borderRadius: 4,
  marginBottom: 12,
};

const workspaceTabsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  marginBottom: 16,
  borderBottom: "1px solid rgba(255,255,255,0.14)",
};

const workspaceTabStyle: React.CSSProperties = {
  background: "transparent",
  color: "#9aa3b3",
  border: "none",
  borderBottom: "2px solid transparent",
  padding: "10px 14px",
  cursor: "pointer",
  fontSize: 15,
  fontWeight: 600,
};

const workspaceTabContentStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
};

const materialSymbolStyle: React.CSSProperties = {
  fontFamily: "'Material Symbols Outlined'",
  fontSize: 20,
  fontWeight: 400,
  lineHeight: 1,
  fontStyle: "normal",
  fontVariationSettings: "'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24",
};

const workspaceTabActiveStyle: React.CSSProperties = {
  color: "#d8e7ff",
  borderBottomColor: "#d8e7ff",
};

const driveBrowserStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
  marginBottom: 12,
};

const driveBrowserHeaderStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "center",
  justifyContent: "space-between",
  minWidth: 0,
};

const activityAssetBadgeStyle: React.CSSProperties = {
  ...archivedAssetBadgeStyle,
  background: "rgba(51, 65, 85, 0.94)",
  border: "1px solid rgba(203, 213, 225, 0.68)",
  color: "#f1f5f9",
};

function readableBadgeTextColour(background: string) {
  const match = background.match(/^#([0-9a-f]{6})$/i);
  if (!match) return "#fff";
  const value = parseInt(match[1], 16);
  const red = (value >> 16) & 255;
  const green = (value >> 8) & 255;
  const blue = value & 255;
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) / 255;
  return luminance > 0.62 ? "#111827" : "#fff";
}

const driveBreadcrumbsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 4,
  minWidth: 0,
  overflowX: "auto",
};

const openDriveFolderLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  flex: "0 0 auto",
  color: "#d8e7ff",
  textDecoration: "none",
  fontSize: 13,
  whiteSpace: "nowrap",
};

const driveFolderActionsStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flex: "0 0 auto",
};

const copyDriveFolderLinkStyle: React.CSSProperties = {
  ...openDriveFolderLinkStyle,
  padding: 0,
  border: 0,
  background: "transparent",
  fontFamily: "inherit",
  cursor: "pointer",
};

function formatAssetDuration(seconds: number) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, Math.round(seconds)) : 0;
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainder = safeSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

const driveFileListStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(236px, 1fr))",
  gap: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 4,
  padding: 8,
};

const driveFileItemStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateRows: "220px auto",
  gap: 8,
  padding: 8,
  background: "rgba(255,255,255,0.05)",
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "rgba(255,255,255,0.12)",
  borderRadius: 4,
  boxShadow: "none",
  cursor: "pointer",
  fontSize: 13,
  color: "#d8e7ff",
  transition: "background 120ms ease, border-color 120ms ease, box-shadow 120ms ease",
};

const driveFileItemSelectedStyle: React.CSSProperties = {
  background: "rgba(120, 170, 255, 0.18)",
  borderColor: "rgba(216, 231, 255, 0.9)",
  boxShadow: "0 0 0 2px rgba(120, 170, 255, 0.24)",
};

const driveFileThumbStyle: React.CSSProperties = {
  position: "relative",
  width: 220,
  height: 220,
  display: "grid",
  placeItems: "center",
  overflow: "hidden",
  borderRadius: 4,
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.12)",
};

const driveFileCheckboxStyle: React.CSSProperties = {
  position: "absolute",
  top: 8,
  left: 8,
  width: 20,
  height: 20,
  margin: 0,
  cursor: "pointer",
  accentColor: "#9ec1ff",
  zIndex: 1,
};

const driveFileBadgeStyle: React.CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  zIndex: 1,
  padding: "4px 8px",
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  lineHeight: 1.2,
  boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
};

const driveFileImportedBadgeStyle: React.CSSProperties = {
  ...driveFileBadgeStyle,
  color: "#082b17",
  background: "#70df93",
  border: "1px solid #a1efb7",
};

const driveFileNewBadgeStyle: React.CSSProperties = {
  ...driveFileBadgeStyle,
  color: "#eef3fb",
  background: "#42526d",
  border: "1px solid #71809a",
};

const driveFileMetaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  minWidth: 0,
};

const driveFolderNameAndStatsStyle: React.CSSProperties = {
  display: "flex",
  flex: 1,
  alignItems: "baseline",
  flexDirection: "row",
  gap: 8,
  minWidth: 0,
};

const driveFolderStatsStyle: React.CSSProperties = {
  color: "#9aa3b3",
  fontSize: 12,
  fontWeight: 400,
};

const driveFileThumbImageStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
  display: "block",
};

const driveFileTypeStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "#9aa3b3",
};

const driveActionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 8,
};
