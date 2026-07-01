import { useEffect, useMemo } from "react";
import { useLoader } from "@react-three/fiber";
import * as THREE from "three";

interface Props {
  position: [number, number, number];
  logoUrl?: string;
  onClick?: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

export default function PlaceMarker({
  position,
  logoUrl,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: Props) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    const scale = 0.0385;

    // Scaled from the provided 24x24 SVG path. The bottom point is kept at
    // local origin so the marker's pin aligns with the placement coordinate.
    const p = (x: number, y: number) => new THREE.Vector2((x - 12) * scale, (22 - y) * scale);
    const start = p(12.0000002, 22);
    shape.moveTo(start.x, start.y);
    shape.bezierCurveTo(
      p(9.3166666, 19.7166668).x,
      p(9.3166666, 19.7166668).y,
      p(7.3125001, 17.5958335).x,
      p(7.3125001, 17.5958335).y,
      p(5.9875001, 15.6374999).x,
      p(5.9875001, 15.6374999).y
    );
    shape.bezierCurveTo(
      p(4.6625001, 13.6791663).x,
      p(4.6625001, 13.6791663).y,
      p(4, 11.8666662).x,
      p(4, 11.8666662).y,
      p(4, 10.1999998).x,
      p(4, 10.1999998).y
    );
    shape.bezierCurveTo(
      p(4, 7.6999998).x,
      p(4, 7.6999998).y,
      p(4.8041668, 5.7083326).x,
      p(4.8041668, 5.7083326).y,
      p(6.4125, 4.2249997).x,
      p(6.4125, 4.2249997).y
    );
    shape.bezierCurveTo(
      p(8.0208336, 2.7416669).x,
      p(8.0208336, 2.7416669).y,
      p(9.8833336, 2).x,
      p(9.8833336, 2).y,
      p(12.0000002, 2).x,
      p(12.0000002, 2).y
    );
    shape.bezierCurveTo(
      p(14.1166674, 2).x,
      p(14.1166674, 2).y,
      p(15.9791674, 2.7416672).x,
      p(15.9791674, 2.7416672).y,
      p(17.5875003, 4.2250001).x,
      p(17.5875003, 4.2250001).y
    );
    shape.bezierCurveTo(
      p(19.1958333, 5.7083328).x,
      p(19.1958333, 5.7083328).y,
      p(20.0000003, 7.6999997).x,
      p(20.0000003, 7.6999997).y,
      p(20.0000003, 10.1999998).x,
      p(20.0000003, 10.1999998).y
    );
    shape.bezierCurveTo(
      p(20.0000003, 11.8666662).x,
      p(20.0000003, 11.8666662).y,
      p(19.3375003, 13.6791664).x,
      p(19.3375003, 13.6791664).y,
      p(18.0125003, 15.6374999).x,
      p(18.0125003, 15.6374999).y
    );
    shape.bezierCurveTo(
      p(16.6875003, 17.5958334).x,
      p(16.6875003, 17.5958334).y,
      p(14.6833332, 19.7166669).x,
      p(14.6833332, 19.7166669).y,
      start.x,
      start.y
    );

    const markerGeometry = new THREE.ExtrudeGeometry(shape, {
      depth: 0.04,
      bevelEnabled: true,
      bevelThickness: 0.006,
      bevelSize: 0.006,
      bevelSegments: 2,
    });
    markerGeometry.rotateX(Math.PI / 2);
    markerGeometry.translate(0, 0, 0.012);
    return markerGeometry;
  }, []);
  const [x, y, z] = position;

  return (
    <group position={[x, y, z + 0.03]}>
      <mesh
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
          color="#ffffff"
          emissive="#141414"
          roughness={0.55}
          metalness={0.05}
          transparent
          opacity={0.75}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
      {logoUrl && <PartnerLogoTexture url={logoUrl} />}
    </group>
  );
}

function PartnerLogoTexture({ url }: { url: string }) {
  const texture = useLoader(THREE.TextureLoader, url);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
  }, [texture]);

  return (
    <mesh position={[0, -0.026, 0.48]} rotation={[Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.36, 0.18]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={0.95}
        toneMapped={false}
        polygonOffset
        polygonOffsetFactor={-4}
        polygonOffsetUnits={-4}
      />
    </mesh>
  );
}
