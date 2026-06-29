export interface WpPlace {
  id: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  city?: string;
  postal_code?: string;
  shared_with?: string;
}

export interface WpPartner {
  id: number;
  name: string;
  type: string;
  website?: string;
}

export interface WpPerson {
  id: number;
  name: string;
  role: string;
  email?: string;
  photo?: {
    id: number;
    url: string;
    mime_type: string;
    alt: string;
  } | null;
}

export interface WpProject {
  id: number;
  name: string;
  year: number;
  description: string;
}

export interface WpArtasiaPlacement {
  placement_id: number;
  placement_name: string;
  project: WpProject | null;
  program_context: string;
  is_earlyon: boolean;
  section?: string;
  delivery_weekday?: string;
  delivery_start_time?: string;
  delivery_end_time?: string;
  delivery_schedule?: string;
  participant_count?: number;
  participant_age?: string;
  place: WpPlace | null;
  partner: WpPartner | null;
  team_member: WpPerson | null;
}

const WORDPRESS_URL = process.env.WORDPRESS_URL ?? "https://artsforall.co";
const CACHE_TTL_MS = 60_000;

let cache: { data: WpArtasiaPlacement[]; timestamp: number } | null = null;
let lastKnownGood: WpArtasiaPlacement[] | null = null;

let uploadTagCache: { data: string[]; timestamp: number } | null = null;
let uploadTagLastKnownGood: string[] | null = null;

let uploaderCache: { data: WpPerson[]; timestamp: number } | null = null;
let uploaderLastKnownGood: WpPerson[] | null = null;

export function getWordPressConfig() {
  return { url: WORDPRESS_URL };
}

async function wpRequest(path: string): Promise<Response> {
  const url = `${WORDPRESS_URL}${path}`;
  console.log(`[WordPress] -> GET ${url}`);

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    throw new Error(
      `WordPress network error: ${(err as Error).message} — check WORDPRESS_URL (${WORDPRESS_URL})`
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `WordPress ${res.status} ${res.statusText} — ${url}\n${body.slice(0, 500)}`
    );
  }

  return res;
}

export async function getArtasiaPlacements({
  forceFresh = false,
}: { forceFresh?: boolean } = {}): Promise<WpArtasiaPlacement[]> {
  if (!forceFresh && cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
    return cache.data;
  }

  try {
    const res = await wpRequest("/wp-json/artasia/v1/placements");
    const data = (await res.json()) as WpArtasiaPlacement[];
    cache = { data, timestamp: Date.now() };
    lastKnownGood = data;
    return data;
  } catch (err) {
    console.warn(`[WordPress] failed to fetch placements: ${(err as Error).message}`);
    if (!forceFresh && lastKnownGood) {
      console.warn("[WordPress] serving last-known-good cache");
      return lastKnownGood;
    }
    throw err;
  }
}

interface WpActivity {
  id: number;
  name: string;
  project_id?: number;
  week?: number;
  description?: string;
}

export async function getUploadTags({
  forceFresh = false,
}: { forceFresh?: boolean } = {}): Promise<string[]> {
  if (!forceFresh && uploadTagCache && Date.now() - uploadTagCache.timestamp < CACHE_TTL_MS) {
    return uploadTagCache.data;
  }

  try {
    const res = await wpRequest("/wp-json/artasia/v1/activities");
    const activities = (await res.json()) as WpActivity[];
    const tags = Array.from(
      new Set(
        activities
          .map((activity) => activity.name?.trim())
          .filter((name): name is string => Boolean(name))
      )
    );
    uploadTagCache = { data: tags, timestamp: Date.now() };
    uploadTagLastKnownGood = tags;
    return tags;
  } catch (err) {
    console.warn(`[WordPress] failed to fetch activity upload tags: ${(err as Error).message}`);
    if (!forceFresh && uploadTagLastKnownGood) {
      console.warn("[WordPress] serving last-known-good activity upload tags");
      return uploadTagLastKnownGood;
    }
    throw err;
  }
}

export async function getArtasiaUploaders({
  forceFresh = false,
}: { forceFresh?: boolean } = {}): Promise<WpPerson[]> {
  if (!forceFresh && uploaderCache && Date.now() - uploaderCache.timestamp < CACHE_TTL_MS) {
    return uploaderCache.data;
  }

  try {
    const res = await wpRequest("/wp-json/artasia/v1/uploaders");
    const data = (await res.json()) as WpPerson[];
    uploaderCache = { data, timestamp: Date.now() };
    uploaderLastKnownGood = data;
    return data;
  } catch (err) {
    console.warn(`[WordPress] failed to fetch uploaders: ${(err as Error).message}`);
    if (!forceFresh && uploaderLastKnownGood) {
      console.warn("[WordPress] serving last-known-good uploaders");
      return uploaderLastKnownGood;
    }
    throw err;
  }
}
