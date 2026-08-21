import { Router } from "express";
import { searchContextPlacements } from "../services/contextSearch.service.js";

const router = Router();

router.post("/context", async (req, res) => {
  const query = typeof req.body?.query === "string" ? req.body.query.trim() : "";
  if (!query) {
    res.status(400).json({ error: "Search query is required" });
    return;
  }

  try {
    const results = await searchContextPlacements(query);
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    res.json({ query, results });
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`[context-search] ${msg}`);
    res.status(502).json({ error: msg });
  }
});

export default router;
