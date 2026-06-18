import { create } from "zustand";
import type { Photo, Album } from "../api/client";
import { fetchSlideshow, fetchAlbums } from "../api/client";

interface GalleryState {
  photos: Photo[];
  albums: Album[];
  selectedAlbumId: string | null;
  selectedPhotoIndex: number | null;
  loading: boolean;
  error: string | null;

  fetchPhotos: (albumId?: string) => Promise<void>;
  fetchAlbumList: () => Promise<void>;
  selectPhoto: (index: number | null) => void;
  nextPhoto: () => void;
  prevPhoto: () => void;
  setSelectedAlbum: (albumId: string | null) => void;
}

export const useGalleryStore = create<GalleryState>((set, get) => ({
  photos: [],
  albums: [],
  selectedAlbumId: null,
  selectedPhotoIndex: null,
  loading: false,
  error: null,

  fetchPhotos: async (albumId) => {
    set({ loading: true, error: null });
    try {
      const albumIds = albumId ? [albumId] : undefined;
      const result = await fetchSlideshow({ albumIds });
      set({ photos: result.photos, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  fetchAlbumList: async () => {
    try {
      const albums = await fetchAlbums();
      set({ albums });
    } catch {
      // non-critical — gallery still works without albums
    }
  },

  selectPhoto: (index) => {
    set({ selectedPhotoIndex: index });
  },

  nextPhoto: () => {
    const { photos, selectedPhotoIndex } = get();
    if (photos.length === 0) return;
    const next =
      selectedPhotoIndex === null
        ? 0
        : (selectedPhotoIndex + 1) % photos.length;
    set({ selectedPhotoIndex: next });
  },

  prevPhoto: () => {
    const { photos, selectedPhotoIndex } = get();
    if (photos.length === 0) return;
    const prev =
      selectedPhotoIndex === null
        ? 0
        : (selectedPhotoIndex - 1 + photos.length) % photos.length;
    set({ selectedPhotoIndex: prev });
  },

  setSelectedAlbum: (albumId) => {
    set({ selectedAlbumId: albumId });
    get().fetchPhotos(albumId ?? undefined);
  },
}));
