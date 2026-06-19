import type { Request, Response, NextFunction } from "express";
import { UPLOAD_LIMITS } from "../services/uploadLimits.js";

const buckets = new Map<string, { count: number; resetAt: number }>();

function clientKey(req: Request) {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function uploadRateLimit(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  const key = clientKey(req);
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, {
      count: 1,
      resetAt: now + UPLOAD_LIMITS.rateLimitWindowMs,
    });
    next();
    return;
  }

  bucket.count += 1;
  if (bucket.count > UPLOAD_LIMITS.rateLimitMaxBatches) {
    res.status(429).json({
      error: "Too many upload attempts. Please wait and try again.",
    });
    return;
  }

  next();
}
