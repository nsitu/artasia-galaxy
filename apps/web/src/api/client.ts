export interface Photo {
  id: string;
  thumbnailUrl: string;
  previewUrl: string;
  width: number;
  height: number;
  orientation: "portrait" | "landscape" | "square";
  createdAt: string;
  fileName: string;
  isFavorite: boolean;
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

export interface Album {
  id: string;
  name: string;
  description: string;
  assetCount: number;
  thumbnailAssetId: string | null;
  createdAt: string;
  shared: boolean;
}

export async function fetchSlideshow(params: {
  albumIds?: string[];
  seed?: number;
  limit?: number;
}): Promise<{ photos: Photo[]; total: number }> {
  const res = await fetch("/api/v1/slideshow/query", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      albumIds: params.albumIds,
      shuffle: true,
      seed: params.seed ?? Date.now(),
      limit: params.limit ?? 100,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json();
}

export async function fetchAlbums(): Promise<Album[]> {
  const res = await fetch("/api/v1/albums");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export interface UploadPlacement {
  placement_id: number;
  placement_name: string;
  team_member_id?: number;
  team_member_name?: string;
  secondary_team_member_id?: number;
  secondary_team_member_name?: string;
  partner_name: string;
  delivery_weekday?: string;
  delivery_start_time?: string;
  delivery_end_time?: string;
  delivery_schedule?: string;
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
  partner_name?: string;
  place_name?: string;
  address?: string;
  lat: number;
  lng: number;
}

export interface ActivityOption {
  id: number;
  label: string;
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
  fileName: string;
  createdAt: string;
  updatedAt: string;
  archived?: boolean;
  trashed?: boolean;
  uploader_id?: number | null;
  uploader_name?: string | null;
  uploader_album_id?: string | null;
  thumbnailUrl: string;
  previewUrl: string;
}

export async function fetchUploadOptions(): Promise<UploadOptions> {
  const res = await fetch("/api/v1/uploads/options");
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

export async function fetchPlacementAssetSet(placementIds: number[], activityId?: number): Promise<PlacementAsset[]> {
  if (placementIds.length === 0) return [];
  const params = new URLSearchParams({
    placement_ids: placementIds.join(","),
  });
  if (activityId != null) params.set("activity_id", String(activityId));
  const res = await fetch(`/api/v1/uploads/assets?${params.toString()}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  const body = await res.json() as { assets?: PlacementAsset[] };
  return body.assets ?? [];
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
}): Promise<void> {
  const res = await fetch(`/api/v1/uploads/assets/${params.assetId}/activity-tag`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activity_id: params.activityId }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
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
  uploader: UploadUploader;
  location: UploadPlacement;
  activityId?: number;
  onProgress?: (percent: number) => void;
}): Promise<UploadResult[]> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const file of params.files) form.append("files", file);
    form.append("uploader", params.uploader.name);
    form.append("uploader_id", String(params.uploader.id));
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
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  isFolder: boolean;
  isImage: boolean;
  isVideo: boolean;
}

export async function fetchDriveFolders(): Promise<DriveFolder[]> {
  const res = await fetch("/api/v1/drive/folders");
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Please sign in with Google to access Drive");
    }
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function fetchDriveFiles(
  folderId: string = "root",
  pageToken?: string
): Promise<{ files: DriveFile[]; nextPageToken?: string }> {
  const params = new URLSearchParams({ folderId });
  if (pageToken) params.set("pageToken", pageToken);

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

