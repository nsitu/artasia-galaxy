import { Router } from "express";
import {
  getAssetOriginal,
  getAssetThumbnail,
  hasAssetEmbedding,
  isMissingEmbeddingError,
  regenerateAssetThumbnail,
} from "../infra/ImmichClient.js";
import { getWordPressConfig } from "../infra/WordPressClient.js";
import {
  DEFAULT_SIMILAR_RESULT_LIMIT,
  MAX_SIMILAR_RESULT_LIMIT,
  findSimilarAssets,
  pickSimilarAsset,
} from "../services/similarAsset.service.js";

const router = Router();
const THUMBNAIL_REGEN_COOLDOWN_MS = 5 * 60_000;
const thumbnailRegenRequestedAt = new Map<string, number>();

async function isMissingAssetMedia(response: Response) {
  if (response.status !== 404) return false;

  const body = await response.clone().text().catch(() => "");
  try {
    const parsed = JSON.parse(body) as { message?: unknown };
    return parsed.message === "Asset media not found";
  } catch {
    return body.includes("Asset media not found");
  }
}

async function requestThumbnailRegeneration(assetId: string, response: Response) {
  if (!(await isMissingAssetMedia(response))) return;

  const now = Date.now();
  const lastRequestedAt = thumbnailRegenRequestedAt.get(assetId) ?? 0;
  if (now - lastRequestedAt < THUMBNAIL_REGEN_COOLDOWN_MS) return;

  thumbnailRegenRequestedAt.set(assetId, now);
  if (thumbnailRegenRequestedAt.size > 5_000) {
    for (const [cachedAssetId, requestedAt] of thumbnailRegenRequestedAt) {
      if (now - requestedAt >= THUMBNAIL_REGEN_COOLDOWN_MS) {
        thumbnailRegenRequestedAt.delete(cachedAssetId);
      }
    }
  }

  try {
    await regenerateAssetThumbnail(assetId);
    console.warn(`[thumbnail] ${assetId}: missing media; regeneration queued`);
  } catch (error) {
    console.error(
      `[thumbnail] ${assetId}: failed to queue regeneration: ${(error as Error).message}`,
    );
  }
}

async function getAssetThumbnailWithFallback(
  assetId: string,
  size: "thumbnail" | "preview",
  edited: boolean,
) {
  const response = await getAssetThumbnail(assetId, size, { edited });
  if (!edited || response.ok) {
    if (!response.ok) await requestThumbnailRegeneration(assetId, response);
    return response;
  }

  await response.body?.cancel().catch(() => undefined);
  const fallback = await getAssetThumbnail(assetId, size);
  if (fallback.ok) {
    console.warn(
      `[${size}] ${assetId}: edited rendition unavailable; using original thumbnail`,
    );
  } else {
    await requestThumbnailRegeneration(assetId, fallback);
  }
  return fallback;
}

router.get("/external-logo", async (req, res) => {
  try {
    const rawUrl = typeof req.query.url === "string" ? req.query.url : "";
    if (!rawUrl) {
      res.status(400).json({ error: "Missing url" });
      return;
    }

    const logoUrl = new URL(rawUrl);
    const wordpressUrl = new URL(getWordPressConfig().url);
    if (logoUrl.hostname !== wordpressUrl.hostname || !logoUrl.pathname.startsWith("/wp-content/uploads/")) {
      res.status(400).json({ error: "Logo URL is not allowed" });
      return;
    }

    const upstream = await fetch(logoUrl);
    if (!upstream.ok) {
      res.status(upstream.status).json({ error: `Logo request failed: ${upstream.statusText}` });
      return;
    }

    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("Content-Type") ?? "image/svg+xml");
    res.setHeader("Cache-Control", "public, max-age=86400");

    if (upstream.body) {
      const reader = upstream.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[external-logo] ${msg}`);
    res.status(502).json({ error: msg });
  }
});

router.get("/:id/thumbnail", async (req, res) => {
  try {
    const edited = req.query.edited === "true";
    const immichRes = await getAssetThumbnailWithFallback(
      req.params.id,
      "thumbnail",
      edited,
    );

    res.status(immichRes.status);
    res.setHeader("Content-Type", immichRes.headers.get("Content-Type") ?? "image/jpeg");
    res.setHeader("Cache-Control", immichRes.ok && !edited ? "public, max-age=86400" : "no-store");

    if (immichRes.body) {
      const reader = immichRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[thumbnail] ${req.params.id}: ${msg}`);
    res.status(502).json({ error: msg });
  }
});

router.get("/:id/preview", async (req, res) => {
  try {
    const edited = req.query.edited === "true";
    const immichRes = await getAssetThumbnailWithFallback(
      req.params.id,
      "preview",
      edited,
    );

    res.status(immichRes.status);
    res.setHeader("Content-Type", immichRes.headers.get("Content-Type") ?? "image/jpeg");
    res.setHeader("Cache-Control", immichRes.ok && !edited ? "public, max-age=86400" : "no-store");

    if (immichRes.body) {
      const reader = immichRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[preview] ${req.params.id}: ${msg}`);
    res.status(502).json({ error: msg });
  }
});

router.get("/:id/similar-availability", async (req, res) => {
  try {
    const available = await hasAssetEmbedding(req.params.id);
    res.set("Cache-Control", "no-store");
    res.json({ available });
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[similar-availability] ${req.params.id}: ${msg}`);
    res.status(502).json({ error: msg });
  }
});

router.get("/:id/similar", async (req, res) => {
  const rawPlacementId = typeof req.query.excludePlacementId === "string"
    ? Number(req.query.excludePlacementId)
    : undefined;
  const excludePlacementId = rawPlacementId != null && Number.isInteger(rawPlacementId) && rawPlacementId > 0
    ? rawPlacementId
    : undefined;
  const rawLimit = typeof req.query.limit === "string"
    ? Number(req.query.limit)
    : DEFAULT_SIMILAR_RESULT_LIMIT;
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(MAX_SIMILAR_RESULT_LIMIT, Math.floor(rawLimit)))
    : DEFAULT_SIMILAR_RESULT_LIMIT;

  try {
    const recommendations = await findSimilarAssets(req.params.id, excludePlacementId, limit);
    const recommendation = pickSimilarAsset(recommendations);
    // Each request samples from the top eligible matches, so caching would
    // defeat the variety users get from repeated searches.
    res.set("Cache-Control", "no-store");
    res.json({ recommendation, recommendations });
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[similar] ${req.params.id}: ${msg}`);
    res.status(isMissingEmbeddingError(err) ? 400 : 502).json({ error: msg });
  }
});

router.get("/:id/original", async (req, res) => {
  try {
    const range = typeof req.headers.range === "string" ? req.headers.range : undefined;
    const immichRes = await getAssetOriginal(req.params.id, {
      range,
      allowErrorStatus: true,
    });

    res.status(immichRes.status);
    for (const header of [
      "content-type",
      "content-length",
      "content-range",
      "accept-ranges",
      "etag",
      "last-modified",
    ]) {
      const value = immichRes.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader("Cache-Control", "private, max-age=3600");

    if (immichRes.body) {
      const reader = immichRes.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[original] ${req.params.id}: ${msg}`);
    res.status(502).json({ error: msg });
  }
});

export default router;
