# Artasia Galaxy MVP

Artasia Galaxy is a browser-based 3D gallery for photos hosted in Immich. The current MVP is deployed at:

```text
https://galaxy.artsforall.co
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

WordPress integration appears in the original architecture plan, but it is not part of the immediate MVP roadmap.

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

It stores non-secret JSON configuration and runtime JSON state. The committed files under `data/` are examples only:

```text
data/locations.json
data/upload-tags.json
data/uploaders.json
```

Secrets should remain in `/opt/artasia-galaxy/.env`, not in `data/`.

Production values should be copied manually to `/opt/artasia-galaxy/data/` on the VM before deployment. When setting up a VM or switching from the older named volume, ensure the directory exists before restarting Compose:

```bash
cd /opt/artasia-galaxy
mkdir -p data
```

## VM Setup Assumptions

The GitHub Actions deploy workflow assumes the VM has already been prepared. The workflow pulls the latest Docker image and restarts Compose, but it does not currently copy `docker-compose.yml`, `.env`, or `data/*.json` to the VM.

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

Initial setup:

```bash
sudo mkdir -p /opt/artasia-galaxy/data
cd /opt/artasia-galaxy
```

Copy the repo's `docker-compose.yml` to:

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

Copy production JSON config files into:

```text
/opt/artasia-galaxy/data/
```

After this one-time setup, deployments can be handled by GitHub Actions.

## Immich API Key Permissions

The Artasia server-side Immich API key must have these Immich permissions:

| Permission | Why Artasia Needs It |
| --- | --- |
| `album.read` | Find the `Published` album and uploader albums. |
| `album.create` | Create the `Published` album and uploader albums when missing. |
| `albumAsset.create` | Add uploaded assets to uploader albums. |
| `asset.upload` | Upload images and videos to Immich. |
| `asset.read` | Query assets from the `Published` album for the public gallery. |
| `asset.view` | Proxy thumbnails and previews. |
| `asset.download` | Proxy original assets if needed. |
| `tag.read` | Find existing sensory, partner, and site tags. |
| `tag.create` | Create missing sensory, partner, and site tags. |
| `tag.asset` | Attach tags to uploaded assets. |
| `server.statistics` | Read Immich storage usage and disable uploads above 50 GB. |

These permissions are needed for the public upload companion, uploader albums, the `Published` album, upload tagging, and the 50 GB storage usage cutoff.

## Environment

The VM `.env` file provides runtime configuration. Important values:

```dotenv
ARTASIA_IMAGE=ghcr.io/nsitu/artasia-galaxy:latest
IMMICH_URL=https://photos.artsforall.co
IMMICH_API_KEY=...
WORDPRESS_URL=http://127.0.0.1
```

`IMMICH_URL` uses the public Immich HTTPS URL because the Galaxy app runs inside Docker. Inside the container, `127.0.0.1` refers to the Galaxy container, not the VM host.

## nginx

nginx terminates HTTPS for:

```text
galaxy.artsforall.co
```

The Galaxy HTTPS server block lives at:

```text
/opt/bitnami/nginx/conf/server_blocks/galaxy-https-server-block.conf
```

It proxies requests to:

```text
http://127.0.0.1:3000
```

The config follows the same pattern as the existing Immich HTTPS server block, including forwarded headers and WebSocket upgrade headers.

## Deployment

GitHub Actions deploys on pushes to `main`.

The workflow:

1. Builds the Docker image.
2. Pushes `latest` and commit-SHA tags to GHCR.
3. SSHes into the Azure VM.
4. Runs Docker Compose in `/opt/artasia-galaxy`.
5. Pulls the new image.
6. Restarts the container.
7. Prunes old local Docker images.
8. Deletes old GHCR package versions, keeping only the newest version for now.

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
curl -Ik https://galaxy.artsforall.co
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
