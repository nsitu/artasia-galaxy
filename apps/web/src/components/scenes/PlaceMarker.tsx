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

  // Create an extruded 3D place marker shape (coin-like with a pin point)
  const geometry = useMemo(() => {
    // Create a 2D teardrop shape (location pin)
    const shape = new THREE.Shape();

    // Create a teardrop/pin shape
    const radius = 0.12;
    const height = 0.25;

    // Start at the pointed tip
    shape.moveTo(0, -height);

    // Right side of the bulbous top (using quadratic bezier)
    shape.quadraticCurveTo(radius * 1.2, -height * 0.4, radius * 1.1, height * 0.3);

    // Top right rounded corner
    shape.quadraticCurveTo(radius * 1.15, radius * 1.1, 0, radius * 1.2);

    // Top left rounded corner
    shape.quadraticCurveTo(-radius * 1.15, radius * 1.1, -radius * 1.1, height * 0.3);

    // Left side of the bulbous top
    shape.quadraticCurveTo(-radius * 1.2, -height * 0.4, 0, -height);

    // Extrude the shape to create thickness (coin-like)
    const extrudeSettings = {
      depth: 0.08,
      bevelEnabled: true,
      bevelThickness: 0.01,
      bevelSize: 0.01,
      bevelSegments: 3,
    };

    const extruded = new THREE.ExtrudeGeometry(shape, extrudeSettings);

    // Center the geometry
    extruded.center();

    // Rotate to point downward (align pin to terrain)
    extruded.rotateX(Math.PI / 2);

    return extruded;
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
          roughness={0.4}
          metalness={0.15}
        />
      </mesh>
    </group>
  );
}
