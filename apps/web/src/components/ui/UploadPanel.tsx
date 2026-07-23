import { useEffect, useMemo, useRef, useState } from "react";
import {
  assignAssetActivityTag,
  assignAssetPlacement,
  assignAssetUploader,
  cropUploadAsset,
  deleteUploadAsset,
  fetchAssetEdits,
  fetchAuthUser,
  fetchDriveFiles,
  fetchDriveFolders,
  flattenUploadAsset,
  fetchPlacementAssetSet,
  fetchPlacementAssets,
  fetchUploadOptions,
  fetchUploadAssetAdjustments,
  fetchUploadAsset,
  fetchUntaggedPlacementAssets,
  logoutAuthUser,
  resetUploadAssetEdits,
  setAssetPublished,
  syncDriveFiles,
  updateAssetCaption,
  updateUploadAssetAdjustments,
  uploadFiles,
  type AssetAdjustments,
  type AuthUser,
  type CropParameters,
  type DriveFile,
  type DriveFolder,
  type RotationDegrees,
  type UploadOptions,
  type PlacementAsset,
} from "../../api/client";
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
type WorkspaceMode = "sites" | "browse" | "edit" | "upload" | "import";
type PlacementMetaLine = {
  text: string;
  icon?: string;
  href?: string;
  variant?: "location";
};

interface UploadPanelProps {
  initialError?: string | null;
  initialAssetId?: string;
  adminPath?: string;
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
  const [placementKey, setPlacementKey] = useState("");
  const [activityTagFilter, setActivityTagFilter] = useState("");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [placementAssets, setPlacementAssets] = useState<PlacementAsset[]>([]);
  const [assetMode, setAssetMode] = useState<"placements" | "untagged">(
    "placements",
  );
  const [siteScope, setSiteScope] = useState<SiteScope>("select");
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("sites");
  const [selectedAsset, setSelectedAsset] = useState<PlacementAsset | null>(
    null,
  );
  const [managePlacementKey, setManagePlacementKey] = useState("");
  const [manageUploaderKey, setManageUploaderKey] = useState("");
  const [manageActivityTag, setManageActivityTag] = useState("");
  const [managePublished, setManagePublished] = useState(false);
  const [manageCaption, setManageCaption] = useState("");
  const [captionSaving, setCaptionSaving] = useState(false);
  const [captionSaveStatus, setCaptionSaveStatus] = useState<
    "idle" | "saved" | "failed"
  >("idle");
  const [captionSaveError, setCaptionSaveError] = useState<string | null>(null);
  const [savingAsset, setSavingAsset] = useState(false);
  const [deletingAsset, setDeletingAsset] = useState(false);
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
  const [directAssetLoading, setDirectAssetLoading] = useState(
    Boolean(initialAssetId),
  );
  const [notice, setNotice] = useState<{
    tone: NoticeTone;
    message: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const cropStartRef = useRef<{ x: number; y: number } | null>(null);

  const appPath = adminPath ?? window.location.pathname;

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
    if (nextMode === workspaceMode) {
      if (
        nextMode === "import" &&
        window.location.pathname === "/admin/import"
      ) {
        void openDriveImportDefault();
      }
      return;
    }

    setWorkspaceMode(nextMode);
    setSelectedAsset(null);
    setItems([]);
    setNotice(null);

    if (nextMode === "import") {
      void openDriveImportDefault();
    }
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
  const [selectedDriveFolder, setSelectedDriveFolder] = useState("root");
  const [folderPath, setFolderPath] = useState<
    Array<{ id: string; name: string }>
  >([]);
  const [selectedDriveFiles, setSelectedDriveFiles] = useState<Set<string>>(
    new Set(),
  );
  const [driveSyncing, setDriveSyncing] = useState(false);
  const [driveLoading, setDriveLoading] = useState(false);
  const [driveDefaultOpening, setDriveDefaultOpening] = useState(false);

  function placementLabel(location: UploadOptions["placements"][number]) {
    return location.placement_name;
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
    if (selectedAsset?.id === initialAssetId) {
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
        if (!cancelled) openAssetManager(asset, false);
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
          setDriveFolders(response.subfolders ?? []);
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
    if (
      workspaceMode === "upload" ||
      workspaceMode === "import" ||
      !browsePartnerKey
    )
      return contextFilteredPlacements;
    return contextFilteredPlacements.filter(
      (placement) => placement.partner_name?.trim() === browsePartnerKey,
    );
  }, [
    ageRangeFilter,
    browseContextFilter,
    browsePartnerKey,
    deliveryDayFilter,
    options,
    selectedUploader,
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

  const selectedPlacement = useMemo(() => {
    if (!options || !placementKey) return null;
    return (
      options.placements.find(
        (placement) => String(placement.placement_id) === placementKey,
      ) ?? null
    );
  }, [options, placementKey]);

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

  const selectedActivityLabel = useMemo(() => {
    if (!options || !activityTagFilter) return null;
    return (
      options.activities.find(
        (activity) => String(activity.id) === activityTagFilter,
      )?.label ?? null
    );
  }, [activityTagFilter, options]);

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
    browsePartnerKey,
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
    if (assetMode === "untagged") {
      let cancelled = false;
      setAssetsLoading(true);
      fetchUntaggedPlacementAssets()
        .then((assets) => {
          if (!cancelled) setPlacementAssets(assets);
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
        if (!cancelled) setPlacementAssets(assets);
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
  }, [assetMode, visiblePlacementIds, activityTagFilter, workspaceMode]);

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
    void openDriveImportDefault();
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
      .then(setPlacementAssets)
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

  function setApplicationPath(path: string, replace = false) {
    if (window.location.pathname === path) return;
    if (replace) window.history.replaceState(null, "", path);
    else window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  function openAssetManager(asset: PlacementAsset, updateUrl = true) {
    const adjustments = normalizeAdjustments(asset.adjustments);
    setSelectedAsset(asset);
    setManagePlacementKey(asset.placement_id ? String(asset.placement_id) : "");
    setManageUploaderKey(asset.uploader_id ? String(asset.uploader_id) : "");
    setManageActivityTag(asset.activity_id ? String(asset.activity_id) : "");
    setManagePublished(Boolean(asset.published));
    setManageCaption(asset.description ?? "");
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
    setManageUploaderKey("");
    setManageActivityTag("");
    setManagePublished(false);
    setManageCaption("");
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
    const uploaderChanged =
      Boolean(manageUploaderKey) &&
      manageUploaderKey !==
        (selectedAsset.uploader_id ? String(selectedAsset.uploader_id) : "");
    const activityTagChanged =
      manageActivityTag !==
      (selectedAsset.activity_id ? String(selectedAsset.activity_id) : "");
    const publishedChanged =
      managePublished !== Boolean(selectedAsset.published);

    if (
      !placementChanged &&
      !uploaderChanged &&
      !activityTagChanged &&
      !publishedChanged
    ) {
      setError(
        "Choose a placement, team member album, program week, or publication status to save.",
      );
      return;
    }
    if (placementChanged && (!placementId || !Number.isFinite(placementId))) {
      setError("Select a placement to assign this upload.");
      return;
    }
    if (uploaderChanged && (!uploaderId || !Number.isFinite(uploaderId))) {
      setError("Select a team member album for this upload.");
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
      if (uploaderChanged && uploaderId) {
        await assignAssetUploader({
          assetId: selectedAsset.id,
          uploaderId,
        });
      }
      if (activityTagChanged) {
        await assignAssetActivityTag({
          assetId: selectedAsset.id,
          activityId: manageActivityTag
            ? parseInt(manageActivityTag, 10)
            : null,
        });
      }
      if (publishedChanged) {
        await setAssetPublished({
          assetId: selectedAsset.id,
          published: managePublished,
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
    const placementChanged =
      Boolean(managePlacementKey) &&
      managePlacementKey !==
        (selectedAsset.placement_id ? String(selectedAsset.placement_id) : "");
    const uploaderChanged =
      Boolean(manageUploaderKey) &&
      manageUploaderKey !==
        (selectedAsset.uploader_id ? String(selectedAsset.uploader_id) : "");
    const activityChanged =
      manageActivityTag !==
      (selectedAsset.activity_id ? String(selectedAsset.activity_id) : "");
    const publishedChanged =
      managePublished !== Boolean(selectedAsset.published);
    const captionChanged =
      manageCaption.trim() !== (selectedAsset.description ?? "").trim();
    const selectedAdjustments = normalizeAdjustments(selectedAsset.adjustments);
    const adjustmentChanged =
      manageBrightness !== selectedAdjustments.brightness ||
      manageContrast !== selectedAdjustments.contrast ||
      manageSaturation !== selectedAdjustments.saturation;
    const pixelEditsChanged = hasPendingPixelEdits(selectedAsset);

    if (
      !placementChanged &&
      !uploaderChanged &&
      !activityChanged &&
      !publishedChanged &&
      !captionChanged &&
      !adjustmentChanged &&
      !pixelEditsChanged
    ) {
      setError("There are no changes to save.");
      return;
    }
    if (pixelEditsChanged && !cropRect) {
      setError("Choose a crop area before saving.");
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
      if (uploaderChanged)
        await assignAssetUploader({
          assetId,
          uploaderId: parseInt(manageUploaderKey, 10),
        });
      if (activityChanged) {
        await assignAssetActivityTag({
          assetId,
          activityId: manageActivityTag
            ? parseInt(manageActivityTag, 10)
            : null,
        });
      }
      if (publishedChanged)
        await setAssetPublished({ assetId, published: managePublished });
      if (captionChanged)
        await updateAssetCaption({ assetId, caption: manageCaption.trim() });
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

      closeAssetManager();
      setWorkspaceMode("browse");
      setApplicationPath("/admin", true);
      setNotice({ tone: "success", message });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSavingAsset(false);
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
    setDeletingAsset(true);
    setError(null);
    try {
      await deleteUploadAsset({ assetId });
      closeAssetManager();
      setPlacementAssets((current) =>
        current.filter((asset) => asset.id !== assetId),
      );
      refreshVisibleAssets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingAsset(false);
    }
  }

  function sourceImageDimensions(asset: PlacementAsset) {
    if (cropEditing && cropSourceDimensions) return cropSourceDimensions;
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
      const results = await syncDriveFiles({
        fileIds: Array.from(selectedDriveFiles),
        placementId: placementKey ? parseInt(placementKey, 10) : null,
        activityId: activityTagFilter ? parseInt(activityTagFilter, 10) : null,
      });

      const succeeded = results.filter((r) => r.status === "success").length;
      const failed = results.filter((r) => r.status === "failed").length;
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

  async function openDriveImportDefault() {
    setWorkspaceMode("import");
    setSelectedDriveFiles(new Set());
    setDriveFolders([]);
    setDriveFiles([]);
    setDriveDefaultOpening(true);
    setDriveLoading(true);
    setError(null);
    setNotice(null);

    try {
      const sharedDrives = await fetchDriveFolders("sharedDrives", "root");
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
      console.warn(
        "[drive] Failed to open default Artasia Documentation folder",
        err,
      );
      resetDriveFolderPath();
    } finally {
      setDriveDefaultOpening(false);
      setDriveLoading(false);
    }
  }

  function resetDriveFolderPath() {
    setDriveType("chooser");
    setFolderPath([]);
    setSelectedDriveFolder("root");
    setCurrentDriveId(undefined);
  }

  function renderAssetCard(asset: PlacementAsset) {
    return (
      <button
        key={asset.id}
        type="button"
        onClick={() => openAssetManager(asset)}
        style={assetCardStyle}
      >
        <img
          src={mediaUrl(asset.thumbnailUrl, asset.id)}
          alt=""
          style={{
            ...assetImageStyle,
            ...adjustmentFilterStyle(asset.adjustments),
          }}
        />
        <span style={assetNameStyle}>{asset.fileName}</span>
        <span style={assetDateStyle}>
          {asset.uploader_name ?? "No team member album"}
        </span>
        <span style={assetDateStyle}>
          {new Date(asset.createdAt).toLocaleDateString()}
        </span>
      </button>
    );
  }

  function renderAssetGrid(emptyMessage: string) {
    if (assetsLoading)
      return <div style={emptyStateStyle}>Loading uploads...</div>;
    if (placementAssets.length === 0)
      return <div style={emptyStateStyle}>{emptyMessage}</div>;
    return (
      <div style={assetGridStyle}>{placementAssets.map(renderAssetCard)}</div>
    );
  }

  function renderUploadItems() {
    if (items.length === 0) return null;

    return (
      <div style={listStyle}>
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
                      disabled={item.captionStatus === "saving"}
                      style={captionSaveButtonStyle}
                    >
                      {item.captionStatus === "saving" ? "Saving..." : "Save"}
                    </button>
                  </div>
                  {item.captionStatus === "saved" && (
                    <span style={captionStatusStyle}>Saved</span>
                  )}
                  {item.captionStatus === "failed" && (
                    <span style={captionErrorStyle}>
                      {item.captionError ?? "Caption failed"}
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
    return (
      <div style={driveBrowserStyle}>
        {/* Breadcrumb navigation */}
        {folderPath.length > 0 && (
          <div style={{ ...driveBrowserHeaderStyle, gap: 4, overflow: "auto" }}>
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
                <span style={{ flex: 1 }}>{folder.name}</span>
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
                  {file.thumbnailLink ? (
                    <img
                      src={file.thumbnailLink}
                      alt=""
                      style={driveFileThumbImageStyle}
                      loading="lazy"
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
                    {file.isVideo ? "Video" : "Image"}
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
              {driveSyncing
                ? `Importing ${selectedDriveFiles.size} file${selectedDriveFiles.size === 1 ? "" : "s"}...`
                : `Import ${selectedDriveFiles.size} file${selectedDriveFiles.size === 1 ? "" : "s"}`}
            </button>
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
                  Import
                </button>
                <a
                  href={placementViewerUrl(placement)}
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
    const placementChanged =
      Boolean(managePlacementKey) &&
      managePlacementKey !==
        (selectedAsset.placement_id ? String(selectedAsset.placement_id) : "");
    const uploaderChanged =
      Boolean(manageUploaderKey) &&
      manageUploaderKey !==
        (selectedAsset.uploader_id ? String(selectedAsset.uploader_id) : "");
    const activityChanged =
      manageActivityTag !==
      (selectedAsset.activity_id ? String(selectedAsset.activity_id) : "");
    const publishedChanged =
      managePublished !== Boolean(selectedAsset.published);
    const selectedAdjustments = normalizeAdjustments(selectedAsset.adjustments);
    const adjustmentChanged =
      manageBrightness !== selectedAdjustments.brightness ||
      manageContrast !== selectedAdjustments.contrast ||
      manageSaturation !== selectedAdjustments.saturation;
    const captionChanged =
      manageCaption.trim() !== (selectedAsset.description ?? "").trim();
    const pixelEditsChanged = hasPendingPixelEdits(selectedAsset);
    const hasAnyChanges =
      placementChanged ||
      uploaderChanged ||
      activityChanged ||
      publishedChanged ||
      adjustmentChanged ||
      captionChanged ||
      pixelEditsChanged;
    const displayPreviewUrl = mediaUrl(
      selectedAsset.previewUrl,
      selectedAsset.id,
    );
    const cropSourceUrl = `/api/v1/assets/${selectedAsset.id}/preview?v=${encodeURIComponent(
      `${selectedAsset.updatedAt}-${cropRefreshKey}`,
    )}`;
    const cropCanvasDimensions = rotatedImageDimensions(selectedAsset);
    const cropSourceSize = sourceImageDimensions(selectedAsset);

    return (
      <div className="atlas-manage-panel" style={managePanelStyle}>
        <div style={managePreviewStyle}>
          {selectedAsset.type === "VIDEO" ? (
            <video
              src={selectedAsset.previewUrl}
              controls
              style={manageMediaStyle}
            />
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
                  onClick={() => changeRotationDegrees(-90)}
                  disabled={cropSaving}
                  style={secondaryButtonStyle}
                >
                  Left 90°
                </button>
                <button
                  type="button"
                  onClick={() => changeRotationDegrees(90)}
                  disabled={cropSaving}
                  style={secondaryButtonStyle}
                >
                  Right 90°
                </button>
                <span style={rotationValueStyle}>
                  {rotationDegrees === 270 ? "-90°" : `${rotationDegrees}°`}
                </span>
              </div>
              <label style={adjustmentLabelStyle}>
                <span>Straighten {straightenDegrees.toFixed(1)}°</span>
                <input
                  type="range"
                  min={-35}
                  max={35}
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
          <h2 style={assetHeadingStyle}>{selectedAsset.fileName}</h2>

          <label style={labelStyle}>
            Artasia Site
            <select
              value={managePlacementKey}
              onChange={(e) => setManagePlacementKey(e.target.value)}
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
            Asset Owner
            <select
              value={manageUploaderKey}
              onChange={(e) => setManageUploaderKey(e.target.value)}
              style={inputStyle}
            >
              <option value="">Select a team member</option>
              {(options?.uploaders ?? []).map((uploader) => (
                <option key={uploader.id} value={String(uploader.id)}>
                  {uploader.name}
                </option>
              ))}
            </select>
          </label>
          <label style={labelStyle}>
            Program Week / Activity
            <select
              value={manageActivityTag}
              onChange={(e) => setManageActivityTag(e.target.value)}
              style={inputStyle}
            >
              <option value="">No activity tag</option>
              {(options?.activities ?? []).map((activity) => (
                <option key={activity.id} value={String(activity.id)}>
                  {activity.label}
                </option>
              ))}
            </select>
          </label>
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
          <label style={checkboxLabelStyle}>
            <input
              type="checkbox"
              checked={managePublished}
              disabled={!authUser?.authenticated}
              onChange={(e) => setManagePublished(e.target.checked)}
            />
            Published
          </label>
          <div style={manageActionsStyle}>
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
                ? pixelEditsChanged
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
          @media (max-width: 760px) {
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
          }
        `}
      </style>
      <section style={panelStyle}>
        <div style={headerStyle}>
          <div style={headerBrandStyle}>
            <img src="/artasia.svg" alt="Artasia" style={logoStyle} />
            <div>
              <h1 style={titleStyle}>Atlas Admin</h1>
            </div>
          </div>
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
                <button
                  type="button"
                  onClick={selectMySites}
                  disabled={!authUser.uploader_id && !authUser.uploader?.id}
                  style={secondaryButtonStyle}
                >
                  My Sites
                </button>
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
              void openDriveImportDefault();
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
              {workspaceMode === "browse" && (
                <label style={labelStyle}>
                  Artasia Site
                  <select
                    value={
                      assetMode === "untagged" || !selectedPlacement
                        ? ""
                        : String(selectedPlacement.placement_id)
                    }
                    onChange={(e) => {
                      const nextPlacementKey = e.target.value;
                      if (!nextPlacementKey) {
                        setPlacementKey("");
                        setSiteScope("all");
                        setAssetMode("placements");
                      } else {
                        setPlacementKey(nextPlacementKey);
                        setSiteScope("placement");
                        setAssetMode("placements");
                      }
                      setSelectedAsset(null);
                      setItems([]);
                      setNotice(null);
                    }}
                    style={inputStyle}
                  >
                    <option value="">All Sites</option>
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

              {workspaceMode === "browse" && (
                <label style={labelStyle}>
                  Assets
                  <select
                    value={assetMode}
                    onChange={(e) => {
                      const nextAssetMode = e.target.value as
                        | "placements"
                        | "untagged";
                      setAssetMode(nextAssetMode);
                      if (nextAssetMode === "untagged") {
                        setUploaderKey("");
                        setActivityTagFilter("");
                        setBrowseContextFilter("all");
                        setTimeOfDayFilter("");
                        setAgeRangeFilter("");
                        setBrowsePartnerKey("");
                      }
                      setPlacementKey("");
                      setSiteScope("select");
                      setSelectedAsset(null);
                      setItems([]);
                    }}
                    style={inputStyle}
                  >
                    <option value="placements">Tagged assets</option>
                    <option value="untagged">Untagged assets</option>
                  </select>
                </label>
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
                    <div style={countBadgeStyle}>
                      {assetsLoading ? "..." : placementAssets.length} upload
                      {placementAssets.length === 1 ? "" : "s"}
                    </div>
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
                    <h2 style={detailTitleStyle}>Assets</h2>
                  )}
                  <div style={detailHeaderActionsStyle}>
                    <div style={countBadgeStyle}>
                      {assetsLoading ? "..." : placementAssets.length} upload
                      {placementAssets.length === 1 ? "" : "s"}
                    </div>
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
  fontFamily: "system-ui, sans-serif",
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

const clearFiltersButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
  width: "100%",
  boxSizing: "border-box",
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
  display: "grid",
  gap: 6,
  fontSize: 13,
  color: "#aaa",
  minWidth: 0,
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
  gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))",
  gap: 10,
};

const assetCardStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  color: "#ddd",
  background: "#171a22",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: 8,
  minWidth: 0,
  cursor: "pointer",
  textAlign: "left",
  font: "inherit",
};

const assetImageStyle: React.CSSProperties = {
  width: "100%",
  aspectRatio: "1 / 1",
  objectFit: "cover",
  borderRadius: 4,
  background: "#0c0e13",
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

const emptyStateStyle: React.CSSProperties = {
  color: "#8f98a8",
  background: "#171a22",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  padding: 16,
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
};

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
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 4,
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

const driveFileMetaStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  minWidth: 0,
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
