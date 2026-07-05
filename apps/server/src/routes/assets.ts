import { Router } from "express";
import { getAssetThumbnail } from "../infra/ImmichClient.js";
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
    const immichRes = await getAssetThumbnail(req.params.id, "thumbnail");

    res.status(immichRes.status);
    res.setHeader("Content-Type", immichRes.headers.get("Content-Type") ?? "image/jpeg");
    res.setHeader("Cache-Control", immichRes.ok ? "public, max-age=86400" : "no-store");

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
    const immichRes = await getAssetThumbnail(req.params.id, "preview");

    res.status(immichRes.status);
    res.setHeader("Content-Type", immichRes.headers.get("Content-Type") ?? "image/jpeg");
    res.setHeader("Cache-Control", immichRes.ok ? "public, max-age=86400" : "no-store");

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

export default router;
