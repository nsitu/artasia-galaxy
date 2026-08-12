import { google, type drive_v3 } from "googleapis";
import { OAuth2Client } from "google-auth-library";
import { extname } from "node:path";

const GOOGLE_MIME_TYPE_FOLDER = "application/vnd.google-apps.folder";
const IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/bmp",
  "image/heic",
  "image/heif",
];
const VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime", "video/x-msvideo"];
const AUDIO_MIME_TYPES = [
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
];
const SUPPORTED_MIME_TYPES = [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES, ...AUDIO_MIME_TYPES];

const MIME_TYPE_EXTENSIONS: Readonly<Record<string, string>> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/bmp": ".bmp",
  "image/heic": ".heic",
  "image/heif": ".heif",
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/x-msvideo": ".avi",
  "audio/mpeg": ".mp3",
  "audio/mp3": ".mp3",
  "audio/mp4": ".m4a",
  "audio/m4a": ".m4a",
  "audio/x-m4a": ".m4a",
};
const MIME_TYPE_COMPATIBLE_EXTENSIONS: Readonly<Record<string, ReadonlySet<string>>> = {
  "image/jpeg": new Set([".jpg", ".jpeg", ".jpe"]),
  "image/png": new Set([".png"]),
  "image/gif": new Set([".gif"]),
  "image/webp": new Set([".webp"]),
  "image/bmp": new Set([".bmp"]),
  "image/heic": new Set([".heic"]),
  "image/heif": new Set([".heif"]),
  "video/mp4": new Set([".mp4", ".m4v"]),
  "video/quicktime": new Set([".mov", ".qt"]),
  "video/x-msvideo": new Set([".avi"]),
  "audio/mpeg": new Set([".mp3", ".mp2", ".mpa"]),
  "audio/mp3": new Set([".mp3"]),
  "audio/mp4": new Set([".m4a", ".mp4"]),
  "audio/m4a": new Set([".m4a"]),
  "audio/x-m4a": new Set([".m4a"]),
};
const COMPARABLE_MEDIA_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif",
  ".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv",
  ".mp3", ".m4a", ".wav", ".aac", ".ogg", ".flac",
]);

export function comparableMediaFilename(name: string) {
  const normalized = name.trim().toLocaleLowerCase();
  const extension = extname(normalized);
  const stem = COMPARABLE_MEDIA_EXTENSIONS.has(extension)
    ? normalized.slice(0, -extension.length)
    : normalized;
  return stem
    .replace(/(?:\s*-\s*artasia-(?:edit|trim))+$/g, "")
    .trim();
}

/**
 * Google Drive permits names without extensions, while Immich also consults
 * the multipart filename when choosing an upload decoder.
 */
export function ensureDriveFileExtension(name: string, mimeType: string): string {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  const extension = MIME_TYPE_EXTENSIONS[normalizedMimeType];
  if (!extension) return name;

  const filenameExtension = extname(name).toLowerCase();
  if (MIME_TYPE_COMPATIBLE_EXTENSIONS[normalizedMimeType]?.has(filenameExtension)) {
    return name;
  }

  return `${name}${extension}`;
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: number;
  createdTime?: string;
  modifiedTime?: string;
  md5Checksum?: string;
  sha1Checksum?: string;
  parents?: string[];
  webViewLink?: string;
  thumbnailLink?: string;
}

interface DriveFolder {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  driveId?: string;
}

export interface DriveFolderStats {
  folderId: string;
  directFileCount: number;
  subfolderCount: number;
  nestedFileCount: number;
  totalFileCount: number;
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(values[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, worker),
  );
  return results;
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
    const parentId = folderId === "root" ? driveId ?? "root" : folderId;
    const supportedTypesQuery = `(${SUPPORTED_MIME_TYPES.map(
      (mime) => `mimeType = '${mime}'`
    ).join(" or ")} or mimeType = '${GOOGLE_MIME_TYPE_FOLDER}')`;

    const listParams: any = {
      q: `'${parentId}' in parents and trashed = false and ${supportedTypesQuery}`,
      pageSize: 100,
      pageToken,
      fields: "files(id,name,mimeType,size,createdTime,modifiedTime,md5Checksum,sha1Checksum,parents,webViewLink,thumbnailLink)",
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
      fields: "id,name,mimeType,size,createdTime,modifiedTime,md5Checksum,sha1Checksum,parents,webViewLink,thumbnailLink",
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
    const resolvedParentId = parentId === "root" ? driveId ?? "root" : parentId;
    const query = `'${resolvedParentId}' in parents and mimeType = '${GOOGLE_MIME_TYPE_FOLDER}' and trashed = false`;

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

  private async getAllFolderChildren(folderId: string, driveId?: string) {
    const children: Array<{ id: string; mimeType: string }> = [];
    let pageToken: string | undefined;
    do {
      const listParams: drive_v3.Params$Resource$Files$List = {
        q: `'${folderId}' in parents and trashed = false`,
        pageSize: 1000,
        pageToken,
        fields: "nextPageToken,files(id,mimeType)",
      };
      if (driveId) {
        listParams.corpora = "drive";
        listParams.driveId = driveId;
        listParams.includeItemsFromAllDrives = true;
        listParams.supportsAllDrives = true;
      } else {
        listParams.spaces = "drive";
      }
      const response = await this.drive.files.list(listParams);
      for (const child of response.data.files ?? []) {
        if (child.id && child.mimeType) {
          children.push({ id: child.id, mimeType: child.mimeType });
        }
      }
      pageToken = response.data.nextPageToken ?? undefined;
    } while (pageToken);
    return children;
  }

  async getFolderStatsOneLevel(
    folderId: string,
    driveId?: string,
  ): Promise<DriveFolderStats> {
    const directChildren = await this.getAllFolderChildren(folderId, driveId);
    const subfolders = directChildren.filter(
      (child) => child.mimeType === GOOGLE_MIME_TYPE_FOLDER,
    );
    const directFileCount = directChildren.length - subfolders.length;
    const nestedFileCounts = await mapWithConcurrency(
      subfolders,
      4,
      async (subfolder) => {
        const children = await this.getAllFolderChildren(subfolder.id, driveId);
        return children.filter(
          (child) => child.mimeType !== GOOGLE_MIME_TYPE_FOLDER,
        ).length;
      },
    );
    const nestedFileCount = nestedFileCounts.reduce(
      (total, count) => total + count,
      0,
    );
    return {
      folderId,
      directFileCount,
      subfolderCount: subfolders.length,
      nestedFileCount,
      totalFileCount: directFileCount + nestedFileCount,
    };
  }

  async getFolderStats(
    folderIds: string[],
    driveId?: string,
  ): Promise<DriveFolderStats[]> {
    return mapWithConcurrency(folderIds, 3, (folderId) =>
      this.getFolderStatsOneLevel(folderId, driveId),
    );
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
    modifiedTime?: string;
    isSupported: boolean;
    isAudio: boolean;
  }> {
    const file = await this.getFile(fileId);
    const isSupported = SUPPORTED_MIME_TYPES.includes(file.mimeType);
    return {
      name: file.name,
      mimeType: file.mimeType,
      size: file.size ? parseInt(file.size as unknown as string) : undefined,
      modifiedTime: file.modifiedTime,
      isSupported,
      isAudio: GoogleDriveClient.isAudio(file.mimeType),
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
   * Searches a placement folder and all of its subfolders for a single media
   * filename. Audio imports are stored as MP4s, so matching compares media
   * stems as well as the original filename.
   */
  async findUniqueFileInFolderTree(folderId: string, filename: string): Promise<{
    file?: DriveFile;
    matches: DriveFile[];
    matchCount: number;
  }> {
    return (await this.findUniqueFilesInFolderTree(folderId, [filename]))[0] ?? {
      matches: [],
      matchCount: 0,
    };
  }

  /**
   * Searches a placement folder tree for several filenames in one traversal.
   * This is used by the admin maintenance lookup so a folder is not crawled
   * once for every asset it contains.
   */
  async findUniqueFilesInFolderTree(
    folderId: string,
    filenames: string[],
  ): Promise<Array<{
    filename: string;
    folderName: string;
    file?: DriveFile;
    matches: DriveFile[];
    matchCount: number;
  }>> {
    const uniqueFilenames = Array.from(
      new Set(filenames.map((filename) => filename.trim()).filter(Boolean)),
    );
    if (uniqueFilenames.length === 0) return [];

    const rootFolder = await this.getFolder(folderId);
    const driveId = rootFolder.driveId;
    const queue = [folderId];
    const visitedFolders = new Set<string>();
    const exactTargets = new Map<string, string[]>();
    const comparableTargets = new Map<string, string[]>();
    for (const filename of uniqueFilenames) {
      const exactMatches = exactTargets.get(filename.toLocaleLowerCase()) ?? [];
      exactMatches.push(filename);
      exactTargets.set(filename.toLocaleLowerCase(), exactMatches);
      const comparableMatches = comparableTargets.get(comparableMediaFilename(filename)) ?? [];
      comparableMatches.push(filename);
      comparableTargets.set(comparableMediaFilename(filename), comparableMatches);
    }
    const matches = new Map<string, Map<string, DriveFile>>();
    const maxFolders = 2_000;

    while (queue.length > 0) {
      const currentFolderId = queue.shift();
      if (!currentFolderId || visitedFolders.has(currentFolderId)) continue;
      visitedFolders.add(currentFolderId);
      if (visitedFolders.size > maxFolders) {
        throw new Error(`Google Drive lookup stopped after ${maxFolders} folders. Narrow the placement folder before trying again.`);
      }

      let pageToken: string | undefined;
      do {
        const page = await this.listFiles(currentFolderId, pageToken, driveId);
        for (const file of page.files) {
          if (GoogleDriveClient.isFolder(file.mimeType)) {
            queue.push(file.id);
            continue;
          }
          const candidateName = ensureDriveFileExtension(file.name, file.mimeType)
            .trim()
            .toLocaleLowerCase();
          const exactTargetsForCandidate = exactTargets.get(candidateName) ?? [];
          const comparableTargetsForCandidate = comparableTargets.get(
            comparableMediaFilename(candidateName),
          );
          for (const target of new Set([
            ...exactTargetsForCandidate,
            ...(comparableTargetsForCandidate ?? []),
          ])) {
            const targetMatches = matches.get(target) ?? new Map<string, DriveFile>();
            targetMatches.set(file.id, file);
            matches.set(target, targetMatches);
          }
        }
        pageToken = page.nextPageToken;
      } while (pageToken);
    }

    return uniqueFilenames.map((filename) => {
      const targetMatches = matches.get(filename) ?? new Map<string, DriveFile>();
      return {
        filename,
        folderName: rootFolder.name,
        ...(targetMatches.size === 1
          ? { file: targetMatches.values().next().value as DriveFile }
          : {}),
        matches: Array.from(targetMatches.values()),
        matchCount: targetMatches.size,
      };
    });
  }

  async getFolder(folderId: string): Promise<DriveFolder> {
    const res = await this.drive.files.get({
      fileId: folderId,
      fields: "id,name,mimeType,parents,driveId",
      supportsAllDrives: true,
    });

    if (!res.data.id || res.data.mimeType !== GOOGLE_MIME_TYPE_FOLDER) {
      throw new Error(`Google Drive folder ${folderId} not found`);
    }

    return res.data as DriveFolder;
  }

  async getFolderPath(folderId: string): Promise<DriveFolder[]> {
    const path: DriveFolder[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = folderId;

    while (currentId && !visited.has(currentId) && path.length < 100) {
      visited.add(currentId);
      const folder = await this.getFolder(currentId);
      path.unshift(folder);
      currentId = folder.parents?.[0];
    }

    if (currentId && visited.has(currentId)) {
      throw new Error(`Cycle detected in Google Drive folder ancestry for ${folderId}`);
    }

    const sharedDriveId = path[path.length - 1]?.driveId;
    if (sharedDriveId) {
      const sharedDrive = await this.drive.drives.get({
        driveId: sharedDriveId,
        fields: "id,name",
      });
      if (sharedDrive.data.id && sharedDrive.data.name) {
        const sharedDriveRoot: DriveFolder = {
          id: sharedDrive.data.id,
          name: sharedDrive.data.name,
          mimeType: GOOGLE_MIME_TYPE_FOLDER,
          driveId: sharedDrive.data.id,
        };
        if (path[0]?.id === sharedDrive.data.id) {
          path[0] = sharedDriveRoot;
        } else {
          path.unshift(sharedDriveRoot);
        }
      }
    }

    return path;
  }

  /**
   * Check if a MIME type is supported audio
   */
  static isAudio(mimeType: string): boolean {
    return AUDIO_MIME_TYPES.includes(mimeType);
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
