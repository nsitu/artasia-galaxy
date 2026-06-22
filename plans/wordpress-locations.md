# Artasia Locations: WordPress Plugin + Node.js Integration Plan

## Overview

Replace `data/locations.json` with a WordPress plugin that manages artasia locations through custom post types, exposed to the Node.js backend via a custom REST endpoint.

**Decisions locked in:**

1. **Custom REST endpoint** `/wp-json/artasia/v1/locations` — single request, fully-expanded shape, zero client-side joins
2. **WP-only, no `locations.json` fallback** — clean cutover
3. **Both sides implemented** — WordPress plugin PHP + Node.js client + refactored upload flow

---

## Current State

- `data/locations.json` holds a flat array of `{partner, site, address?, lat?, lng?}` objects (currently placeholder values; real values live on the production VM at `/opt/artasia-galaxy/data/locations.json`)
- Consumed solely by the **upload feature**: drives the upload dropdown, Immich asset tagging (`partner` + `site` as tags), and GPS fallback when uploaded media lacks EXIF coordinates
- No map rendering or gallery display uses location data
- `WORDPRESS_URL` is already plumbed through `docker-compose.yml` and `.env` but no code reads it
- `ImmichClient.ts` is the existing external API client pattern to follow
- No caching of location config currently — `getUploadConfig()` re-reads `locations.json` from disk on every request

### Key files in the current flow

| File | Role |
|---|---|
| `data/locations.json` | Source of truth: array of `{partner, site, address, lat, lng}` |
| `apps/server/src/services/uploadConfig.service.ts` | Reads + validates `locations.json`; exports `getUploadConfig()`, `findConfiguredLocation(partner, site)` |
| `apps/server/src/routes/uploads.ts` | `/api/v1/uploads/options` returns config; `POST /api/v1/uploads` validates location, tags assets with `partner` + `site`, applies GPS fallback |
| `apps/server/src/infra/ImmichClient.ts` | Existing external API client pattern (template for `WordPressClient.ts`) |
| `apps/web/src/api/client.ts` | Frontend API client; defines `UploadLocation` interface; `fetchUploadOptions()` + `uploadFiles()` |
| `apps/web/src/components/ui/UploadPanel.tsx` | Upload UI; renders location dropdown keyed by `${partner}\|\|${site}` |

---

## WordPress Plugin

### Plugin file structure

```
apps/wp-artasia-locations/
  wp-artasia-locations.php
  includes/
    post-types.php
    meta-fields.php
    meta-boxes.php
    rest-fields.php
    admin-columns.php
  assets/
    admin.js
    admin.css
```

### `wp-artasia-locations.php` — Main plugin file

- Plugin header (`Plugin Name: Artasia Locations`)
- `require_once` all includes
- Activation hook: flush rewrite rules (for CPTs)

### `includes/post-types.php` — Register 3 custom post types

| Post type | REST base | Supports | Description |
|---|---|---|---|
| `artasia_venue` | `artasia_venue` | `title` | Fixed physical place |
| `artasia_site` | `artasia_site` | `title` | One year's activation at a venue with a community/program context |
| `artasia_context` | `artasia_context` | `title` | Partner/program/community grouping |

All: `show_in_rest => true`, `public => true`, `has_archive => false`, exclude `editor` (no content body needed).

### `includes/meta-fields.php` — Register post meta

All meta registered with `register_post_meta()`, `single => true`, `show_in_rest => true`.

#### `artasia_venue` meta

| Meta key | Type | Default | Notes |
|---|---|---|---|
| `artasia_address` | string | `''` | Street address |
| `artasia_lat` | number | `0` | Latitude (-90..90) |
| `artasia_lng` | number | `0` | Longitude (-180..180) |
| `artasia_city` | string | `''` | Optional |
| `artasia_postal_code` | string | `''` | Optional |
| `artasia_accessibility_notes` | string | `''` | Optional |

#### `artasia_site` meta

| Meta key | Type | Default | Notes |
|---|---|---|---|
| `artasia_venue_id` | integer | `0` | Post ID of related `artasia_venue` |
| `artasia_context_id` | integer | `0` | Post ID of related `artasia_context` |
| `artasia_program_year` | integer | `0` | e.g. 2026 |
| `artasia_section` | string | `''` | e.g. "A" |
| `artasia_participant_count` | integer | `0` | |
| `artasia_participant_age` | string | `''` | e.g. "5-7" |
| `artasia_start_date` | string | `''` | Optional, date format |
| `artasia_end_date` | string | `''` | Optional, date format |

#### `artasia_context` meta

| Meta key | Type | Default | Notes |
|---|---|---|---|
| `artasia_context_type` | string | `''` | Select: Partner Organization, Program, Community Group, School Board, Other |
| `artasia_website` | string | `''` | Optional, URL |
| `artasia_contact_notes` | string | `''` | Optional |

### `includes/meta-boxes.php` — Admin editing UI

#### Site Details meta box (on `artasia_site` edit screen)

```
Site Details
------------
Program Year: [2026      ]
Venue:        [Prince of Wales Elementary School v]
Context:      [YMCA / Artasia Hamilton v]
Section:      [A         ]
Participants: [26        ]
Ages:         [5-7       ]
Start Date:   [          ]
End Date:     [          ]
```

- Venue dropdown: `get_posts(['post_type' => 'artasia_venue', 'numberposts' => -1])`
- Context dropdown: `get_posts(['post_type' => 'artasia_context', 'numberposts' => -1])`
- `save_post` hook persists meta with sanitization (`sanitize_text_field`, `intval`, `floatval`)

#### Venue Details meta box (on `artasia_venue` edit screen)

- Address (text), Latitude (number), Longitude (number), City (text), Postal Code (text), Accessibility Notes (textarea)

#### Context Details meta box (on `artasia_context` edit screen)

- Type (`<select>`: Partner Organization, Program, Community Group, School Board, Other)
- Website (URL input)
- Contact Notes (textarea)

### `includes/rest-fields.php` — Custom REST endpoint

```php
register_rest_route('artasia/v1', '/locations', [
  'methods'             => 'GET',
  'callback'            => 'artasia_get_expanded_locations',
  'permission_callback' => '__return_true',  // public read
]);
```

#### `artasia_get_expanded_locations()` logic

1. `WP_Query` all published `artasia_site` posts (orderby date, ascending)
2. Collect all unique `artasia_venue_id` and `artasia_context_id` values
3. Single `WP_Query` with `post__in` for all venue IDs -> build lookup map
4. Single `WP_Query` with `post__in` for all context IDs -> build lookup map
5. For each site, assemble the expanded object with nested venue + context
6. Return `rest_ensure_response($array)`

#### Response shape

```json
[
  {
    "site_id": 123,
    "site_name": "Prince of Wales - Artasia 2026",
    "program_year": 2026,
    "section": "A",
    "participant_count": 26,
    "participant_age": "5-7",
    "venue": {
      "id": 45,
      "name": "Prince of Wales Elementary School",
      "address": "77 Melrose Ave N, Hamilton",
      "lat": 43.25249507156775,
      "lng": -79.83204157570965,
      "city": "Hamilton",
      "postal_code": "L8L 7R5"
    },
    "context": {
      "id": 88,
      "name": "YMCA",
      "type": "Partner Organization",
      "website": "https://ymca.ca"
    }
  }
]
```

### `includes/admin-columns.php` — Admin list table columns

| Post type | Columns |
|---|---|
| `artasia_site` | Site Name (title), Venue, Context, Year, Section, Participants |
| `artasia_venue` | Venue Name (title), Address, City |
| `artasia_context` | Name (title), Type, Website |

---

## Node.js Side

### `apps/server/src/infra/WordPressClient.ts` (new file)

Follows the `ImmichClient.ts` pattern.

- Env vars: `WORDPRESS_URL` (no auth needed — endpoint is public read)
- `wpRequest(path)` with network error handling and descriptive Error messages
- `getArtasiaLocations()` — GET `${WP_URL}/wp-json/artasia/v1/locations`
- **In-memory cache**: 60-second TTL + last-known-good retention (since WordPress is network-accessed, unlike `locations.json` which was disk reads)
- Logs each WP request (matching `ImmichClient` logging style)

#### TypeScript interfaces

```ts
export interface WpVenue {
  id: number;
  name: string;
  address: string;
  lat: number;
  lng: number;
  city?: string;
  postal_code?: string;
}

export interface WpContext {
  id: number;
  name: string;
  type: string;
  website?: string;
}

export interface WpArtasiaLocation {
  site_id: number;
  site_name: string;
  program_year: number;
  section?: string;
  participant_count?: number;
  participant_age?: string;
  venue: WpVenue;
  context: WpContext;
}
```

### `apps/server/src/services/uploadConfig.service.ts` (refactored)

- Remove `locations.json` reading and `cleanLocations()`
- `getUploadConfig()` still returns `{locations, tags, uploaders}`; `locations` now comes from `WordPressClient.getArtasiaLocations()` mapped to the frontend shape
- `findConfiguredLocation(site_id: number)` — lookup by `site_id` (replaces string-based `partner`/`site` matching)
- `upload-tags.json` and `uploaders.json` remain file-based (unchanged)

### `apps/server/src/routes/uploads.ts` (refactored)

- `POST /api/v1/uploads`: read `site_id` from form body instead of `partner` + `site`
- Validate with `findConfiguredLocation(site_id)`
- Tags: `[...allowedUserTags, location.context.name, location.site_name]`
- GPS fallback: `location.venue.lat`, `location.venue.lng`

### `apps/web/src/api/client.ts` (refactored)

New `UploadLocation` interface:

```ts
export interface UploadLocation {
  site_id: number;
  site_name: string;
  context_name: string;
  address?: string;
  lat?: number;
  lng?: number;
}
```

`uploadFiles()` sends `site_id` form field instead of `partner` + `site`.

### `apps/web/src/components/ui/UploadPanel.tsx` (refactored)

- Dropdown key: `site_id` (number, not string concatenation)
- Dropdown label: `${context_name} - ${site_name}`
- Passes `site_id` to `uploadFiles()`

### Environment variables

Add to `docker-compose.yml` and `.env.example`:

```env
WORDPRESS_URL=http://127.0.0.1
```

### Program Year: Meta Field (not Taxonomy)

Use a numeric meta field (`artasia_program_year`) rather than a taxonomy. Reasons:

- The Node.js app currently loads all active sites — no year filtering needed
- Taxonomy adds REST complexity (separate endpoints, term IDs vs values)
- Numeric meta field is simpler to filter via `WP_Query` meta_query
- A simple `<select>` or number input in the meta box is sufficient for the small set of years

If year-based filtering on the WP admin side is needed later, it can be migrated to a taxonomy at that time.

---

## Field Mapping: Old Model -> New Model

| Current `locations.json` | New WordPress Model | Used For |
|---|---|---|
| `partner` (string) | `context.name` (from `artasia_context` CPT) | Upload dropdown label, Immich tag |
| `site` (string) | `site_name` (from `artasia_site` CPT post title) | Upload dropdown label, Immich tag |
| `address` (string) | `venue.address` | GPS fallback reference |
| `lat` (number) | `venue.lat` | Immich GPS fallback |
| `lng` (number) | `venue.lng` | Immich GPS fallback |

---

## Security

- All published location data is public information — no authentication is required on the custom REST endpoint
- Custom `/artasia/v1/locations` endpoint is public read (no auth for GET)
- Writes happen through WP admin UI by authorized WP users, not through the API
- If write API access is ever needed from Node.js in the future, introduce Application Passwords at that time

---

## Execution Order

1. Build WordPress plugin PHP files (`apps/wp-artasia-locations/` directory)
2. Activate plugin in WordPress, create test venues/contexts/sites
3. Add `WordPressClient.ts` to the Node.js backend
4. Refactor `uploadConfig.service.ts` to use `WordPressClient`
5. Refactor `routes/uploads.ts` for `site_id` flow
6. Refactor frontend `client.ts` and `UploadPanel.tsx`
7. Update `docker-compose.yml` and `.env.example`
8. Remove `locations.json`, update `data/README.md`
9. Test end-to-end: dropdown loads from WP, upload validates `site_id`, tags include context + site name, GPS fallback works