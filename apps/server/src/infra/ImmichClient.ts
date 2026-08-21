import { openAsBlob } from "node:fs";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

const IMMICH_URL = process.env.IMMICH_URL ?? "https://photos.artsforall.co";
const IMMICH_API_KEY = process.env.IMMICH_API_KEY ?? "";
const PUBLISHED_ALBUM_NAME = "Published";
const IMMICH_LIST_CACHE_TTL_MS = 30_000;

let tagsCache: { expiresAt: number; value: ImmichTag[] } | null = null;
let tagsRequest: Promise<ImmichTag[]> | null = null;
let albumsCache: { expiresAt: number; value: ImmichAlbum[] } | null = null;
let albumsRequest: Promise<ImmichAlbum[]> | null = null;
const albumByNameCache = new Map<string, {
  expiresAt: number;
  value: ImmichAlbum | null;
}>();
const albumByNameRequests = new Map<string, Promise<ImmichAlbum | null>>();
const tagAssetIdsCache = new Map<string, {
  expiresAt: number;
  value: string[];
}>();
const tagAssetIdsRequests = new Map<string, Promise<string[]>>();

export interface ImmichAsset {
  id: string;
  deviceAssetId?: string;
  ownerId?: string;
  deviceId?: string;
  type: "IMAGE" | "VIDEO";
  width?: number | null;
  height?: number | null;
  originalFileName: string;
  originalPath: string;
  fileCreatedAt: string;
  fileModifiedAt: string;
  updatedAt: string;
  isFavorite: boolean;
  isArchived: boolean;
  isTrashed?: boolean;
  duration: string | number | null;
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
    orientation?: string | null;
    fileSizeInByte?: number;
  };
  people?: Array<{
    id: string;
    name: string;
    birthDate?: string;
  }>;
  tags?: ImmichTag[];
  visibility?: "archive" | "timeline" | "hidden" | "locked";
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
  init?: RequestInit,
  options?: { allowErrorStatus?: boolean }
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

  if (!res.ok && !options?.allowErrorStatus) {
    if (res.status === 401) {
      throw new Error(
        `Immich authentication failed (401) for ${init?.method ?? "GET"} ${path} — the running Atlas container may have an invalid, expired, or stale IMMICH_API_KEY`,
      );
    }
    if (res.status === 403) {
      throw new Error(
        `Immich permission denied (403) for ${init?.method ?? "GET"} ${path} — update the API key permissions for this operation`,
      );
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
  size: "thumbnail" | "preview" = "preview",
  options?: { edited?: boolean }
): Promise<Response> {
  const params = new URLSearchParams({ size });
  if (options?.edited) params.set("edited", "true");
  return immichRequest(
    `/assets/${assetId}/thumbnail?${params.toString()}`,
    undefined,
    { allowErrorStatus: true },
  );
}

export async function regenerateAssetThumbnail(assetId: string): Promise<void> {
  if (!isValidUUID(assetId)) {
    throw new Error(`Cannot regenerate thumbnail for invalid asset ID: ${assetId}`);
  }

  await immichRequest("/assets/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assetIds: [assetId],
      name: "regenerate-thumbnail",
    }),
  });
}

export async function getAssetOriginal(
  assetId: string,
  options?: { range?: string; allowErrorStatus?: boolean },
): Promise<Response> {
  return immichRequest(
    `/assets/${assetId}/original`,
    options?.range
      ? { headers: { Range: options.range } }
      : undefined,
    { allowErrorStatus: options?.allowErrorStatus },
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

export async function updateAssetDescription(assetId: string, description: string) {
  await immichRequest(`/assets/${assetId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description }),
  });
}

export async function updateAsset(assetId: string, params: {
  description?: string;
  isFavorite?: boolean;
  latitude?: number;
  longitude?: number;
  dateTimeOriginal?: string;
  visibility?: "archive" | "timeline" | "hidden" | "locked";
}) {
  const res = await immichRequest(`/assets/${assetId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json() as Promise<ImmichAsset>;
}

export async function copyAssetRelationships(sourceId: string, targetId: string) {
  await immichRequest("/assets/copy", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sourceId,
      targetId,
      albums: true,
      favorite: true,
      sharedLinks: true,
      sidecar: true,
      stack: true,
    }),
  });
}

export interface ImmichCropParameters {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImmichAssetEditAction {
  action: "crop" | "rotate" | "mirror";
  parameters: ImmichCropParameters | { angle: number } | { axis: "horizontal" | "vertical" };
}

export interface ImmichAssetEdits {
  assetId: string;
  edits: Array<ImmichAssetEditAction & { id?: string }>;
}

export async function getAssetEdits(assetId: string): Promise<ImmichAssetEdits> {
  const res = await immichRequest(`/assets/${assetId}/edits`);
  return res.json();
}

export async function editAsset(assetId: string, edits: ImmichAssetEditAction[]): Promise<ImmichAssetEdits> {
  const res = await immichRequest(`/assets/${assetId}/edits`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ edits }),
  });
  return res.json();
}

export async function removeAssetEdits(assetId: string) {
  await immichRequest(`/assets/${assetId}/edits`, {
    method: "DELETE",
  });
}

export async function deleteAssets(assetIds: string[]) {
  if (assetIds.length === 0) return;

  const invalidAssetIds = assetIds.filter((id) => !isValidUUID(id));
  if (invalidAssetIds.length > 0) {
    throw new Error(`Invalid asset ID format(s): ${invalidAssetIds.join(", ")}. Expected UUID format.`);
  }

  await immichRequest("/assets", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      force: true,
      ids: assetIds,
    }),
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
  withExif?: boolean;
  withPeople?: boolean;
  visibility?: "archive" | "timeline" | "hidden" | "locked";
  takenAfter?: string;
  takenBefore?: string;
}): Promise<ImmichSearchResponse> {
  const body: Record<string, unknown> = {
    page: params.page ?? 1,
    size: params.size ?? 100,
    withExif: params.withExif ?? true,
    withPeople: params.withPeople ?? true,
  };

  if (params.type) body.type = params.type;
  if (params.albumId) body.albumId = params.albumId;
  if (params.albumIds?.length) body.albumIds = params.albumIds;
  if (params.personIds?.length) body.personIds = params.personIds;
  if (params.tagIds?.length) body.tagIds = params.tagIds;
  if (params.visibility) body.visibility = params.visibility;
  if (params.takenAfter) body.takenAfter = params.takenAfter;
  if (params.takenBefore) body.takenBefore = params.takenBefore;

  const res = await immichRequest("/search/metadata", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  return res.json();
}

export async function searchSimilarAssets(params: {
  assetId: string;
  albumIds?: string[];
  type?: "IMAGE" | "VIDEO";
  size?: number;
}): Promise<ImmichAsset[]> {
  if (!isValidUUID(params.assetId)) {
    throw new Error(`Cannot search similar assets for invalid asset ID: ${params.assetId}`);
  }

  const body: Record<string, unknown> = {
    queryAssetId: params.assetId,
    size: params.size ?? 50,
    withExif: true,
    visibility: "timeline",
  };
  if (params.albumIds?.length) body.albumIds = params.albumIds;
  if (params.type) body.type = params.type;

  const res = await immichRequest("/search/smart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await res.json() as ImmichSearchResponse;
  return response.assets?.items ?? [];
}

export async function searchContextAssets(params: {
  query: string;
  albumIds?: string[];
  type?: "IMAGE" | "VIDEO";
  size?: number;
}): Promise<ImmichAsset[]> {
  const query = params.query.trim();
  if (!query) return [];

  const body: Record<string, unknown> = {
    query,
    size: params.size ?? 500,
    withExif: true,
    visibility: "timeline",
  };
  if (params.albumIds?.length) body.albumIds = params.albumIds;
  if (params.type) body.type = params.type;

  const res = await immichRequest("/search/smart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const response = await res.json() as ImmichSearchResponse;
  return response.assets?.items ?? [];
}

export async function searchAssetIdsByTag(tagId: string): Promise<string[]> {
  const cached = tagAssetIdsCache.get(tagId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = tagAssetIdsRequests.get(tagId);
  if (pending) return pending;

  const request = loadAssetIdsByTag(tagId)
    .then((value) => {
      tagAssetIdsCache.set(tagId, {
        expiresAt: Date.now() + IMMICH_LIST_CACHE_TTL_MS,
        value,
      });
      return value;
    })
    .finally(() => {
      tagAssetIdsRequests.delete(tagId);
    });
  tagAssetIdsRequests.set(tagId, request);
  return request;
}

async function loadAssetIdsByTag(tagId: string): Promise<string[]> {
  const assetIds: string[] = [];
  const size = 500;
  let page = 1;
  for (;;) {
    const res = await searchAssets({
      tagIds: [tagId],
      page,
      size,
      visibility: "timeline",
      withExif: false,
      withPeople: false,
    });
    for (const item of res.assets.items) assetIds.push(item.id);
    if (!res.assets.nextPage || res.assets.items.length < size) break;
    page += 1;
  }
  return assetIds;
}

export async function listAssetIdsByTag(tagId: string): Promise<string[]> {
  return searchAssetIdsByTag(tagId);
}

export async function searchAssetIdsByTags(
  tagIds: Iterable<string>,
  concurrency = 8,
): Promise<Map<string, string[]>> {
  const uniqueTagIds = Array.from(new Set(tagIds));
  const results = new Map<string, string[]>();
  let cursor = 0;

  async function worker() {
    while (cursor < uniqueTagIds.length) {
      const tagId = uniqueTagIds[cursor++];
      results.set(tagId, await searchAssetIdsByTag(tagId));
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(1, concurrency), uniqueTagIds.length) },
      worker,
    ),
  );
  return results;
}

export interface ImmichAlbum {
  id: string;
  albumName: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  ownerId?: string;
  albumThumbnailAssetId: string | null;
  assetCount: number;
  shared?: boolean;
  isShared?: boolean;
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

export async function listAlbums(options?: { forceFresh?: boolean }): Promise<ImmichAlbum[]> {
  if (!options?.forceFresh && albumsCache && albumsCache.expiresAt > Date.now()) {
    return albumsCache.value;
  }
  if (!options?.forceFresh && albumsRequest) return albumsRequest;

  const request = immichRequest("/albums")
    .then((res) => res.json() as Promise<ImmichAlbum[]>)
    .then((value) => {
      albumsCache = { expiresAt: Date.now() + IMMICH_LIST_CACHE_TTL_MS, value };
      return value;
    })
    .finally(() => {
      albumsRequest = null;
    });
  albumsRequest = request;
  return request;
}

export async function findAlbumByName(name: string): Promise<ImmichAlbum | null> {
  const normalized = name.trim().toLowerCase();
  const cached = albumByNameCache.get(normalized);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = albumByNameRequests.get(normalized);
  if (pending) return pending;

  const params = new URLSearchParams({ name: name.trim() });
  const request = immichRequest(`/albums?${params.toString()}`)
    .then((res) => res.json() as Promise<ImmichAlbum[]>)
    .then((matches) =>
      matches.find((album) => album.albumName.trim().toLowerCase() === normalized) ?? null,
    )
    .catch(async () => {
      const albums = await listAlbums();
      return albums.find((album) => album.albumName.trim().toLowerCase() === normalized) ?? null;
    })
    .then((value) => {
      albumByNameCache.set(normalized, {
        expiresAt: Date.now() + IMMICH_LIST_CACHE_TTL_MS,
        value,
      });
      return value;
    })
    .finally(() => {
      albumByNameRequests.delete(normalized);
    });
  albumByNameRequests.set(normalized, request);
  return request;
}

export async function ensureAlbum(name: string): Promise<ImmichAlbum> {
  const existing = await findAlbumByName(name);
  if (existing) return existing;

  const res = await immichRequest("/albums", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumName: name }),
  });
  const created = await res.json() as ImmichAlbum;
  const normalized = created.albumName.trim().toLowerCase();
  albumByNameCache.set(normalized, {
    expiresAt: Date.now() + IMMICH_LIST_CACHE_TTL_MS,
    value: created,
  });
  albumsCache = null;
  return created;
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
  if (tagsCache && tagsCache.expiresAt > Date.now()) return tagsCache.value;
  if (tagsRequest) return tagsRequest;

  const request = immichRequest("/tags")
    .then((res) => res.json() as Promise<ImmichTag[]>)
    .then((value) => {
      tagsCache = { expiresAt: Date.now() + IMMICH_LIST_CACHE_TTL_MS, value };
      return value;
    })
    .finally(() => {
      tagsRequest = null;
    });
  tagsRequest = request;
  return request;
}

export async function ensureTag(name: string, cachedTags?: ImmichTag[]): Promise<ImmichTag> {
  const normalized = name.trim().toLowerCase();
  const tags = cachedTags ?? await listTags();
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
  const created = await res.json() as ImmichTag;
  tagsCache = {
    expiresAt: Date.now() + IMMICH_LIST_CACHE_TTL_MS,
    value: [...(tagsCache?.value ?? []), created],
  };
  return created;
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

  // Fetch tag list once and reuse for all ensureTag calls
  const allTags = await listTags();
  const tags = [];
  for (const name of uniqueNames) {
    tags.push(await ensureTag(name, allTags));
  }

  await immichRequest("/tags/assets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      assetIds: [assetId],
      tagIds: tags.map((tag) => tag.id),
    }),
  });
  for (const tag of tags) tagAssetIdsCache.delete(tag.id);
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
  for (const tagId of tagIds) tagAssetIdsCache.delete(tagId);
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

  for (const tagId of tagIds) {
    await immichRequest(`/tags/${tagId}/assets`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: assetIds }),
    });
    tagAssetIdsCache.delete(tagId);
  }
}

export async function renameTag(tagId: string, newName: string): Promise<ImmichTag> {
  const res = await immichRequest(`/tags/${tagId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: newName.trim() }),
  });
  const renamed = await res.json() as ImmichTag;
  tagAssetIdsCache.delete(tagId);
  tagsCache = null;
  return renamed;
}

export async function getServerStatistics(): Promise<ImmichServerStats> {
  const res = await immichRequest("/server/statistics");
  return res.json();
}

export async function uploadAsset(params: {
  filePath: string;
  filename: string;
  mimeType: string;
  deviceAssetId?: string;
  createdAt?: Date;
  modifiedAt?: Date;
}): Promise<ImmichUploadResponse> {
  const createdAt = params.createdAt ?? new Date();
  const modifiedAt = params.modifiedAt ?? createdAt;
  const blob = await openAsBlob(params.filePath, { type: params.mimeType });
  const checksum = await sha1File(params.filePath);
  const deviceAssetId = params.deviceAssetId ?? `artasia-galaxy:${checksum}`;

  return uploadAssetBlob({
    blob,
    checksum,
    filename: params.filename,
    createdAt,
    modifiedAt,
    legacyDeviceAssetId: deviceAssetId,
  });
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

  return uploadAssetBlob({
    blob,
    checksum,
    filename: params.filename,
    createdAt,
    modifiedAt,
    legacyDeviceAssetId: params.deviceAssetId,
  });
}

export async function uploadAssetBuffer(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
  deviceAssetId: string;
  createdAt?: Date;
  modifiedAt?: Date;
}): Promise<ImmichUploadResponse> {
  const createdAt = params.createdAt ?? new Date();
  const modifiedAt = params.modifiedAt ?? createdAt;
  const checksum = createHash("sha1").update(params.buffer).digest("hex");
  const arrayBuffer = params.buffer.buffer.slice(
    params.buffer.byteOffset,
    params.buffer.byteOffset + params.buffer.byteLength,
  ) as ArrayBuffer;
  return uploadAssetBlob({
    blob: new Blob([arrayBuffer], { type: params.mimeType }),
    checksum,
    filename: params.filename,
    createdAt,
    modifiedAt,
    legacyDeviceAssetId: params.deviceAssetId,
  });
}

function createAssetUploadForm(params: {
  blob: Blob;
  filename: string;
  createdAt: Date;
  modifiedAt: Date;
  legacyDeviceAssetId?: string;
}) {
  const form = new FormData();
  form.append("assetData", params.blob, params.filename);
  if (params.legacyDeviceAssetId) {
    form.append("deviceAssetId", params.legacyDeviceAssetId);
    form.append("deviceId", "artasia-galaxy");
  }
  form.append("filename", params.filename);
  form.append("fileCreatedAt", params.createdAt.toISOString());
  form.append("fileModifiedAt", params.modifiedAt.toISOString());
  return form;
}

async function uploadAssetBlob(params: {
  blob: Blob;
  checksum: string;
  filename: string;
  createdAt: Date;
  modifiedAt: Date;
  legacyDeviceAssetId: string;
}): Promise<ImmichUploadResponse> {
  const modernResponse = await immichRequest(
    "/assets",
    {
      method: "POST",
      headers: { "x-immich-checksum": params.checksum },
      body: createAssetUploadForm({
        blob: params.blob,
        filename: params.filename,
        createdAt: params.createdAt,
        modifiedAt: params.modifiedAt,
      }),
    },
    { allowErrorStatus: true },
  );
  if (modernResponse.ok) return modernResponse.json();

  const modernError = await modernResponse.clone().text().catch(() => "");
  const requiresLegacyFields =
    modernResponse.status === 400 &&
    /deviceAssetId|deviceId/i.test(modernError);
  if (!requiresLegacyFields) {
    throw new Error(
      `Immich ${modernResponse.status} ${modernResponse.statusText} — upload failed\n${modernError.slice(0, 500)}`,
    );
  }

  const legacyResponse = await immichRequest("/assets", {
    method: "POST",
    headers: { "x-immich-checksum": params.checksum },
    body: createAssetUploadForm({
      ...params,
      legacyDeviceAssetId: params.legacyDeviceAssetId,
    }),
  });
  return legacyResponse.json();
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
    visibility: "timeline",
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
