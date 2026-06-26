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
  partner_name: string;
  address?: string;
  lat?: number;
  lng?: number;
}

export interface UploadOptions {
  placements: UploadPlacement[];
  tags: string[];
  uploaders: string[];
  limits: {
    maxFiles: number;
    maxFileBytes: number;
    maxBatchBytes: number;
  };
}

export interface UploadResult {
  fileName: string;
  status: "completed" | "failed";
  assetId?: string;
  error?: string;
}

export async function fetchUploadOptions(): Promise<UploadOptions> {
  const res = await fetch("/api/v1/uploads/options");
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export function uploadFiles(params: {
  files: File[];
  uploader: string;
  location: UploadPlacement;
  tags: string[];
  onProgress?: (percent: number) => void;
}): Promise<UploadResult[]> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    for (const file of params.files) form.append("files", file);
    form.append("uploader", params.uploader);
    form.append("placement_id", String(params.location.placement_id));
    form.append("tags", JSON.stringify(params.tags));

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
