import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useGalleryStore } from "../../stores/galleryStore";

const GAP_X = 3.0;
const GAP_Y = 2.8;

export default function CameraRig({ columns = 4 }: { columns?: number }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(0, 0, 8));
  const lookTarget = useRef(new THREE.Vector3(0, 0, 0));
  const selectedIndex = useGalleryStore((s) => s.selectedPhotoIndex);

  useFrame(() => {
    if (selectedIndex !== null) {
      const col = selectedIndex % columns;
      const row = Math.floor(selectedIndex / columns);
      const x = (col - (columns - 1) / 2) * GAP_X;
      const y = -(row * GAP_Y) + 1;

      lookTarget.current.set(x, y, 0);
      target.current.set(x, y, 3.5);
    } else {
      lookTarget.current.set(0, 0, 0);
      target.current.set(0, 0, 8);
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
