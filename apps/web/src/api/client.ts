export interface AssetAdjustments {
  brightness: number;
  contrast: number;
  saturation: number;
}

export type AssetType = "artwork" | "process";

export interface Photo {
  id: string;
  mediaKind: "image" | "video" | "audio" | "anecdote";
  audioUrl?: string;
  videoUrl?: string;
  linkedAudioUrl?: string;
  thumbnailUrl: string;
  previewUrl: string;
  width: number;
  height: number;
  orientation: "portrait" | "landscape" | "square";
  createdAt: string;
  fileName: string;
  isFavorite: boolean;
  assetType: AssetType;
  iconName?: string;
  activityIds?: number[];
  customActivities?: string[];
  anecdoteHtml?: string;
  attribution?: string;
  wordpressPostId?: number;
  placementId?: number;
  useGpsLocation?: boolean;
  adjustments?: AssetAdjustments;
  exifInfo?: {
    make?: string;
    model?: string;
    focalLength?: number;
    description?: string;
    latitude?: number;
    longitude?: number;
  };
  faces?: Array<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

export type ProcessGalleryAsset = Photo & {
  caption: string;
  alt: string;
};

export async function fetchPlacementProcessGallery(
  placementId: number,
): Promise<ProcessGalleryAsset[]> {
  const res = await fetch(`/api/v1/placements/${encodeURIComponent(String(placementId))}/process-gallery`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { assets?: ProcessGalleryAsset[] };
  return body.assets ?? [];
}

export async function fetchSlideshow(params: {
  albumIds?: string[];
  seed?: number;
  limit?: number;
  placementFocus?: {
    placementId: number;
    lat: number;
    lng: number;
    radiusKm: number;
    activityId?: number;
  };
}): Promise<{ photos: Photo[]; total: number }> {
  const res = await fetch("/api/v1/slideshow/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      albumIds: params.albumIds,
      shuffle: true,
      seed: params.seed ?? Date.now(),
      limit: params.limit ?? 100,
      placementFocus: params.placementFocus,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json();
}

export interface UploadPlacement {
  placement_id: number;
  placement_name: string;
  section?: string;
  placement_slug?: string;
  documentation_url?: string;
  documentation_title?: string;
  documentation_pull_quote?: string;
  documentation_content_html?: string;
  documentation_attribution?: string;
  google_drive_folder_id?: string;
  team_member_id?: number;
  team_member_name?: string;
  secondary_team_member_id?: number;
  secondary_team_member_name?: string;
  is_earlyon: boolean;
  partner_name: string;
  partner_logo?: {
    id: number;
    url: string;
    mime_type: string;
    alt: string;
  } | null;
  partner_white_logo?: {
    id: number;
    url: string;
    mime_type: string;
    alt: string;
  } | null;
  partner_brand_color_one?: string;
  partner_brand_color_two?: string;
  delivery_weekday?: string;
  delivery_start_time?: string;
  delivery_end_time?: string;
  delivery_schedule?: string;
  participant_age?: string;
  place_name?: string;
  place_city?: string;
  address?: string;
  shared_with?: string;
  lat?: number;
  lng?: number;
}

export interface UploadUploader {
  id: number;
  name: string;
  role: string;
  email?: string;
}

export interface MapPlacement {
  placement_id: number;
  placement_name: string;
  project?: ProjectOption | null;
  section?: string;
  placement_slug?: string;
  documentation_url?: string;
  documentation_title?: string;
  documentation_pull_quote?: string;
  documentation_content_html?: string;
  documentation_attribution?: string;
  is_earlyon: boolean;
  partner_name?: string;
  partner_acronym?: string;
  partner_logo?: {
    id: number;
    url: string;
    mime_type: string;
    alt: string;
  } | null;
  partner_white_logo?: {
    id: number;
    url: string;
    mime_type: string;
    alt: string;
  } | null;
  partner_brand_color_one?: string;
  partner_brand_color_two?: string;
  team_member?: UploadUploader;
  secondary_team_member?: UploadUploader;
  participant_count?: number;
  participant_age?: string;
  place_name?: string;
  place_city?: string;
  address?: string;
  lat: number;
  lng: number;
}

export interface ProjectOption {
  id: number;
  slug: string;
  name: string;
  year: number;
  description?: string;
  statistics?: {
    children: number;
    caregivers: number;
    educators: number;
    artist_educators: number;
    partners: number;
    neighbourhoods: number;
  };
}

export interface ActivityOption {
  id: number;
  label: string;
  customActivity?: string;
  week?: number;
  description?: string;
  colour?: string;
  count?: number;
}

export interface UploadOptions {
  placements: UploadPlacement[];
  activities: ActivityOption[];
  uploaders: UploadUploader[];
  currentUser: AuthUser | null;
  limits: {
    maxFiles: number;
    maxFileBytes: number;
    maxBatchBytes: number;
  };
}

export interface AuthUser {
  authenticated: boolean;
  email?: string;
  name?: string;
  picture?: string;
  hostedDomain?: string;
  uploader?: UploadUploader | null;
  uploader_id?: number | null;
  uploader_name?: string | null;
}

export async function fetchAuthUser(): Promise<AuthUser> {
  const res = await fetch("/api/v1/auth/me");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function logoutAuthUser(): Promise<void> {
  const res = await fetch("/api/v1/auth/logout", { method: "POST" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export interface UploadResult {
  fileName: string;
  status: "completed" | "failed";
  assetId?: string;
  error?: string;
}

export interface PlacementAsset {
  id: string;
  type: "IMAGE" | "VIDEO";
  mediaKind: "image" | "video" | "audio";
  durationSeconds: number;
  fileName: string;
  description?: string;
  latitude?: number | null;
  longitude?: number | null;
  useGpsLocation?: boolean;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
  trashed?: boolean;
  published?: boolean;
  assetType?: AssetType;
  width?: number | null;
  height?: number | null;
  placement_id?: number | null;
  placement_name?: string | null;
  display_placement_id?: number | null;
  display_placement_name?: string | null;
  activity_id?: number | null;
  activity_label?: string | null;
  custom_activity?: string | null;
  iconName?: string | null;
  linkedAudioAssetId?: string | null;
  driveFileId?: string | null;
  uploader_id?: number | null;
  uploader_name?: string | null;
  uploader_album_id?: string | null;
  thumbnailUrl: string;
  previewUrl: string;
  originalUrl: string;
  adjustments?: AssetAdjustments;
}

export interface LinkedAudioOption {
  id: string;
  fileName: string;
}

export interface SiteActivityStats {
  sites: Record<string, {
    totalPublished: number;
    activities: Array<{
      activityId: number;
      label: string;
      publishedCount: number;
    }>;
  }>;
  generatedAt: string;
}

export interface CropParameters {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AssetEdit {
  id?: string;
  action: "crop" | "rotate" | "mirror";
  parameters: CropParameters | { angle: number } | { axis: "horizontal" | "vertical" };
}

export interface AssetEditsResponse {
  assetId: string;
  edits: AssetEdit[];
}

export async function fetchUploadOptions(): Promise<UploadOptions> {
  const res = await fetch("/api/v1/uploads/options");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchSiteActivityStats(): Promise<SiteActivityStats> {
  const res = await fetch("/api/v1/uploads/site-activity-stats");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchPlacementAssets(placementId: number): Promise<PlacementAsset[]> {
  const res = await fetch(`/api/v1/uploads/placements/${placementId}/assets`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { assets?: PlacementAsset[] };
  return body.assets ?? [];
}

export async function fetchPlacementAssetSet(
  placementIds: number[],
  activityId?: number,
  assetType?: AssetType,
  mediaKind?: "image" | "audio" | "video",
): Promise<PlacementAsset[]> {
  if (placementIds.length === 0) return [];
  const params = new URLSearchParams({
    placement_ids: placementIds.join(","),
  });
  if (activityId != null) params.set("activity_id", String(activityId));
  if (assetType != null) params.set("asset_type", assetType);
  if (mediaKind != null) params.set("media_kind", mediaKind);
  const res = await fetch(`/api/v1/uploads/assets?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { assets?: PlacementAsset[] };
  return body.assets ?? [];
}

export async function fetchLinkedAudioOptions(
  placementId?: number,
): Promise<LinkedAudioOption[]> {
  const params = new URLSearchParams();
  if (placementId != null) {
    params.set("placement_id", String(placementId));
  }
  const query = params.size ? `?${params.toString()}` : "";
  const res = await fetch(`/api/v1/uploads/audio-options${query}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { options?: LinkedAudioOption[] };
  return body.options ?? [];
}

export async function fetchUntaggedPlacementAssets(): Promise<PlacementAsset[]> {
  const res = await fetch("/api/v1/uploads/assets/untagged");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { assets?: PlacementAsset[] };
  return body.assets ?? [];
}

export async function fetchUploadAsset(assetId: string): Promise<PlacementAsset> {
  const res = await fetch(`/api/v1/uploads/assets/${encodeURIComponent(assetId)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { asset: PlacementAsset };
  return body.asset;
}

export async function assignAssetPlacement(params: {
  assetId: string;
  placementId: number;
}): Promise<void> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}/placement`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ placement_id: params.placementId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function assignAssetDisplayPlacement(params: {
  assetId: string;
  placementId: number | null;
}): Promise<void> {
  const res = await fetch(
    `/api/v1/uploads/assets/${params.assetId}/display-placement`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ placement_id: params.placementId }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function assignAssetUploader(params: {
  assetId: string;
  uploaderId: number;
}): Promise<void> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}/uploader`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ uploader_id: params.uploaderId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function assignAssetActivityTag(params: {
  assetId: string;
  activityId: number | null;
  customActivity?: string | null;
}): Promise<void> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}/activity-tag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      activity_id: params.activityId,
      custom_activity: params.customActivity ?? null,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function assignAssetsActivityTag(params: {
  assetIds: string[];
  activityId: number;
}): Promise<string[]> {
  const res = await fetch("/api/v1/uploads/assets/activity-tag", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      asset_ids: params.assetIds,
      activity_id: params.activityId,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { asset_ids?: string[] };
  return body.asset_ids ?? params.assetIds;
}

export async function setAssetType(params: {
  assetId: string;
  assetType: "artwork" | "process";
}): Promise<void> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}/asset-type`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset_type: params.assetType }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function setAssetsType(params: {
  assetIds: string[];
  assetType: "artwork" | "process";
}): Promise<string[]> {
  const res = await fetch("/api/v1/uploads/assets/asset-type", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      asset_ids: params.assetIds,
      asset_type: params.assetType,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { asset_ids?: string[] };
  return body.asset_ids ?? params.assetIds;
}

export async function setAssetIcon(params: {
  assetId: string;
  iconName: string | null;
}): Promise<void> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}/icon`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ icon_name: params.iconName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function setAssetLinkedAudio(params: {
  assetId: string;
  linkedAudioAssetId: string | null;
}): Promise<void> {
  const res = await fetch(
    `/api/v1/uploads/assets/${params.assetId}/linked-audio`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        linked_audio_asset_id: params.linkedAudioAssetId,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function setAssetPublished(params: {
  assetId: string;
  published: boolean;
}): Promise<void> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}/published`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ published: params.published }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function setAssetsPublished(assetIds: string[]): Promise<string[]> {
  const res = await fetch("/api/v1/uploads/assets/published", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset_ids: assetIds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { asset_ids?: string[] };
  return body.asset_ids ?? assetIds;
}

export async function setAssetArchived(params: {
  assetId: string;
  archived: boolean;
}): Promise<void> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}/archived`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ archived: params.archived }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function setAssetsArchived(assetIds: string[]): Promise<string[]> {
  const res = await fetch("/api/v1/uploads/assets/archived", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset_ids: assetIds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { asset_ids?: string[] };
  return body.asset_ids ?? assetIds;
}

export async function updateAssetCaption(params: {
  assetId: string;
  caption: string;
}): Promise<void> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}/caption`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caption: params.caption }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function updateAssetLocation(params: {
  assetId: string;
  latitude: number;
  longitude: number;
}): Promise<void> {
  const res = await fetch(
    `/api/v1/uploads/assets/${encodeURIComponent(params.assetId)}/location`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        latitude: params.latitude,
        longitude: params.longitude,
      }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function updateAssetGpsUsage(params: {
  assetId: string;
  useGpsLocation: boolean;
}): Promise<void> {
  const res = await fetch(
    `/api/v1/uploads/assets/${encodeURIComponent(params.assetId)}/gps-usage`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ useGpsLocation: params.useGpsLocation }),
    },
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function fetchAssetEdits(assetId: string): Promise<AssetEditsResponse> {
  const res = await fetch(`/api/v1/uploads/assets/${assetId}/edits`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function cropUploadAsset(params: {
  assetId: string;
  crop: CropParameters;
}): Promise<AssetEditsResponse> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}/crop`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params.crop),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export interface FlattenAssetResponse {
  asset_id: string;
  source_asset_id: string;
  width: number;
  height: number;
  archivedSource: boolean;
}

export type RotationDegrees = 0 | 90 | 180 | 270;

export async function flattenUploadAsset(params: {
  assetId: string;
  rotationDegrees: RotationDegrees;
  straightenDegrees: number;
  cropNormalized?: CropParameters;
  redactRegionsNormalized?: CropParameters[];
}): Promise<FlattenAssetResponse> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}/flatten`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: 2,
      rotationDegrees: params.rotationDegrees,
      straightenDegrees: params.straightenDegrees,
      cropNormalized: params.cropNormalized,
      redactRegionsNormalized: params.redactRegionsNormalized ?? [],
      editSpace: "auto-oriented-rotated",
      output: { format: "jpeg", quality: 92 },
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export interface AudioWaveform {
  assetId: string;
  durationSeconds: number;
  sampleCount: number;
  peaks: number[];
}

export interface AudioTrimJob {
  id: string;
  sourceAssetId: string;
  targetAssetId?: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  state:
    | "prepared"
    | "downloading"
    | "rendering"
    | "uploaded"
    | "relationships_copied"
    | "verified"
    | "source_archived"
    | "complete"
    | "failed";
  progress: number;
  message: string;
  error?: string;
}

export async function fetchAudioWaveform(assetId: string): Promise<AudioWaveform> {
  const res = await fetch(`/api/v1/uploads/assets/${assetId}/waveform`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function createAudioTrim(params: {
  assetId: string;
  startSeconds: number;
  endSeconds: number;
}): Promise<AudioTrimJob> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}/trim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      startSeconds: params.startSeconds,
      endSeconds: params.endSeconds,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { job: AudioTrimJob };
  return body.job;
}

export async function fetchAudioTrimJob(jobId: string): Promise<AudioTrimJob> {
  const res = await fetch(`/api/v1/uploads/audio-trim-jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { job: AudioTrimJob };
  return body.job;
}

export interface VideoRotationJob {
  id: string;
  sourceAssetId: string;
  targetAssetId?: string;
  rotationDegrees: 90 | 180 | 270;
  durationSeconds: number;
  width?: number;
  height?: number;
  state:
    | "prepared"
    | "downloading"
    | "rendering"
    | "uploaded"
    | "relationships_copied"
    | "verified"
    | "source_archived"
    | "complete"
    | "failed";
  progress: number;
  message: string;
  error?: string;
}

export async function createVideoRotation(params: {
  assetId: string;
  rotationDegrees: 90 | 180 | 270;
}): Promise<VideoRotationJob> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}/rotate-video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rotationDegrees: params.rotationDegrees }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { job: VideoRotationJob };
  return body.job;
}

export async function fetchVideoRotationJob(jobId: string): Promise<VideoRotationJob> {
  const res = await fetch(`/api/v1/uploads/video-rotation-jobs/${encodeURIComponent(jobId)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { job: VideoRotationJob };
  return body.job;
}

export async function resetUploadAssetEdits(assetId: string): Promise<void> {
  const res = await fetch(`/api/v1/uploads/assets/${assetId}/edits`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function fetchUploadAssetAdjustments(assetId: string): Promise<AssetAdjustments> {
  const res = await fetch(`/api/v1/uploads/assets/${assetId}/adjustments`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function updateUploadAssetAdjustments(params: {
  assetId: string;
  adjustments: AssetAdjustments;
}): Promise<AssetAdjustments> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}/adjustments`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params.adjustments),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { adjustments?: AssetAdjustments };
  return body.adjustments ?? params.adjustments;
}

export async function deleteUploadAsset(params: {
  assetId: string;
}): Promise<void> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
}

export async function deleteUploadAssets(assetIds: string[]): Promise<string[]> {
  const res = await fetch("/api/v1/uploads/assets/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ asset_ids: assetIds }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { asset_ids?: string[] };
  return body.asset_ids ?? assetIds;
}

export async function fetchMapPlacements(): Promise<MapPlacement[]> {
  const res = await fetch("/api/v1/placements");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function uploadFiles(params: {
  files: File[];
  uploader?: UploadUploader;
  location: UploadPlacement;
  activityId?: number;
  onProgress?: (percent: number) => void;
}): Promise<UploadResult[]> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const file of params.files) form.append("files", file);
    if (params.uploader) {
      form.append("uploader", params.uploader.name);
      form.append("uploader_id", String(params.uploader.id));
    }
    form.append("placement_id", String(params.location.placement_id));
    if (params.activityId != null) form.append("activity_id", String(params.activityId));

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/v1/uploads");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      params.onProgress?.(Math.round((event.loaded / event.total) * 100));
    };

    xhr.onload = () => {
      let body: unknown = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        body = null;
      }

      if (xhr.status >= 200 && xhr.status < 300) {
        const results = (body as { results?: UploadResult[] } | null)?.results ?? [];
        resolve(results);
      } else {
        const message =
          (body as { error?: string } | null)?.error ?? `Upload failed with HTTP ${xhr.status}`;
        reject(new Error(message));
      }
    };

    xhr.onerror = () => reject(new Error("Upload network error"));
    xhr.send(form);
  });
}

/**
 * Google Drive integration
 */

export interface DriveFolder {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  driveId?: string;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  thumbnailLink?: string;
  isFolder: boolean;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
}

export interface DriveFoldersResponse {
  myDrive?: DriveFolder;
  subfolders?: DriveFolder[];
  folders?: DriveFolder[];
}

export interface DriveFolderStats {
  folderId: string;
  directFileCount: number;
  subfolderCount: number;
  nestedFileCount: number;
  totalFileCount: number;
}

export async function fetchDriveFolder(folderId: string): Promise<{
  folder: DriveFolder;
  path: DriveFolder[];
}> {
  const res = await fetch(`/api/v1/drive/folders/${encodeURIComponent(folderId)}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * Fetch folders for navigation (supports hierarchy and Shared Drives)
 * @param driveType "myDrive" or "sharedDrives"
 * @param parentId folder ID to list children from (for myDrive)
 * @param driveId Shared Drive ID (when navigating within a Shared Drive)
 */
export async function fetchDriveFolders(
  driveType: "myDrive" | "sharedDrives" = "myDrive",
  parentId: string = "root",
  driveId?: string
): Promise<DriveFoldersResponse> {
  const params = new URLSearchParams({ driveType });
  if (parentId !== "root") params.set("parentId", parentId);
  if (driveId) params.set("driveId", driveId);

  const res = await fetch(`/api/v1/drive/folders?${params.toString()}`);
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Please sign in with Google to access Drive");
    }
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchProjects(): Promise<ProjectOption[]> {
  const res = await fetch("/api/v1/projects");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchDriveFolderStats(
  folderIds: string[],
  driveId?: string,
): Promise<DriveFolderStats[]> {
  const res = await fetch("/api/v1/drive/folders/stats", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderIds, ...(driveId ? { driveId } : {}) }),
  });
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Please sign in with Google to access Drive");
    }
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = (await res.json()) as { stats: DriveFolderStats[] };
  return body.stats;
}

export async function fetchDriveFiles(
  folderId: string = "root",
  pageToken?: string,
  driveId?: string
): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ folderId });
  if (pageToken) params.set("pageToken", pageToken);
  if (driveId) params.set("driveId", driveId);

  const res = await fetch(`/api/v1/drive/files?${params.toString()}`);
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Please sign in with Google to access Drive");
    }
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export interface DriveSyncResult {
  fileId: string;
  fileName: string;
  status: "success" | "failed";
  assetId?: string;
  replacedAssetId?: string;
  error?: string;
}

export async function syncDriveFiles(params: {
  fileIds: string[];
  placementId?: number | null;
  activityId?: number | null;
}): Promise<DriveSyncResult[]> {
  const res = await fetch("/api/v1/drive/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Please sign in with Google to access Drive");
    }
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  const data = await res.json() as { results?: DriveSyncResult[] };
  return data.results ?? [];
}

export interface DriveLookupResult {
  status: "linked" | "already-linked" | "not-found" | "ambiguous";
  fileId?: string;
  fileName?: string;
  scope?: "site" | "project-documentation";
  placementId?: number;
  placementName?: string;
  activityId?: number;
  activityLabel?: string;
  matchCount?: number;
  matches?: Array<{ id: string; name: string }>;
  detail?: string;
}

export async function lookupUploadAssetDriveSource(assetId: string): Promise<DriveLookupResult> {
  const res = await fetch(`/api/v1/drive/assets/${encodeURIComponent(assetId)}/lookup`, {
    method: "POST",
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("Please sign in with Google to access Drive");
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export interface BulkDriveLookupResult {
  assetId: string;
  fileName: string;
  status: "linked" | "not-found" | "ambiguous" | "skipped" | "failed";
  placementId?: number;
  placementName?: string;
  placementTags?: string[];
  folderId?: string;
  folderName?: string;
  searchedFileName?: string;
  matches?: Array<{ id: string; name: string }>;
  fileId?: string;
  driveFileName?: string;
  error?: string;
}

export interface BulkDriveLookupSummary {
  scanned: number;
  candidates: number;
  linked: number;
  notFound: number;
  ambiguous: number;
  skipped: number;
  failed: number;
  results: BulkDriveLookupResult[];
}

export async function lookupMissingUploadAssetDriveSources(): Promise<BulkDriveLookupSummary> {
  const startRes = await fetch("/api/v1/drive/assets/lookup-missing", {
    method: "POST",
  });
  const startBody = await startRes.json().catch(() => ({})) as {
    jobId?: string;
    error?: string;
  };
  if (!startRes.ok && !(startRes.status === 409 && startBody.jobId)) {
    if (startRes.status === 401) throw new Error("Please sign in with Google to access Drive");
    throw new Error(startBody.error ?? `HTTP ${startRes.status}`);
  }

  const jobId = startBody.jobId;
  if (!jobId) throw new Error("Drive maintenance lookup did not return a job ID.");

  for (;;) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 1_000));
    const statusRes = await fetch(
      `/api/v1/drive/assets/lookup-missing/${encodeURIComponent(jobId)}`,
    );
    const statusBody = await statusRes.json().catch(() => ({})) as {
      status?: "running" | "completed" | "failed";
      summary?: BulkDriveLookupSummary;
      error?: string;
    };
    if (!statusRes.ok) {
      if (statusRes.status === 401) throw new Error("Please sign in with Google to access Drive");
      throw new Error(statusBody.error ?? `HTTP ${statusRes.status}`);
    }
    if (statusBody.status === "failed") {
      throw new Error(statusBody.error ?? "Drive maintenance lookup failed.");
    }
    if (statusBody.status === "completed" && statusBody.summary) {
      return statusBody.summary;
    }
  }
}

export async function reimportUploadAssetFromDrive(
  assetId: string,
  placementId?: number,
  asAudio = false,
): Promise<DriveSyncResult> {
  const res = await fetch(`/api/v1/drive/assets/${encodeURIComponent(assetId)}/reimport`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ placementId, asAudio }),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error("Please sign in with Google to access Drive");
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { result: DriveSyncResult };
  return body.result;
}
