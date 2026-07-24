import { Router } from "express";
import { getAssetOriginal, getAssetThumbnail } from "../infra/ImmichClient.js";
import { getWordPressConfig } from "../infra/WordPressClient.js";

const router = Router();

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
    const immichRes = await getAssetThumbnail(req.params.id, "thumbnail", { edited });

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
    const immichRes = await getAssetThumbnail(req.params.id, "preview", { edited });

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
