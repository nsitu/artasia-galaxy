import { Router } from "express";
import type { Response } from "express";
import { getSettings, updateSettings, clearSettings } from "../services/settings.service.js";

const router = Router();

const clients = new Set<Response>();

router.get("/", (_req, res) => {
  res.json(getSettings());
});

router.patch("/:domain", (req, res) => {
  const domain = (req.params as Record<string, string>).domain;
  if (domain !== "playback" && domain !== "display") {
    res.status(400).json({ error: `Unknown domain: ${domain}` });
    return;
  }
  const merged = updateSettings(domain, req.body ?? {});
  broadcast(domain, merged);
  res.json(merged);
});

router.delete("/", (req, res) => {
  clearSettings();
  res.json(getSettings());
});

router.delete("/:domain", (req, res) => {
  clearSettings((req.params as Record<string, string>).domain);
  res.json(getSettings());
});

function broadcast(domain: string, data: unknown) {
  const event = `data: ${JSON.stringify({ domain, settings: data })}\n\n`;
  for (const client of clients) {
    client.write(event);
  }
}

export function mountSSE(
  app: { get: (path: string, handler: (req: import("express").Request, res: Response) => void) => void }
) {
  app.get("/api/v1/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    clients.add(res);
    req.on("close", () => clients.delete(res));
  });
}

export default router;
