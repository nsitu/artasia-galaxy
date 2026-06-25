import { useMemo, useState } from "react";
import { useGalleryStore } from "../../stores/galleryStore";
import ImagePlane from "./ImagePlane";
import { createGalleryLayout } from "./galleryLayout";

export default function GalleryWall({ columns = 4 }: { columns?: number }) {
  const photos = useGalleryStore((s) => s.photos);
  const selectedIndex = useGalleryStore((s) => s.selectedPhotoIndex);
  const selectPhoto = useGalleryStore((s) => s.selectPhoto);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const layout = useMemo(
    () => createGalleryLayout(photos, columns),
    [photos, columns]
  );

  if (photos.length === 0) return null;

  return (
    <group>
      {layout.map(({ photo, index, position }) => {
        return (
          <ImagePlane
            key={photo.id}
            url={photo.thumbnailUrl}
            width={photo.width}
            height={photo.height}
            position={position}
            isSelected={index === selectedIndex}
            isHighlighted={index === hoveredIndex}
            onClick={() => selectPhoto(index === selectedIndex ? null : index)}
            onPointerEnter={() => setHoveredIndex(index)}
            onPointerLeave={() => setHoveredIndex(null)}
          />
        );
      })}
    </group>
  );
}
