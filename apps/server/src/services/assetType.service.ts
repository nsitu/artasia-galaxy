export const ASSET_TYPE_TAG_PREFIX = "asset_type:";

export type AssetType = "artwork" | "process";

export function parseAssetTypeTagValue(value: string): AssetType | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === `${ASSET_TYPE_TAG_PREFIX}process`) return "process";
  if (normalized === `${ASSET_TYPE_TAG_PREFIX}artwork`) return "artwork";
  return null;
}

export function getAssetTypeFromTagValues(values: string[]): AssetType {
  const parsed = values
    .map(parseAssetTypeTagValue)
    .filter((value): value is AssetType => value !== null);
  return parsed.includes("process") ? "process" : "artwork";
}

export function assetTypeTag(type: AssetType): string {
  return `${ASSET_TYPE_TAG_PREFIX}${type}`;
}
