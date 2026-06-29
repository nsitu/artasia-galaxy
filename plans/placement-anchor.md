# Placement-Anchored Tagging: Single Source of Truth for Immich Metadata

## Overview

Anchor the relationship between an Immich asset and its Artasia context to the **immutable WordPress placement post ID**. Human-readable tags (`partner.name`, `placement_name`) become derived/cached values that can always be recomputed from WordPress, eliminating the rename-drift problem by construction.

**Decisions locked in:**

1. **Placement ID becomes a first-class Immich tag** — emitted as `placement:<post_id>` alongside the existing human-readable tags on every upload.
2. **WordPress is the single source of truth** — the upload tool sources `placements` *and* the upload tag picklist from WordPress REST, not from JSON files on disk.
3. **Reconcile is stateless and idempotent** — derives current state from the placement-ID anchor tags; no manifest capture, no webhooks required.

---

## Background

### Current upload flow (as deployed)

`apps/server/src/routes/uploads.ts` validates each upload against `placement_id` resolved from WordPress, then tags the resulting Immich asset with `partner.name` + `placement_name` (see `getPlacementTagNames()` in `uploadConfig.service.ts:133`). Immich tags are matched by string via `ensureTag(name)` in `ImmichClient.ts`, which matches on either `name` or `value`.

### The drift problem

Immich tags are linked to WordPress only by **display string**. When a partner is renamed in WordPress from "Gallery A" to "Gallery Atrium":

- Future uploads emit a new Immich tag entity named "Gallery Atrium".
- Past assets retain the old "Gallery A" tag — an orphan with no referent in the source of truth.
- There is no durable identifier on the Immich side to bridge back to the WP post.

A webhook-based capture-and-manifest approach (snapshot before-state via `pre_post_update` → emit manifest → reconcile on Immich) was considered and rejected in favor of the simpler anchor approach below. See "Rejected alternatives" for the reasoning.

### Current sources of upload config

| Source | Today | Proposed |
|---|---|---|
| Placements dropdown | WP REST `/wp-json/artasia/v1/placements`, 60s cached | unchanged |
| Upload tag picklist | `data/upload-tags.json` on disk | WP REST (new `artasia_upload_tag` taxonomy) |
| Uploaders (who may upload) | `data/uploaders.json` on disk | unchanged (orthogonal; may move later for consistency) |

---

## Design

### Tag shape on Immich

Every uploaded asset receives, in addition to user-selected tags:

```
placement:<placement_id>      # durable anchor — never renamed
<partner.name>                # human-readable label — derived, may drift
<placement_name>              # human-readable label — derived, may drift
```

`ensureTag()` in `ImmichClient.ts` already creates `placement:123` once and attaches it to every asset bound to that placement. The post ID is immutable in WordPress, so this tag never needs to be renamed.

### Why this is simpler than the webhook approach

- **No before/after capture on the WP side.** WP revisions are off for all five CPTs (`post-types.php` declares no `revisions` support; `artasia_placement` declares `supports => false`), so there is no stored "before" state to read back from. The anchor approach doesn't need a "before" — the tag is keyed on the post ID which doesn't change.
- **No state held on the Galaxy side.** No `tag-map.json` post_id ↔ immich_tag_id lookup is needed; the Immich tag itself *is* the lookup key (its name encodes the post ID).
- **Reconcile runs entirely off public WP read.** Public read is already the established integration contract (`permission_callback => __return_true` on `/wp-json/artasia/v1/placements`).

### Reconcile algorithm (stateless, idempotent)

```
1. GET /wp-json/artasia/v1/placements                 # current WP state
2. Immich listTags() filtered to /^placement:\d+$/    # set of anchor tags that exist
3. For each Immich tag whose name matches placement:<N>:
     a. Search WP placements for id === N
     b. If found:
        - searchAssets({ tagId }) on Immich → every asset bound to N
        - expected human tags = [partner.name, placement_name] from WP
        - diff against each asset's current tags
        - re-apply derived tags via PUT /tags/assets (add) or DELETE (remove)
     c. If not found (post trashed/missing):
        - rename tag to archived:placement:<N> (keeps history browseable, surfaces orphans)
4. Loop; can run on cron, on demand, or both
```

Runs from current WP state alone — no event ordering, no missing-message recovery. A dropped reconcile run repairs itself on the next run.

---

## Implementation

### WordPress side — new `artasia_upload_tag` taxonomy

Migrate `data/upload-tags.json` into a WordPress taxonomy so the tag picklist also lives in the source of truth. Tag lifecycle (rename, retire) then flows through the same reconcile pass automatically.

- Register `artasia_upload_tag` taxonomy in a new `includes/taxonomies.php` (or extend `post-types.php`), attached to `artasia_placement` so admins can tag placements with the radio-button options at edit time. Or attach to no post type — purely a managed list.
- Public REST: `/wp-json/wp/v2/artasia_upload_tag` (standard WP taxonomy endpoint) or custom `/wp-json/artasia/v1/upload-tags` matching the existing `/placements` style.
- Admin UI: standard WP terms admin screen, linked from the Artasia menu.
- Reuses the existing deployment path (plugin SCP + WP-CLI activation in `.github/workflows/deploy.yml`).

### Galaxy side — changes

#### `apps/server/src/services/uploadConfig.service.ts`

Replace `readJson("upload-tags.json", [])` with a `WordPressClient.getUploadTags()` call (new method; follows the `getArtasiaPlacements()` pattern with 60s cache + last-known-good retention). Update `getUploadConfig()` accordingly.

Add the placement-ID anchor to the tag names emitted on upload:

```ts
export function getPlacementTagNames(location: WpArtasiaPlacement): string[] {
  return nonEmptyValues([
    `placement:${location.placement_id}`,   // durable anchor
    location.partner?.name,                  // derived, may drift
    location.placement_name,                 // derived, may drift
  ]);
}
```

#### `apps/server/src/infra/WordPressClient.ts`

Add `getUploadTags()` mirroring `getArtasiaPlacements()` (same caching pattern, same accept header, same error handling).

#### `apps/server/src/routes/reconcile.ts` (new file)

- `POST /api/v1/reconcile` — guarded by a shared secret header (env `RECONCILE_SECRET`), since reconcile mutates Immich tags across many assets. WP cron (or a Galaxy-side cron) calls this endpoint on a schedule.
- `GET /api/v1/reconcile/drift` — read-only diff for monitoring: returns `{ drifted: [...], orphaned: [...] }` without mutating Immich. Useful for ad-hoc inspection.
- Runs the stateless algorithm above. Logs every Immich mutation. Persists nothing to disk — state lives in Immich and WP.

#### `apps/server/src/services/reconcile.service.ts` (new file)

Pure functions: `collectDrift()`, `applyReconcile()`. Reuses `ImmichClient.listTags`, `searchAssets`, `ensureTag`, `tagAsset`, and a new `renameTag()` helper (Immich `PUT /tags/{id}` — needs adding to `ImmichClient.ts`; rename should use a new tagId-targeted API call, not the asset-based `PUT /tags/assets`).

#### `apps/server/src/index.ts`

Wire reconcile route into the app. Optionally schedule a read-only `collectDrift()` call at boot (matches the existing `startup.service.ts` non-blocking pattern) to surface drift in logs without mutating.

#### `apps/server/src/infra/ImmichClient.ts`

Add:
- `renameTag(tagId, newName)` → `PUT /tags/{id}` body `{ name }`. Required Immich API-key permission: `tag.update` (verify with Immich docs/UI; may not be currently granted).
- `removeTagFromAssets(tagId, assetIds)` → `DELETE /tags/assets` body `{ tagIds, assetIds }`. Permission: `tag.asset` (already granted for upload; verify covers delete).

### Environment

New env vars:
- `RECONCILE_SECRET` — shared secret for the reconcile endpoint. Add to `.env.example` and `docker-compose.yml`. **Do not commit a real value.**

### Immich API-key permissions delta

| Permission | Current | Required after this change |
|---|---|---|
| `tag.update` | not needed | **new** — for rename-to-archived and orphan handling |
| `tag.asset` (delete) | granted for upload (add) | verify covers delete operations |
| others | unchanged | unchanged |

---

## Backfill

Assets uploaded before this change carry only `partner.name` + `placement_name` tags, no `placement:N` anchor. A one-time backfill is required:

1. Query Immich for all assets with `partner.name` or `placement_name` tags.
2. For each unique `(partner_name, placement_name)` pair: resolve to a `placement_id` via current WP state.
3. Attach the missing `placement:<id>` tag to all matching assets.
4. Log pairs that fail to resolve (because WP has been renamed since the original upload) as orphans for manual re-tagging.

Implementation: a `scripts/backfill-placement-anchors.ts` script using `ImmichClient` + `WordPressClient`. Runs once against production, outputting a `backfill-orphans.json` report for human triage. The sooner backfill runs after deploy, the smaller the orphan set (renames are less likely to have happened).

---

## Caveats

1. **Opaque tag name visible in Immich UI.** Anyone browsing `photos.artsforall.co` directly will see `placement:123` among asset tags. Staff-facing; verify acceptable. Alternative: use Immich tag's `value` field to hide the anchor (set `name="placement:123"`, leave `value` blank). Public gallery at `galaxy.artsforall.co` is unaffected — `slideshow.service.ts` does not surface Immich tags to end users.

2. **Tag namespace grows unbounded.** One Immich tag per placement. At Artasia's scale (dozens of placements per year) this is fine, but the tag list grows yearly. The reconcile pass handles retirement by renaming trashed placements to `archived:placement:N`. Optionally add a WP `trashed_post` hook that proactively triggers the rename, but a daily reconcile catches it too — non-critical.

3. **Human-readable tags remain redundant.** Once `placement:N` anchors the relationship, `partner.name` and `placement_name` are decorative from the lineage perspective. A future end state: assets carry only `placement:N`, and the gallery resolves names from WP at render time. Day-one keeps the readable tags — useful inside Immich's own UI — but they can be dropped later without losing the relationship.

4. **`uploaders.json` not in scope.** Uploader identity ("who may upload") is editorial configuration, not metadata describing the artwork. Migrating it to WP would be for consistency only, not for the reconcile design's benefit. Out of scope for this plan.

5. **Read-only WP REST contract preserved.** Reconcile only reads from WP (no writes back to WP), so the existing `permission_callback => __return_true` model is sufficient. No application passwords needed.

---

## Rejected alternatives

### Webhook + manifest capture (earlier proposal)

Rejected because anchor tags make "before" state irrelevant. The webhook approach required hooking `pre_post_update` in WP to snapshot pre-rename state (since native WP revisions are off for all Artasia CPTs), emitting a manifest to Galaxy, and retrying on failure. Critical complexity that doesn't survive the anchor:

- Need to handle cascade: renaming a partner regenerates placement titles (via `artasia_update_placement_meta`), so one partner rename produces N placement tag manifestations. Anchor model handles this automatically — each `placement:N` tag still points to the same post, regardless of derived name changes.
- Webhook delivery reliability concerns (drop → drift) disappear when reconcile reads current WP state directly.
- The `data/tag-map.json` reconciliation statefile becomes unnecessary; Immich tag names *are* the map.

### Bidirectional sync (Immich → WP)

Rejected outright. Immich is a downstream consumer of Artasia metadata, not a collaborative editor. Letting Immich writes flow back to WP would create merge conflicts and update cycles. One-way truth with downstream repair is the goal.

---

## Execution Order

1. **Migrate upload tags to WordPress.** Register `artasia_upload_tag` taxonomy, expose via REST. Add `getUploadTags()` to `WordPressClient.ts`. Update `getUploadConfig()` to pull from WP. Remove `data/upload-tags.json` (update `data/README.md`).
2. **Add placement-ID anchor tag on upload.** Modify `getPlacementTagNames()` in `uploadConfig.service.ts`. Unit-test the new tag emission.
3. **Extend `ImmichClient.ts`** with `renameTag()` and verify `removeTagFromAssets()` works against the deployed Immich instance. Verify `tag.update` permission on the API key.
4. **Build reconcile.** `services/reconcile.service.ts` + `routes/reconcile.ts` + wire into `index.ts`. Add `RECONCILE_SECRET` env.
5. **Backfill.** Write `scripts/backfill-placement-anchors.ts`; run against production; triage orphans.
6. **Schedule.** Add a WP-cron (or Galaxy-side `setInterval`) that POSTs to `/api/v1/reconcile` on a daily schedule. Add a drift report log at boot.
7. **Document.** Update `docs/mvp.md` with the reconcile flow; record this plan as completed.
8. **Rotate secrets.** Before deploying any reconcile path with cross-asset write access, rotate the committed Immich API key and Mapbox token out of `.env` and into the VM environment (currently both secrets are committed to git — pre-existing problem flagged for remediation).