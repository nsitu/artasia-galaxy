// Isolated browser regression fixture: real Atlas UI, synthetic API responses only.
// Run from the repository root: node apps/web/tests/import-navigation.fixture.mjs
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

const folder = (id, name) => ({ id, name, mimeType: "application/vnd.google-apps.folder" });
const roots = [folder("alpha", "Alpha Drive folder"), folder("beta", "Beta Drive folder")];
const placements = [
  { placement_id: 101, placement_name: "Alpha site", google_drive_folder_id: "alpha" },
  { placement_id: 202, placement_name: "Beta site", google_drive_folder_id: "beta" },
  { placement_id: 303, placement_name: "No folder site" },
  { placement_id: 404, placement_name: "Unavailable folder site", google_drive_folder_id: "unavailable" },
].map((site) => ({ ...site, partner_name: "Navigation fixtures", is_earlyon: false }));

const server = await createServer({
  configFile: false,
  root: fileURLToPath(new URL("../", import.meta.url)),
  envFile: false,
  plugins: [react(), {
    name: "import-navigation-fixture",
    configureServer(vite) {
      vite.middlewares.use((req, res, next) => {
        const url = new URL(req.url, "http://localhost");
        if (!url.pathname.startsWith("/api/")) return next();
        const send = (body, delay = 0, status = 200) => setTimeout(() => {
          res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
          res.end(JSON.stringify(body));
        }, delay);
        if (url.pathname === "/api/v1/uploads/options") return send({
          placements, activities: [{ id: 10, week: 1, label: "Collage" }], uploaders: [],
          currentUser: { authenticated: true, name: "Navigation tester", email: "test@example.test" },
        });
        if (url.pathname === "/api/v1/auth/me") return send({ authenticated: true });
        if (url.pathname === "/api/v1/uploads/site-activity-stats") return send({ sites: {} });
        if (/\/uploads\/(assets|placements\/\d+\/assets)$/.test(url.pathname)) return send({ assets: [] });
        if (url.pathname.endsWith("/sync-status")) return send({ latest: null, lastSuccessful: null, configurationChanged: false });
        if (url.pathname === "/api/v1/drive/folders/stats") return send({ stats: [] });
        if (url.pathname.startsWith("/api/v1/drive/folders/")) {
          const id = url.pathname.split("/").at(-1);
          const root = roots.find((item) => item.id === id);
          if (!root) return send({ error: "Fixture folder unavailable" }, 300, 404);
          return send({ folder: root, path: [folder("root", "My Drive"), root] }, id === "beta" ? 1800 : 80);
        }
        if (url.pathname === "/api/v1/drive/folders") {
          const parent = url.searchParams.get("parentId") ?? "root";
          const children = parent === "root" && url.searchParams.get("driveType") === "myDrive"
            ? roots : parent === "alpha" || parent === "beta" ? [folder(`${parent}-week`, "Week 1")] : [];
          return send({ folders: children, subfolders: children }, parent === "alpha" ? 900 : 40);
        }
        if (url.pathname === "/api/v1/drive/files") {
          const id = url.searchParams.get("folderId");
          return send({ files: id === "root" ? [] : [{ id: `${id}-media`, name: `${id} media.jpg`, mimeType: "image/jpeg" }] }, id === "alpha" ? 1200 : 40);
        }
        // Never forward imports, real authentication, or any other API to a live server.
        return send({ error: `Unsupported fixture endpoint: ${url.pathname}` }, 0, 404);
      });
    },
  }],
  define: { __ARTASIA_BUILD_LABEL__: JSON.stringify("Navigation regression fixture") },
  server: { host: "127.0.0.1", port: 5187, strictPort: true },
});
await server.listen();
console.log("Import navigation fixture: http://127.0.0.1:5187/admin");
