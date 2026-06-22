# Upload Feature Plan

Status: implemented in app code, pending deployment/runtime verification

The next feature is an upload area in the Node app for adding images and videos to Immich with Artasia-specific metadata.

The upload tool is a public companion to Immich. Its purpose is to make sharing easier and reduce the number of steps required for contributors, so Artasia receives more shared media. It is not intended to replace Immich's authenticated review, organization, or publishing workflows.

## User Flow

The app should provide an upload area where users can drag and drop images and videos. Batch uploads should be supported from the start.

Before or during upload, users should be able to select:

- One or more predefined tags.
- One Artasia program location from a dropdown.
- One uploader name from a dropdown.

The Node app should receive the uploads, pass them along to Immich, and attach the selected tags, partner tag, site tag, and uploader album assignment.

Authentication is not required for uploads. Publishing is a separate authenticated workflow managed in Immich itself.

Because upload is unauthenticated, unpublished uploaded content does not need to appear beyond the current upload session. The upload area can show minimal per-file status for the active session only: in progress, completed, failed, and retrying.

## Architecture

Uploads should go through the Artasia Express backend rather than directly from the browser to Immich. This keeps the Immich API key server-side and gives us a place to manage upload limits, retries, validation, and metadata normalization.

Because batch media uploads can be large, the architecture should avoid overwhelming the VM or Immich. The implementation should consider:

- File count limits per batch.
- File size limits per asset.
- Total batch size limits.
- Accepted MIME types for images and videos.
- Extension validation in addition to MIME validation.
- Streaming uploads instead of buffering entire files in memory.
- Controlled concurrency when forwarding files to Immich.
- Per-file progress and status reporting.
- Clear failure handling so one failed file does not necessarily fail the whole batch.
- Retry failed files rather than supporting resumable uploads in the first version.
- Server-side request timeouts appropriate for large uploads.
- nginx `client_max_body_size` and proxy timeout settings.
- Rate limiting for public upload routes.
- A global upload disable check when Immich storage usage exceeds 50 GB.

Before accepting a batch, the backend should query Immich server statistics and reject uploads when total Immich usage is greater than 50 GB. Immich exposes total storage usage in bytes through the server statistics API. This requires an Immich API key with permission to read server statistics.

## Upload Progress Design

The first version should not attempt resumable upload sessions. Failed files can be retried by the user from the current session.

Progress should be modeled per file with a small state machine:

```text
queued -> uploading -> processing -> completed
                   \-> failed -> retrying -> uploading
```

The browser can report upload progress for the browser-to-Artasia request. After the Artasia backend receives a file and forwards it to Immich, the UI can show a simpler `processing` state until the backend returns success or failure.

Recommended implementation shape:

- Browser sends a multipart batch upload request.
- Backend parses uploads with a streaming multipart parser.
- Backend validates batch metadata before processing files.
- Backend enforces file count, file size, total batch size, MIME type, extension, rate limit, and Immich storage usage rules.
- Backend forwards files to Immich with bounded concurrency.
- Backend returns a per-file result list with original filename, status, error message if any, and Immich asset ID if successful.
- Frontend keeps the status list in memory for the current session only.

If finer-grained server-side progress is needed later, add a lightweight upload session ID plus server-sent events. That is out of scope for the first version.

## Metadata

Each upload should include:

- Selected predefined tags.
- Selected Artasia program location.
- Partner name from the selected location.
- Site name from the selected location.
- Selected uploader name.
- Original filename.
- Media type.
- Upload status.
- Immich asset ID after successful upload.

Location metadata should be loaded from `/data/locations.json`. Each location includes a partner name, site name, address, and optional default GPS coordinates.

Example shape:

```json
[
  {
    "partner": "BGC",
    "site": "Kiwanis Club",
    "address": "Street address",
    "lat": 43.2557,
    "lng": -79.8711
  }
]
```

Uploads should be tagged with both the selected location's partner name and site name. For example, selecting `{ partner: "BGC", site: "Kiwanis Club" }` should attach both `BGC` and `Kiwanis Club` as tags.

If the uploaded asset does not already have GPS metadata, the backend should attach the selected location's default `lat` and `lng` to the Immich asset after upload. Existing GPS metadata should not be overwritten.

The initial predefined upload tags are:

```json
[
  "Feeling",
  "Smelling",
  "Seeing",
  "Listening",
  "Imagining"
]
```

These tags should be loaded from `/data/upload-tags.json`.

Upload tags are for categorization only. Publishing is controlled by album membership, not tags.

Uploader names should be loaded from `/data/uploaders.json`.

```json
[
  "Harold Sikkema"
]
```

## Immich Albums

Uploads should be added to an Immich album based on the selected uploader name.

For example, uploads by `Harold Sikkema` should be added to an album named:

```text
Harold Sikkema
```

If the album already exists, reuse it. If it does not exist, create it before assigning uploaded assets.

Albums should be created proactively when uploader names are discovered in `/data/uploaders.json`. Startup or configuration-load logic can ensure each configured uploader has a corresponding Immich album.

The first implementation should avoid creating duplicate albums for the same uploader. The backend should normalize or compare album names consistently before creating a new album.

An Immich asset can be associated with multiple albums. Adding an asset to an album uses the existing asset ID and creates an album association; it should not duplicate the underlying media file.

## Publishing Model

Uploads are not public by default.

Publishing should happen inside Immich, not through the upload tool. An authenticated Immich user deliberately publishes content by adding approved assets to a hardcoded Immich album named:

```text
Published
```

The upload tool must not be able to add assets to the `Published` album, even if a request attempts to do so.

The Galaxy content API should shift to a published-content model:

- The Three.js client requests gallery/slideshow content from the Artasia backend.
- The backend queries Immich.
- The backend only returns assets that belong to the `Published` album in Immich.
- Uploaded assets that are not in the `Published` album remain hidden from the public Galaxy experience.

This keeps upload friction low while preserving editorial control through Immich.

Admin review, curation, and publishing happen in Immich itself. Unpublished content should not be exposed through a persistent Galaxy admin or review view in the first version. The upload UI only needs to confirm what happened during the current session.

## Configuration Files

Upload configuration lives in the persistent data directory mounted at `/data` in production:

- `/data/locations.json`
- `/data/upload-tags.json`
- `/data/uploaders.json`

The repo includes example versions of these files under `data/`. Production values should be copied manually to `/opt/artasia-galaxy/data` on the VM. That directory is bind-mounted into the container as `/data`, so production config can be changed without rebuilding the Docker image.

## VM Setup Assumptions

The deploy workflow copies `docker-compose.yml` from the repo to the VM, but it does not copy `.env` or `data/*.json`. Before deployment, the VM must be prepared manually with environment secrets and production JSON config.

Expected VM layout:

```text
/opt/artasia-galaxy/
  docker-compose.yml
  .env
  data/
    locations.json
    upload-tags.json
    uploaders.json
```

Initial setup steps:

```bash
sudo mkdir -p /opt/artasia-galaxy/data
cd /opt/artasia-galaxy
```

GitHub Actions keeps the repo's `docker-compose.yml` synced to:

```text
/opt/artasia-galaxy/docker-compose.yml
```

Create the VM-only `.env` file:

```dotenv
ARTASIA_IMAGE=ghcr.io/nsitu/artasia-galaxy:latest
IMMICH_URL=https://photos.artsforall.co
IMMICH_API_KEY=...
WORDPRESS_URL=http://127.0.0.1
```

Copy production data files manually into:

```text
/opt/artasia-galaxy/data/
```

After setup, GitHub Actions can deploy by syncing `docker-compose.yml`, pulling the newest image, and restarting Docker Compose. Production `.env` and `data/` files remain untouched by the workflow.

## Immich API Key Permissions

The Immich API key used by Artasia needs enough permission to support upload intake, metadata tagging, album assignment, published album lookup, public asset delivery, and the storage usage cutoff.

Required Immich permissions:

| Permission | Why Artasia Needs It |
| --- | --- |
| `album.read` | Find the `Published` album and uploader albums. |
| `album.create` | Create the `Published` album and uploader albums when missing. |
| `albumAsset.create` | Add uploaded assets to uploader albums. |
| `asset.upload` | Upload images and videos to Immich. |
| `asset.update` | Attach default GPS coordinates when uploaded media lacks GPS metadata. |
| `asset.read` | Query assets from the `Published` album for the public gallery. |
| `asset.view` | Proxy thumbnails and previews. |
| `asset.download` | Proxy original assets if needed. |
| `tag.read` | Find existing sensory, partner, and site tags. |
| `tag.create` | Create missing sensory, partner, and site tags. |
| `tag.asset` | Attach tags to uploaded assets. |
| `server.statistics` | Read Immich storage usage and disable uploads above 50 GB. |

The current implementation logs startup album initialization failures and continues booting, but upload and publication filtering will not work correctly until the API key has the required permissions.

## Open Questions

## Initial Implementation Direction

1. Define the upload UI and validation rules.
2. Add backend loading and validation for `/data/locations.json`.
3. Add backend loading and validation for `/data/upload-tags.json`.
4. Add backend loading and validation for `/data/uploaders.json`.
5. Confirm the Immich upload, tagging, album lookup, album creation, and album asset assignment endpoints.
6. Confirm the `Published` album exists, or create it proactively during startup/configuration load.
7. Add server statistics lookup and disable uploads when usage exceeds 50 GB.
8. Add proactive album creation for configured uploaders.
9. Add a server-side upload route that streams files to Immich.
10. Add controlled batch concurrency.
11. Add backend logic to create or reuse the uploader album during upload as a fallback.
12. Attach predefined tags, partner tag, and site tag to uploaded assets.
13. Reject or ignore any attempt to add uploaded assets to the reserved `Published` album.
14. Update gallery/slideshow API queries to return only Immich assets from the `Published` album.
15. Add frontend per-file progress, success, failure, and retry states.
16. Add nginx and Docker runtime limits for expected upload sizes.
17. Document operational behavior after implementation.
