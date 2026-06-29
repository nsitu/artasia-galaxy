import { mkdirSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import { Router } from "express";
import multer from "multer";
import {
  addAssetsToAlbum,
  ensureAlbum,
  getAsset,
  getServerStatistics,
  tagAsset,
  updateAssetLocation,
  uploadAsset,
} from "../infra/ImmichClient.js";
import { uploadRateLimit } from "../middleware/uploadRateLimit.js";
import {
  findConfiguredPlacement,
  findConfiguredUploader,
  getPlacementTagNames,
  getAllowedTagNames,
  getUploadConfig,
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

function hasGps(asset: Awaited<ReturnType<typeof getAsset>>) {
  return asset.exifInfo?.latitude != null && asset.exifInfo?.longitude != null;
}

async function applyDefaultLocationIfMissing(assetId: string, location: {
  lat?: number;
  lng?: number;
}) {
  if (location.lat == null || location.lng == null || (location.lat === 0 && location.lng === 0)) return;
  const asset = await getAsset(assetId);
  if (hasGps(asset)) return;
  await updateAssetLocation(assetId, {
    latitude: location.lat,
    longitude: location.lng,
  });
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

router.get("/options", async (_req, res) => {
  try {
    const config = await getUploadConfig();
    res.json({
      ...config,
      limits: {
        maxFiles: UPLOAD_LIMITS.maxFiles,
        maxFileBytes: UPLOAD_LIMITS.maxFileBytes,
        maxBatchBytes: UPLOAD_LIMITS.maxBatchBytes,
      },
    });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

router.post(
  "/",
  uploadRateLimit,
  upload.array("files", UPLOAD_LIMITS.maxFiles),
  async (req, res) => {
    const files = (req.files ?? []) as Express.Multer.File[];

    try {
      const uploader = typeof req.body.uploader === "string" ? req.body.uploader.trim() : "";
      const uploader_id = parseInt(typeof req.body.uploader_id === "string" ? req.body.uploader_id.trim() : "", 10);
      const placement_id = parseInt(typeof req.body.placement_id === "string" ? req.body.placement_id.trim() : "", 10);
      const [location, selectedUploader] = await Promise.all([
        findConfiguredPlacement(placement_id),
        findConfiguredUploader({
          id: Number.isFinite(uploader_id) ? uploader_id : undefined,
          name: uploader,
        }),
      ]);
      const selectedTags = await getAllowedTagNames(parseTags(req.body.tags));

      if (!selectedUploader) {
        res.status(400).json({ error: "Select a valid uploader." });
        return;
      }

      if (!location) {
        res.status(400).json({ error: "Select a valid placement." });
        return;
      }

      if (location.team_member?.id !== selectedUploader.id) {
        res.status(400).json({ error: "Select a placement assigned to the selected uploader." });
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

      const album = await ensureAlbum(selectedUploader.name);
      const tagNames = [...selectedTags, ...getPlacementTagNames(location)];

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

          await applyDefaultLocationIfMissing(uploaded.id, {
            lat: location.place?.lat,
            lng: location.place?.lng,
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
        uploader: selectedUploader.name,
        uploader_id: selectedUploader.id,
        placement_id,
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
