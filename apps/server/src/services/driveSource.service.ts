export const DRIVE_SOURCE_PREFIX = "source:drive:";

/** Tag prefixes are case-insensitive; opaque Drive IDs are not. */
export function driveSourceIds(asset: { tags?: Array<{ name: string; value: string }> }) {
  return [...new Set((asset.tags ?? []).flatMap((tag) => [tag.name, tag.value])
    .map((value) => value.trim())
    .filter((value) => value.toLowerCase().startsWith(DRIVE_SOURCE_PREFIX))
    .map((value) => value.slice(DRIVE_SOURCE_PREFIX.length)).filter(Boolean))];
}

let driveWriter: string | null = null;

/** Single-server exclusion shared by automatic imports and manual Drive mutations. */
export function acquireDriveWriter(owner: string): (() => void) | null {
  if (driveWriter) return null;
  driveWriter = owner;
  return () => { if (driveWriter === owner) driveWriter = null; };
}
