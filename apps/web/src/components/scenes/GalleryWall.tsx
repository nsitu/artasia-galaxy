import { useState } from "react";
import { useGalleryStore } from "../../stores/galleryStore";
import ImagePlane from "./ImagePlane";

const GAP_X = 3.0;
const GAP_Y = 2.8;

export default function GalleryWall({ columns = 4 }: { columns?: number }) {
  const photos = useGalleryStore((s) => s.photos);
  const selectedIndex = useGalleryStore((s) => s.selectedPhotoIndex);
  const selectPhoto = useGalleryStore((s) => s.selectPhoto);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  if (photos.length === 0) return null;

  return (
    <group>
      {photos.map((photo, i) => {
        const col = i % columns;
        const row = Math.floor(i / columns);
        const x = (col - (columns - 1) / 2) * GAP_X;
        const y = -(row * GAP_Y) + 1;
        const z = Math.random() * 0.5 - 0.25;

        return (
          <ImagePlane
            key={photo.id}
            url={photo.thumbnailUrl}
            width={photo.width}
            height={photo.height}
            position={[x, y, z]}
            isSelected={i === selectedIndex}
            isHighlighted={i === hoveredIndex}
            onClick={() => selectPhoto(i === selectedIndex ? null : i)}
            onPointerEnter={() => setHoveredIndex(i)}
            onPointerLeave={() => setHoveredIndex(null)}
          />
        );
      })}
    </group>
  );
}
