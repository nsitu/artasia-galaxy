import { google, type drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";

const GOOGLE_MIME_TYPE_FOLDER = "application/vnd.google-apps.folder";
const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
];
const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime", "video/x-msvideo"];
const SUPPORTED_MIME_TYPES = [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES];

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  modifiedTime?: string;
  parents?: string[];
  webViewLink?: string;
}

interface DriveFolder {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  driveId?: string;
}

export class GoogleDriveClient {
  private drive: drive_v3.Drive;

  constructor(refreshToken: string, clientId: string, clientSecret: string) {
    const auth = new OAuth2Client({
      clientId,
      clientSecret,
    });

    auth.setCredentials({
      refresh_token: refreshToken,
    });

    this.drive = google.drive({ version: "v3", auth: auth as any });
  }

  /**
   * List files in a folder, supporting pagination and Shared Drives
   */
  async listFiles(
    folderId: string = "root",
    pageToken?: string,
    driveId?: string
  ): Promise<{
    files: DriveFile[];
    nextPageToken?: string;
  }> {
    const query = folderId === "root" 
      ? `trashed = false and (${SUPPORTED_MIME_TYPES.map(
          (mime) => `mimeType = '${mime}'`
        ).join(" or ")} or mimeType = '${GOOGLE_MIME_TYPE_FOLDER}')`
      : `'${folderId}' in parents and trashed = false and (${SUPPORTED_MIME_TYPES.map(
          (mime) => `mimeType = '${mime}'`
        ).join(" or ")} or mimeType = '${GOOGLE_MIME_TYPE_FOLDER}')`;

    const listParams: any = {
      q: driveId && folderId === "root" ? query : `'${folderId}' in parents and ${query}`,
      pageSize: 100,
      pageToken,
      fields: "files(id,name,mimeType,size,modifiedTime,parents,webViewLink)",
      orderBy: "name",
    };

    // For Shared Drives, use corpora and driveId instead of spaces
    if (driveId) {
      listParams.corpora = "drive";
      listParams.driveId = driveId;
      listParams.includeItemsFromAllDrives = true;
      listParams.supportsAllDrives = true;
    } else {
      listParams.spaces = "drive";
    }

    const res = await this.drive.files.list(listParams);

    return {
      files: (res.data.files ?? []) as DriveFile[],
      nextPageToken: res.data.nextPageToken || undefined,
    };
  }

  /**
   * Get metadata for a single file
   */
  async getFile(fileId: string): Promise<DriveFile> {
    const res = await this.drive.files.get({
      fileId,
      fields: "id,name,mimeType,size,modifiedTime,parents,webViewLink",
      supportsAllDrives: true,
    });

    if (!res.data.id) {
      throw new Error(`File ${fileId} not found`);
    }

    return res.data as DriveFile;
  }

  /**
   * Get subfolders in a specific folder (hierarchical browsing)
   */
  async getFoldersInFolder(parentId: string = "root", driveId?: string): Promise<DriveFolder[]> {
    const query = parentId === "root"
      ? `mimeType = '${GOOGLE_MIME_TYPE_FOLDER}' and trashed = false`
      : `mimeType = '${GOOGLE_MIME_TYPE_FOLDER}' and trashed = false and '${parentId}' in parents`;

    const listParams: any = {
      q: query,
      pageSize: 100,
      fields: "files(id,name,mimeType,parents)",
      orderBy: "name",
    };

    // For Shared Drives, use corpora and driveId instead of spaces
    if (driveId) {
      listParams.corpora = "drive";
      listParams.driveId = driveId;
      listParams.includeItemsFromAllDrives = true;
      listParams.supportsAllDrives = true;
    } else {
      listParams.spaces = "drive";
    }

    const res = await this.drive.files.list(listParams);

    return (res.data.files ?? []) as DriveFolder[];
  }

  /**
   * Get all Shared Drives
   */
  async getSharedDrives(): Promise<DriveFolder[]> {
    const res = await this.drive.drives.list({
      pageSize: 100,
      fields: "drives(id,name)",
    });

    return (res.data.drives ?? []).map((drive: any) => ({
      id: drive.id,
      name: drive.name,
      mimeType: GOOGLE_MIME_TYPE_FOLDER,
      driveId: drive.id,
    }));
  }

  /**
   * Get root folder info for My Drive
   */
  async getMyDriveInfo(): Promise<DriveFolder> {
    return {
      id: "root",
      name: "My Drive",
      mimeType: GOOGLE_MIME_TYPE_FOLDER,
    };
  }

  /**
   * Get folder structure starting from root (legacy, returns immediate children)
   */
  async getFolders(): Promise<DriveFolder[]> {
    return this.getFoldersInFolder("root");
  }

  /**
   * Download file content as a stream
   */
  async downloadFile(fileId: string): Promise<NodeJS.ReadableStream> {
    const res = await this.drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "stream" }
    );
    return res.data as NodeJS.ReadableStream;
  }

  /**
   * Get file metadata including MIME type and size for type checking
   */
  async getFileInfo(fileId: string): Promise<{
    name: string;
    mimeType: string;
    size?: number;
    isSupported: boolean;
  }> {
    const file = await this.getFile(fileId);
    const isSupported = SUPPORTED_MIME_TYPES.includes(file.mimeType);
    return {
      name: file.name,
      mimeType: file.mimeType,
      size: file.size ? parseInt(file.size as unknown as string) : undefined,
      isSupported,
    };
  }

  /**
   * Check if a MIME type is an image
   */
  static isImage(mimeType: string): boolean {
    return IMAGE_MIME_TYPES.includes(mimeType);
  }

  /**
   * Check if a MIME type is a video
   */
  static isVideo(mimeType: string): boolean {
    return VIDEO_MIME_TYPES.includes(mimeType);
  }

  /**
   * Check if a MIME type is supported
   */
  static isSupported(mimeType: string): boolean {
    return SUPPORTED_MIME_TYPES.includes(mimeType);
  }

  /**
   * Check if file is a folder
   */
  static isFolder(mimeType: string): boolean {
    return mimeType === GOOGLE_MIME_TYPE_FOLDER;
  }
}

/**
 * Create a Drive client for a user with a refresh token
 */
export function createDriveClient(
  refreshToken: string | undefined
): GoogleDriveClient | null {
  if (!refreshToken) return null;

  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET ?? "";

  if (!clientId || !clientSecret) {
    throw new Error("Google credentials not configured");
  }

  return new GoogleDriveClient(refreshToken, clientId, clientSecret);
}
