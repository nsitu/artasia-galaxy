// Real Tools UI, synthetic API only. No calls reach Atlas, Drive, or Immich.
// Run: node apps/web/tests/process-backfill.fixture.mjs
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

let latest = null;
let runs = 0;
let startedAt = 0;
const results = Array.from({ length: 103 }, (_, i) => ({ assetId: `asset-${i}`, fileName: `Legacy photo ${i}.jpg`, fileId: i < 2 ? undefined : `drive-${i}`,
  folderName: i === 3 ? "Finished artwork" : i % 2 === 0 ? "FiNaL photos" : "Work in PrOcEsS", status: i < 2 ? "needs_review" : i === 2 ? "failed" : i === 3 ? "not_process" : "tagged",
  detail: i < 2 ? "Multiple Drive IDs; no tags were changed." : i === 2 ? "Drive lookup failed: permission denied." : undefined }));
function status() {
  if (latest?.status === "running" && !latest.cancelRequested) {
    const elapsed = Date.now() - startedAt;
    latest.phase = elapsed < 1500 ? "indexing" : "checking";
    latest.counts.scanned = 123;
    if (elapsed >= 1500) {
      latest.current = "Legacy photo 4.jpg";
      latest.counts = { scanned: 123, checked: 4, tagged: 1, alreadyProcess: 1, noSource: 1, notProcess: 1, needsReview: 0, failed: 0 };
      latest.resultCount = 2;
    }
    if (runs === 1 && elapsed > 12_000) {
      latest.status = "completed_with_issues"; latest.phase = "done"; latest.current = undefined; latest.finishedAt = new Date().toISOString(); latest.resultCount = 103;
      latest.counts = { scanned: 123, checked: 123, tagged: 99, alreadyProcess: 10, noSource: 10, notProcess: 1, needsReview: 2, failed: 1 };
    }
  }
  return latest;
}
const server = await createServer({
  configFile: false, root: fileURLToPath(new URL("../", import.meta.url)), envFile: false,
  plugins: [react(), { name: "process-backfill-fixture", configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      const url = new URL(req.url, "http://localhost");
      if (!url.pathname.startsWith("/api/")) return next();
      const send = (body, code = 200) => { res.writeHead(code, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(body)); };
      if (url.pathname === "/api/v1/auth/me") return send({ authenticated: true, name: "Tools tester" });
      if (url.pathname === "/api/v1/uploads/options") return send({ placements: [], activities: [], uploaders: [], currentUser: { authenticated: true } });
      const base = "/api/v1/tools/drive-process-backfill";
      if (url.pathname === base && req.method === "GET") return send({ latest: status() });
      if (url.pathname === base && req.method === "POST") {
        runs++; startedAt = Date.now(); latest = { jobId: `fixture-${runs}`, initiatedBy: "test@example.test", startedAt: new Date().toISOString(), status: "running", phase: "indexing", cancelRequested: false,
          counts: { scanned: 0, checked: 0, tagged: 0, alreadyProcess: 0, noSource: 0, notProcess: 0, needsReview: 0, failed: 0 }, resultCount: 0 };
        return send(latest, 202);
      }
      if (url.pathname.startsWith(`${base}/`) && url.pathname.endsWith("/cancel")) {
        latest.status = "cancelled"; latest.phase = "done"; latest.cancelRequested = true; latest.current = undefined; latest.finishedAt = new Date().toISOString();
        return send(latest);
      }
      if (url.pathname.startsWith(`${base}/`) && url.pathname.endsWith("/results")) {
        const cursor = Number(url.searchParams.get("cursor") ?? 0);
        return send({ results: results.slice(cursor, Math.min(cursor + 100, latest.resultCount)), nextCursor: cursor + 100 < latest.resultCount ? cursor + 100 : null });
      }
      return send({ error: `Unsupported fixture endpoint: ${url.pathname}` }, 404);
    });
  } }],
  define: { __ARTASIA_BUILD_LABEL__: JSON.stringify("Process backfill regression fixture") },
  server: { host: "127.0.0.1", port: 5188, strictPort: true },
});
await server.listen();
console.log("Process backfill fixture: http://127.0.0.1:5188/admin/tools");
