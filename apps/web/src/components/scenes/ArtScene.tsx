import { Suspense, useEffect, useState, useRef, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Preload } from "@react-three/drei";
import { useGalleryStore } from "../../stores/galleryStore";
import { useSettingsStore } from "../../stores/settingsStore";
import GalleryWall from "./GalleryWall";
import CameraRig from "./CameraRig";
import TerrainGallery from "./TerrainGallery";
import SettingsPanel from "../ui/SettingsPanel";
import UploadPanel from "../ui/UploadPanel";

export default function ArtScene() {
  const fetchPhotos = useGalleryStore((s) => s.fetchPhotos);
  const fetchAlbumList = useGalleryStore((s) => s.fetchAlbumList);
  const photos = useGalleryStore((s) => s.photos);
  const albums = useGalleryStore((s) => s.albums);
  const selectedAlbumId = useGalleryStore((s) => s.selectedAlbumId);
  const setSelectedAlbum = useGalleryStore((s) => s.setSelectedAlbum);
  const selectedPhotoIndex = useGalleryStore((s) => s.selectedPhotoIndex);
  const nextPhoto = useGalleryStore((s) => s.nextPhoto);
  const prevPhoto = useGalleryStore((s) => s.prevPhoto);
  const selectPhoto = useGalleryStore((s) => s.selectPhoto);
  const loading = useGalleryStore((s) => s.loading);
  const error = useGalleryStore((s) => s.error);

  const playback = useSettingsStore((s) => s.playback);
  const display = useSettingsStore((s) => s.display);
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const toggleAutoplay = useSettingsStore((s) => s.toggleAutoplay);

  const [showAlbums, setShowAlbums] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const autoAdvance = useCallback(() => {
    nextPhoto();
  }, [nextPhoto]);

  useEffect(() => {
    loadSettings();
    fetchAlbumList();
    fetchPhotos();
  }, [loadSettings, fetchPhotos, fetchAlbumList]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowRight") nextPhoto();
      if (e.key === "ArrowLeft") prevPhoto();
      if (e.key === "Escape") selectPhoto(null);
      if (e.key === "a" || e.key === "A") setShowAlbums((v) => !v);
      if (e.key === "s" || e.key === "S") setShowSettings((v) => !v);
      if (e.key === " ") {
        e.preventDefault();
        toggleAutoplay();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nextPhoto, prevPhoto, selectPhoto, toggleAutoplay]);

  useEffect(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (playback.autoplay && photos.length > 0) {
      timerRef.current = setInterval(autoAdvance, playback.intervalSec * 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playback.autoplay, playback.intervalSec, photos.length, autoAdvance]);

  const albumLabel = selectedAlbumId
    ? albums.find((a) => a.id === selectedAlbumId)?.name ?? "Album"
    : "All Photos";
  const selectedPhoto =
    selectedPhotoIndex !== null ? photos[selectedPhotoIndex] : null;
  const selectedDescription = selectedPhoto?.exifInfo?.description?.trim();

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      {/* HUD overlay */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: showSettings ? 280 : 0,
          zIndex: 10,
          display: "flex",
          justifyContent: "space-between",
          padding: "12px 16px",
          fontFamily: "monospace",
          fontSize: 13,
          color: "#aaa",
          pointerEvents: "none",
        }}
      >
        <div style={{ pointerEvents: "auto", display: "flex", gap: 8 }}>
          <button
            onClick={() => setShowAlbums((v) => !v)}
            style={btnStyle}
          >
            {albumLabel} ▾
          </button>
          <button
            onClick={() => toggleAutoplay()}
            title="Space"
            style={{
              ...btnStyle,
              color: playback.autoplay ? "#8d8" : "#888",
            }}
          >
            {playback.autoplay ? "⏸" : "▶"}
          </button>
          <button
            onClick={() => setShowSettings((v) => !v)}
            title="S"
            style={btnStyle}
          >
            ⚙
          </button>
          <button
            onClick={() => setShowUpload(true)}
            style={btnStyle}
          >
            Upload
          </button>
        </div>

        <div style={{ display: "flex", gap: 12 }}>
          {selectedPhotoIndex !== null && (
            <>
              <button onClick={prevPhoto} style={btnStyle}>
                ◀ Prev
              </button>
              <button onClick={nextPhoto} style={btnStyle}>
                Next ▶
              </button>
            </>
          )}
        </div>

        <span>
          {photos.length > 0 &&
            `${photos.length} photo${photos.length !== 1 ? "s" : ""}`}
          {selectedPhotoIndex !== null &&
            ` · ${selectedPhotoIndex + 1} / ${photos.length}`}
        </span>
      </div>

      {/* Album picker dropdown */}
      {showAlbums && (
        <div style={dropdownStyle}>
          <div
            onClick={() => {
              setSelectedAlbum(null);
              setShowAlbums(false);
            }}
            style={{
              ...dropdownItemStyle,
              background: selectedAlbumId === null ? "rgba(255,255,255,0.1)" : "transparent",
              color: selectedAlbumId === null ? "#fff" : "#999",
            }}
          >
            All Photos
          </div>
          {albums.map((album) => (
            <div
              key={album.id}
              onClick={() => {
                setSelectedAlbum(album.id);
                setShowAlbums(false);
              }}
              style={{
                ...dropdownItemStyle,
                background: selectedAlbumId === album.id ? "rgba(255,255,255,0.1)" : "transparent",
                color: selectedAlbumId === album.id ? "#fff" : "#999",
              }}
            >
              {album.name}
              <span style={{ color: "#555", marginLeft: 8 }}>
                ({album.assetCount})
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Loading / error */}
      {loading && photos.length === 0 && (
        <div style={centeredStyle}>
          Loading...
        </div>
      )}
      {error && (
        <div
          style={{
            position: "absolute",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            color: "#f66",
            fontFamily: "monospace",
            fontSize: 13,
            background: "rgba(0,0,0,0.7)",
            padding: "8px 16px",
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      )}

      {selectedPhoto && (
        <div style={metadataOverlayStyle}>
          <div style={metadataTitleStyle}>{selectedPhoto.fileName}</div>
          <div style={metadataDescriptionStyle}>
            {selectedDescription || "No description metadata."}
          </div>
          <button
            onClick={() => selectPhoto(null)}
            aria-label="Close metadata"
            style={metadataCloseStyle}
          >
            x
          </button>
        </div>
      )}

      {/* Keyboard hints */}
      <div
        style={{
          position: "absolute",
          bottom: 14,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
          color: "#555",
          fontFamily: "monospace",
          fontSize: 11,
          pointerEvents: "none",
        }}
      >
        ← → navigate · Space = autoplay ({playback.intervalSec}s) · S =
        settings · A = albums
      </div>

      {/* Settings panel */}
      <SettingsPanel
        visible={showSettings}
        onClose={() => setShowSettings(false)}
      />

      <UploadPanel
        visible={showUpload}
        onClose={() => setShowUpload(false)}
      />

      <Canvas
        camera={{ position: [0, 0, 16], fov: 50 }}
        dpr={[1, 1.5]}
        style={{ background: "#0a0a14" }}
      >
        <ambientLight intensity={0.8} />
        <Suspense fallback={null}>
          {display.mode === "wall" && <GalleryWall columns={display.columns} />}
          {display.mode === "terrain" && <TerrainGallery />}
          {display.mode === "wall" && (
            <CameraRig columns={display.columns} mode={display.mode} />
          )}
          {display.mode === "terrain" && (
            <OrbitControls
              makeDefault
              enableDamping
              dampingFactor={0.08}
              enablePan
              enableZoom
              screenSpacePanning
              minDistance={3}
              maxDistance={80}
            />
          )}
          <Preload all />
        </Suspense>
      </Canvas>
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  pointerEvents: "auto",
  background: "rgba(255,255,255,0.08)",
  color: "#ccc",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 4,
  padding: "4px 12px",
  cursor: "pointer",
  fontSize: 13,
  fontFamily: "monospace",
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: 46,
  left: 16,
  zIndex: 20,
  background: "rgba(20,20,30,0.95)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 6,
  padding: 8,
  minWidth: 200,
  maxHeight: 300,
  overflowY: "auto",
  fontFamily: "monospace",
  fontSize: 13,
};

const dropdownItemStyle: React.CSSProperties = {
  padding: "6px 12px",
  cursor: "pointer",
  borderRadius: 3,
};

const centeredStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 10,
  color: "#888",
  fontFamily: "monospace",
  pointerEvents: "none",
};

const metadataOverlayStyle: React.CSSProperties = {
  position: "absolute",
  left: 16,
  bottom: 42,
  zIndex: 14,
  width: "min(420px, calc(100vw - 32px))",
  maxHeight: "32vh",
  overflowY: "auto",
  background: "rgba(10,10,20,0.88)",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 6,
  padding: "12px 40px 12px 14px",
  color: "#ddd",
  fontFamily: "monospace",
  fontSize: 13,
  lineHeight: 1.45,
};

const metadataTitleStyle: React.CSSProperties = {
  color: "#fff",
  fontSize: 12,
  marginBottom: 6,
  overflowWrap: "anywhere",
};

const metadataDescriptionStyle: React.CSSProperties = {
  color: "#bbb",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

const metadataCloseStyle: React.CSSProperties = {
  position: "absolute",
  top: 8,
  right: 8,
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 4,
  color: "#aaa",
  cursor: "pointer",
  fontFamily: "monospace",
  fontSize: 12,
  width: 24,
  height: 24,
};
