import { Router } from "express";
import { readAuthSession } from "../services/auth.service.js";
import { createDriveClient } from "../services/googleDrive.service.js";
import { driveProcessBackfill, DriveProcessBusyError } from "../services/driveProcessBackfill.service.js";

export function createDriveProcessBackfillRouter(manager = driveProcessBackfill, makeClient = createDriveClient) {
  const router = Router();
  router.use((req, res, next) => {
    res.set("Cache-Control", "no-store");
    if (!readAuthSession(req)) { res.status(401).json({ error: "Sign in to manage Process tags." }); return; }
    next();
  });
  router.get("/", (_req, res) => { res.json({ latest: manager.latest() }); });
  router.post("/", (req, res) => {
    try {
      const session = readAuthSession(req)!;
      const client = makeClient(session.refreshToken);
      if (!client) { res.status(400).json({ error: "Google Drive access is not configured. Sign in again." }); return; }
      res.status(202).json(manager.start(client, session.email));
    } catch (error) {
      res.status(error instanceof DriveProcessBusyError ? 409 : 400).json({ error: error instanceof Error ? error.message : "Could not start Process tagging." });
    }
  });
  router.get("/:jobId/results", (req, res) => {
    const cursor = req.query.cursor === undefined ? 0 : Number(req.query.cursor);
    if (!Number.isSafeInteger(cursor) || cursor < 0) { res.status(400).json({ error: "Invalid results cursor." }); return; }
    const job = manager.get(String(req.params.jobId));
    if (!job) { res.status(404).json({ error: "Job not found. Results reset on server restart or when a new run begins." }); return; }
    res.json({ results: job.results.slice(cursor, cursor + 100), nextCursor: cursor + 100 < job.results.length ? cursor + 100 : null });
  });
  router.post("/:jobId/cancel", (req, res) => {
    const job = manager.cancel(String(req.params.jobId));
    if (!job) { res.status(404).json({ error: "Job not found." }); return; }
    res.json(job);
  });
  return router;
}

export default createDriveProcessBackfillRouter();
