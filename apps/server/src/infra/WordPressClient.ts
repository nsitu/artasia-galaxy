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
  acronym?: string;
  type: string;
  website?: string;
  brand_color_one?: string;
  brand_color_two?: string;
  logo?: {
    id: number;
    url: string;
    mime_type: string;
    alt: string;
  } | null;
  white_logo?: {
    id: number;
    url: string;
    mime_type: string;
    alt: string;
  } | null;
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
  placement_slug?: string;
  documentation_url?: string;
  documentation_pull_quote?: string;
  documentation_attribution?: string;
  project: WpProject | null;
  program_context: string;
  is_earlyon: boolean;
  section?: string;
  google_drive_folder_id?: string;
  delivery_weekday?: string;
  delivery_start_time?: string;
  delivery_end_time?: string;
  delivery_schedule?: string;
  participant_count?: number;
  participant_age?: string;
  place: WpPlace | null;
  partner: WpPartner | null;
  team_member: WpPerson | null;
  secondary_team_member: WpPerson | null;
}

export interface WpArtasiaAnecdote {
  id: number;
  title: string;
  content_html: string;
  placement_id: number;
  activity_id: number | null;
  person: {
    id: number;
    name: string;
  } | null;
  created_at: string;
}

const WORDPRESS_URL = process.env.WORDPRESS_URL ?? "https://artsforall.co";
const CACHE_TTL_MS = 60_000;

let cache: { data: WpArtasiaPlacement[]; timestamp: number } | null = null;
let lastKnownGood: WpArtasiaPlacement[] | null = null;

let uploadTagCache: { data: WpActivityInfo[]; timestamp: number } | null = null;
let uploadTagLastKnownGood: WpActivityInfo[] | null = null;

let uploaderCache: { data: WpPerson[]; timestamp: number } | null = null;
let uploaderLastKnownGood: WpPerson[] | null = null;

let anecdoteCache: { data: WpArtasiaAnecdote[]; timestamp: number } | null = null;
let anecdoteLastKnownGood: WpArtasiaAnecdote[] | null = null;

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
  colour?: string;
}

export async function getArtasiaAnecdotes({
  forceFresh = false,
  placementId,
}: { forceFresh?: boolean; placementId?: number } = {}): Promise<WpArtasiaAnecdote[]> {
  let anecdotes: WpArtasiaAnecdote[];
  if (!forceFresh && anecdoteCache && Date.now() - anecdoteCache.timestamp < CACHE_TTL_MS) {
    anecdotes = anecdoteCache.data;
  } else {
    try {
      const res = await wpRequest("/wp-json/artasia/v1/anecdotes");
      anecdotes = (await res.json()) as WpArtasiaAnecdote[];
      anecdoteCache = { data: anecdotes, timestamp: Date.now() };
      anecdoteLastKnownGood = anecdotes;
    } catch (err) {
      console.warn(`[WordPress] failed to fetch anecdotes: ${(err as Error).message}`);
      if (!forceFresh && anecdoteLastKnownGood) {
        console.warn("[WordPress] serving last-known-good anecdotes");
        anecdotes = anecdoteLastKnownGood;
      } else {
        throw err;
      }
    }
  }

  return placementId == null
    ? anecdotes
    : anecdotes.filter((anecdote) => anecdote.placement_id === placementId);
}

export interface WpActivityInfo {
  id: number;
  label: string;
  week?: number;
  description?: string;
  colour?: string;
}

export const ACTIVITY_ANCHOR_TAG_PREFIX = "activity:";

export function activityAnchorTag(activityId: number): string {
  return `${ACTIVITY_ANCHOR_TAG_PREFIX}${activityId}`;
}

export function isActivityAnchorTagName(value: string): boolean {
  return /^activity:\d+$/.test(value.trim().toLowerCase());
}

function activityUploadTagName(activity: WpActivity): string {
  const name = activity.name?.trim();
  if (!name) return "";
  return activity.week && activity.week > 0 ? `${activity.week} - ${name}` : name;
}

function compareActivitiesByWeek(a: WpActivity, b: WpActivity): number {
  const aWeek = a.week && a.week > 0 ? a.week : Number.MAX_SAFE_INTEGER;
  const bWeek = b.week && b.week > 0 ? b.week : Number.MAX_SAFE_INTEGER;
  if (aWeek !== bWeek) return aWeek - bWeek;
  return a.name.localeCompare(b.name);
}

export async function getUploadActivities({
  forceFresh = false,
}: { forceFresh?: boolean } = {}): Promise<WpActivityInfo[]> {
  if (!forceFresh && uploadTagCache && Date.now() - uploadTagCache.timestamp < CACHE_TTL_MS) {
    return uploadTagCache.data;
  }

  try {
    const res = await wpRequest("/wp-json/artasia/v1/activities");
    const activities = (await res.json()) as WpActivity[];
    const seen = new Set<number>();
    const result: WpActivityInfo[] = [];
    for (const activity of activities.sort(compareActivitiesByWeek)) {
      const label = activityUploadTagName(activity);
      if (!label || seen.has(activity.id)) continue;
      seen.add(activity.id);
      result.push({
        id: activity.id,
        label,
        ...(activity.week && activity.week > 0 ? { week: activity.week } : {}),
        ...(activity.description?.trim()
          ? { description: activity.description.trim() }
          : {}),
        ...(/^#[0-9a-f]{6}$/i.test(activity.colour ?? "")
          ? { colour: activity.colour }
          : {}),
      });
    }
    uploadTagCache = { data: result, timestamp: Date.now() };
    uploadTagLastKnownGood = result;
    return result;
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
