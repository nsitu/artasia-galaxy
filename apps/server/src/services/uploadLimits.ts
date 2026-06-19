export const UPLOAD_LIMITS = {
  maxFiles: parseInt(process.env.UPLOAD_MAX_FILES ?? "20", 10),
  maxFileBytes: parseInt(process.env.UPLOAD_MAX_FILE_BYTES ?? `${250 * 1024 * 1024}`, 10),
  maxBatchBytes: parseInt(process.env.UPLOAD_MAX_BATCH_BYTES ?? `${1024 * 1024 * 1024}`, 10),
  maxImmichUsageBytes: parseInt(
    process.env.UPLOAD_DISABLE_AT_IMMICH_BYTES ?? `${50 * 1024 * 1024 * 1024}`,
    10
  ),
  rateLimitWindowMs: parseInt(process.env.UPLOAD_RATE_LIMIT_WINDOW_MS ?? `${60 * 1000}`, 10),
  rateLimitMaxBatches: parseInt(process.env.UPLOAD_RATE_LIMIT_MAX_BATCHES ?? "10", 10),
};

export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".heic",
  ".heif",
  ".mp4",
  ".mov",
  ".webm",
]);
