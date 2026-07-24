import type { ImmichAsset } from "../infra/ImmichClient.js";

export const AUDIO_MEDIA_TAG = "media:audio";

export function isAudioAsset(asset: ImmichAsset) {
  return asset.type === "VIDEO" && (asset.tags ?? []).some((tag) => {
    const name = tag.name.trim().toLowerCase();
    const value = tag.value.trim().toLowerCase();
    return name === AUDIO_MEDIA_TAG || value === AUDIO_MEDIA_TAG;
  });
}

export function parseImmichDuration(value?: string | null) {
  if (!value) return 0;
  if (/^\d+(?:\.\d+)?$/.test(value.trim())) {
    return Number.parseFloat(value);
  }
  const parts = value.trim().split(":").map(Number);
  if (parts.some((part) => !Number.isFinite(part))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}
