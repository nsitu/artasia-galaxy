# Artasia Galaxy MVP

Artasia Galaxy is a browser-based 3D gallery for photos hosted in Immich. The current MVP is deployed at:

```text
https://atlas.artsforall.co
```

The MVP includes:

- React + Three.js frontend built with Vite.
- Express backend serving the built frontend and API routes.
- Immich API integration through server-side proxy routes.
- Album and slideshow data fetching.
- Settings persistence through JSON files in a runtime data directory.
- Docker production image.
- Docker Compose runtime on the Azure VM.
- GitHub Actions build, publish, and deploy pipeline.
- nginx HTTPS reverse proxy on the existing Bitnami VM.

WordPress provides the Artasia placement metadata, activity-backed upload tags, and uploader names used by the `/admin` companion.

## Local Development

Run the app from the repo root with two terminals.

Backend:

```powershell
npm run dev --workspace @artasia/server
```

Frontend:

```powershell
npm run dev --workspace @artasia/web
```

The backend listens on:

```text
http://localhost:3000
```

The Vite frontend usually listens on:

```text
http://localhost:5173
```

The Vite dev server proxies `/api` requests to the backend.

## Production Runtime

Production uses a single Docker image containing:

- The compiled Express server.
- Production Node dependencies.
- The built Vite frontend copied into the static public directory.

The image is published to GitHub Container Registry:

```text
ghcr.io/nsitu/artasia-galaxy:latest
```

The VM runs the app from:

```text
/opt/artasia-galaxy
```

That directory contains the live Docker Compose file and environment file:

```text
/opt/artasia-galaxy/docker-compose.yml
/opt/artasia-galaxy/.env
/opt/artasia-galaxy/data/
```

The container binds only to localhost:

```text
127.0.0.1:3000 -> container port 3000
```

Public traffic reaches the app through nginx.

The `data/` directory is bind-mounted into the container at:

```text
/data
```

It stores non-secret runtime JSON state. Upload tags, uploader names, and placement data are managed in WordPress by the `wp-artasia-locations` plugin. Upload tags come from published Artasia Activities through `/wp-json/artasia/v1/activities`. Legacy `data/upload-tags.json` and `data/uploaders.json` files are ignored if present.

Secrets should remain in `/opt/artasia-galaxy/.env`, not in `data/`.

Production values should be copied manually to `/opt/artasia-galaxy/data/` on the VM before deployment. When setting up a VM or switching from the older named volume, ensure the directory exists before restarting Compose:

```bash
cd /opt/artasia-galaxy
mkdir -p data
```

## VM Setup Assumptions

The GitHub Actions deploy workflow assumes the VM has already been prepared. The workflow copies `docker-compose.yml` from the repo, pulls the latest Docker image, and restarts Compose. It does not copy `.env` or runtime files under `data/`; those remain VM-managed.

Expected VM layout:

```text
/opt/artasia-galaxy/
  docker-compose.yml
  .env
  data/
    settings.*.json
    upload-tmp/
```

Initial setup:

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

Runtime settings and upload temp files are written under:

```text
/opt/artasia-galaxy/data/
```

After this one-time setup, deployments can be handled by GitHub Actions. Future changes to `docker-compose.yml` will be copied by the workflow, while `.env` and `data/` remain untouched.

## Immich API Key Permissions

The Artasia server-side Immich API key must have these Immich permissions:

| Permission | Why Artasia Needs It |
| --- | --- |
| `album.read` | Find the `Published` album and uploader albums. |
| `album.create` | Create the `Published` album and uploader albums when missing. |
| `albumAsset.create` | Add uploaded assets to uploader albums. |
| `albumAsset.delete` | Move managed uploads out of the wrong uploader album. |
| `asset.delete` | Delete uploaded assets from Immich through the logged-in admin workflow. |
| `asset.edit.create` | Save crop edits from the logged-in admin workflow. |
| `asset.edit.delete` | Reset saved Immich edits from the logged-in admin workflow. |
| `asset.edit.get` | Load existing crop edits into the admin crop UI. |
| `asset.upload` | Upload images and videos to Immich. |
| `asset.update` | Attach default GPS coordinates when uploaded media lacks GPS metadata. |
| `asset.read` | Query assets from the `Published` album for the public gallery. |
| `asset.view` | Proxy thumbnails and previews. |
| `asset.download` | Proxy original assets if needed. |
| `tag.read` | Find existing activity, partner, and site tags. |
| `tag.create` | Create missing activity, partner, and site tags. |
| `tag.asset` | Attach tags to uploaded assets. |
| `server.statistics` | Read Immich storage usage and disable uploads above 50 GB. |

These permissions are needed for the public upload companion, uploader albums, the `Published` album, upload tagging, admin reassignment, and the 50 GB storage usage cutoff.

## Environment

The VM `.env` file provides runtime configuration. Important values:

```dotenv
ARTASIA_IMAGE=ghcr.io/nsitu/artasia-galaxy:latest
IMMICH_URL=https://photos.artsforall.co
IMMICH_API_KEY=...
WORDPRESS_URL=http://host.docker.internal
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://atlas.artsforall.co/api/v1/auth/google/callback
GOOGLE_ALLOWED_DOMAIN=artsforall.co
SESSION_SECRET=...
```

`IMMICH_URL` uses the public Immich HTTPS URL because the Galaxy app runs inside Docker. Inside the container, `127.0.0.1` refers to the Galaxy container, not the VM host.

`WORDPRESS_URL` has the same container boundary. Using the public URL is also valid:

```dotenv
WORDPRESS_URL=https://artsforall.co
```

The viewer runs at `/`. The authenticated admin area starts at `/admin`; the upload experience is currently the first tool there.

Google sign-in is handled by the Node app through `/api/v1/auth/google/start` and `/api/v1/auth/google/callback`. The Google OAuth client must allow this redirect URI:

```text
https://atlas.artsforall.co/api/v1/auth/google/callback
```

The auth session is an HTTP-only signed cookie. `GOOGLE_ALLOWED_DOMAIN` restricts accepted Google Workspace accounts, and `SESSION_SECRET` signs both the OAuth state cookie and the app session cookie. Changing `SESSION_SECRET` logs current browser sessions out.

## nginx

nginx terminates HTTPS for the canonical Atlas hostname and temporarily preserves the legacy Galaxy hostname:

```text
atlas.artsforall.co
galaxy.artsforall.co
```

The Atlas HTTPS server block lives at:

```text
/opt/bitnami/nginx/conf/server_blocks/atlas-https-server-block.conf
```

It proxies requests to:

```text
http://127.0.0.1:3000
```

The config follows the same pattern as the existing Immich HTTPS server block, including forwarded headers and WebSocket upgrade headers.

## Deployment

GitHub Actions deploys on pushes to `main`.

The workflow detects which deployable areas changed before doing expensive work:

1. App image changes under `apps/server/`, `apps/web/`, the Docker build inputs, or root package files build and push a new Docker image.
2. `docker-compose.yml` changes copy the Compose file to `/opt/artasia-galaxy`.
3. App image or Compose changes restart Docker Compose in `/opt/artasia-galaxy`.
4. WordPress plugin changes under `apps/wp-artasia-locations/` copy and activate only that plugin.
5. Plugin-only changes skip the Docker image build, GHCR push, Compose pull, and container restart.
6. Old GHCR package versions are deleted only after a new image build, keeping only the newest version for now.

The deploy command effectively runs:

```bash
cd /opt/artasia-galaxy
sudo ARTASIA_IMAGE=ghcr.io/nsitu/artasia-galaxy:latest docker compose pull
sudo ARTASIA_IMAGE=ghcr.io/nsitu/artasia-galaxy:latest docker compose up -d --remove-orphans
sudo docker image prune -f
```

## Maintenance Commands

Check container status:

```bash
cd /opt/artasia-galaxy
sudo docker compose ps
```

View logs:

```bash
cd /opt/artasia-galaxy
sudo docker compose logs --tail=100 artasia
```

Check app health:

```bash
curl http://127.0.0.1:3000/api/v1/health
```

Check public HTTPS:

```bash
curl -Ik https://atlas.artsforall.co
```

Restart the app manually:

```bash
cd /opt/artasia-galaxy
sudo docker compose up -d
```

Reload nginx after config changes:

```bash
sudo /opt/bitnami/nginx/sbin/nginx -t
sudo /opt/bitnami/ctlscript.sh restart nginx
```
