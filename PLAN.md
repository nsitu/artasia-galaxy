# Artasia Galaxy — Architecture Plan

## Overview

A browser-based Three.js image gallery for a self-hosted [Immich](https://immich.app) server. The app displays photos in a 3D environment with smooth transitions, camera movement, and narrative context via optional WordPress integration.

---

## VM Environment

| Detail                  | Value                                                                                                    |
| ----------------------- | -------------------------------------------------------------------------------------------------------- |
| OS                      | Debian 12 (Bookworm)                                                                                     |
| Platform                | Azure VM, Bitnami WordPress stack                                                                        |
| CPU                     | 2 vCPU                                                                                                   |
| RAM                     | 8 GB (+ 4 GB swap at `/swapfile`)                                                                        |
| System disk             | 64 GB                                                                                                    |
| Data disk               | 75 GB at `/mnt`                                                                                          |
| nginx configs           | `/opt/bitnami/nginx/conf/server_blocks/`                                                                 |
| Service management      | `/opt/bitnami/ctlscript.sh status`                                                                       |
| SSL certs               | Let's Encrypt via LEGO, renewed by `/opt/bitnami/letsencrypt/scripts/renew-certificate.sh` (weekly cron) |
| Docker compose (Immich) | `/opt/immich-app/`                                                                                       |
| Immich binds to         | `127.0.0.1:2283` (not publicly exposed)                                                                  |
| Project home            | `/opt/artasia-galaxy/`                                                                                   |

## High-Level Architecture

```
artsforall.co              → nginx → PHP-FPM → WordPress (existing, on VM)
photos.artsforall.co       → nginx → 127.0.0.1:2283 → Immich (existing)
galaxy.artsforall.co       → nginx → 127.0.0.1:3000 → Express (new)
```

```
Browser → Cloudflare DNS → Azure VM
                                │
                    ┌───────────┴───────────┐
                    │ nginx (on host)        │
                    │ /opt/bitnami/nginx/    │
                    │ conf/server_blocks/    │
                    │                       │
                    │ artsforall.co → WP    │
                    │ photos.* → :2283      │
                    │ galaxy.* → :3000      │
                    └───────┬───────────────┘
                            │
                    ┌───────▼───────────────┐
                    │  Express Container     │
                    │  (port 3000)          │
                    │  binds 127.0.0.1:3000 │
                    │                       │
                    │  /*        → SPA      │
                    │  /api/v1/* → Immich   │
                    │             (127.0.0.1:2283)
                    │  /api/wp/* → WP       │
                    │             (127.0.0.1:80)
                    └───────────────────────┘
```

**Same origin for the galaxy app** — the Three.js frontend calls `/api/v1/*` and `/api/wp/*` on `galaxy.artsforall.co`. No CORS issues. No separate deployment for frontend.

---

## Domain Layout

| Domain                     | Destination           |
| -------------------------- | --------------------- |
| `artsforall.co`            | WordPress (existing)  |
| `photos.artsforall.co`     | Immich (existing)     |
| **`galaxy.artsforall.co`** | **Express app (new)** |

---

## Project Structure

```
artasia-galaxy/
├── apps/
│   ├── web/                          # Three.js + React Frontend
│   │   ├── src/
│   │   │   ├── components/
│   │   │   │   ├── scenes/
│   │   │   │   │   ├── ArtScene.tsx         # <Canvas> + scene setup
│   │   │   │   │   ├── ImagePlane.tsx       # Single image mesh + texture
│   │   │   │   │   ├── GalleryWall.tsx      # Grid layout of planes
│   │   │   │   │   ├── CameraRig.tsx        # Smooth camera movement
│   │   │   │   │   └── TransitionFX.tsx     # Transition shaders/effects
│   │   │   │   ├── ui/
│   │   │   │   │   ├── HUD.tsx              # Clock, weather, overlays
│   │   │   │   │   ├── SettingsPanel.tsx    # Configuration UI
│   │   │   │   │   ├── GalleryNav.tsx       # Navigation overlay
│   │   │   │   │   └── StoryPanel.tsx       # WordPress narrative overlay
│   │   │   │   └── loading/
│   │   │   │       ├── LoadingScreen.tsx
│   │   │   │       └── TexturePreloader.tsx
│   │   │   ├── api/
│   │   │   │   ├── client.ts               # Fetch wrapper
│   │   │   │   ├── slideshow.ts            # Slideshow query
│   │   │   │   └── wordpress.ts            # WP client
│   │   │   ├── stores/
│   │   │   │   ├── galleryStore.ts         # zustand: images, selected, camera
│   │   │   │   ├── settingsStore.ts        # zustand: playback, filters
│   │   │   │   └── uiStore.ts              # zustand: overlays, theme
│   │   │   ├── hooks/
│   │   │   │   ├── useSlideshow.ts         # Timer, autoplay engine
│   │   │   │   ├── useImagePreloader.ts    # Preload textures
│   │   │   │   └── useCameraTransition.ts  # Camera animation
│   │   │   ├── types/
│   │   │   │   └── gallery.ts             # Shared types
│   │   │   ├── App.tsx
│   │   │   └── main.tsx
│   │   ├── index.html
│   │   ├── vite.config.ts
│   │   └── package.json
│   │
│   └── server/                        # Express Proxy Backend
│       ├── src/
│       │   ├── routes/
│       │   │   ├── slideshow.ts       # POST /api/v1/slideshow/query
│       │   │   ├── assets.ts          # GET /api/v1/assets/:id/{thumbnail,preview}
│       │   │   ├── albums.ts          # GET /api/v1/albums
│       │   │   ├── people.ts          # GET /api/v1/people
│       │   │   ├── settings.ts        # GET/PATCH /api/v1/settings
│       │   │   ├── events.ts          # GET /api/v1/events (SSE)
│       │   │   └── wordpress.ts       # /api/wp/* → proxy to WP (optional)
│       │   ├── services/
│       │   │   ├── slideshow.service.ts
│       │   │   └── settings.service.ts
│       │   ├── infra/
│       │   │   ├── ImmichClient.ts    # HTTP client to Immich API
│       │   │   └── WordPressClient.ts # HTTP client to WP REST (optional)
│       │   └── index.ts              # Express bootstrap
│       ├── tsconfig.json
│       └── package.json
│
├── wp-plugin/                         # Optional WordPress plugin
│   └── artasia-gallery/
│       ├── artasia-gallery.php
│       ├── rest-api.php
│       └── admin/
│           └── meta-box.php
│
├── Dockerfile                         # Multi-stage: server + built frontend
├── docker-compose.yml
├── .github/workflows/
│   └── deploy.yml                     # Build + push + SSH deploy
├── package.json                       # npm workspaces root
├── PLAN.md                            # This file
└── README.md
```

---

## API Contract

All API endpoints are under `/api/v1/` on `galaxy.artsforall.co`.

### Proxy to Immich

| Endpoint                       | Method | Purpose                               |
| ------------------------------ | ------ | ------------------------------------- |
| `/api/v1/slideshow/query`      | POST   | Fetch slideshow photos with filters   |
| `/api/v1/assets/:id/thumbnail` | GET    | Proxied thumbnail (`?size=thumbnail`) |
| `/api/v1/assets/:id/preview`   | GET    | Proxied preview (`?size=preview`)     |
| `/api/v1/albums`               | GET    | List Immich albums                    |
| `/api/v1/albums/:id`           | GET    | Single album detail                   |
| `/api/v1/people`               | GET    | List people                           |
| `/api/v1/settings`             | GET    | Merged settings                       |
| `/api/v1/settings/:domain`     | PATCH  | Persist setting override              |
| `/api/v1/events`               | GET    | SSE stream for settings sync          |
| `/api/v1/meta`                 | GET    | Version + contract info               |

### Proxy to WordPress (optional, normalized)

| Endpoint                | Method | Source WP Endpoint                  |
| ----------------------- | ------ | ----------------------------------- |
| `/api/wp/galleries`     | GET    | `/wp-json/artasia/v1/galleries`     |
| `/api/wp/galleries/:id` | GET    | `/wp-json/artasia/v1/galleries/:id` |

The Express proxy normalizes WordPress responses into a consistent shape so the frontend has one API contract regardless of the backend.

### Slideshow Query Request

```json
POST /api/v1/slideshow/query
{
  "albumIds": ["uuid1", "uuid2"],
  "personIds": ["uuid3"],
  "datePreset": "year",
  "startDate": null,
  "endDate": null,
  "shuffle": true,
  "seed": 42,
  "limit": 100
}
```

### Slideshow Query Response

```json
{
  "photos": [
    {
      "id": "immich-asset-uuid",
      "thumbnailUrl": "/api/v1/assets/uuid/thumbnail",
      "previewUrl": "/api/v1/assets/uuid/preview",
      "width": 1920,
      "height": 1080,
      "orientation": "landscape",
      "createdAt": "2025-06-01T12:00:00Z",
      "exifInfo": {
        "make": "Canon",
        "model": "R5",
        "focalLength": 35
      },
      "faces": [{ "x": 0.3, "y": 0.5, "width": 0.1, "height": 0.15 }]
    }
  ],
  "total": 284
}
```

The `faces` array enables **face-aware zoom** — the camera targets face origins rather than image center (inspired by immich-kiosk's smart-zoom).

---

## Immich Integration

| Immich API                                     | Used for                            |
| ---------------------------------------------- | ----------------------------------- |
| `GET /api/assets/:id/thumbnail?size=thumbnail` | Gallery thumbnails (proxied)        |
| `GET /api/assets/:id/thumbnail?size=preview`   | Full-screen image (proxied)         |
| `POST /api/search/metadata`                    | Slideshow query with filters        |
| `POST /api/search/random`                      | Random shuffle mode                 |
| `GET /api/albums`                              | Album picker for settings           |
| `GET /api/people`                              | People picker for settings          |
| `GET /api/assets/:id`                          | Full EXIF metadata for info overlay |

**API Key Security**: The `x-api-key` header is set in `ImmichClient.ts` server-side, never exposed to the browser. The Express proxy streams image bytes through — the browser only knows proxy URLs.

---

## Three.js Rendering

### Tech Stack

| Layer       | Choice                                                | Why                                    |
| ----------- | ----------------------------------------------------- | -------------------------------------- |
| 3D Engine   | React Three Fiber + drei                              | React-native 3D, built-in helpers      |
| State       | zustand                                               | Idiomatic with R3F, shared scene state |
| Textures    | `useLoader(TextureLoader, url)` inside `<Suspense>`   | Automatic caching by `THREE.Cache`     |
| Camera      | `useFrame` + `THREE.MathUtils.damp()`                 | Smooth lerp for transitions            |
| Performance | `dpr={[1, 1.5]}`, thumbnail textures, frustum culling | Good enough for MVP concurrency        |

### Proof of Concept MVP

- Images on flat planes arranged in a grid/wall
- Camera zooms to selected image
- Subtle parallax on mouse move (CameraRig)
- Hover: scale + brightness on image plane

---

## Docker & Deployment

### Dockerfile (Multi-stage)

```dockerfile
# Stage 1: Frontend build
FROM node:22 AS frontend
WORKDIR /app/apps/web
COPY apps/web/package.json ./
RUN npm install
COPY apps/web/ ./
RUN npm run build

# Stage 2: Server build
FROM node:22 AS backend
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/server/ apps/server/
COPY packages/shared/ packages/shared/
RUN npm install
RUN npm run build -w apps/server

# Stage 3: Runtime
FROM node:22-alpine
WORKDIR /app
COPY --from=backend /app/apps/server/dist/ ./dist/
COPY --from=backend /app/node_modules/ ./node_modules/
COPY --from=frontend /app/apps/web/dist/ ./public/
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### docker-compose.yml

Created at `/opt/artasia-galaxy/docker-compose.yml` on the VM:

```yaml
services:
  artasia:
    image: ghcr.io/your/artasia:latest
    ports:
      - "127.0.0.1:3000:3000" # not publicly exposed
    environment:
      - IMMICH_URL=http://127.0.0.1:2283
      - IMMICH_API_KEY=${IMMICH_API_KEY}
      - PORT=3000
      - DATA_DIR=/data
      - WORDPRESS_URL=http://127.0.0.1
    volumes:
      - artasia-data:/data
    restart: unless-stopped

volumes:
  artasia-data:
```

Express binds to `127.0.0.1:3000` (localhost only, matching Immich's security pattern). nginx on the host reverse-proxies `galaxy.artsforall.co` → `127.0.0.1:3000`.

**Environment variable management**: Create a `.env` file next to `docker-compose.yml` with the Immich API key (never committed to git):

```
IMMICH_API_KEY=your-api-key-here
```

### nginx config addition (on the VM)

Add alongside existing server blocks in `/opt/bitnami/nginx/conf/server_blocks/`:

```nginx
# /opt/bitnami/nginx/conf/server_blocks/galaxy-artsforall-co.conf
server {
    listen 80;
    server_name galaxy.artsforall.co;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_buffering off;          # needed for SSE
    }
}
```

### SSL cert update

Before deploying, `galaxy.artsforall.co` must be added to the Let's Encrypt SAN certificate. The existing renew script at `/opt/bitnami/letsencrypt/scripts/renew-certificate.sh` handles renewal; the `DOMAINS` variable inside it needs to include `galaxy.artsforall.co`.

### DNS setup

Create a DNS A record:

```
galaxy.artsforall.co  →  <VM public IP>
```

Add it alongside the existing `photos.artsforall.co` record.

### Port mapping

Express binds to `127.0.0.1:3000` — not publicly exposed, matching the Immich pattern:

```yaml
ports:
  - "127.0.0.1:3000:3000"
```

---

## CI/CD Pipeline

```yaml
# .github/workflows/deploy.yml
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build and push
        uses: docker/build-push-action@v5
        with:
          context: .
          push: true
          tags: ghcr.io/${{ github.repository }}:latest

      - name: Deploy to VM
        uses: appleboy/ssh-action@v1
        with:
          host: ${{ secrets.VM_HOST }}
          username: ${{ secrets.VM_USER }}
          key: ${{ secrets.VM_SSH_KEY }}
          script: |
            cd /opt/artasia-galaxy
            docker compose pull
            docker compose up -d --remove-orphans
            docker image prune -f
```

**Flow**:

1. Push to `main` triggers workflow
2. Docker image is built and pushed to GHCR
3. SSH into the Azure VM
4. `docker compose pull` fetches the new image
5. `docker compose up -d` restarts the container

No inbound ports needed beyond SSH (port 22), which is already open for VM management.

---

## WordPress Integration (Optional)

WordPress runs directly on the VM (not in a container) at `artsforall.co`.

### How cross-origin is handled

The Three.js frontend never calls WordPress directly. Express proxies WordPress REST endpoints under `/api/wp/*`:

```
Three.js frontend (galaxy.artsforall.co)
  → /api/wp/galleries
  → Express proxies to http://artsforall.co/wp-json/artasia/v1/galleries
  → Response normalized and returned
```

Same origin for the frontend — no CORS.

### Plugin architecture

```
wp-plugin/artasia-gallery/
├── artasia-gallery.php          # Plugin bootstrap
├── rest-api.php                 # Register /artasia/v1/galleries endpoints
└── admin/
    └── meta-box.php             # Immich album selector in Gallery editor
```

The plugin exposes:

- A **Custom Post Type** `artasia_gallery` with ACF fields (narrative, location, date_range)
- A **meta box** that fetches Immich albums from the Express proxy and lets the editor pick one
- **REST endpoints** that include the linked `immich_album_uuid` in responses

### The Express proxy normalizes responses

```typescript
// /api/wp/galleries response shape (frontend contract)
{
  "id": 42,
  "title": "Summer in Tuscany",
  "narrative": "We started in Florence...",
  "location": "Tuscany, Italy",
  "dateRange": { "start": "2025-06-01", "end": "2025-06-14" },
  "immichAlbumUuid": "a1b2c3d4-...",
  "immichAlbumTitle": "2025-Italy"
}
```

---

## Implementation Phases

### Phase 1 — Proxy & Single Image

- Express server with `/api/v1/assets/:id/thumbnail` and `/api/v1/assets/:id/preview`
- `ImmichClient.ts` with API key injection
- Dockerfile and docker-compose.yml
- Three.js `<Canvas>` with a single `<ImagePlane>` loading texture from proxy URL
- Deploy to VM

### Phase 2 — Slideshow Query & Gallery Wall

- `POST /api/v1/slideshow/query` endpoint calling Immich search
- Gallery wall: grid of thumbnail `<ImagePlane>` components
- Click to zoom (camera flies to selected image)
- Basic navigation (next/prev)
- Zustand stores for state

### Phase 3 — Settings & Configuration

- Settings persistence (`DATA_DIR/settings.*.json`)
- Settings panel UI
- Photo filtering (albums, people, dates)
- Shuffle/autoplay engine
- SSE events for multi-device sync

### Phase 4 — Polish & 3D Experience

- Camera transitions (smooth fly-through between images)
- Face-aware zoom origin
- Shader effects for image transitions
- Hover effects, parallax
- HUD overlays (clock, metadata)

### Phase 5 — WordPress Integration (Optional)

- WP plugin with CPT + meta box
- Express WP proxy routes
- Story panel overlay in Three.js
- Gallery → narrative mapping

---

## Key Decisions

| Decision              | Choice                                          | Rationale                                               |
| --------------------- | ----------------------------------------------- | ------------------------------------------------------- |
| Deployment model      | Single Docker container                         | Atomic deploys, same origin, simple CI/CD               |
| Frontend framework    | React + Vite                                    | R3F ecosystem, fast builds                              |
| 3D state management   | zustand                                         | Idiomatic with R3F, avoids prop drilling                |
| Image resolution      | Thumbnails for gallery, preview for full-screen | Performance, bandwidth                                  |
| Backend framework     | Express                                         | Simple, familiar, excellent streaming support           |
| API key security      | Server-side only, never exposed                 | Immich API key stays on the VM                          |
| WordPress integration | Proxied through Express                         | Single origin for frontend, no CORS                     |
| Container registry    | GHCR                                            | Tight GitHub Actions integration                        |
| Domain strategy       | Separate subdomain per app                      | Clean separation, existing nginx routing unaffected     |
| Express port binding  | `127.0.0.1:3000` (localhost only)               | Matches Immich's security pattern, not publicly exposed |
