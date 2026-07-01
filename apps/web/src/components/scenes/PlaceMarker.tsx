import { useMemo, useRef } from "react";
import * as THREE from "three";

interface Props {
  position: [number, number, number];
  onClick?: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

export default function PlaceMarker({
  position,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: Props) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Create the lathe geometry using useMemo to avoid recreating on every render
  const geometry = useMemo(() => {
    // Define the 2D profile of the pin (to be revolved around Y axis)
    // This creates a teardrop/pin shape similar to the place.svg marker
    const points: THREE.Vector2[] = [];
    const radius = 0.12;
    const height = 0.35;

    // Bulbous top (circular)
    for (let i = 0; i <= 8; i++) {
      const angle = (i / 8) * Math.PI;
      const x = Math.sin(angle) * radius * 1.1;
      const y = Math.cos(angle) * radius + height * 0.6;
      points.push(new THREE.Vector2(x, y));
    }

    // Tapered middle
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      const x = radius * (1.1 - t * 1.05);
      const y = height * 0.6 - t * height * 0.25;
      points.push(new THREE.Vector2(x, y));
    }

    // Sharp point at bottom
    points.push(new THREE.Vector2(0, 0));

    // Create lathe geometry by revolving the profile around the Y axis
    const lathe = new THREE.LatheGeometry(points, 32);

    // Center and rotate the geometry
    lathe.center();
    lathe.rotateZ(Math.PI / 2);

    return lathe;
  }, []);

  return (
    <group position={position}>
      <mesh
        ref={meshRef}
        geometry={geometry}
        onClick={onClick
          ? (event) => {
              event.stopPropagation();
              onClick();
            }
          : undefined}
        onPointerOver={onClick || onPointerEnter
          ? () => {
              if (onClick) document.body.style.cursor = "pointer";
              onPointerEnter?.();
            }
          : undefined}
        onPointerOut={onClick || onPointerLeave
          ? () => {
              document.body.style.cursor = "";
              onPointerLeave?.();
            }
          : undefined}
      >
        <meshStandardMaterial
          color="#ff2d2d"
          emissive="#7a0808"
          roughness={0.5}
          metalness={0.1}
        />
      </mesh>
    </group>
  );
}
