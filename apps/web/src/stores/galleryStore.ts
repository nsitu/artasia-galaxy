import { create } from "zustand";
import type { Photo } from "../api/client";
import { fetchSlideshow } from "../api/client";

interface GalleryState {
  photos: Photo[];
  selectedPhotoIndex: number | null;
  loading: boolean;
  error: string | null;

  fetchPhotos: () => Promise<void>;
  fetchPlacementFocus: (params: {
    placementId: number;
    lat: number;
    lng: number;
    radiusKm: number;
  }) => Promise<void>;
  selectPhoto: (index: number | null) => void;
}

export const useGalleryStore = create<GalleryState>((set) => ({
  photos: [],
  selectedPhotoIndex: null,
  loading: false,
  error: null,

  fetchPhotos: async () => {
    set({ loading: true, error: null });
    try {
      const result = await fetchSlideshow({});
      set({ photos: result.photos, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  fetchPlacementFocus: async (params) => {
    set({ loading: true, error: null, selectedPhotoIndex: null });
    try {
      const result = await fetchSlideshow({
        placementFocus: params,
        limit: 500,
      });
      set({ photos: result.photos, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  selectPhoto: (index) => {
    set({ selectedPhotoIndex: index });
  },
}));
