import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { createDriveProcessBackfillRouter } from "./driveProcessBackfill.js";
import { DriveProcessBackfillManager } from "../services/driveProcessBackfill.service.js";
import { acquireDriveWriter } from "../services/driveSource.service.js";
import type { GoogleDriveClient } from "../services/googleDrive.service.js";
import type { ImmichAsset } from "../infra/ImmichClient.js";

test("Process backfill APIs require auth/Drive access, serialize writers, paginate results and disable caching", async (t) => {
  const previousSecret = process.env.SESSION_SECRET; process.env.SESSION_SECRET = "test-secret";
  const manager = new DriveProcessBackfillManager({
    inventory: async () => Array.from({ length: 101 }, (_, i) => ({ id: `asset-${i}`, originalFileName: "file.jpg",
      tags: [{ id: "source", name: `source:drive:file-${i}`, value: `source:drive:file-${i}` }] }) as ImmichAsset),
    getAsset: async () => { throw new Error("No writes expected"); }, tagAsset: async () => assert.fail("No writes expected"), pause: async () => {},
  });
  let driveConfigured = false;
  const client = { getFile: async (id: string) => ({ id, name: "file.jpg", mimeType: "image/jpeg", parents: ["folder"] }),
    getFolder: async () => ({ id: "folder", name: "Artwork", mimeType: "application/vnd.google-apps.folder" }) } as unknown as GoogleDriveClient;
  const app = express(); app.use("/api/v1/tools/drive-process-backfill", createDriveProcessBackfillRouter(manager, () => driveConfigured ? client : null));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(async () => {
    await manager.waitForIdle(); server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
    if (previousSecret === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = previousSecret;
  });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/tools/drive-process-backfill`;
  for (const [path, method] of [["", "GET"], ["", "POST"], ["/missing/results", "GET"], ["/missing/cancel", "POST"]]) {
    const response = await fetch(`${base}${path}`, { method });
    assert.equal(response.status, 401); assert.equal(response.headers.get("cache-control"), "no-store");
  }
  const payload = Buffer.from(JSON.stringify({ sub: "test", email: "test@example.test", refreshToken: "not-exposed", exp: Date.now() + 60_000 })).toString("base64url");
  const signature = createHmac("sha256", "test-secret").update(payload).digest("base64url");
  const headers = { Cookie: `artasia_auth=${payload}.${signature}` };
  assert.equal((await fetch(base, { headers }).then((r) => r.json()) as { latest: unknown }).latest, null);
  assert.equal((await fetch(base, { headers, method: "POST" })).status, 400);
  driveConfigured = true;
  const release = acquireDriveWriter("manual"); assert.ok(release);
  try { assert.equal((await fetch(base, { headers, method: "POST" })).status, 409); } finally { release(); }
  const start = await fetch(base, { headers, method: "POST" }); assert.equal(start.status, 202);
  const { jobId } = await start.json() as { jobId: string }; await manager.waitForIdle();
  const statusResponse = await fetch(base, { headers }); assert.equal(statusResponse.headers.get("cache-control"), "no-store");
  const status = await statusResponse.text(); assert.ok(!status.includes("not-exposed")); assert.ok(!status.includes('"results"'));
  assert.equal(JSON.parse(status).latest.counts.notProcess, 101);
  assert.equal((await fetch(`${base}/${jobId}/results?cursor=-1`, { headers })).status, 400);
  assert.equal((await fetch(`${base}/${jobId}/results?cursor=abc`, { headers })).status, 400);
  assert.equal((await fetch(`${base}/missing/results`, { headers })).status, 404);
  assert.equal((await fetch(`${base}/missing/cancel`, { headers, method: "POST" })).status, 404);
  const page = await fetch(`${base}/${jobId}/results`, { headers }).then((r) => r.json()) as { results: unknown[]; nextCursor: number };
  assert.equal(page.results.length, 100); assert.equal(page.nextCursor, 100);
  const last = await fetch(`${base}/${jobId}/results?cursor=100`, { headers }).then((r) => r.json()) as { results: unknown[]; nextCursor: null };
  assert.equal(last.results.length, 1); assert.equal(last.nextCursor, null);
  assert.equal((await fetch(`${base}/${jobId}/cancel`, { headers, method: "POST" })).status, 200);
});
