import { Router } from "express";
import { getAuthContext } from "../services/auth.service.js";
import {
  applyDocumentationGalleryMigration,
  previewDocumentationGalleryMigration,
} from "../services/documentationGalleryMigration.service.js";
import {
  applyPlacementTagCleanup,
  previewPlacementTagCleanup,
} from "../services/placementTagCleanup.service.js";

const router = Router();

async function requireAuthenticated(req: Parameters<typeof getAuthContext>[0], res: {
  status: (code: number) => { json: (body: unknown) => unknown };
}): Promise<boolean> {
  const auth = await getAuthContext(req);
  if (auth.authenticated) return true;
  res.status(401).json({ error: "Sign in to use Atlas tools." });
  return false;
}

router.get("/documentation-gallery-migration", async (req, res) => {
  try {
    if (!(await requireAuthenticated(req, res))) return;
    res.json(await previewDocumentationGalleryMigration());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post("/documentation-gallery-migration", async (req, res) => {
  try {
    if (!(await requireAuthenticated(req, res))) return;
    res.json(await applyDocumentationGalleryMigration());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.get("/placement-tag-cleanup", async (req, res) => {
  try {
    if (!(await requireAuthenticated(req, res))) return;
    res.json(await previewPlacementTagCleanup());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post("/placement-tag-cleanup", async (req, res) => {
  try {
    if (!(await requireAuthenticated(req, res))) return;
    res.json(await applyPlacementTagCleanup());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

export default router;
