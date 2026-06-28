export interface WpPlace {
  id: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  city?: string;
  postal_code?: string;
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

export async function getArtasiaPlacements(): Promise<WpArtasiaPlacement[]> {
  if (cache && Date.now() - cache.timestamp < CACHE_TTL_MS) {
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
    if (lastKnownGood) {
      console.warn("[WordPress] serving last-known-good cache");
      return lastKnownGood;
    }
    throw err;
  }
}
