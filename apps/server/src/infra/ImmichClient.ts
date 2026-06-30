import { openAsBlob } from "node:fs";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

const IMMICH_URL = process.env.IMMICH_URL ?? "https://photos.artsforall.co";
const IMMICH_API_KEY = process.env.IMMICH_API_KEY ?? "";
const PUBLISHED_ALBUM_NAME = "Published";

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
  isTrashed?: boolean;
  duration: string;
  exifInfo?: {
    make?: string;
    model?: string;
    exifImageWidth?: number;
    exifImageHeight?: number;
    focalLength?: number;
    description?: string;
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

function isValidUUID(id: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isValid = uuidRegex.test(id);
  if (!isValid) {
    console.error(`[ImmichClient] Invalid UUID format: "${id}" (length: ${id.length})`);
  }
  return isValid;
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

export async function updateAssetLocation(assetId: string, params: {
  latitude: number;
  longitude: number;
}) {
  await immichRequest(`/assets/${assetId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export async function searchAssets(params: {
  albumId?: string;
  albumIds?: string[];
  personIds?: string[];
  tagIds?: string[];
  type?: "IMAGE" | "VIDEO";
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
  if (params.tagIds?.length) body.tagIds = params.tagIds;
  if (params.takenAfter) body.takenAfter = params.takenAfter;
  if (params.takenBefore) body.takenBefore = params.takenBefore;

  const res = await immichRequest("/search/metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return res.json();
}

export async function searchAssetIdsByTag(tagId: string): Promise<string[]> {
  const assetIds: string[] = [];
  const size = 100;
  for (const type of ["IMAGE", "VIDEO"] as const) {
    let page = 1;
    for (;;) {
      const res = await searchAssets({ tagIds: [tagId], page, size, type });
      for (const item of res.assets.items) assetIds.push(item.id);
      if (!res.assets.nextPage || res.assets.items.length < size) break;
      page += 1;
    }
  }
  return assetIds;
}

export async function listAssetIdsByTag(tagId: string): Promise<string[]> {
  return searchAssetIdsByTag(tagId);
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

export interface ImmichTag {
  id: string;
  name: string;
  value: string;
}

interface ImmichUploadResponse {
  id: string;
  status: string;
}

interface ImmichServerStats {
  usage: number;
  photos: number;
  videos: number;
  usagePhotos: number;
  usageVideos: number;
}

export async function listAlbums(): Promise<ImmichAlbum[]> {
  const res = await immichRequest("/albums");
  return res.json();
}

export async function findAlbumByName(name: string): Promise<ImmichAlbum | null> {
  const normalized = name.trim().toLowerCase();
  const albums = await listAlbums();
  return albums.find((album) => album.albumName.trim().toLowerCase() === normalized) ?? null;
}

export async function ensureAlbum(name: string): Promise<ImmichAlbum> {
  const existing = await findAlbumByName(name);
  if (existing) return existing;

  const res = await immichRequest("/albums", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumName: name }),
  });
  return res.json();
}

export async function ensureConfiguredAlbums(names: string[]) {
  for (const name of names) {
    try {
      await ensureAlbum(name);
    } catch (err) {
      console.warn(`[Immich] failed to ensure album "${name}": ${(err as Error).message}`);
    }
  }
}

export async function getPublishedAlbum(): Promise<ImmichAlbum> {
  return ensureAlbum(PUBLISHED_ALBUM_NAME);
}

export async function addAssetsToAlbum(albumId: string, assetIds: string[]) {
  if (assetIds.length === 0) return;
  await immichRequest(`/albums/${albumId}/assets`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: assetIds }),
  });
}

export async function removeAssetsFromAlbum(albumId: string, assetIds: string[]) {
  if (assetIds.length === 0) return;
  await immichRequest(`/albums/${albumId}/assets`, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids: assetIds }),
  });
}

export async function listTags(): Promise<ImmichTag[]> {
  const res = await immichRequest("/tags");
  return res.json();
}

export async function ensureTag(name: string): Promise<ImmichTag> {
  const normalized = name.trim().toLowerCase();
  const tags = await listTags();
  const existing = tags.find(
    (tag) =>
      tag.name.trim().toLowerCase() === normalized ||
      tag.value.trim().toLowerCase() === normalized
  );
  if (existing) return existing;

  const res = await immichRequest("/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function tagAsset(assetId: string, tagNames: string[]) {
  // Validate assetId is a UUID format
  if (!isValidUUID(assetId)) {
    const errorMsg = `Invalid asset ID format: "${assetId}" (length: ${assetId.length}). Expected UUID format (36 chars with hyphens).`;
    console.error(`[tagAsset] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  const uniqueNames = Array.from(
    new Set(tagNames.map((tag) => tag.trim()).filter(Boolean))
  );
  if (uniqueNames.length === 0) return;

  const tags = [];
  for (const name of uniqueNames) {
    tags.push(await ensureTag(name));
  }

  console.log(`[tagAsset] Tagging asset ${assetId} with tags: ${uniqueNames.join(", ")}`);
  
  await immichRequest("/tags/assets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assetIds: [assetId],
      tagIds: tags.map((tag) => tag.id),
    }),
  });
}

export async function tagAssets(assetIds: string[], tagIds: string[]) {
  if (assetIds.length === 0 || tagIds.length === 0) return;
  
  // Validate all assetIds are UUID format
  const invalidAssetIds = assetIds.filter(id => !isValidUUID(id));
  if (invalidAssetIds.length > 0) {
    throw new Error(`Invalid asset ID format(s): ${invalidAssetIds.join(", ")}. Expected UUID format.`);
  }

  // Validate all tagIds are UUID format
  const invalidTagIds = tagIds.filter(id => !isValidUUID(id));
  if (invalidTagIds.length > 0) {
    console.error(`[tagAssets] Invalid tag IDs: ${JSON.stringify(invalidTagIds)}`);
    throw new Error(`Invalid tag ID format(s): ${invalidTagIds.join(", ")}. Expected UUID format. Tags received: ${JSON.stringify(tagIds)}`);
  }

  console.log(`[tagAssets] Tagging ${assetIds.length} asset(s) with ${tagIds.length} tag(s)`);
  
  await immichRequest("/tags/assets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assetIds,
      tagIds,
    }),
  });
}

export async function untagAssets(assetIds: string[], tagIds: string[]) {
  if (assetIds.length === 0 || tagIds.length === 0) return;
  
  // Validate all assetIds are UUID format
  const invalidAssetIds = assetIds.filter(id => !isValidUUID(id));
  if (invalidAssetIds.length > 0) {
    throw new Error(`Invalid asset ID format(s): ${invalidAssetIds.join(", ")}. Expected UUID format.`);
  }

  // Validate all tagIds are UUID format
  const invalidTagIds = tagIds.filter(id => !isValidUUID(id));
  if (invalidTagIds.length > 0) {
    console.error(`[untagAssets] Invalid tag IDs to delete: ${JSON.stringify(invalidTagIds)}`);
    throw new Error(`Invalid tag ID format(s): ${invalidTagIds.join(", ")}. Expected UUID format. Tags received: ${JSON.stringify(tagIds)}`);
  }

  console.log(`[untagAssets] Removing ${tagIds.length} tag(s) from ${assetIds.length} asset(s)`);
  
  await immichRequest("/tags/assets", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assetIds,
      tagIds,
    }),
  });
}

export async function renameTag(tagId: string, newName: string): Promise<ImmichTag> {
  const res = await immichRequest(`/tags/${tagId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName.trim() }),
  });
  return res.json();
}

export async function getServerStatistics(): Promise<ImmichServerStats> {
  const res = await immichRequest("/server/statistics");
  return res.json();
}

export async function uploadAsset(params: {
  filePath: string;
  filename: string;
  mimeType: string;
  createdAt?: Date;
  modifiedAt?: Date;
}): Promise<ImmichUploadResponse> {
  const createdAt = params.createdAt ?? new Date();
  const modifiedAt = params.modifiedAt ?? createdAt;
  const form = new FormData();
  const blob = await openAsBlob(params.filePath, { type: params.mimeType });
  const checksum = await sha1File(params.filePath);
  const deviceAssetId = `artasia-galaxy:${checksum}`;

  form.append("assetData", blob, params.filename);
  form.append("deviceAssetId", deviceAssetId);
  form.append("deviceId", "artasia-galaxy");
  form.append("filename", params.filename);
  form.append("fileCreatedAt", createdAt.toISOString());
  form.append("fileModifiedAt", modifiedAt.toISOString());

  const res = await immichRequest("/assets", {
    method: "POST",
    headers: { "x-immich-checksum": checksum },
    body: form,
  });

  return res.json();
}

export async function uploadAssetStream(params: {
  stream: NodeJS.ReadableStream;
  filename: string;
  mimeType: string;
  deviceAssetId: string;
  createdAt?: Date;
  modifiedAt?: Date;
}): Promise<ImmichUploadResponse> {
  const createdAt = params.createdAt ?? new Date();
  const modifiedAt = params.modifiedAt ?? createdAt;
  
  // Hash the stream while reading it
  const hash = createHash("sha1");
  const chunks: Buffer[] = [];
  
  await new Promise<void>((resolve, reject) => {
    params.stream.on("data", (chunk) => {
      hash.update(chunk);
      chunks.push(chunk);
    });
    params.stream.on("error", reject);
    params.stream.on("end", () => resolve());
  });

  const checksum = hash.digest("hex");
  const uint8Arrays = chunks.map((chunk) => new Uint8Array(chunk));
  const blob = new Blob(uint8Arrays, { type: params.mimeType });

  const form = new FormData();
  form.append("assetData", blob, params.filename);
  form.append("deviceAssetId", params.deviceAssetId);
  form.append("deviceId", "artasia-galaxy");
  form.append("filename", params.filename);
  form.append("fileCreatedAt", createdAt.toISOString());
  form.append("fileModifiedAt", modifiedAt.toISOString());

  const res = await immichRequest("/assets", {
    method: "POST",
    headers: { "x-immich-checksum": checksum },
    body: form,
  });

  return res.json();
}

async function sha1File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha1");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
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
