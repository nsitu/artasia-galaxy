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
