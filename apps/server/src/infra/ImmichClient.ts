const IMMICH_URL = process.env.IMMICH_URL ?? "https://photos.artsforall.co";
const IMMICH_API_KEY = process.env.IMMICH_API_KEY ?? "";

export interface ImmichAsset {
  id: string;
  deviceAssetId: string;
  ownerId: string;
  deviceId: string;
  type: "IMAGE" | "VIDEO";
  originalFileName: string;
  originalPath: string;
  fileCreatedAt: string;
  fileModifiedAt: string;
  updatedAt: string;
  isFavorite: boolean;
  isArchived: boolean;
  duration: string;
  exifInfo?: {
    make?: string;
    model?: string;
    exifImageWidth?: number;
    exifImageHeight?: number;
    focalLength?: number;
    latitude?: number;
    longitude?: number;
    city?: string;
    state?: string;
    country?: string;
  };
  people?: Array<{
    id: string;
    name: string;
    birthDate?: string;
  }>;
  checksum: string;
}

interface ImmichSearchResponse {
  assets: {
    items: ImmichAsset[];
    nextPage?: string;
  };
}

export function getImmichConfig() {
  return { url: IMMICH_URL, keyPrefix: IMMICH_API_KEY.slice(0, 6) + "..." };
}

async function immichRequest(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = `${IMMICH_URL}/api${path}`;
  const headers = new Headers(init?.headers);
  headers.set("x-api-key", IMMICH_API_KEY);

  console.log(`[Immich] → ${init?.method ?? "GET"} ${url}`);

  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers,
      signal: init?.signal,
    });
  } catch (err) {
    throw new Error(
      `Immich network error: ${(err as Error).message} — check IMMICH_URL (${IMMICH_URL})`
    );
  }

  if (!res.ok) {
    if (res.status === 401) {
      throw new Error(`Immich auth failed (401) — check IMMICH_API_KEY permissions`);
    }
    const body = await res.text().catch(() => "");
    throw new Error(
      `Immich ${res.status} ${res.statusText} — ${url}\n${body.slice(0, 500)}`
    );
  }

  return res;
}

export async function checkImmichHealth(): Promise<boolean> {
  const res = await immichRequest("/search/metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ size: 1, type: "IMAGE" }),
  });
  return res.ok;
}

export async function getAssetThumbnail(
  assetId: string,
  size: "thumbnail" | "preview" = "preview"
): Promise<Response> {
  return immichRequest(
    `/assets/${assetId}/thumbnail?size=${size}`,
  );
}

export async function getAssetOriginal(
  assetId: string,
): Promise<Response> {
  return immichRequest(
    `/assets/${assetId}/original`,
  );
}

export async function getAsset(assetId: string): Promise<ImmichAsset> {
  const res = await immichRequest(`/assets/${assetId}`);
  return res.json();
}

export async function searchAssets(params: {
  albumId?: string;
  albumIds?: string[];
  personIds?: string[];
  type?: "IMAGE" | "VIDEO" | "ALL";
  page?: number;
  size?: number;
  takenAfter?: string;
  takenBefore?: string;
}): Promise<ImmichSearchResponse> {
  const body: Record<string, unknown> = {
    page: params.page ?? 1,
    size: params.size ?? 100,
    type: params.type ?? "IMAGE",
    withExif: true,
    withPeople: true,
  };

  if (params.albumId) body.albumId = params.albumId;
  if (params.albumIds?.length) body.albumIds = params.albumIds;
  if (params.personIds?.length) body.personIds = params.personIds;
  if (params.takenAfter) body.takenAfter = params.takenAfter;
  if (params.takenBefore) body.takenBefore = params.takenBefore;

  const res = await immichRequest("/search/metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return res.json();
}

export interface ImmichAlbum {
  id: string;
  albumName: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  ownerId: string;
  albumThumbnailAssetId: string | null;
  assetCount: number;
  shared: boolean;
}

export async function listAlbums(): Promise<ImmichAlbum[]> {
  const res = await immichRequest("/albums");
  return res.json();
}

export async function randomAssets(params: {
  albumId?: string;
  personIds?: string[];
  type?: "IMAGE";
  size?: number;
}): Promise<{ assets: ImmichAsset[] }> {
  const body: Record<string, unknown> = {
    size: params.size ?? 50,
    type: params.type ?? "IMAGE",
  };

  if (params.albumId) body.albumId = params.albumId;
  if (params.personIds?.length) body.personIds = params.personIds;

  const res = await immichRequest("/search/random", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return res.json();
}
