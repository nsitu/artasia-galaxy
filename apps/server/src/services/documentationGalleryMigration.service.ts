import {
  ensureTag,
  getPublishedAlbum,
  listTags,
  searchAssets,
  searchAssetIdsByTag,
  tagAssets,
  untagAssets,
  updateAssetDescription,
  type ImmichAsset,
  type ImmichTag,
} from "../infra/ImmichClient.js";
import {
  getArtasiaDocumentationGalleries,
  getArtasiaPlacements,
  migrateArtasiaDocumentationGalleries,
  type WpDocumentationGallery,
} from "../infra/WordPressClient.js";
import {
  displayPlacementTag,
  placementAnchorTag,
} from "./uploadConfig.service.js";

const PROCESS_ASSET_TYPE_TAG = "asset_type:process";
const ARTWORK_ASSET_TYPE_TAG = "asset_type:artwork";
const MAX_ASSETS_PER_PLACEMENT = 5000;

export interface DocumentationGalleryMigrationMatch {
  attachmentId: number;
  wordpressFileName: string;
  wordpressCaption: string;
  assetId: string;
  immichFileName: string;
  currentDescription: string;
  assetAlreadyProcess: boolean;
  descriptionAction: "update" | "preserve" | "none";
}

export interface DocumentationGalleryMigrationDocument {
  documentId: number;
  documentTitle: string;
  placementIds: number[];
  placementNames: string[];
  placementAssets: Array<{
    placementId: number;
    placementName: string;
    fileNames: string[];
  }>;
  matches: DocumentationGalleryMigrationMatch[];
  unmatched: Array<{
    attachmentId: number;
    wordpressFileName: string;
  }>;
  ambiguous: Array<{
    attachmentId: number;
    wordpressFileName: string;
    assetIds: string[];
  }>;
  skippedReason?: string;
}

export interface DocumentationGalleryMigrationReport {
  dryRun: boolean;
  generatedAt: string;
  documentsScanned: number;
  documentsWithMatches: number;
  documentsReady: number;
  documentsWithIssues: number;
  exactMatches: number;
  unmatchedImages: number;
  ambiguousImages: number;
  assetsToTag: number;
  descriptionsToUpdate: number;
  descriptionsPreserved: number;
  sourceDocumentsToUpdate: number;
  sourceDocumentsUpdated: number;
  sourceUpdateError?: string;
  documents: DocumentationGalleryMigrationDocument[];
}

type PlacementAssetIndex = Map<string, ImmichAsset[]>;

function normalizeFileName(value: string): string {
  const basename = value.trim().replaceAll("\\", "/").split("/").pop() ?? "";
  return basename.normalize("NFKC").toLocaleLowerCase();
}

function tagValue(tag: ImmichTag): string[] {
  return [tag.name, tag.value]
    .map((value) => value.trim().toLocaleLowerCase())
    .filter(Boolean);
}

function findTagIds(tags: ImmichTag[], names: string[]): string[] {
  const normalizedNames = new Set(names.map((name) => name.toLocaleLowerCase()));
  return tags
    .filter((tag) => tagValue(tag).some((value) => normalizedNames.has(value)))
    .map((tag) => tag.id);
}

async function searchPlacementAssets(
  placementId: number,
  publishedAlbumId: string,
  tags: ImmichTag[],
): Promise<PlacementAssetIndex> {
  const placementTagIds = findTagIds(tags, [
    placementAnchorTag(placementId),
    displayPlacementTag(placementId),
  ]);
  const byName = new Map<string, ImmichAsset[]>();
  if (placementTagIds.length === 0) return byName;

  const results = await Promise.all(
    placementTagIds.map(async (tagId) => {
      const assets: ImmichAsset[] = [];
      let page = 1;
      while (assets.length < MAX_ASSETS_PER_PLACEMENT) {
        const result = await searchAssets({
          albumIds: [publishedAlbumId],
          tagIds: [tagId],
          type: "IMAGE",
          visibility: "timeline",
          page,
          size: 500,
          withExif: true,
          withPeople: false,
        });
        assets.push(...result.assets.items);
        if (!result.assets.nextPage || result.assets.items.length < 500) break;
        page += 1;
      }
      return assets;
    }),
  );

  const byId = new Map<string, ImmichAsset>();
  for (const asset of results.flat()) byId.set(asset.id, asset);
  for (const asset of byId.values()) {
    const key = normalizeFileName(asset.originalFileName);
    if (!key) continue;
    const matches = byName.get(key) ?? [];
    matches.push(asset);
    byName.set(key, matches);
  }
  return byName;
}

function migrationDocument(
  gallery: WpDocumentationGallery,
  placementNames: Map<number, string>,
  assetsByPlacement: Map<number, PlacementAssetIndex>,
  processAssetIds: Set<string>,
): DocumentationGalleryMigrationDocument {
  const result: DocumentationGalleryMigrationDocument = {
    documentId: gallery.document_id,
    documentTitle: gallery.document_title,
    placementIds: gallery.placement_ids,
    placementNames: gallery.placement_ids
      .map((id) => placementNames.get(id) ?? `Placement ${id}`),
    placementAssets: gallery.placement_ids.map((placementId) => {
      const filesByName = new Map<string, string>();
      for (const assets of assetsByPlacement.get(placementId)?.values() ?? []) {
        for (const asset of assets) filesByName.set(asset.id, asset.originalFileName);
      }
      return {
        placementId,
        placementName: placementNames.get(placementId) ?? `Placement ${placementId}`,
        fileNames: [...filesByName.values()].sort((a, b) => a.localeCompare(b)),
      };
    }),
    matches: [],
    unmatched: [],
    ambiguous: [],
  };

  if (gallery.placement_ids.length === 0) {
    result.skippedReason = "No placement is selected.";
    return result;
  }
  if (gallery.assets.length === 0) {
    result.skippedReason = "No WordPress gallery images are selected.";
    return result;
  }

  for (const image of gallery.assets) {
    const normalizedName = normalizeFileName(image.file_name);
    const candidates = new Map<string, ImmichAsset>();
    for (const placementId of gallery.placement_ids) {
      for (const asset of assetsByPlacement.get(placementId)?.get(normalizedName) ?? []) {
        candidates.set(asset.id, asset);
      }
    }

    if (candidates.size === 0) {
      result.unmatched.push({
        attachmentId: image.attachment_id,
        wordpressFileName: image.file_name,
      });
      continue;
    }
    if (candidates.size > 1) {
      result.ambiguous.push({
        attachmentId: image.attachment_id,
        wordpressFileName: image.file_name,
        assetIds: [...candidates.keys()],
      });
      continue;
    }

    const asset = candidates.values().next().value as ImmichAsset;
    const wordpressCaption = image.caption.trim();
    const currentDescription = asset.exifInfo?.description?.trim() ?? "";
    result.matches.push({
      attachmentId: image.attachment_id,
      wordpressFileName: image.file_name,
      wordpressCaption,
      assetId: asset.id,
      immichFileName: asset.originalFileName,
      currentDescription,
      assetAlreadyProcess: processAssetIds.has(asset.id),
      descriptionAction: wordpressCaption.length > currentDescription.length
        ? "update"
        : wordpressCaption
          ? "preserve"
          : "none",
    });
  }

  return result;
}

async function loadMigrationState() {
  const [galleries, placements, publishedAlbum, tags] = await Promise.all([
    getArtasiaDocumentationGalleries({ forceFresh: true }),
    getArtasiaPlacements({ forceFresh: true }),
    getPublishedAlbum(),
    listTags(),
  ]);
  const processTag = tags.find((tag) =>
    tagValue(tag).includes(PROCESS_ASSET_TYPE_TAG),
  );
  const artworkTag = tags.find((tag) =>
    tagValue(tag).includes(ARTWORK_ASSET_TYPE_TAG),
  );
  const processAssetIds = new Set(
    processTag ? await searchAssetIdsByTag(processTag.id) : [],
  );
  const artworkAssetIds = new Set(
    artworkTag ? await searchAssetIdsByTag(artworkTag.id) : [],
  );
  const placementNames = new Map(
    placements.map((placement) => [placement.placement_id, placement.placement_name]),
  );
  const placementIds = new Set(galleries.flatMap((gallery) => gallery.placement_ids));
  const assetsByPlacement = new Map<number, PlacementAssetIndex>();
  for (const placementId of placementIds) {
    assetsByPlacement.set(
      placementId,
      await searchPlacementAssets(placementId, publishedAlbum.id, tags),
    );
  }
  return {
    galleries,
    placementNames,
    assetsByPlacement,
    processAssetIds,
    artworkAssetIds,
    processTag,
    artworkTag,
  };
}

function buildReport(
  documents: DocumentationGalleryMigrationDocument[],
  dryRun: boolean,
): DocumentationGalleryMigrationReport {
  const matches = documents.flatMap((document) => document.matches);
  return {
    dryRun,
    generatedAt: new Date().toISOString(),
    documentsScanned: documents.length,
    documentsWithMatches: documents.filter((document) => document.matches.length > 0).length,
    documentsReady: documents.filter((document) =>
      document.matches.length > 0 &&
      document.unmatched.length === 0 &&
      document.ambiguous.length === 0 &&
      !document.skippedReason,
    ).length,
    documentsWithIssues: documents.filter((document) =>
      Boolean(document.skippedReason) ||
      document.unmatched.length > 0 ||
      document.ambiguous.length > 0,
    ).length,
    exactMatches: matches.length,
    unmatchedImages: documents.reduce((total, document) => total + document.unmatched.length, 0),
    ambiguousImages: documents.reduce((total, document) => total + document.ambiguous.length, 0),
    assetsToTag: new Set(
      matches
        .filter((match) => !match.assetAlreadyProcess)
        .map((match) => match.assetId),
    ).size,
    descriptionsToUpdate: new Set(
      matches
        .filter((match) => match.descriptionAction === "update")
        .map((match) => match.assetId),
    ).size,
    descriptionsPreserved: matches.filter((match) => match.descriptionAction === "preserve").length,
    sourceDocumentsToUpdate: documents.filter((document) =>
      document.matches.length > 0 &&
      document.unmatched.length === 0 &&
      document.ambiguous.length === 0 &&
      !document.skippedReason,
    ).length,
    sourceDocumentsUpdated: 0,
    documents,
  };
}

export async function previewDocumentationGalleryMigration(): Promise<DocumentationGalleryMigrationReport> {
  const state = await loadMigrationState();
  const documents = state.galleries.map((gallery) =>
    migrationDocument(
      gallery,
      state.placementNames,
      state.assetsByPlacement,
      state.processAssetIds,
    ),
  );
  return buildReport(documents, true);
}

export async function applyDocumentationGalleryMigration(): Promise<DocumentationGalleryMigrationReport> {
  const state = await loadMigrationState();
  const documents = state.galleries.map((gallery) =>
    migrationDocument(
      gallery,
      state.placementNames,
      state.assetsByPlacement,
      state.processAssetIds,
    ),
  );
  const report = buildReport(documents, false);
  const matches = documents.flatMap((document) => document.matches);
  const assetIds = [...new Set(matches.map((match) => match.assetId))];

  if (assetIds.length > 0) {
    const processTag = state.processTag ?? await ensureTag(PROCESS_ASSET_TYPE_TAG);
    await tagAssets(assetIds, [processTag.id]);
    if (state.artworkTag) {
      const artworkAssetIds = assetIds.filter((assetId) => state.artworkAssetIds.has(assetId));
      if (artworkAssetIds.length > 0) {
        await untagAssets(artworkAssetIds, [state.artworkTag.id]);
      }
    }
  }

  const descriptionUpdates = new Map<string, string>();
  for (const match of matches) {
    if (match.descriptionAction !== "update") continue;
    const current = descriptionUpdates.get(match.assetId) ?? "";
    if (match.wordpressCaption.length > current.length) {
      descriptionUpdates.set(match.assetId, match.wordpressCaption);
    }
  }
  for (const [assetId, description] of descriptionUpdates) {
    await updateAssetDescription(assetId, description);
  }

  const readyDocumentIds = documents
    .filter((document) =>
      document.matches.length > 0 &&
      document.unmatched.length === 0 &&
      document.ambiguous.length === 0 &&
      !document.skippedReason,
    )
    .map((document) => document.documentId);
  let sourceDocumentsUpdated = 0;
  let sourceUpdateError: string | undefined;
  if (readyDocumentIds.length > 0) {
    try {
      const sourceUpdate = await migrateArtasiaDocumentationGalleries(readyDocumentIds);
      sourceDocumentsUpdated = sourceUpdate.updated.length;
    } catch (err) {
      sourceUpdateError = (err as Error).message;
    }
  }

  return {
    ...report,
    sourceDocumentsToUpdate: readyDocumentIds.length,
    sourceDocumentsUpdated,
    ...(sourceUpdateError ? { sourceUpdateError } : {}),
  };
}
