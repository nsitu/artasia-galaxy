import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import express from "express";
import { createDriveAutoImportRouter } from "./driveAutoImport.js";
import { DriveAutoImportManager, DriveJobStore } from "../services/driveAutoImport.service.js";

test("all auto-import APIs require authentication, results are bounded, and status is not cached", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "atlas-drive-api-test-"));
  const store = new DriveJobStore(directory);
  const manager = new DriveAutoImportManager(store);
  const previousSecret = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = "test-only-secret";
  const app = express(); app.use(express.json());
  app.use("/api/v1/drive", createDriveAutoImportRouter(manager, async () => ({ placements: [
    { placement_id: 1, placement_name: "Test", partner_name: "Partner", is_earlyon: false, google_drive_folder_id: "root" },
  ], activities: [], uploaders: [] })));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => {
    server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previousSecret;
    await rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/drive`;
  for (const [path, method] of [["placements/1/auto-import", "POST"], ["placements/1/sync-status", "GET"],
    ["auto-import-jobs/missing", "GET"], ["auto-import-jobs/missing/results", "GET"], ["auto-import-jobs/missing/cancel", "POST"]]) {
    assert.equal((await fetch(`${base}/${path}`, { method })).status, 401);
  }
  const body = Buffer.from(JSON.stringify({ sub: "test", email: "test@example.test", exp: Date.now() + 60_000 })).toString("base64url");
  const signature = createHmac("sha256", "test-only-secret").update(body).digest("base64url");
  const headers = { Cookie: `artasia_auth=${body}.${signature}` };
  const status = await fetch(`${base}/placements/1/sync-status`, { headers });
  assert.equal(status.status, 200); assert.equal(status.headers.get("cache-control"), "no-store");
  assert.equal((await status.json() as { lastSuccessful: unknown }).lastSuccessful, null);
  assert.equal((await fetch(`${base}/placements/999/sync-status`, { headers })).status, 404);
  assert.equal((await fetch(`${base}/auto-import-jobs/missing/results?cursor=-1`, { headers })).status, 400);
  assert.equal((await fetch(`${base}/auto-import-jobs/missing`, { headers })).status, 404);
  assert.equal((await fetch(`${base}/placements/1/auto-import`, { method: "POST", headers })).status, 400, "missing Drive credentials must fail before starting a job");

  const jobId = "11111111-1111-4111-8111-111111111111";
  await store.save({ version: 1, jobId, placementId: 1, placementName: "Test", rootFolderId: "root", configurationHash: "test", initiatedBy: "test",
    startedAt: new Date().toISOString(), status: "completed", phase: "done", cancelRequested: false, eligible: 101, foldersScanned: 1, matchedFolders: 1,
    results: Array.from({ length: 101 }, (_, i) => ({ kind: "file", fileId: `file${i}`, name: "file", path: "Week 1/file", status: "imported", createdAssetId: "private-checkpoint" })) });
  const results = await fetch(`${base}/auto-import-jobs/${jobId}/results`, { headers }).then((response) => response.json()) as { results: unknown[]; nextCursor: number };
  assert.equal(results.results.length, 100); assert.equal(results.nextCursor, 100);
  assert.equal(JSON.stringify(results).includes("private-checkpoint"), false);
});
