import { Router } from "express";
import { querySlideshow } from "../services/slideshow.service.js";

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
    });

    res.json(result);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[slideshow] query failed: ${msg}`);
    res.status(502).json({ error: msg });
  }
});

export default router;
