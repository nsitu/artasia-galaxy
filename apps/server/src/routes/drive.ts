import { Router, type Request, type Response } from "express";
import { readAuthSession } from "../services/auth.service.js";
import {
  createDriveClient,
  GoogleDriveClient,
} from "../services/googleDrive.service.js";
import {
  uploadAssetStream,
  tagAsset,
} from "../infra/ImmichClient.js";
import { getUploadConfig } from "../services/uploadConfig.service.js";

const router = Router();

/**
 * Middleware to extract and validate Drive client from auth session
 */
function getDriveClient(req: Request): GoogleDriveClient {
  const session = readAuthSession(req);
  if (!session) {
    throw new Error("Not authenticated");
  }
  if (!session.refreshToken) {
    throw new Error(
      "Google Drive access not configured. Please sign in again."
    );
  }

  const client = createDriveClient(session.refreshToken);
  if (!client) {
    throw new Error("Failed to initialize Drive client");
  }

  return client;
}

/**
 * GET /api/v1/drive/folders
 * List top-level folders in user's Google Drive
 */
router.get("/folders", async (req: Request, res: Response) => {
  try {
    const client = getDriveClient(req);
    const folders = await client.getFolders();
    res.json(folders);
  } catch (err) {
    res
      .status(err instanceof Error && err.message.includes("Not authenticated") ? 401 : 500)
      .json({ error: (err as Error).message });
  }
});

interface DriveFileInfo {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  modifiedTime?: string;
  isFolder: boolean;
  isImage: boolean;
  isVideo: boolean;
}

interface DriveListResponse {
  files: DriveFileInfo[];
  nextPageToken?: string;
}

/**
 * GET /api/v1/drive/files?folderId=...&pageToken=...
 * List files/folders in a specific folder
 */
router.get("/files", async (req: Request, res: Response) => {
  try {
    const client = getDriveClient(req);
    const folderId =
      typeof req.query.folderId === "string"
        ? req.query.folderId
        : "root";
    const pageToken =
      typeof req.query.pageToken === "string"
        ? req.query.pageToken
        : undefined;

    const { files, nextPageToken } = await client.listFiles(
      folderId,
      pageToken
    );

    const result: DriveListResponse = {
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size ? String(file.size) : undefined,
        modifiedTime: file.modifiedTime,
        isFolder: GoogleDriveClient.isFolder(file.mimeType),
        isImage: GoogleDriveClient.isImage(file.mimeType),
        isVideo: GoogleDriveClient.isVideo(file.mimeType),
      })),
      nextPageToken,
    };

    res.json(result);
  } catch (err) {
    res
      .status(err instanceof Error && err.message.includes("Not authenticated") ? 401 : 500)
      .json({ error: (err as Error).message });
  }
});

interface DriveSyncRequest {
  fileIds: string[];
  placementId?: number | null;
  activityId?: number | null;
}

interface DriveSyncResult {
  fileId: string;
  fileName: string;
  status: "success" | "failed";
  assetId?: string;
  error?: string;
}

/**
 * POST /api/v1/drive/sync
 * Download and import selected files from Google Drive
 * Body: { fileIds: string[], placementId?: number, activityId?: number }
 */
router.post("/sync", async (req: Request, res: Response) => {
  try {
    const session = readAuthSession(req);
    if (!session) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }

    const client = getDriveClient(req);
    const config = await getUploadConfig();

    const { fileIds, placementId, activityId } = req.body as DriveSyncRequest;

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      res.status(400).json({ error: "No files specified" });
      return;
    }

    if (fileIds.length > 20) {
      res.status(400).json({ error: "Maximum 20 files per sync" });
      return;
    }

    // Validate placement and activity if specified
    let placementTags: string[] = [];
    let activityTags: string[] = [];

    if (placementId !== null && placementId !== undefined) {
      const placementConfig = config.placements.find(
        (p) => p.placement_id === placementId
      );
      if (!placementConfig) {
        res.status(400).json({ error: "Invalid placement ID" });
        return;
      }
      placementTags = [
        `placement:${placementId}`,
        placementConfig.placement_name,
      ];
    }

    if (activityId !== null && activityId !== undefined) {
      const activity = config.activities.find((a) => a.id === activityId);
      if (!activity) {
        res.status(400).json({ error: "Invalid activity ID" });
        return;
      }
      activityTags = [`activity:${activityId}`, activity.label];
    }

    const results: DriveSyncResult[] = [];

    for (const fileId of fileIds) {
      try {
        // Get file info
        const fileInfo = await client.getFileInfo(fileId);

        if (!fileInfo.isSupported) {
          results.push({
            fileId,
            fileName: fileInfo.name,
            status: "failed",
            error: `Unsupported file type: ${fileInfo.mimeType}`,
          });
          continue;
        }

        // Check file size limits
        if (fileInfo.size && fileInfo.size > 10 * 1024 * 1024 * 1024) {
          results.push({
            fileId,
            fileName: fileInfo.name,
            status: "failed",
            error: "File exceeds 10GB limit",
          });
          continue;
        }

        // Download file
        const stream = await client.downloadFile(fileId);

        // Create unique device asset ID using Drive file ID
        const deviceAssetId = `artasia-galaxy:drive:${fileId}`;

        // Upload to Immich
        const uploadResult = await uploadAssetStream({
          stream,
          filename: fileInfo.name,
          mimeType: fileInfo.mimeType,
          deviceAssetId,
        });

        if (!uploadResult.id) {
          results.push({
            fileId,
            fileName: fileInfo.name,
            status: "failed",
            error: "Failed to upload to Immich",
          });
          continue;
        }

        // Apply tags
        const allTags = [...placementTags, ...activityTags];
        if (allTags.length > 0) {
          await tagAsset(uploadResult.id, allTags);
        }

        results.push({
          fileId,
          fileName: fileInfo.name,
          status: "success",
          assetId: uploadResult.id,
        });
      } catch (err) {
        results.push({
          fileId,
          fileName: "Unknown",
          status: "failed",
          error: (err as Error).message,
        });
      }
    }

    res.json({ results });
  } catch (err) {
    res
      .status(err instanceof Error && err.message.includes("Not authenticated") ? 401 : 500)
      .json({ error: (err as Error).message });
  }
});

export default router;
