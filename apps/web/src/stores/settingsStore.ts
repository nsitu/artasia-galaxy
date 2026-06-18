import { create } from "zustand";

export interface PlaybackSettings {
  autoplay: boolean;
  intervalSec: number;
  shuffle: boolean;
  seed: number;
}

export interface DisplaySettings {
  columns: number;
}

interface SettingsState {
  playback: PlaybackSettings;
  display: DisplaySettings;
  loaded: boolean;

  loadSettings: () => Promise<void>;
  updatePlayback: (partial: Partial<PlaybackSettings>) => Promise<void>;
  updateDisplay: (partial: Partial<DisplaySettings>) => Promise<void>;
  toggleAutoplay: () => Promise<void>;
  setInterval: (sec: number) => Promise<void>;
  toggleShuffle: () => Promise<void>;
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  playback: {
    autoplay: false,
    intervalSec: 5,
    shuffle: true,
    seed: Date.now(),
  },
  display: {
    columns: 4,
  },
  loaded: false,

  loadSettings: async () => {
    try {
      const res = await fetch("/api/v1/settings");
      if (res.ok) {
        const data = await res.json();
        set({ playback: data.playback, display: data.display, loaded: true });
      }
    } catch {
      set({ loaded: true });
    }
  },

  updatePlayback: async (partial) => {
    set((s) => ({ playback: { ...s.playback, ...partial } }));
    await fetch("/api/v1/settings/playback", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
  },

  updateDisplay: async (partial) => {
    set((s) => ({ display: { ...s.display, ...partial } }));
    await fetch("/api/v1/settings/display", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(partial),
    });
  },

  toggleAutoplay: async () => {
    const next = !get().playback.autoplay;
    await get().updatePlayback({ autoplay: next });
  },

  setInterval: async (intervalSec) => {
    await get().updatePlayback({ intervalSec });
  },

  toggleShuffle: async () => {
    const next = !get().playback.shuffle;
    await get().updatePlayback({ shuffle: next });
  },
}));
