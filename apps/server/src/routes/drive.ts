import { Router, type Request, type Response } from "express";
import { readAuthSession } from "../services/auth.service.js";
import {
  createDriveClient,
  ensureDriveFileExtension,
  GoogleDriveClient,
} from "../services/googleDrive.service.js";
import {
  addAssetsToAlbum,
  ensureAlbum,
  uploadAsset,
  uploadAssetStream,
  tagAsset,
} from "../infra/ImmichClient.js";
import { getUploadConfig } from "../services/uploadConfig.service.js";
import { prepareAudioAsVideo } from "../services/audioToVideo.service.js";
import { UPLOAD_LIMITS } from "../services/uploadLimits.js";

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
 * GET /api/v1/drive/folders?driveType=myDrive&parentId=root&driveId=...
 * List folders with support for hierarchy and Shared Drives
 * Query params:
 *   - driveType: "myDrive" (default) or "sharedDrives"
 *   - parentId: folder ID to list children from (default "root")
 *   - driveId: Shared Drive ID (when navigating within a Shared Drive)
 */
router.get("/folders", async (req: Request, res: Response) => {
  try {
    const client = getDriveClient(req);
    const driveType = typeof req.query.driveType === "string" ? req.query.driveType : "myDrive";
    const parentId = typeof req.query.parentId === "string" ? req.query.parentId : "root";
    const driveId = typeof req.query.driveId === "string" ? req.query.driveId : undefined;

    let folders;

    if (driveType === "sharedDrives" && !driveId) {
      // Get all Shared Drives (first level)
      folders = await client.getSharedDrives();
      res.json({ folders });
      return;
    }

    if (driveType === "sharedDrives" && driveId) {
      // Get subfolders within a Shared Drive
      folders = await client.getFoldersInFolder(parentId, driveId);
      res.json({ folders, driveId });
      return;
    }

    // My Drive navigation
    if (parentId === "root") {
      // Return "My Drive" as the root with its immediate children as subfolders
      const myDrive = await client.getMyDriveInfo();
      const subfolders = await client.getFoldersInFolder("root");
      res.json({ myDrive, subfolders });
      return;
    } else {
      // Get subfolders of a specific folder in My Drive
      folders = await client.getFoldersInFolder(parentId);
      res.json({ folders });
      return;
    }
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
  thumbnailLink?: string;
  isFolder: boolean;
  isImage: boolean;
  isVideo: boolean;
  isAudio: boolean;
}

interface DriveListResponse {
  files: DriveFileInfo[];
  nextPageToken?: string;
}

/**
 * GET /api/v1/drive/files?folderId=...&pageToken=...&driveId=...
 * List files/folders in a specific folder
 * Query params:
 *   - folderId: folder ID (default "root")
 *   - pageToken: for pagination
 *   - driveId: Shared Drive ID (when querying within a Shared Drive)
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
    const driveId =
      typeof req.query.driveId === "string"
        ? req.query.driveId
        : undefined;

    const { files, nextPageToken } = await client.listFiles(
      folderId,
      pageToken,
      driveId
    );

    const result: DriveListResponse = {
      files: files.map((file) => ({
        id: file.id,
        name: file.name,
        mimeType: file.mimeType,
        size: file.size ? String(file.size) : undefined,
        modifiedTime: file.modifiedTime,
        thumbnailLink: file.thumbnailLink,
        isFolder: GoogleDriveClient.isFolder(file.mimeType),
        isImage: GoogleDriveClient.isImage(file.mimeType),
        isVideo: GoogleDriveClient.isVideo(file.mimeType),
        isAudio: GoogleDriveClient.isAudio(file.mimeType),
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
  uploaderId?: number | null;
}

interface DriveSyncResult {
  fileId: string;
  fileName: string;
  status: "success" | "failed";
  assetId?: string;
  uploaderId?: number;
  uploaderName?: string;
  error?: string;
}

/**
 * POST /api/v1/drive/sync
 * Download and import selected files from Google Drive
 * Body: { fileIds: string[], placementId?: number, activityId?: number, uploaderId?: number }
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

    const { fileIds, placementId, activityId, uploaderId } = req.body as DriveSyncRequest;

    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      res.status(400).json({ error: "No files specified" });
      return;
    }

    if (fileIds.length > 20) {
      res.status(400).json({ error: "Maximum 20 files per import" });
      return;
    }

    // Validate placement and activity if specified
    let placementTags: string[] = [];
    let activityTags: string[] = [];
    let owner: { id: number; name: string } | null = null;
    let placementConfig: (typeof config.placements)[number] | undefined;

    const requestedUploaderId = Number(uploaderId);
    const hasRequestedOwner = uploaderId !== null && uploaderId !== undefined;
    if (hasRequestedOwner && !Number.isInteger(requestedUploaderId)) {
      res.status(400).json({ error: "Invalid asset owner ID" });
      return;
    }

    if (placementId !== null && placementId !== undefined) {
      placementConfig = config.placements.find(
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

    if (hasRequestedOwner) {
      owner = config.uploaders.find((uploader) => uploader.id === requestedUploaderId) ?? null;
      if (!owner) {
        res.status(400).json({ error: "Invalid asset owner" });
        return;
      }
      if (
        placementConfig &&
        owner.id !== placementConfig.team_member_id &&
        owner.id !== placementConfig.secondary_team_member_id
      ) {
        res.status(400).json({ error: "Select a team member assigned to this placement" });
        return;
      }
    } else if (placementConfig?.team_member_id) {
      owner = config.uploaders.find(
        (uploader) => uploader.id === placementConfig.team_member_id,
      ) ?? null;
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
      let fileName = "Unknown";
      try {
        // Get file info
        const fileInfo = await client.getFileInfo(fileId);
        fileName = fileInfo.name;
        const uploadFileName = ensureDriveFileExtension(
          fileInfo.name,
          fileInfo.mimeType,
        );

        if (!fileInfo.isSupported) {
          results.push({
            fileId,
            fileName: fileInfo.name,
            status: "failed",
            error: `Unsupported file type: ${fileInfo.mimeType}`,
          });
          continue;
        }

        if (
          fileInfo.isAudio &&
          fileInfo.size &&
          fileInfo.size > UPLOAD_LIMITS.maxFileBytes
        ) {
          results.push({
            fileId,
            fileName: fileInfo.name,
            status: "failed",
            error: `Audio file exceeds the ${Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))}MB limit`,
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
        const fileDate = fileInfo.modifiedTime
          ? new Date(fileInfo.modifiedTime)
          : undefined;

        let uploadResult;
        if (fileInfo.isAudio) {
          console.log(`[Drive] converting audio file ${fileId} to MP4`);
          const prepared = await prepareAudioAsVideo({
            stream,
            originalName: fileInfo.name,
          });
          try {
            console.log(
              `[Drive] converted audio file ${fileId}: ${Math.round(prepared.durationSeconds)}s, ${prepared.outputBytes} bytes`,
            );
            uploadResult = await uploadAsset({
              filePath: prepared.filePath,
              filename: prepared.filename,
              mimeType: prepared.mimeType,
              deviceAssetId,
              createdAt: fileDate,
              modifiedAt: fileDate,
            });
          } finally {
            await prepared.cleanup().catch((err) => {
              console.warn(
                `[Drive] failed to clean up audio conversion for ${fileId}: ${(err as Error).message}`,
              );
            });
          }
        } else {
          uploadResult = await uploadAssetStream({
            stream,
            filename: uploadFileName,
            mimeType: fileInfo.mimeType,
            deviceAssetId,
            createdAt: fileDate,
            modifiedAt: fileDate,
          });
        }

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
        const allTags = [
          ...placementTags,
          ...activityTags,
          ...(fileInfo.isAudio ? ["media:audio"] : []),
        ];
        if (allTags.length > 0) {
          await tagAsset(uploadResult.id, allTags);
        }
        if (owner) {
          const album = await ensureAlbum(owner.name);
          await addAssetsToAlbum(album.id, [uploadResult.id]);
        }

        results.push({
          fileId,
          fileName: fileInfo.name,
          status: "success",
          assetId: uploadResult.id,
          ...(owner ? { uploaderId: owner.id, uploaderName: owner.name } : {}),
        });
      } catch (err) {
        results.push({
          fileId,
          fileName,
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
