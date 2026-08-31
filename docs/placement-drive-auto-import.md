# Placement Drive auto-import

In **Admin → Import**, select a placement and choose **Auto-import placement**. The server scans that placement's configured Drive root and imports new supported media into Immich. The currently browsed subfolder/activity does not narrow its scope. This is on-demand, one-way ingestion: no scheduling, Drive writes, replacements, deletions, or automatic publication.

## Folder and asset-type rules

- Traverse ordinary subfolders recursively, including organizational folders. Activity matching uses configured week numbers (or numbers in activity labels), prefers explicit `Week N` over bare numbers, and requires a unique best match.
- Matched folders supply the activity to their media and otherwise unmatched descendants. Ambiguous/conflicting nested activity branches require review. Root/unmatched media, unsupported formats, and shortcuts are excluded. Duplicate configured roots are rejected; another placement's root is not traversed.
- Beneath a matched activity folder, a name containing `process` (case-insensitive) gives new media `asset_type:process`, inherited by deeper descendants but not sibling branches. Filenames and ancestors above the activity do not trigger it. New imports receive placement/activity/source tags; supported audio is converted to video and its duration verified.
- Existing asset types are not backfilled. The separate [Tools-tab Process backfill](drive-process-backfill.md) checks **immediate parents** containing `process` **or `final`** and adds Process to existing assets. Final matching applies only to that tool, not auto-import.

## Existing sources and duplicates

- Compare exact, case-preserved `source:drive:<fileId>` IDs across the accessible library, including archive, trash, hidden assets, and stacked children. Existing sources are skipped even when Drive content changed; permanently deleted assets can be imported again. Another placement's source or multiple active assets sharing an ID require review; an archived original alongside its edited derivative is a normal skip.
- Immich's locked folder cannot be inventoried or linked with Atlas's API key. Keep Drive-linked assets outside it when their IDs must prevent re-import. Inventory/authentication failure stops ingestion rather than assuming sources are absent.
- On an explicit checksum-duplicate response, recheck the existing asset and source ownership. With no Drive ID or assignment conflict, add and verify **only** the missing source tag, reporting **Linked existing asset**. Preserve all other tags, assignments, archive/trash, and publication. Different IDs, ambiguous/conflicting assignments, unreadable metadata, or failed verification require review; never replace/add a second source ID or claim the duplicate as a new upload.

## Progress, success, and recovery

The browser polls discovery, source indexing, import, and verification phases. Counts distinguish imported, linked-existing, existing, excluded, needs-review, and failed results; details include Drive links. Closing the tab does not stop the job; reopening reconnects. Cancel preserves completed work and may wait for an in-flight metadata request.

**Last successful sync** is separate from the latest attempt. Only a complete scan with verified outcomes and no actionable failures/conflicts advances it. All-existing or matched-empty runs can succeed; no matched activity folders reports `no_matches`. Changed source/matching configuration marks earlier success stale. Drive is not a frozen snapshot; files changed/moved before transfer are rejected for rerun.

Restart marks unfinished jobs `interrupted`. Rerun to rescan and skip completed files. Durable upload-ownership checkpoints allow incomplete tagging to resume; changed source/activity/type or subsequently archived, trashed, or reassigned assets require review. Checksum duplicates never use this recovery path: a persisted source link is skipped on rerun, otherwise the source-only repair can retry. Concurrent external edits are not atomic with Atlas's checks.

## Operations

- **Single server:** the in-process Drive writer lock covers imports and maintenance. Repeat starts for the same active placement/root reconnect; competing operations return HTTP 409. Multiple replicas need shared locking/storage.
- **Limits:** 2,000 folders and 20,000 files per scan; exceeding limits is not success. Transfers use bounded temporary files and check actual bytes/free disk. Audio uses the configured upload limit; other media is capped at 10 GiB.
- **History:** atomic, flushed JSON under `DATA_DIR/drive-auto-import/` (Compose persists `/data`), without OAuth credentials. Retain the latest 25 runs plus each placement's latest attempt, each source/configuration's latest success, and unresolved recovery records. Back it up; do not discard ownership checkpoints. History-write failures prevent success.

## API and code

All routes require Atlas sign-in and return `Cache-Control: no-store`, under `/api/v1/drive`:

| Method and path | Purpose |
| --- | --- |
| `POST /placements/:placementId/auto-import` | Start/reconnect; HTTP 202. |
| `GET /placements/:placementId/sync-status` | Latest attempt, last success, configuration change. |
| `GET /auto-import-jobs/:jobId` | Progress summary. |
| `GET /auto-import-jobs/:jobId/results?cursor=0` | Results, 100 per page. |
| `POST /auto-import-jobs/:jobId/cancel` | Request cancellation. |

[Job/scanner](../apps/server/src/services/driveAutoImport.service.ts), [additive importer](../apps/server/src/services/driveImport.service.ts), [duplicate linker](../apps/server/src/services/driveDuplicateLink.service.ts), and [UI](../apps/web/src/components/ui/DriveAutoImportPanel.tsx) are separate from manual replacement imports.

Validate with `npm run test --workspace @artasia/server` and `npm run build --workspace @artasia/web`; see [browser fixtures](../apps/web/tests/README.md). Live-placement smoke testing is separate from mocked tests.
