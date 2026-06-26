import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  getArtasiaProgramDeliveries,
  type WpArtasiaProgramDelivery,
} from "../infra/WordPressClient.js";

export interface ArtasiaProgramDelivery {
  program_delivery_id: number;
  program_delivery_name: string;
  partner_name: string;
  address?: string;
  lat?: number;
  lng?: number;
}

export interface UploadConfig {
  programDeliveries: ArtasiaProgramDelivery[];
  tags: string[];
  uploaders: string[];
}

function resolveDataDir() {
  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  const candidates = [
    join(process.cwd(), "data"),
    join(process.cwd(), "../../data"),
  ];

  return candidates.find((candidate) => existsSync(join(candidate, "upload-tags.json"))) ?? candidates[0];
}

const DATA_DIR = resolveDataDir();
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

function nonEmptyValues(values: Array<string | undefined>) {
  return values
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

function cleanStringList(input: unknown, options?: { excludeReservedAlbums?: boolean }) {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const values: string[] = [];

  for (const item of input) {
    const value = cleanString(item);
    if (!value) continue;
    const key = value.toLowerCase();
    if (options?.excludeReservedAlbums && RESERVED_ALBUMS.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(value);
  }

  return values;
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase();
}

function mapWpProgramDelivery(wp: WpArtasiaProgramDelivery): ArtasiaProgramDelivery {
  const lat = wp.place?.lat;
  const lng = wp.place?.lng;
  return {
    program_delivery_id: wp.program_delivery_id,
    program_delivery_name: wp.program_delivery_name,
    partner_name: wp.partner?.name ?? "",
    ...(wp.place?.address ? { address: wp.place.address } : {}),
    ...(lat != null && lat !== 0 ? { lat } : {}),
    ...(lng != null && lng !== 0 ? { lng } : {}),
  };
}

export async function getUploadConfig(): Promise<UploadConfig> {
  const wpProgramDeliveries = await getArtasiaProgramDeliveries();
  const programDeliveries = wpProgramDeliveries.map(mapWpProgramDelivery);
  const tags = cleanStringList(readJson<unknown>("upload-tags.json", []));
  const uploaders = cleanStringList(readJson<unknown>("uploaders.json", []), {
    excludeReservedAlbums: true,
  });

  return { programDeliveries, tags, uploaders };
}

export async function findConfiguredProgramDelivery(program_delivery_id: number): Promise<WpArtasiaProgramDelivery | undefined> {
  const wpProgramDeliveries = await getArtasiaProgramDeliveries();
  return wpProgramDeliveries.find((location) => location.program_delivery_id === program_delivery_id);
}

export async function getAllowedTagNames(requestedTags: unknown): Promise<string[]> {
  const requested = cleanStringList(requestedTags);
  const config = await getUploadConfig();
  const allowedByKey = new Map(config.tags.map((tag) => [normalizeKey(tag), tag]));
  return requested
    .map((tag) => allowedByKey.get(normalizeKey(tag)))
    .filter((tag): tag is string => Boolean(tag));
}

export async function isConfiguredUploader(value: string): Promise<boolean> {
  const key = normalizeKey(value);
  const config = await getUploadConfig();
  return config.uploaders.some((uploader) => normalizeKey(uploader) === key);
}

export function getProgramDeliveryTagNames(location: WpArtasiaProgramDelivery): string[] {
  return nonEmptyValues([location.partner?.name, location.program_delivery_name]);
}
