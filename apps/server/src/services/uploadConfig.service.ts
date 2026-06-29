import {
  getArtasiaPlacements,
  getArtasiaUploaders,
  getUploadTags,
  type WpArtasiaPlacement,
  type WpPerson,
} from "../infra/WordPressClient.js";

export interface ArtasiaPlacement {
  placement_id: number;
  placement_name: string;
  team_member_id?: number;
  team_member_name?: string;
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

export interface ArtasiaMapPlacement {
  placement_id: number;
  placement_name: string;
  partner_name?: string;
  place_name?: string;
  address?: string;
  lat: number;
  lng: number;
}

export interface UploadUploader {
  id: number;
  name: string;
  role: string;
  email?: string;
}

export interface UploadConfig {
  placements: ArtasiaPlacement[];
  tags: string[];
  uploaders: UploadUploader[];
}

const RESERVED_ALBUMS = new Set(["published"]);

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

function mapWpUploader(uploader: WpPerson): UploadUploader {
  return {
    id: uploader.id,
    name: uploader.name,
    role: uploader.role,
    ...(uploader.email ? { email: uploader.email } : {}),
  };
}

function mapWpPlacement(wp: WpArtasiaPlacement): ArtasiaPlacement {
  const lat = wp.place?.lat;
  const lng = wp.place?.lng;
  return {
    placement_id: wp.placement_id,
    placement_name: wp.placement_name,
    ...(wp.team_member?.id ? { team_member_id: wp.team_member.id } : {}),
    ...(wp.team_member?.name ? { team_member_name: wp.team_member.name } : {}),
    partner_name: wp.partner?.name ?? "",
    ...(wp.delivery_weekday ? { delivery_weekday: wp.delivery_weekday } : {}),
    ...(wp.delivery_start_time ? { delivery_start_time: wp.delivery_start_time } : {}),
    ...(wp.delivery_end_time ? { delivery_end_time: wp.delivery_end_time } : {}),
    ...(wp.delivery_schedule ? { delivery_schedule: wp.delivery_schedule } : {}),
    ...(wp.place?.address ? { address: wp.place.address } : {}),
    ...(wp.place?.shared_with ? { shared_with: wp.place.shared_with } : {}),
    ...(lat != null && lat !== 0 ? { lat } : {}),
    ...(lng != null && lng !== 0 ? { lng } : {}),
  };
}

export async function getUploadConfig(): Promise<UploadConfig> {
  const [wpPlacements, wpUploaders] = await Promise.all([
    getArtasiaPlacements(),
    getArtasiaUploaders(),
  ]);
  const placements = wpPlacements.map(mapWpPlacement);
  const tags = cleanStringList(await getUploadTags());
  const uploaders = wpUploaders
    .map(mapWpUploader)
    .filter((uploader) => uploader.name && !RESERVED_ALBUMS.has(normalizeKey(uploader.name)));

  return { placements, tags, uploaders };
}

export async function getMapPlacements(): Promise<ArtasiaMapPlacement[]> {
  const wpPlacements = await getArtasiaPlacements();

  return wpPlacements.flatMap((wp) => {
    const lat = wp.place?.lat;
    const lng = wp.place?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      return [];
    }

    return [{
      placement_id: wp.placement_id,
      placement_name: wp.placement_name,
      ...(wp.partner?.name ? { partner_name: wp.partner.name } : {}),
      ...(wp.place?.name ? { place_name: wp.place.name } : {}),
      ...(wp.place?.address ? { address: wp.place.address } : {}),
      lat: lat as number,
      lng: lng as number,
    }];
  });
}

export async function findConfiguredPlacement(placement_id: number): Promise<WpArtasiaPlacement | undefined> {
  const wpPlacements = await getArtasiaPlacements();
  return wpPlacements.find((location) => location.placement_id === placement_id);
}

export async function getAllowedTagNames(requestedTags: unknown): Promise<string[]> {
  const requested = cleanStringList(requestedTags);
  const config = await getUploadConfig();
  const allowedByKey = new Map(config.tags.map((tag) => [normalizeKey(tag), tag]));
  return requested
    .map((tag) => allowedByKey.get(normalizeKey(tag)))
    .filter((tag): tag is string => Boolean(tag));
}

export async function findConfiguredUploader(params: {
  id?: number;
  name?: string;
}): Promise<UploadUploader | undefined> {
  const config = await getUploadConfig();
  if (params.id != null && Number.isFinite(params.id)) {
    return config.uploaders.find((uploader) => uploader.id === params.id);
  }

  const key = normalizeKey(params.name ?? "");
  if (!key) return undefined;
  return config.uploaders.find((uploader) => normalizeKey(uploader.name) === key);
}

export const PLACEMENT_ANCHOR_TAG_PREFIX = "placement:";
export const PLACEMENT_ANCHOR_TAG_PATTERN = /^placement:(\d+)$/;

export function placementAnchorTag(postId: number): string {
  return `${PLACEMENT_ANCHOR_TAG_PREFIX}${postId}`;
}

export function getPlacementTagNames(location: WpArtasiaPlacement): string[] {
  return nonEmptyValues([
    placementAnchorTag(location.placement_id),
    location.partner?.name,
    location.placement_name,
  ]);
}
