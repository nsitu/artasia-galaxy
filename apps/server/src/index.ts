import express, { type NextFunction, type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import assetRoutes from "./routes/assets.js";
import slideshowRoutes from "./routes/slideshow.js";
import albumRoutes from "./routes/albums.js";
import authRoutes from "./routes/auth.js";
import uploadRoutes from "./routes/uploads.js";
import placementRoutes from "./routes/placements.js";
import reconcileRoutes from "./routes/reconcile.js";
import settingsRoutes, { mountSSE } from "./routes/settings.js";
import driveRoutes from "./routes/drive.js";
import { checkImmichHealth, getImmichConfig } from "./infra/ImmichClient.js";
import { readAuthSession } from "./services/auth.service.js";
import { initializeImmichStructure, logReconcileDriftAtBoot } from "./services/startup.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.set("trust proxy", "loopback");
app.use(express.json());

app.use("/api/v1/assets", assetRoutes);
app.use("/api/v1/slideshow", slideshowRoutes);
app.use("/api/v1/albums", albumRoutes);
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/uploads", uploadRoutes);
app.use("/api/v1/placements", placementRoutes);
app.use("/api/v1/reconcile", reconcileRoutes);
app.use("/api/v1/settings", settingsRoutes);
app.use("/api/v1/drive", driveRoutes);
mountSSE(app);

app.use((err: unknown, _req: Request, res: Response, next: NextFunction) => {
  if (!err) {
    next();
    return;
  }

  const message = err instanceof Error ? err.message : "Request failed";
  res.status(400).json({ error: message });
});

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

  app.get(/^\/admin(?:\/.*)?$/, (req, res) => {
    if (!readAuthSession(req)) {
      res.redirect("/api/v1/auth/google/start");
      return;
    }

    res.sendFile(path.join(publicDir, "index.html"));
  });

  app.get(/.*/, (req, res) => {
    if (req.path.startsWith("/api")) return;
    res.sendFile(path.join(publicDir, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Artasia server running on http://localhost:${PORT}`);
  console.log(`Immich upstream: ${process.env.IMMICH_URL ?? "not set"}`);
});

initializeImmichStructure().catch((err) => {
  console.warn(`[startup] Immich structure initialization failed: ${(err as Error).message}`);
});

logReconcileDriftAtBoot().catch((err) => {
  console.warn(`[startup] reconcile drift check failed: ${(err as Error).message}`);
});
