import { Router } from "express";
import { querySlideshow, queryViewerAsset } from "../services/slideshow.service.js";

const router = Router();

router.post("/query", async (req, res) => {
  try {
    const result = await querySlideshow({
      albumIds: req.body.albumIds,
      personIds: req.body.personIds,
      datePreset: req.body.datePreset,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
      shuffle: req.body.shuffle ?? true,
      seed: req.body.seed ?? Date.now(),
      limit: req.body.limit ?? 100,
      assetType: req.body.assetType,
      placementFocus: req.body.placementFocus,
    });

    res.json(result);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[slideshow] query failed: ${msg}`);
    res.status(502).json({ error: msg });
  }
});

router.get("/assets/:assetId", async (req, res) => {
  try {
    const photo = await queryViewerAsset(req.params.assetId);
    if (!photo) {
      res.status(404).json({ error: "Asset is not available in the viewer" });
      return;
    }
    res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=900");
    res.json({ photo });
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[slideshow/asset] ${req.params.assetId}: ${msg}`);
    res.status(502).json({ error: msg });
  }
});

export default router;
