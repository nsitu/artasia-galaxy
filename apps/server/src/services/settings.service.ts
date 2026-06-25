import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface PlaybackSettings {
  autoplay: boolean;
  intervalSec: number;
  shuffle: boolean;
  seed: number;
}

export interface DisplaySettings {
  columns: number;
  mode: "wall" | "terrain";
}

export interface AppSettings {
  playback: PlaybackSettings;
  display: DisplaySettings;
}

const FALLBACK_SETTINGS: AppSettings = {
  playback: {
    autoplay: false,
    intervalSec: 5,
    shuffle: true,
    seed: Date.now(),
  },
  display: {
    columns: 4,
    mode: "terrain",
  },
};

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");

function ensureDataDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function filePath(domain: string) {
  return join(DATA_DIR, `settings.${domain}.json`);
}

function readOverrides<T>(domain: string): Partial<T> {
  ensureDataDir();
  const fp = filePath(domain);
  if (!existsSync(fp)) return {};
  try {
    return JSON.parse(readFileSync(fp, "utf-8"));
  } catch {
    return {};
  }
}

function writeOverrides<T>(domain: string, data: Partial<T>) {
  ensureDataDir();
  writeFileSync(filePath(domain), JSON.stringify(data, null, 2), "utf-8");
}

export function getSettings(): AppSettings {
  const playbackOverrides = readOverrides<PlaybackSettings>("playback");
  const displayOverrides = readOverrides<DisplaySettings>("display");

  const playbackEnv: Partial<PlaybackSettings> = {};
  if (process.env.DEFAULT_AUTOPLAY) playbackEnv.autoplay = process.env.DEFAULT_AUTOPLAY === "true";
  if (process.env.DEFAULT_INTERVAL) playbackEnv.intervalSec = parseInt(process.env.DEFAULT_INTERVAL, 10);
  if (process.env.DEFAULT_SHUFFLE) playbackEnv.shuffle = process.env.DEFAULT_SHUFFLE === "true";

  return {
    playback: {
      ...FALLBACK_SETTINGS.playback,
      ...playbackEnv,
      ...playbackOverrides,
    },
    display: {
      ...FALLBACK_SETTINGS.display,
      ...displayOverrides,
    },
  };
}

export function updateSettings(
  domain: "playback" | "display",
  partial: Record<string, unknown>
) {
  const defaults = getSettings();
  const current = { ...defaults[domain] };
  const merged = { ...current, ...partial };
  writeOverrides(domain, merged as Record<string, unknown>);
  return merged;
}

export function clearSettings(domain?: string) {
  ensureDataDir();
  if (domain) {
    const fp = filePath(domain);
    if (existsSync(fp)) {
      writeFileSync(fp, "{}", "utf-8");
    }
  } else {
    for (const d of ["playback", "display"]) {
      const fp = filePath(d);
      if (existsSync(fp)) writeFileSync(fp, "{}", "utf-8");
    }
  }
}
