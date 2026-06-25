import { useRef, useEffect } from "react";
import { useLoader, useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface Props {
  url: string;
  width: number;
  height: number;
  position: [number, number, number];
  isSelected: boolean;
  isHighlighted: boolean;
  onClick: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

const MAX_SIZE = 2.4;

export default function ImagePlane({
  url,
  width,
  height,
  position,
  isSelected,
  isHighlighted,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: Props) {
  const meshRef = useRef<THREE.Mesh>(null);
  const texture = useLoader(THREE.TextureLoader, url);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
  }, [texture]);

  const aspect = width / height;
  let planeW: number;
  let planeH: number;

  if (aspect >= 1) {
    planeW = Math.min(MAX_SIZE, MAX_SIZE * aspect);
    planeH = planeW / aspect;
  } else {
    planeH = Math.min(MAX_SIZE, MAX_SIZE / aspect);
    planeW = planeH * aspect;
  }

  useFrame(() => {
    if (!meshRef.current) return;
    const targetScale = isHighlighted ? 1.08 : isSelected ? 1.0 : 1.0;
    meshRef.current.scale.lerp(
      new THREE.Vector3(targetScale, targetScale, 1),
      0.15
    );
  });

  return (
    <mesh
      ref={meshRef}
      position={position}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <planeGeometry args={[planeW, planeH]} />
      <meshBasicMaterial
        map={texture}
        side={THREE.DoubleSide}
        toneMapped={false}
      />
    </mesh>
  );
}
