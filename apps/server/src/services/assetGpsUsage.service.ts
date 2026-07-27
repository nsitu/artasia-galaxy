import {
  ensureTag,
  listTags,
  searchAssetIdsByTag,
  tagAssets,
  untagAssets,
} from "../infra/ImmichClient.js";

const GPS_DISABLED_TAG_NAME = "artasia:gps:disabled";

function tagKey(tag: { name: string; value: string }) {
  return (tag.name || tag.value || "").trim().toLowerCase();
}

export async function getGpsDisabledAssetIds(
  assetIds?: Iterable<string>,
): Promise<Set<string>> {
  const assetIdSet = assetIds ? new Set(assetIds) : null;
  const tag = (await listTags()).find(
    (candidate) => tagKey(candidate) === GPS_DISABLED_TAG_NAME,
  );
  if (!tag) return new Set();

  const disabledIds = await searchAssetIdsByTag(tag.id);
  return new Set(
    assetIdSet
      ? disabledIds.filter((assetId) => assetIdSet.has(assetId))
      : disabledIds,
  );
}

export async function saveAssetGpsUsage(
  assetId: string,
  useGpsLocation: boolean,
): Promise<void> {
  const allTags = await listTags();
  const existingTag = allTags.find(
    (candidate) => tagKey(candidate) === GPS_DISABLED_TAG_NAME,
  );

  if (useGpsLocation) {
    if (existingTag) await untagAssets([assetId], [existingTag.id]);
    return;
  }

  const tag = existingTag ?? await ensureTag(GPS_DISABLED_TAG_NAME, allTags);
  await tagAssets([assetId], [tag.id]);
}
