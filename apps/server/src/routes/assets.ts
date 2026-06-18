import { Router } from "express";
import { getAssetThumbnail } from "../infra/ImmichClient.js";

const router = Router();

router.get("/:id/thumbnail", async (req, res) => {
  try {
    const immichRes = await getAssetThumbnail(req.params.id, "thumbnail");

    res.status(immichRes.status);
    res.setHeader("Content-Type", immichRes.headers.get("Content-Type") ?? "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");

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
    res.setHeader("Cache-Control", "public, max-age=86400");

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
