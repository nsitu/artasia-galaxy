import { create } from "zustand";
import type { Photo } from "../api/client";
import { fetchSlideshow } from "../api/client";

type GalleryPhotoScope =
  | { mode: "regional" }
  | { mode: "placement"; placementId: number };

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
  }) => Promise<void>;
  selectPhoto: (index: number | null) => void;
}

let galleryRequestId = 0;
const placementPhotoCache = new Map<number, Photo[]>();
const placementPhotoRequests = new Map<number, Promise<Photo[]>>();

function requestPlacementPhotos(params: {
  placementId: number;
  lat: number;
  lng: number;
  radiusKm: number;
}) {
  const cached = placementPhotoCache.get(params.placementId);
  if (cached) return Promise.resolve(cached);

  const pending = placementPhotoRequests.get(params.placementId);
  if (pending) return pending;

  const request = fetchSlideshow({
    placementFocus: params,
    limit: 500,
  })
    .then((result) => {
      placementPhotoCache.set(params.placementId, result.photos);
      return result.photos;
    })
    .finally(() => {
      placementPhotoRequests.delete(params.placementId);
    });
  placementPhotoRequests.set(params.placementId, request);
  return request;
}

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
    };
    const cached = placementPhotoCache.get(params.placementId);
    set({
      photos: cached ?? [],
      photoScope: scope,
      loading: !cached,
      error: null,
      selectedPhotoIndex: null,
    });
    if (cached) return;
    try {
      const photos = await requestPlacementPhotos(params);
      if (requestId === galleryRequestId) {
        set({
          photos,
          photoScope: scope,
          loading: false,
        });
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
