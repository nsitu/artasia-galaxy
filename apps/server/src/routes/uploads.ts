import { mkdirSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { Router } from "express";
import multer from "multer";
import {
  addAssetsToAlbum,
  ensureAlbum,
  getServerStatistics,
  tagAsset,
  uploadAsset,
} from "../infra/ImmichClient.js";
import { uploadRateLimit } from "../middleware/uploadRateLimit.js";
import {
  findConfiguredLocation,
  getAllowedTagNames,
  getUploadConfig,
  isConfiguredUploader,
} from "../services/uploadConfig.service.js";
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  ALLOWED_UPLOAD_MIME_TYPES,
  UPLOAD_LIMITS,
} from "../services/uploadLimits.js";

const router = Router();
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const UPLOAD_TMP_DIR = join(DATA_DIR, "upload-tmp");

mkdirSync(UPLOAD_TMP_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_TMP_DIR,
  limits: {
    files: UPLOAD_LIMITS.maxFiles,
    fileSize: UPLOAD_LIMITS.maxFileBytes,
  },
});

interface UploadFileResult {
  fileName: string;
  status: "completed" | "failed";
  assetId?: string;
  error?: string;
}

function parseTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
}

function cleanup(file: Express.Multer.File) {
  try {
    unlinkSync(file.path);
  } catch {
    // temp cleanup best effort
  }
}

function validateFile(file: Express.Multer.File) {
  const extension = extname(file.originalname).toLowerCase();
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.mimetype)) {
    return `Unsupported file type: ${file.mimetype}`;
  }
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(extension)) {
    return `Unsupported file extension: ${extension || "(none)"}`;
  }
  return null;
}

async function processWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, run);
  await Promise.all(workers);
  return results;
}

router.get("/options", (_req, res) => {
  const config = getUploadConfig();
  res.json({
    ...config,
    limits: {
      maxFiles: UPLOAD_LIMITS.maxFiles,
      maxFileBytes: UPLOAD_LIMITS.maxFileBytes,
      maxBatchBytes: UPLOAD_LIMITS.maxBatchBytes,
    },
  });
});

router.post(
  "/",
  uploadRateLimit,
  upload.array("files", UPLOAD_LIMITS.maxFiles),
  async (req, res) => {
    const files = (req.files ?? []) as Express.Multer.File[];

    try {
      const uploader = typeof req.body.uploader === "string" ? req.body.uploader.trim() : "";
      const partner = typeof req.body.partner === "string" ? req.body.partner.trim() : "";
      const site = typeof req.body.site === "string" ? req.body.site.trim() : "";
      const location = findConfiguredLocation(partner, site);
      const selectedTags = getAllowedTagNames(parseTags(req.body.tags));

      if (!uploader || !isConfiguredUploader(uploader)) {
        res.status(400).json({ error: "Select a valid uploader." });
        return;
      }

      if (!location) {
        res.status(400).json({ error: "Select a valid Artasia location." });
        return;
      }

      if (files.length === 0) {
        res.status(400).json({ error: "Add at least one file." });
        return;
      }

      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > UPLOAD_LIMITS.maxBatchBytes) {
        res.status(413).json({ error: "Upload batch is too large." });
        return;
      }

      const stats = await getServerStatistics();
      if (stats.usage > UPLOAD_LIMITS.maxImmichUsageBytes) {
        res.status(503).json({
          error: "Uploads are temporarily disabled because Immich storage is above the configured limit.",
        });
        return;
      }

      const album = await ensureAlbum(uploader);
      const tagNames = [...selectedTags, location.partner, location.site];

      const results = await processWithConcurrency(files, 2, async (file) => {
        const validationError = validateFile(file);
        if (validationError) {
          cleanup(file);
          return {
            fileName: file.originalname,
            status: "failed",
            error: validationError,
          } satisfies UploadFileResult;
        }

        try {
          const uploaded = await uploadAsset({
            filePath: file.path,
            filename: file.originalname,
            mimeType: file.mimetype,
          });

          await tagAsset(uploaded.id, tagNames);
          await addAssetsToAlbum(album.id, [uploaded.id]);

          return {
            fileName: file.originalname,
            status: "completed",
            assetId: uploaded.id,
          } satisfies UploadFileResult;
        } catch (err) {
          return {
            fileName: file.originalname,
            status: "failed",
            error: (err as Error).message,
          } satisfies UploadFileResult;
        } finally {
          cleanup(file);
        }
      });

      res.json({
        uploader,
        location,
        tags: tagNames,
        results,
      });
    } catch (err) {
      res.status(502).json({ error: (err as Error).message });
    } finally {
      for (const file of files) cleanup(file);
    }
  }
);

export default router;
