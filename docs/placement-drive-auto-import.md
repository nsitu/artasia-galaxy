# Placement Drive auto-import

The admin Import tab has a placement-level **Auto-import placement** action. It scans the placement's configured Drive root, finds activity folders using the existing week-number matching rules, and imports new supported media into Immich. Selecting an activity or browsing a different Drive subfolder does not narrow this action's scope.

For older assets already imported from Process folders, use the separate [Tools-tab Process backfill](drive-process-backfill.md). That tool checks immediate parent folders and adds the missing Process type; auto-import continues to leave existing types unchanged.

## Behavior

- Matching activity folders include nested media. Unmatched organizational folders are traversed to find activity folders further down. Non-matching descendants inherit the matched activity; ambiguous or conflicting nested activity folders are excluded and reported for review.
- Within a matched activity folder, a subfolder whose name contains `process` (case-insensitive, e.g. `Process`, `PROCESS photos`, or `Work in process`) classifies its new media as **Process** using `asset_type:process`. All deeper descendants inherit that type, while siblings retain their normal type. Placement/organizational ancestors and filenames do not trigger it; activity conflicts and exclusions still apply. This does not backfill types on existing assets, including checksum duplicates, whose automatic repair remains source-only.
- Files at the root or without a matched activity ancestor are excluded. Drive shortcuts and unsupported formats are also excluded. Another placement's configured root is not traversed.
- Exact `source:drive:<fileId>` identities are checked across the accessible Immich library, including archive, trash, hidden assets, and stacked assets. Archived and trashed sources prevent re-import. An archived original alongside its edited derivative is a normal existing-source skip. Sources assigned elsewhere or shared by multiple active assets are flagged without modification.
- Immich's locked folder is outside this inventory: it requires an elevated user session, which Atlas's API key cannot provide. Keep Drive-linked assets outside the locked folder if their source IDs must prevent re-import. Searching locked assets would fail the entire inventory with a 401, even with a valid key.
- Existing assets are not replaced, restored, reassigned, or published. Changed Drive files with existing source IDs are skipped. Permanently deleted assets can be imported again.
- On an explicit Immich checksum-duplicate response, Atlas inspects the returned asset and rechecks source ownership. If it has no Drive source ID and no conflicting placement/activity assignment, Atlas adds only `source:drive:<fileId>` and verifies the exact ID. The result is **Linked existing asset**, not a new import. Archive/trash, publication, all existing tags, and placement/activity assignments are preserved; no missing placement/activity tags are added.
- An existing matching Drive ID is reported as already present. Different Drive IDs, conflicting or ambiguous assignments (including known legacy labels and custom activities), unreadable metadata, and unsuccessful link verification remain **Needs review** with a specific explanation. Atlas never replaces a source ID or adds a second one automatically. Locked assets cannot be linked automatically.
- New images/videos use bounded temporary files instead of buffering their full contents into RAM. Supported audio retains the existing audio-to-video conversion. Audio uses the configured upload byte limit; other media is capped at 10 GiB. Actual streamed bytes and temporary disk space are checked.

## Progress and history

The browser polls a server-side job. Progress distinguishes discovery, Immich source indexing, transfer, and tag verification. Reports show imported, linked-existing, existing, excluded, needs-review, and failed items, with paginated file/folder details and Drive links. Linked-existing results are persisted separately and count as successful work; older history has a linked count of zero.

The job continues if the tab is closed. Opening the placement again reconnects to its latest job. Cancel stops further work and aborts active transfer/conversion where supported; completed imports remain. Metadata requests may take up to their timeout to acknowledge cancellation.

Last successful sync is separate from latest attempt. Only a completed scan with no actionable failures/conflicts advances the success record. An all-existing run or matched empty folders may succeed with no imports; no matched activity folders is a separate non-success outcome. Changed source/matching configuration marks an earlier success as stale. Results describe files observed during the scan, not a frozen Drive snapshot.

History is stored under `DATA_DIR/drive-auto-import/`, using atomic per-job JSON replacement with flushed writes. The current Compose deployment mounts `/data` persistently. OAuth credentials are never written to history. Reports are authenticated and sent with `Cache-Control: no-store`; access follows the existing Atlas signed-in administration model.

Server restart marks unfinished jobs interrupted. Run auto-import again to rescan and skip completed files. Persisted upload ownership allows a rerun to retry incomplete tagging without creating another asset, including verification of the inferred Process tag. If the source, activity, or inferred asset type changed since the incomplete upload, or the asset was subsequently archived, trashed, or reassigned, it is left untouched and reported for review. Uncertain uploads without a persisted ownership checkpoint are not automatically retagged.

Checksum duplicates are never recorded as Atlas-owned uploads or passed through new-upload metadata recovery. If a source-link write succeeds but the process stops before recording the result, the next run finds the source tag and skips it. If the write did not persist, a new checksum match can retry the same source-only repair. External administrators can still edit tags concurrently; Atlas rechecks before writing and during verification, but Immich does not offer an atomic check-and-link operation here.

## Operations and limits

- Run a single Atlas server instance. The global Drive mutation lock is in-process and shared by auto-import, selected-file imports, reimports, and source-link maintenance. Multiple replicas require shared locking/storage before this feature is used.
- Only one Drive mutation job runs at once. Repeat starts for the same active placement/root reconnect to that job; other operations receive HTTP 409.
- Traversal limits are 2,000 folders and 20,000 files. Reaching a limit is a visible incomplete-run failure, not success.
- Retention keeps the latest 25 runs plus the latest attempt per placement, the most recent success per source/configuration, and unresolved upload-recovery records. These protected records may exceed 25. Include this directory in data backups; it is excluded from Git and Docker build context.
- Filesystem history errors prevent reliable completion and are reported. Repair permissions/free space or restore history from backup before relying on the success indicator. Do not delete recovery records casually: they prove ownership of incompletely tagged uploads.
- No scheduler, Drive writes, automatic publication, or two-way deletion/update reconciliation is included.

## Implementation and verification

`driveAutoImport.service.ts` owns discovery, jobs, and history; `driveImport.service.ts` owns additive ingestion and source indexing. The existing manual replacement implementation is intentionally retained, with a shared mutation lock. `DriveAutoImportPanel.tsx` contains the focused UI and polling logic.

Server tests cover recursive mapping, case-insensitive Process folder inheritance and tag verification, pagination, archive/trash inventory, duplicate protection, partial tagging recovery (including changed Process classification), cancellation, restart handling, history-write failure, and API authentication. Both workspace builds pass. Browser checks against a local mocked API cover starting, progress, results, reload reconnection, and cancellation. No production Drive or Immich mutations were performed during implementation; a real-placement smoke test remains a deployment step.
