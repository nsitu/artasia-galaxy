import { Router } from "express";
import { getPublishedAlbum } from "../infra/ImmichClient.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const album = await getPublishedAlbum();
    const normalized = [album].map((a) => ({
      id: a.id,
      name: a.albumName,
      description: a.description,
      assetCount: a.assetCount,
      thumbnailAssetId: a.albumThumbnailAssetId,
      createdAt: a.createdAt,
      shared: a.shared,
    }));
    res.json(normalized);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[albums] failed: ${msg}`);
    res.status(502).json({ error: msg });
  }
});

export default router;
