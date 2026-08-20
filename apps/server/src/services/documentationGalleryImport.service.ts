import { Buffer } from "node:buffer";
import {
  addAssetsToAlbum,
  getAsset,
  getPublishedAlbum,
  listTags,
  searchAssetIdsByTags,
  tagAsset,
  untagAssets,
  updateAssetDescription,
  uploadAssetBuffer,
  type ImmichTag,
} from "../infra/ImmichClient.js";
import {
  getArtasiaDocumentationGalleries,
  getArtasiaPlacements,
  getWordPressConfig,
  migrateArtasiaDocumentationGalleries,
  type WpDocumentationGallery,
  type WpDocumentationGalleryAsset,
} from "../infra/WordPressClient.js";
import { placementAnchorTag } from "./uploadConfig.service.js";
import { UPLOAD_LIMITS } from "./uploadLimits.js";

const PROCESS_ASSET_TYPE_TAG = "asset_type:process";
const ARTWORK_ASSET_TYPE_TAG = "asset_type:artwork";
const WORDPRESS_SOURCE_TAG_PREFIX = "source:wordpress-attachment:";

export type DocumentationGalleryImportAssetStatus =
  | "ready"
  | "already-imported"
  | "imported"
  | "missing-source"
  | "unsupported"
  | "duplicate-source"
  | "failed";

export interface DocumentationGalleryImportAsset {
  attachmentId: number;
  wordpressFileName: string;
  wordpressCaption: string;
  status: DocumentationGalleryImportAssetStatus;
  assetId?: string;
  error?: string;
}

export interface DocumentationGalleryImportDocument {
  documentId: number;
  documentTitle: string;
  placementIds: number[];
  placementNames: string[];
  assets: DocumentationGalleryImportAsset[];
  sourceSwitched: boolean;
}

export interface DocumentationGalleryImportReport {
  dryRun: boolean;
  generatedAt: string;
  documentsScanned: number;
  imagesScanned: number;
  imagesToImport: number;
  imagesAlreadyImported: number;
  imagesImported: number;
  imagesFailed: number;
  documentsReadyToSwitch: number;
  sourceDocumentsUpdated: number;
  sourceUpdateError?: string;
  documents: DocumentationGalleryImportDocument[];
}

type ImportState = {
  galleries: WpDocumentationGallery[];
  placementNames: Map<number, string>;
  sourceAssetIdsByAttachment: Map<number, string[]>;
  publishedAlbumId: string;
  tags: ImmichTag[];
  artworkTag: ImmichTag | undefined;
};

function normalizeTagValue(value: string): string {
  return value.trim().toLowerCase();
}

function tagValues(tag: ImmichTag): string[] {
  return [tag.name, tag.value].map(normalizeTagValue).filter(Boolean);
}

function sourceTagName(attachmentId: number): string {
  return `${WORDPRESS_SOURCE_TAG_PREFIX}${attachmentId}`;
}

function findTagByValue(tags: ImmichTag[], value: string): ImmichTag | undefined {
  const normalized = normalizeTagValue(value);
  return tags.find((tag) => tagValues(tag).includes(normalized));
}

async function loadImportState(): Promise<ImportState> {
  const [galleries, placements, publishedAlbum, tags] = await Promise.all([
    getArtasiaDocumentationGalleries({ forceFresh: true }),
    getArtasiaPlacements({ forceFresh: true }),
    getPublishedAlbum(),
    listTags(),
  ]);

  const attachmentIds = [...new Set(galleries.flatMap((gallery) =>
    gallery.assets.map((asset) => asset.attachment_id),
  ))];
  const sourceTagsByAttachment = new Map<number, ImmichTag>();
  for (const attachmentId of attachmentIds) {
    const tag = findTagByValue(tags, sourceTagName(attachmentId));
    if (tag) sourceTagsByAttachment.set(attachmentId, tag);
  }

  const sourceAssets = await searchAssetIdsByTags(
    [...sourceTagsByAttachment.values()].map((tag) => tag.id),
  );
  const sourceAssetIdsByAttachment = new Map<number, string[]>();
  for (const [attachmentId, tag] of sourceTagsByAttachment) {
    sourceAssetIdsByAttachment.set(attachmentId, sourceAssets.get(tag.id) ?? []);
  }

  return {
    galleries,
    placementNames: new Map(
      placements.map((placement) => [placement.placement_id, placement.placement_name]),
    ),
    sourceAssetIdsByAttachment,
    publishedAlbumId: publishedAlbum.id,
    tags,
    artworkTag: findTagByValue(tags, ARTWORK_ASSET_TYPE_TAG),
  };
}

function assetStatus(
  asset: WpDocumentationGalleryAsset,
  state: ImportState,
): DocumentationGalleryImportAsset {
  const importedIds = state.sourceAssetIdsByAttachment.get(asset.attachment_id) ?? [];
  let status: DocumentationGalleryImportAssetStatus = "ready";
  let error: string | undefined;
  if (importedIds.length === 1) {
    status = "already-imported";
  } else if (importedIds.length > 1) {
    status = "duplicate-source";
    error = "Multiple Immich assets carry this WordPress source marker.";
  } else if (!asset.source_url) {
    status = "missing-source";
    error = "WordPress did not provide a downloadable media URL.";
  } else if (!asset.mime_type || !asset.mime_type.toLowerCase().startsWith("image/")) {
    status = "unsupported";
    error = `WordPress media type is not an image: ${asset.mime_type || "unknown"}.`;
  }

  return {
    attachmentId: asset.attachment_id,
    wordpressFileName: asset.file_name,
    wordpressCaption: asset.caption.trim(),
    status,
    ...(importedIds.length === 1 ? { assetId: importedIds[0] } : {}),
    ...(error ? { error } : {}),
  };
}

function documentPreview(
  gallery: WpDocumentationGallery,
  state: ImportState,
): DocumentationGalleryImportDocument {
  return {
    documentId: gallery.document_id,
    documentTitle: gallery.document_title,
    placementIds: gallery.placement_ids,
    placementNames: gallery.placement_ids.map((id) =>
      state.placementNames.get(id) ?? `Placement ${id}`,
    ),
    assets: gallery.assets.map((asset) => assetStatus(asset, state)),
    sourceSwitched: false,
  };
}

function readyToSwitch(document: DocumentationGalleryImportDocument): boolean {
  return document.placementIds.length > 0 &&
    document.assets.length > 0 &&
    document.assets.every((asset) =>
      asset.status === "ready" || asset.status === "already-imported" || asset.status === "imported",
    );
}

function buildReport(
  documents: DocumentationGalleryImportDocument[],
  dryRun: boolean,
  sourceDocumentsUpdated = 0,
  sourceUpdateError?: string,
): DocumentationGalleryImportReport {
  const assets = documents.flatMap((document) => document.assets);
  return {
    dryRun,
    generatedAt: new Date().toISOString(),
    documentsScanned: documents.length,
    imagesScanned: assets.length,
    imagesToImport: assets.filter((asset) => asset.status === "ready").length,
    imagesAlreadyImported: assets.filter((asset) => asset.status === "already-imported").length,
    imagesImported: assets.filter((asset) => asset.status === "imported").length,
    imagesFailed: assets.filter((asset) =>
      ["missing-source", "unsupported", "duplicate-source", "failed"].includes(asset.status),
    ).length,
    documentsReadyToSwitch: documents.filter(readyToSwitch).length,
    sourceDocumentsUpdated,
    ...(sourceUpdateError ? { sourceUpdateError } : {}),
    documents,
  };
}

export async function previewDocumentationGalleryImport(): Promise<DocumentationGalleryImportReport> {
  const state = await loadImportState();
  return buildReport(state.galleries.map((gallery) => documentPreview(gallery, state)), true);
}

async function downloadWordPressImage(asset: WpDocumentationGalleryAsset): Promise<Buffer> {
  const wordpressUrl = new URL(getWordPressConfig().url);
  const sourceUrl = new URL(asset.source_url);
  if (
    !["http:", "https:"].includes(sourceUrl.protocol) ||
    sourceUrl.hostname !== wordpressUrl.hostname
  ) {
    throw new Error("WordPress media URL is not hosted by the configured WordPress site.");
  }

  const response = await fetch(sourceUrl, { headers: { Accept: asset.mime_type || "image/*" } });
  if (!response.ok) {
    throw new Error(`WordPress media download failed: ${response.status} ${response.statusText}.`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > UPLOAD_LIMITS.maxFileBytes) {
    throw new Error(`Image exceeds the ${Math.round(UPLOAD_LIMITS.maxFileBytes / (1024 * 1024))}MB upload limit.`);
  }
  const responseType = response.headers.get("content-type")?.split(";", 1)[0].trim() ?? "";
  if (responseType && !responseType.toLowerCase().startsWith("image/")) {
    throw new Error(`WordPress returned a non-image content type: ${responseType}.`);
  }
  return buffer;
}

async function prepareImportedAsset(
  document: DocumentationGalleryImportDocument,
  asset: DocumentationGalleryImportAsset,
  galleryAsset: WpDocumentationGalleryAsset,
  state: ImportState,
): Promise<void> {
  let assetId = asset.assetId;
  if (!assetId) {
    const buffer = await downloadWordPressImage(galleryAsset);
    const uploaded = await uploadAssetBuffer({
      buffer,
      filename: galleryAsset.file_name,
      mimeType: galleryAsset.mime_type,
      deviceAssetId: `artasia-galaxy:wordpress:${galleryAsset.attachment_id}`,
    });
    assetId = uploaded.id;
    asset.assetId = assetId;
    asset.status = "imported";
  }

  await tagAsset(assetId, [
    ...document.placementIds.map(placementAnchorTag),
    PROCESS_ASSET_TYPE_TAG,
    sourceTagName(galleryAsset.attachment_id),
  ]);
  if (state.artworkTag) {
    await untagAssets([assetId], [state.artworkTag.id]);
  }
  await addAssetsToAlbum(state.publishedAlbumId, [assetId]);

  if (asset.wordpressCaption) {
    const current = await getAsset(assetId);
    const currentDescription = current.exifInfo?.description?.trim() ?? "";
    if (asset.wordpressCaption.length > currentDescription.length) {
      await updateAssetDescription(assetId, asset.wordpressCaption);
    }
  }
}

export async function importDocumentationGalleries(): Promise<DocumentationGalleryImportReport> {
  const state = await loadImportState();
  const documents = state.galleries.map((gallery) => documentPreview(gallery, state));
  const galleryByDocumentId = new Map(state.galleries.map((gallery) => [gallery.document_id, gallery]));

  for (const document of documents) {
    const gallery = galleryByDocumentId.get(document.documentId);
    if (!gallery) continue;
    for (const [index, asset] of document.assets.entries()) {
      if (asset.status !== "ready" && asset.status !== "already-imported") continue;
      try {
        await prepareImportedAsset(document, asset, gallery.assets[index], state);
      } catch (err) {
        asset.status = "failed";
        asset.error = (err as Error).message;
      }
    }
  }

  const readyDocumentIds = documents.filter(readyToSwitch).map((document) => document.documentId);
  let sourceDocumentsUpdated = 0;
  let sourceUpdateError: string | undefined;
  if (readyDocumentIds.length > 0) {
    try {
      const result = await migrateArtasiaDocumentationGalleries(readyDocumentIds);
      sourceDocumentsUpdated = result.updated.length;
      for (const document of documents) {
        if (result.updated.includes(document.documentId)) document.sourceSwitched = true;
      }
    } catch (err) {
      sourceUpdateError = (err as Error).message;
    }
  }

  return buildReport(documents, false, sourceDocumentsUpdated, sourceUpdateError);
}
