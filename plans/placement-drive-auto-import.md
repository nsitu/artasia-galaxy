# Placement Google Drive auto-import

Status: implemented. See [current behavior and operations](../docs/placement-drive-auto-import.md).
Investigated: 2026-08-28.

The user confirmed recursive media inheritance and archive/trash exclusion before implementation. The original design below is retained for context. The additive importer was implemented separately from the existing manual replacement path, and existing UI matching helpers remain in place while automatic discovery reuses the server's scoring helper. Production smoke testing is still a deployment step.

## Outcome and scope

Add an **Auto-import placement** action to the Atlas admin Import tab. One click starts a server-side scan of the selected placement's configured Google Drive folder, discovers activity folders, and imports supported media that does not already have a matching Drive source ID in Immich.

This is an on-demand, additive import, not bidirectional synchronization. It does not update changed source files, replace Atlas edits, delete assets, reorganize Drive, or publish newly imported assets. Scheduling and unattended credentials are outside the first release.

Feasibility: good. The application already has placement folder IDs, OAuth Drive access, activity matching, media import/conversion, source-ID tags, and a background-job/polling precedent. The work is primarily reliable orchestration and reporting, with several prerequisite correctness fixes. This is more than a button around the existing import endpoint.

## What exists today

- `apps/server/src/services/uploadConfig.service.ts:240`: placement configuration and activity definitions come from WordPress, including `google_drive_folder_id` and activity week numbers.
- `apps/web/src/components/ui/UploadPanel.tsx:195`: folder matching scores shared week numbers, preferring explicit `Week N` text over a bare number. It uses the activity's configured week, falling back to numbers in its label. Only a unique highest-scoring match is accepted; this is not general fuzzy name matching.
- `apps/server/src/services/googleDrive.service.ts:180`: a tested server helper mirrors that scoring across folder names in a path. The UI currently auto-selects an activity for a direct child of the placement folder; recursive inheritance is a new policy to define explicitly.
- `apps/web/src/components/ui/UploadPanel.tsx:3722`: manual import loops through selected files in the browser, making one `/api/v1/drive/sync` request per file. Its progress is browser-local.
- `apps/server/src/routes/drive.ts:993`: import already handles supported images/videos, audio-to-video conversion, placement/activity tags, `source:drive:<fileId>`, and verification of the tags on the resulting asset.
- `apps/server/src/routes/drive.ts:931`: existing import can find an active Drive-linked asset, copy relationships to its replacement, and remove the old asset. Auto-import must never enter that replacement path.
- `apps/server/src/routes/drive.ts:663`: bulk Drive-source lookup already starts a background operation and returns a job ID for polling. Its in-memory state expires after 15 minutes and does not provide durable sync history.
- `docker-compose.yml`: the checked-in deployment is a single Atlas service with persistent `DATA_DIR=/data`. This supports a small file-backed job store without introducing Redis or another database. Confirm actual deployment topology before relying on single-process locking.

## Prerequisites and risks found

1. **Complete pagination.** `listFiles()` sets a response field mask without `nextPageToken`, although callers attempt to consume it. `getFoldersInFolder()` requests at most 100 folders without paging. Fix both before claiming a complete scan. The current folder counts inspect only one nested level and include non-media files, so they cannot provide the auto-import total. Google documents both [field-mask selection](https://developers.google.com/workspace/drive/api/guides/fields-parameter) and [pagination/incomplete-search behavior](https://developers.google.com/workspace/drive/api/reference/rest/v3/files/list).
2. **Skip is different from replace.** Add an explicit import policy or separate additive entry point. Do not call the current replacement-aware helper unchanged or simply enlarge the 20-file manual request limit.
3. **Use raw source IDs.** The browser's imported indicator uses placement-scoped asset metadata. `embeddedTagKeys()` lowercases tag values, and one metadata path extracts Drive IDs from those normalized values. Auto-import must preserve the original ID suffix, consider every source tag on an asset, and compare complete IDs rather than filenames or normalized display strings. Include the affected admin metadata path in the prerequisite fix.
4. **Look beyond visible placement assets.** The current tag-to-asset lookup searches timeline visibility. An additive import needs a deliberate policy for archived, trashed, hidden, and differently assigned assets, and cannot use an empty tag alone as proof of an existing asset.
5. **Large files currently use memory.** Despite its name, `uploadAssetStream()` buffers the entire source into chunks and a Blob. Automated traversal can encounter large videos without a person selecting them. Use a bounded temporary-file pipeline before enabling bulk imports; keep audio conversion concurrency low.
6. **Immich can return an existing asset.** Its [v3.1.0 API contract](https://raw.githubusercontent.com/immich-app/immich/v3.1.0/open-api/immich-openapi-specs.json) distinguishes `created` from `duplicate` upload results. The current Drive importer only checks for an ID. Auto-import must not count a checksum duplicate as newly imported or silently retag another placement's asset. Validate against the deployed version during implementation; v3.1.0 is the version recorded in the repository's upgrade note, not a live-version observation.

## Proposed behavior

### Scope and matching

- Require a selected placement and its configured root folder. Resolve that folder on the server; never use the browser's currently open folder or activity filter as the auto-import scope. No fallback to the wider project Documentation folder when configuration is missing.
- Recursively traverse ordinary descendant folders, including unmatched organizational folders, because a matching activity folder may be deeper in the tree.
- Reuse the current per-folder scoring and tie rules. Proposed inheritance: a uniquely matched folder supplies its activity to files directly inside it and to otherwise unmatched descendants.
- If a descendant independently matches a different activity, or matches ambiguously, report that branch for review rather than silently overriding the inherited activity. This is a proposed conservative extension, not the current path helper's exact behavior.
- Files with no matched activity ancestor, including loose files at the placement root, are outside the initial import scope and appear in the report. Do not invent tags or import them untagged by default.
- Multiple separate folders may legitimately map to the same activity. Import all eligible contents, deduplicating by file ID.
- Do not follow Drive shortcuts in v1; report them as excluded. Maintain visited-folder/file sets and explicit traversal limits. A reached safety limit means an incomplete run, never successful completion.
- Reject duplicate configured roots and flag nested roots belonging to another placement; do not cross another configured placement boundary automatically.
- Import only formats supported by the existing Drive service. Unsupported files are reported exclusions; a supported but oversized, inaccessible, or failed file is an actionable failure.

### Existing assets and duplicate handling

- Treat `source:drive:<fileId>` on an actual accessible Immich asset as the primary source identity. Search globally within the Atlas API key's accessible library, not just the selected placement.
- Proposed default: archived and trashed assets still count as existing. Never restore, replace, republish, or retag them as a side effect. Include other relevant visibility states in the inventory, subject to API permissions.
- An existing source assigned elsewhere, or the same ID attached to multiple assets, is skipped and prominently flagged. Existing source-linked assets with changed Drive content are still skipped.
- Build a complete source-ID index once per run, with bounded/paginated queries and raw tag values. Fetch asset details if search results omit tags. Do not scan the whole Immich library separately for each file.
- Keep the index updated as imports complete. Bypass stale caches for checks where a stale negative could cause a duplicate, and coordinate Atlas manual/automatic writes with a shared per-source lock or equivalent exclusion.
- Recheck before downloading. Immich's checksum duplicate response remains the final safeguard for writes outside Atlas's locks.
- If a checksum duplicate lacks the expected source ID, report `needs-review` without changing the existing asset. The existing Drive-source lookup maintenance tool can reconcile legacy uploads explicitly; auto-import should not run filename-based relinking automatically.
- Track an uploaded asset ID before tagging. Retry tag verification for assets demonstrably created by this job; do not turn an upload-success/tag-failure into an ordinary existing-file skip on the next run. Persist enough evidence to distinguish this recovery from modifying a pre-existing asset. Uncertain ownership after a crash requires review, not blind retagging.
- Sync history is not the authority for existence. If a previously imported asset has been permanently deleted and no source-linked asset remains, a later run can import it again. Permanent suppression would require a separate exclusion/tombstone policy.

### Success means a verified, complete eligible scan

Record separate latest-attempt and last-successful-run fields. A successful run requires all pages/folders in the selected scope to have been scanned, all eligible files to be accounted for, and newly imported assets to have verified source/placement/activity tags. Audio retains the current duration verification.

Unsupported and unmatched content are visible exclusions, not silently lost files. A run with no matching activity folders reports `no_matches`, not a successful placement sync. A matched but empty activity tree, or a run where all eligible files already exist without conflicts, may succeed with zero imports.

Unreadable folders, incomplete searches, safety limits, unresolved mapping/source conflicts, failed files, cancellation, and interruption do not advance `lastSuccessfulSyncAt`. Independent folders/files may still finish; the result is `completed_with_issues` and the earlier successful timestamp remains visible.

The status describes the eligible files observed during a scan, not a transactionally frozen snapshot of Drive. New files added after their folder was enumerated are caught on the next run. Record scan start/end times, and report files moved/deleted/changed between discovery and transfer rather than claiming they were imported from a stable snapshot. Thumbnail generation or downstream Immich indexing need not finish before import success, and the UI should not imply otherwise.

## Implementation sequence

### 1. Reliable discovery and matching

- Add a paginated child-listing primitive in `googleDrive.service.ts`, requesting `nextPageToken`, `incompleteSearch`, and metadata needed to classify every child. Continue while a token exists, including after an empty/short page. Handle rejected tokens with bounded restart and ID deduplication.
- Retain Shared Drive parameters throughout recursion; validate root access and stop on incomplete searches or exhausted retries.
- Repair existing file/folder browsing pagination as part of this foundation. Normalize numeric size fields and retain current media classification.
- Extract the score/tie logic behind explicit results: `matched`, `unmatched`, and `ambiguous`, with candidate activities and match reasons. Prefer server-calculated mapping data consumed by the UI to avoid a third matcher implementation; preserve the UI's inverse activity-to-folder unique-best behavior too.
- Add `driveAutoImport.service.ts` to produce a manifest of folders, source files, resolved activities, exclusions, and issues. Snapshot root ID and relevant activity configuration at the start. Use manifest totals, not existing one-level folder statistics.
- Expose a non-importing scan mode for implementation validation and optional later preview UI. A separate user confirmation after scanning is not required for the proposed one-click flow.

### 2. Safe additive media ingestion

- Extract reusable import/verification code from `routes/drive.ts` into `driveImport.service.ts`; keep routes thin.
- Make manual replacement versus additive skip policies explicit and regression-test the existing manual and reimport endpoints.
- Add raw source-ID parsing/indexing helpers and fix the metadata case-loss path in `routes/uploads.ts`; do not lowercase opaque IDs when ensuring source tags either.
- Extend the Immich inventory wrapper as needed to retrieve relevant visibility/trash states and bypass stale lookup caches. Permission failure means incomplete deduplication, not permission to import blindly.
- Spool non-audio downloads to a bounded temporary directory, hash/upload from disk with backpressure, and clean up on success, failure, cancellation, and startup recovery. Enforce actual streamed byte limits, disk-space checks, timeouts, and abort propagation, not only metadata limits.
- Start with one transfer/conversion at a time and a small bounded metadata concurrency. Reuse prepared placement/activity tags to reduce repeated API work.
- Distinguish created uploads, known-source skips, checksum conflicts, failed transfers, and pending verification. Use bounded retries/backoff for transient errors; do not blindly retry an uncertain upload without checking its outcome. Do not roll back successful files when another file fails.

### 3. Background jobs and durable history

- Run the job in the current server process after returning HTTP 202. It survives browser navigation/closure, but not server termination.
- For v1, allow one active auto-import globally; return the existing job for repeat starts of the same placement/root and a clear busy response for another placement. Coordinate overlapping manual imports/reimports and Drive-link maintenance on the server, not just through disabled buttons.
- Store versioned run records, a manifest, per-file outcomes/recovery checkpoints, and summary metadata under `DATA_DIR/drive-auto-import/`. Use serialized writes and atomic summary replacement; persist the initial record before accepting the job and the verified final result before marking success. Paginate detailed result responses and bound history retention.
- Index history by placement ID and root folder ID, and include a fingerprint of relevant matching configuration. Show prior success as belonging to the old source/configuration when these change; do not silently carry forward a current green badge.
- On startup, mark unfinished jobs `interrupted` and retain outcomes for inspection. A user-triggered rerun obtains fresh credentials, rescans, skips completed imports, and explicitly handles incomplete tagging. Automatic crash-resume is not required in v1.
- Keep the initiating user's Drive client/refresh token in memory only. Never persist tokens in job JSON, logs, or API responses. New status/results/cancel endpoints require the existing admin authentication checks and consistent access rules.
- Confirm the single-instance deployment assumption. Multiple Atlas workers would require shared durable locking/job storage before this design can be used safely.
- Add runtime history/temp paths to `.gitignore`; do not bake private sync reports into future Docker images. Keep reports within authenticated APIs and the existing data backup policy.

Proposed API, separate from the existing manual `/drive/sync` route:

| Endpoint | Purpose |
| --- | --- |
| `POST /api/v1/drive/placements/:placementId/auto-import` | Resolve configured scope, start a job, return job ID/status with HTTP 202. |
| `GET /api/v1/drive/placements/:placementId/sync-status` | Current job, latest attempt, last successful run, and configuration mismatch status. |
| `GET /api/v1/drive/auto-import-jobs/:jobId` | Phase, counters, current folder/file, timestamps, and issue summary. |
| `GET /api/v1/drive/auto-import-jobs/:jobId/results?cursor=...` | Paginated per-folder/file outcomes, source links, and errors. |
| `POST /api/v1/drive/auto-import-jobs/:jobId/cancel` | Request cooperative cancellation; preserve completed imports. |

Run records should include `jobId`, `placementId`, `rootFolderId`, configuration fingerprint, initiating identity, `startedAt`, `scanCompletedAt`, `finishedAt`, status, current phase/item, counters, and sanitized errors. Per-file records include exact Drive ID, source path, activity, outcome, Immich ID if known, attempts, and verification state.

### 4. Import-tab controls and progress

- Add an always-visible placement-level **Auto-import placement** button independent of whether the currently browsed folder contains files. Disable it with an explanation when the placement/root/authentication is missing.
- State the scope beside it: all matching activity folders for this placement, existing sources skipped, nothing replaced or published. Keep manual import available as a separate action.
- Add a focused status component/hook rather than substantially expanding the already-large `UploadPanel.tsx`.
- Poll the server approximately every 1-2 seconds while active, with backoff on network errors. Rediscover the active job via placement status on reload. Polling failure is a connection problem, not proof the job stopped.
- Show scanning progress as folder/file counts without a fabricated percentage. Once discovery finishes, show determinate import progress, current folder/activity/file, and imported/existing/excluded/conflict/failed totals. Do not label file-count progress as byte-transfer progress.
- Provide expandable results, Drive links, actionable error messages, and Cancel. A **Run again** action is sufficient for v1: it rescans and safely skips completed files. A selective failed-only retry can follow later.
- Display last successful completion with date/time and a separate latest-attempt outcome, including `never synced`, `no matches`, `completed with issues`, and `interrupted` states.
- Refresh placement assets/imported indicators on completion; keep results associated with the job's captured placement if the user changes the selected placement while it runs. Do not attach a completed job's results to the new selection.

### 5. Verification and rollout

- Unit tests: week scoring, explicit-week preference, numeric label fallback, ties, repeated matching folders, inherited activities, conflicting descendants, unmatched/root files, shortcut exclusion, and foreign placement boundaries.
- Discovery tests: more than 100 files and folders, multiple pages including empty pages with tokens, arbitrary nesting, Shared Drives, duplicate IDs, rejected tokens, incomplete searches, permissions failures, and traversal limits.
- Import tests: exact/mixed-case IDs, all source tags on an asset, archive/trash policy, empty source tags, cross-placement conflicts, two concurrent starts, manual/automatic overlap, checksum duplicate results, partial tagging recovery, timeouts, oversized files, temp cleanup, and audio conversion.
- Persistence tests: browser reconnection, server restart, interrupted jobs, atomic-write failure, prior-success preservation, configuration/root changes, all-existing and empty matches, no-match runs, cancellation, and access control.
- Regression tests: selected-file import and explicit reimport retain their current behavior; activity navigation still chooses the same unique matches.
- Run server tests and both workspace builds. Add a deterministic end-to-end fixture using mocked Drive/Immich services before testing real assets.
- Pilot with an authorized small placement: compare discovered folders/IDs against Drive, verify new tags/draft state, run again and expect zero new imports, then add one source file and expect exactly one new import. Verify that an archived linked asset remains archived and a deliberately injected failure does not update the success timestamp.
- Expand after scan-only results and the pilot are reviewed. No production import is authorized or performed by this planning investigation.

## Confirmed decisions

1. **Recursive inheritance:** matching activity folders include nested media, including non-matching subfolders; root/unmatched media stays excluded and conflicting nested matches are reported instead of guessed.
2. **Archive/delete behavior:** archived and trashed source-linked assets block re-import. Permanently deleted assets may return on a later run; no persistent exclusion list is included.

Other proposed defaults: on-demand button only; globally skip existing Drive IDs without retagging; include existing supported audio formats; new assets remain unpublished; skip shortcuts; report legacy checksum/source-link conflicts for manual reconciliation.

## Investigation validation

The existing Drive service test file passed all 11 tests with `node --import tsx --test apps/server/src/services/googleDrive.service.test.ts`. This establishes the current helper baseline only; no auto-import implementation or live Drive/Immich integration test was performed.
