import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import assetRoutes from "./routes/assets.js";
import slideshowRoutes from "./routes/slideshow.js";
import albumRoutes from "./routes/albums.js";
import settingsRoutes, { mountSSE } from "./routes/settings.js";
import { checkImmichHealth, getImmichConfig } from "./infra/ImmichClient.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json());

app.use("/api/v1/assets", assetRoutes);
app.use("/api/v1/slideshow", slideshowRoutes);
app.use("/api/v1/albums", albumRoutes);
app.use("/api/v1/settings", settingsRoutes);
mountSSE(app);

app.get("/api/v1/meta", (_req, res) => {
  res.json({ apiVersion: "1.0.0", contractVersion: "1.0.0" });
});

app.get("/api/v1/health", async (_req, res) => {
  const config = getImmichConfig();
  try {
    const ok = await checkImmichHealth();
    res.json({ status: "ok", immich: { url: config.url, reachable: ok } });
  } catch (err) {
    res.status(502).json({
      status: "unreachable",
      immich: { url: config.url },
      error: (err as Error).message,
    });
  }
});

const publicDir = path.resolve(__dirname, "../../public");
if (existsSync(publicDir)) {
  app.use(express.static(publicDir));

  app.get("*", (req, res) => {
    if (req.path.startsWith("/api")) return;
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Artasia server running on http://localhost:${PORT}`);
  console.log(`Immich upstream: ${process.env.IMMICH_URL ?? "not set"}`);
});
