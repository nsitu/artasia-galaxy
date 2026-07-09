import { create } from "zustand";
import type { Photo } from "../api/client";
import { fetchSlideshow } from "../api/client";

type GalleryPhotoScope =
  | { mode: "regional" }
  | { mode: "placement"; placementId: number; activityId?: number };

interface GalleryState {
  photos: Photo[];
  photoScope: GalleryPhotoScope;
  selectedPhotoIndex: number | null;
  loading: boolean;
  error: string | null;

  fetchPhotos: () => Promise<void>;
  fetchPlacementFocus: (params: {
    placementId: number;
    lat: number;
    lng: number;
    radiusKm: number;
    activityId?: number;
  }) => Promise<void>;
  selectPhoto: (index: number | null) => void;
}

let galleryRequestId = 0;

export const useGalleryStore = create<GalleryState>((set) => ({
  photos: [],
  photoScope: { mode: "regional" },
  selectedPhotoIndex: null,
  loading: false,
  error: null,

  fetchPhotos: async () => {
    const requestId = ++galleryRequestId;
    set({
      photos: [],
      photoScope: { mode: "regional" },
      loading: true,
      error: null,
      selectedPhotoIndex: null,
    });
    try {
      const result = await fetchSlideshow({});
      if (requestId === galleryRequestId) {
        set({ photos: result.photos, photoScope: { mode: "regional" }, loading: false });
      }
    } catch (err) {
      if (requestId === galleryRequestId) {
        set({ error: (err as Error).message, loading: false });
      }
    }
  },

  fetchPlacementFocus: async (params) => {
    const requestId = ++galleryRequestId;
    const scope: GalleryPhotoScope = {
      mode: "placement",
      placementId: params.placementId,
      ...(params.activityId != null ? { activityId: params.activityId } : {}),
    };
    set({ photos: [], photoScope: scope, loading: true, error: null, selectedPhotoIndex: null });
    try {
      const result = await fetchSlideshow({
        placementFocus: params,
        limit: 500,
      });
      if (requestId === galleryRequestId) {
        set({ photos: result.photos, photoScope: scope, loading: false });
      }
    } catch (err) {
      if (requestId === galleryRequestId) {
        set({ error: (err as Error).message, loading: false });
      }
    }
  },

  selectPhoto: (index) => {
    set({ selectedPhotoIndex: index });
  },
}));
