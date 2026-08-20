import { Router } from "express";
import { getMapPlacements } from "../services/uploadConfig.service.js";
import { queryPlacementProcessGallery } from "../services/slideshow.service.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    res.json(await getMapPlacements());
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[placements] failed: ${msg}`);
    res.status(502).json({ error: msg });
  }
});

router.get("/:placementId/process-gallery", async (req, res) => {
  const placementId = Number(req.params.placementId);
  if (!Number.isInteger(placementId) || placementId <= 0) {
    res.status(400).json({ error: "A valid placement ID is required." });
    return;
  }

  try {
    const photos = await queryPlacementProcessGallery(placementId);
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.json({
      placementId,
      assets: photos.map((photo) => ({
        ...photo,
        caption: photo.exifInfo?.description?.trim() || photo.fileName,
        alt: photo.exifInfo?.description?.trim() || photo.fileName,
      })),
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[placements] process gallery failed: ${msg}`);
    res.status(502).json({ error: msg });
  }
});

export default router;
