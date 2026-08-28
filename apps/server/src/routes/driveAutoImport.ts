import { Router, type Response } from "express";
import { readAuthSession } from "../services/auth.service.js";
import { createDriveClient } from "../services/googleDrive.service.js";
import { getUploadConfig } from "../services/uploadConfig.service.js";
import { driveAutoImport, DriveImportBusyError, summarizeDriveJob } from "../services/driveAutoImport.service.js";

export function createDriveAutoImportRouter(manager = driveAutoImport, loadConfig = getUploadConfig) {
  const router = Router();
  router.use((req, res, next) => {
    if (!readAuthSession(req)) { res.status(401).json({ error: "Sign in to manage Drive auto-imports." }); return; }
    res.set("Cache-Control", "no-store");
    next();
  });
  const fail = (res: Response, error: unknown) => {
    res.status(error instanceof DriveImportBusyError ? 409 : 400).json({ error: error instanceof Error ? error.message : "Drive auto-import failed." });
  };
  router.post("/placements/:placementId/auto-import", async (req, res) => {
    try {
      const session = readAuthSession(req)!;
      const client = createDriveClient(session.refreshToken);
      if (!client) { res.status(400).json({ error: "Google Drive access is not configured. Sign in again." }); return; }
      const job = await manager.start(Number(req.params.placementId), await loadConfig(), session.email, client);
      res.status(202).json(job);
    } catch (error) { fail(res, error); }
  });
  router.get("/placements/:placementId/sync-status", async (req, res) => {
    try {
      const placementId = Number(req.params.placementId);
      const config = await loadConfig();
      if (!config.placements.some((p) => p.placement_id === placementId)) { res.status(404).json({ error: "Placement not found." }); return; }
      res.json(await manager.status(placementId, config));
    } catch (error) { fail(res, error); }
  });
  router.get("/auto-import-jobs/:jobId", async (req, res) => {
    try {
      const job = await manager.get(String(req.params.jobId));
      if (!job) { res.status(404).json({ error: "Import job not found." }); return; }
      res.json(summarizeDriveJob(job));
    } catch (error) { fail(res, error); }
  });
  router.get("/auto-import-jobs/:jobId/results", async (req, res) => {
    try {
      const cursor = req.query.cursor === undefined ? 0 : Number(req.query.cursor);
      if (!Number.isSafeInteger(cursor) || cursor < 0) { res.status(400).json({ error: "Invalid results cursor." }); return; }
      const job = await manager.get(String(req.params.jobId));
      if (!job) { res.status(404).json({ error: "Import job not found." }); return; }
      const end = cursor + 100;
      res.json({ results: job.results.slice(cursor, end).map(({ file: _file, createdAssetId: _checkpoint, ...item }) => item),
        nextCursor: end < job.results.length ? end : null });
    } catch (error) { fail(res, error); }
  });
  router.post("/auto-import-jobs/:jobId/cancel", async (req, res) => {
    try {
      const job = await manager.cancel(String(req.params.jobId));
      if (!job) { res.status(404).json({ error: "Import job not found." }); return; }
      res.json(summarizeDriveJob(job));
    } catch (error) { fail(res, error); }
  });
  return router;
}

export default createDriveAutoImportRouter();
