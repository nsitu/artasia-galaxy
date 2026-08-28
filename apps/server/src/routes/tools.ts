import { Router, type Request, type Response } from "express";
import {
  searchAssets,
  updateAssetDescription,
} from "../infra/ImmichClient.js";
import { getAuthContext } from "../services/auth.service.js";
import driveProcessBackfillRoutes from "./driveProcessBackfill.js";

const router = Router();
router.use("/drive-process-backfill", driveProcessBackfillRoutes);

const ASSET_PAGE_SIZE = 500;

async function searchAllImmichAssets() {
  const byId = new Map<string, Awaited<ReturnType<typeof searchAssets>>["assets"]["items"][number]>();

  for (const visibility of ["timeline", "archive"] as const) {
    let page = 1;
    for (;;) {
      const result = await searchAssets({
        page,
        size: ASSET_PAGE_SIZE,
        visibility,
        withExif: true,
        withPeople: false,
      });
      for (const asset of result.assets.items) byId.set(asset.id, asset);
      if (!result.assets.nextPage || result.assets.items.length < ASSET_PAGE_SIZE) break;
      page += 1;
    }
  }

  return Array.from(byId.values());
}

router.post("/cleanup-screenshot-captions", async (req: Request, res: Response) => {
  try {
    const auth = await getAuthContext(req);
    if (!auth.authenticated) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const assets = await searchAllImmichAssets();
    const matches = assets.filter(
      (asset) => asset.exifInfo?.description?.trim() === "Screenshot",
    );
    const results: Array<{
      assetId: string;
      fileName: string;
      status: "cleared" | "failed";
      error?: string;
    }> = [];

    let cleared = 0;
    let failed = 0;
    for (const asset of matches) {
      try {
        await updateAssetDescription(asset.id, "");
        cleared += 1;
        results.push({
          assetId: asset.id,
          fileName: asset.originalFileName,
          status: "cleared",
        });
      } catch (error) {
        failed += 1;
        results.push({
          assetId: asset.id,
          fileName: asset.originalFileName,
          status: "failed",
          error: (error as Error).message,
        });
      }
    }

    res.json({
      scanned: assets.length,
      matched: matches.length,
      cleared,
      failed,
      results,
    });
  } catch (error) {
    res.status(502).json({ error: (error as Error).message });
  }
});

export default router;
