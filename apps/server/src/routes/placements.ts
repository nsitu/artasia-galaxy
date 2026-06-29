import { Router } from "express";
import { getMapPlacements } from "../services/uploadConfig.service.js";

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

export default router;
