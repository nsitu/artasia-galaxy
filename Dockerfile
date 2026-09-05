# syntax=docker/dockerfile:1

FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json

RUN npm ci

COPY apps/server apps/server
COPY apps/web apps/web

ARG VITE_MAPBOX_TOKEN
ENV VITE_MAPBOX_TOKEN=$VITE_MAPBOX_TOKEN
ARG ARTASIA_BUILD_ID=dev
ARG ARTASIA_BUILD_TIME
ENV ARTASIA_BUILD_ID=$ARTASIA_BUILD_ID
ENV ARTASIA_BUILD_TIME=$ARTASIA_BUILD_TIME
ENV VITE_ARTASIA_BUILD_ID=$ARTASIA_BUILD_ID
ENV VITE_ARTASIA_BUILD_TIME=$ARTASIA_BUILD_TIME

RUN npm run build --workspace @artasia/web
RUN npm run build --workspace @artasia/server
RUN npm prune --omit=dev --workspaces --include-workspace-root

FROM node:22-alpine AS runtime

ARG ARTASIA_BUILD_ID=dev
ARG ARTASIA_BUILD_TIME

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
ENV ARTASIA_BUILD_ID=$ARTASIA_BUILD_ID
ENV ARTASIA_BUILD_TIME=$ARTASIA_BUILD_TIME

RUN apk add --no-cache imagemagick libheif libde265 ffmpeg

WORKDIR /app

COPY package.json package-lock.json ./
COPY apps/server/package.json apps/server/package.json
COPY apps/server/assets /app/assets
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/server/dist dist
COPY --from=build /app/apps/web/dist /public
COPY data /data

RUN mkdir -p /data

EXPOSE 3000

CMD ["node", "dist/index.js"]
