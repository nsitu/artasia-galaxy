import { Billboard } from "@react-three/drei";
import { useEffect, useRef } from "react";
import { useFrame, useLoader, useThree } from "@react-three/fiber";
import * as THREE from "three";

interface Props {
  id: string;
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

const MAX_PIN_IMAGE_SIZE = 0.95;
const PIN_HEIGHT = 1.35;
const PIN_HEIGHT_VARIATION = 0.25;
const BASE_RADIUS = 0.11;
const TIP_RADIUS = 0.012;
const PIN_OPACITY = 0.58;
const PIN_COLOR = "#eee111";
const MIN_PROXIMITY_SCALE = 0.48;
const MAX_PROXIMITY_SCALE = 1;
const CLOSE_DISTANCE = 4;
const FAR_DISTANCE = 18;
const tempVector = new THREE.Vector3();

export default function TerrainPhotoPin({
  id,
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
  const imageRef = useRef<THREE.Mesh>(null);
  const texture = useLoader(THREE.TextureLoader, url);
  const { camera } = useThree();
  const [x, y, groundZ] = position;
  const pinHeight = PIN_HEIGHT * stableRange(id, 1 - PIN_HEIGHT_VARIATION, 1 + PIN_HEIGHT_VARIATION);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
  }, [texture]);

  const aspect = width / height;
  const imageW = aspect >= 1 ? MAX_PIN_IMAGE_SIZE : MAX_PIN_IMAGE_SIZE * aspect;
  const imageH = aspect >= 1 ? MAX_PIN_IMAGE_SIZE / aspect : MAX_PIN_IMAGE_SIZE;

  useFrame(() => {
    if (!imageRef.current) return;
    const distance = camera.position.distanceTo(
      imageRef.current.getWorldPosition(tempVector)
    );
    const proximityScale = THREE.MathUtils.clamp(
      THREE.MathUtils.mapLinear(
        distance,
        CLOSE_DISTANCE,
        FAR_DISTANCE,
        MIN_PROXIMITY_SCALE,
        MAX_PROXIMITY_SCALE
      ),
      MIN_PROXIMITY_SCALE,
      MAX_PROXIMITY_SCALE
    );
    const interactionScale = isHighlighted || isSelected ? 1.14 : 1;
    const targetScale = proximityScale * interactionScale;
    imageRef.current.scale.lerp(
      new THREE.Vector3(targetScale, targetScale, 1),
      0.15
    );
  });

  return (
    <group>
      <mesh position={[x, y, groundZ + 0.02]}>
        <sphereGeometry args={[BASE_RADIUS, 16, 8]} />
        <meshStandardMaterial
          color={isSelected ? "#9df7a8" : PIN_COLOR}
          transparent
          opacity={PIN_OPACITY}
          depthWrite={false}
        />
      </mesh>

      <mesh position={[x, y, groundZ + pinHeight / 2]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[BASE_RADIUS * 0.72, pinHeight, 14]} />
        <meshStandardMaterial
          color={isSelected ? "#9df7a8" : PIN_COLOR}
          transparent
          opacity={PIN_OPACITY}
          depthWrite={false}
        />
      </mesh>

      <mesh position={[x, y, groundZ + pinHeight + TIP_RADIUS * 0.5]}>
        <sphereGeometry args={[TIP_RADIUS, 10, 6]} />
        <meshStandardMaterial
          color={isSelected ? "#9df7a8" : PIN_COLOR}
          transparent
          opacity={0.76}
          depthWrite={false}
        />
      </mesh>

      <Billboard position={[x, y, groundZ + pinHeight + imageH * 0.08]}>
        <mesh
          ref={imageRef}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
        >
          <planeGeometry args={[imageW, imageH]} />
          <meshBasicMaterial
            map={texture}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </Billboard>
    </group>
  );
}

function stableRange(seed: string, min: number, max: number) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const normalized = (Math.abs(hash) % 1000) / 999;
  return min + normalized * (max - min);
}
