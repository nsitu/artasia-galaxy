import { Router } from "express";
import { getArtasiaProjects } from "../infra/WordPressClient.js";

const router = Router();

router.get("/", async (_req, res) => {
  try {
    const projects = await getArtasiaProjects();
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.json(projects);
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[projects] failed: ${msg}`);
    res.status(502).json({ error: msg });
  }
});

export default router;
