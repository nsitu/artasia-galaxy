import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGalleryStore } from "../../stores/galleryStore";
import { createGalleryLayout, getGalleryLayoutBounds } from "./galleryLayout";

export default function CameraRig({ columns = 4 }: { columns?: number }) {
  const { camera, size } = useThree();
  const target = useRef(new THREE.Vector3(0, 0, 8));
  const lookTarget = useRef(new THREE.Vector3(0, 0, 0));
  const selectedIndex = useGalleryStore((s) => s.selectedPhotoIndex);
  const photos = useGalleryStore((s) => s.photos);
  const layout = useMemo(
    () => createGalleryLayout(photos, columns),
    [photos, columns]
  );
  const bounds = useMemo(() => getGalleryLayoutBounds(layout), [layout]);

  useFrame(() => {
    if (selectedIndex !== null) {
      const selected = layout.find((item) => item.index === selectedIndex);
      const [x, y] = selected?.position ?? [0, 0, 0];

      lookTarget.current.set(x, y, 0);
      target.current.set(x, y, 3.5);
    } else {
      const aspect = size.width / Math.max(size.height, 1);
      const verticalZ = bounds.height / (2 * Math.tan(THREE.MathUtils.degToRad(25)));
      const horizontalZ = bounds.width / (2 * Math.tan(THREE.MathUtils.degToRad(25)) * aspect);
      const z = Math.max(8, verticalZ, horizontalZ);

      lookTarget.current.set(bounds.centerX, bounds.centerY, 0);
      target.current.set(bounds.centerX, bounds.centerY, z);
    }

    camera.position.lerp(target.current, 0.06);
    camera.lookAt(
      camera.position
        .clone()
        .lerp(lookTarget.current, 0.06)
    );
  });

  return null;
}
