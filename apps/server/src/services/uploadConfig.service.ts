import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ArtasiaLocation {
  partner: string;
  site: string;
}

export interface UploadConfig {
  locations: ArtasiaLocation[];
  tags: string[];
  uploaders: string[];
}

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const RESERVED_ALBUMS = new Set(["published"]);

function readJson<T>(fileName: string, fallback: T): T {
  const path = join(DATA_DIR, fileName);
  if (!existsSync(path)) return fallback;

  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (err) {
    console.warn(`[upload-config] failed to read ${path}: ${(err as Error).message}`);
    return fallback;
  }
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

function cleanLocations(input: unknown): ArtasiaLocation[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const locations: ArtasiaLocation[] = [];

  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const partner = cleanString((item as Record<string, unknown>).partner);
    const site = cleanString((item as Record<string, unknown>).site);
    if (!partner || !site) continue;
    const key = `${normalizeKey(partner)}|${normalizeKey(site)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    locations.push({ partner, site });
  }

  return locations;
}

function cleanStringList(input: unknown, options?: { excludeReservedAlbums?: boolean }) {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const values: string[] = [];

  for (const item of input) {
    const value = cleanString(item);
    if (!value) continue;
    const key = normalizeKey(value);
    if (options?.excludeReservedAlbums && RESERVED_ALBUMS.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }

  return values;
}

export function getUploadConfig(): UploadConfig {
  const locations = cleanLocations(readJson<unknown>("locations.json", []));
  const tags = cleanStringList(readJson<unknown>("upload-tags.json", []));
  const uploaders = cleanStringList(readJson<unknown>("uploaders.json", []), {
    excludeReservedAlbums: true,
  });

  return { locations, tags, uploaders };
}

export function findConfiguredLocation(partner: string, site: string) {
  const partnerKey = normalizeKey(partner);
  const siteKey = normalizeKey(site);
  return getUploadConfig().locations.find(
    (location) =>
      normalizeKey(location.partner) === partnerKey &&
      normalizeKey(location.site) === siteKey
  );
}

export function getAllowedTagNames(requestedTags: unknown) {
  const requested = cleanStringList(requestedTags);
  const config = getUploadConfig();
  const allowedByKey = new Map(config.tags.map((tag) => [normalizeKey(tag), tag]));
  return requested
    .map((tag) => allowedByKey.get(normalizeKey(tag)))
    .filter((tag): tag is string => Boolean(tag));
}

export function isConfiguredUploader(value: string) {
  const key = normalizeKey(value);
  return getUploadConfig().uploaders.some((uploader) => normalizeKey(uploader) === key);
}
