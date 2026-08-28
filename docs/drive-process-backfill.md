# Existing Drive asset Process tagging

In **Admin → Tools → Tag existing Process assets**, choose **Tag Process assets from Drive**, then **Confirm Process tagging**. This is a separate, explicitly requested metadata backfill; ordinary auto-import still skips existing assets without changing their type.

## Matching and changes

- Scan Immich's API-key-accessible timeline, archive, hidden, trash, and stacked assets. Locked assets cannot be inventoried with Atlas's API key.
- Skip assets with no Drive source ID and those already classified as Process. Tag prefixes and asset-type values are case-insensitive; opaque Drive IDs retain exact case.
- Look up each remaining asset's exact `source:drive:<id>` in Google Drive, then inspect its **immediate parent folder**. A name containing `process` in any casing qualifies, including `Process photos`, `Work in PROCESS`, and `Postprocessing`.
- This backfill intentionally does not walk higher ancestors or infer activity/placement assignments. A file under `Process/Details` does not qualify unless `Details` also contains `process`. This differs from new-import traversal, where descendants inherit a Process classification.
- Add only `asset_type:process` and verify that Immich returns it. Existing tags (including an explicit Artwork tag), captions, relationships, assignments, visibility, and publication are preserved. Atlas's existing asset-type reader gives Process precedence over Artwork. No uploads, replacements, deletions, restores, or Google Drive changes occur.
- Archived originals and edited derivatives sharing a Drive ID are each checked independently. Multiple distinct Drive IDs on one asset, missing/ambiguous parents, shortcuts, or unreadable tags require review without guessing. Lookup/update failures remain visible and do not stop unrelated assets.
- Immediately before writing, re-read the asset and check that its sole Drive ID is unchanged. Verify that ID again during Process-tag readback. Concurrent external edits cannot be made atomic with this operation; an uncertain write or changed source is reported, not counted as verified success.

## Progress and limits

The server-side job reports inventory/lookup progress, verified tags, already-Process skips, missing-source skips, nonmatching parents, review items, and failures. Expand **View asset results** for filenames, Immich asset IDs, Drive links, parent names, and explanations; results load in pages of 100. Assets skipped before Drive lookup are counted but omitted from this detail list.

Leaving or reloading the page does not cancel the job. **Cancel Process tagging** stops at the next safe point; completed changes and any in-flight write remain. API requests may take up to their normal timeout to finish. Reruns skip existing Process tags, so interrupted or uncertain runs are safe to repeat.

Only the latest job/report is retained **in memory**, until another run or a server restart. A server restart stops the job and clears its report; rerun to check remaining assets. No OAuth credentials are retained in reports. Parent metadata is cached for the run, so results reflect folders observed during that run, not a frozen Drive snapshot.

This shares Atlas's single-server Drive mutation lock with imports and Drive-ID maintenance. Multiple Atlas replicas still require a distributed lock before running concurrent maintenance. This tool does not change placement auto-import history or its last-successful-sync timestamp.

## Verification

Server tests cover case-insensitive immediate-parent matching, idempotency, archive/trash preservation, source ambiguity and changes, parent caching, error isolation, readback verification, cancellation, shared locking, authentication, and result pagination. The UI fixture uses only synthetic APIs; no live Drive or Immich metadata is changed by tests.

Run `node apps/web/tests/process-backfill.fixture.mjs`, then open `http://127.0.0.1:5188/admin/tools`. Check confirmation/back, starting, progress, page reload reconnection, issue details and result pagination. The first run completes after 12 seconds with mixed results. Subsequent runs remain active until cancelled, allowing cancellation and reload checks.
