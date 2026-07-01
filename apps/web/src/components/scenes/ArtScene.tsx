import { Suspense, useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Preload } from "@react-three/drei";
import { useGalleryStore } from "../../stores/galleryStore";
import TerrainGallery, { TerrainOverlay, type TerrainOverlayState } from "./TerrainGallery";

export default function ArtScene() {
  const fetchPhotos = useGalleryStore((s) => s.fetchPhotos);
  const photos = useGalleryStore((s) => s.photos);
  const selectedPhotoIndex = useGalleryStore((s) => s.selectedPhotoIndex);
  const selectPhoto = useGalleryStore((s) => s.selectPhoto);
  const error = useGalleryStore((s) => s.error);
  const [terrainOverlay, setTerrainOverlay] = useState<TerrainOverlayState | null>(null);

  useEffect(() => {
    fetchPhotos();
  }, [fetchPhotos]);

  const selectedPhoto = selectedPhotoIndex !== null ? photos[selectedPhotoIndex] : null;
  const selectedDescription = selectedPhoto?.exifInfo?.description?.trim();

  return (
    <div style={{ width: "100vw", height: "100vh", position: "relative" }}>
      <div style={hudStyle}>
        <a href="/admin" style={btnStyle}>
          Admin
        </a>
        <span style={photoCountStyle}>
          {photos.length > 0 && `${photos.length} photo${photos.length !== 1 ? "s" : ""}`}
        </span>
      </div>

      {error && <div style={errorStyle}>{error}</div>}

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

      <TerrainOverlay state={terrainOverlay} />

      <Canvas
        camera={{ position: [0, 0, 16], fov: 50 }}
        dpr={[1, 1.5]}
        style={{ background: "#0a0a14" }}
      >
        <ambientLight intensity={0.8} />
        <Suspense fallback={null}>
          <TerrainGallery onOverlayChange={setTerrainOverlay} />
          <OrbitControls
            makeDefault
            enableDamping
            dampingFactor={0.08}
            enablePan
            enableZoom
            screenSpacePanning
            minDistance={1.5}
            maxDistance={80}
          />
          <Preload all />
        </Suspense>
      </Canvas>
    </div>
  );
}

const hudStyle: React.CSSProperties = {
  position: "absolute",
  top: 0,
  left: 0,
  right: 0,
  zIndex: 10,
  display: "flex",
  justifyContent: "space-between",
  padding: "12px 16px",
  fontFamily: "monospace",
  fontSize: 13,
  color: "#aaa",
  pointerEvents: "none",
};

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
  textDecoration: "none",
};

const photoCountStyle: React.CSSProperties = {
  color: "#aaa",
};

const errorStyle: React.CSSProperties = {
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
