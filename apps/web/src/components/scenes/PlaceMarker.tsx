import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

interface Props {
  position: [number, number, number];
  placementName: string;
  heightScale?: number;
  onClick?: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

const BASE_LIFT = 0.025;
const STEM_HEIGHT = 0.34;
const TRACKING_RADIUS = 0.18;
const HEAD_RADIUS = 0.2295;
const PETAL_LOBE_COUNT = 10;
const STEM_RADIUS = 0.011;
const MAX_TILT = THREE.MathUtils.degToRad(48);
const MIN_UPWARDNESS = 0.34;
const TRACKING_EASE = 0.12;
const UP = new THREE.Vector3(0, 0, 1);

export default function PlaceMarker({
  position,
  placementName,
  heightScale,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const stemRef = useRef<THREE.Mesh>(null);
  const currentDirection = useRef(new THREE.Vector3(0, 0, 1));
  const lastStemDirection = useRef(new THREE.Vector3(0, 0, 1));
  const camera = useThree((state) => state.camera);
  const [x, y, z] = position;
  const resolvedHeightScale = useMemo(() => heightScale ?? getHeightScale(placementName), [heightScale, placementName]);
  const stemHeight = STEM_HEIGHT * resolvedHeightScale;
  const trackingRadius = TRACKING_RADIUS * resolvedHeightScale;

  const headGeometry = useMemo(() => createPetalledHeadGeometry(), []);
  const centerGeometry = useMemo(() => new THREE.CircleGeometry(HEAD_RADIUS * 0.34, 24), []);
  const baseGeometry = useMemo(() => new THREE.SphereGeometry(STEM_RADIUS * 1.45, 12, 8), []);
  const initialStemGeometry = useMemo(
    () => createInitialStemGeometry(stemHeight, trackingRadius),
    [stemHeight, trackingRadius]
  );

  useEffect(() => {
    return () => {
      headGeometry.dispose();
      centerGeometry.dispose();
      baseGeometry.dispose();
      stemRef.current?.geometry.dispose();
    };
  }, [baseGeometry, centerGeometry, headGeometry, initialStemGeometry]);

  useFrame(() => {
    const group = groupRef.current;
    const head = headRef.current;
    const stem = stemRef.current;
    if (!group || !head || !stem) return;

    const sphereCenter = new THREE.Vector3(0, 0, stemHeight);
    const cameraLocal = group.worldToLocal(camera.position.clone());
    const targetDirection = getTiltLimitedDirection(cameraLocal, sphereCenter);
    currentDirection.current.lerp(targetDirection, TRACKING_EASE).normalize();

    const headCenter = sphereCenter.clone().add(currentDirection.current.clone().multiplyScalar(trackingRadius));
    head.position.copy(headCenter);
    orientHeadToCamera(head, group, camera);

    if (lastStemDirection.current.angleTo(currentDirection.current) > 0.025) {
      const curve = createStemCurve(sphereCenter, headCenter, stemHeight);
      const nextGeometry = new THREE.TubeGeometry(curve, 18, STEM_RADIUS, 8, false);
      stem.geometry.dispose();
      stem.geometry = nextGeometry;
      lastStemDirection.current.copy(currentDirection.current);
    }
  });

  const pointerHandlers = {
    onClick: onClick
      ? (event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onClick();
        }
      : undefined,
    onPointerOver: onClick || onPointerEnter
      ? () => {
          if (onClick) document.body.style.cursor = "pointer";
          onPointerEnter?.();
        }
      : undefined,
    onPointerOut: onClick || onPointerLeave
      ? () => {
          document.body.style.cursor = "";
          onPointerLeave?.();
        }
      : undefined,
  };

  return (
    <group ref={groupRef} position={[x, y, z + BASE_LIFT]} {...pointerHandlers}>
      <mesh ref={stemRef} geometry={initialStemGeometry}>
        <meshStandardMaterial color="#49d05a" roughness={0.62} transparent opacity={0.82} />
      </mesh>
      <mesh geometry={baseGeometry}>
        <meshStandardMaterial color="#33b84a" roughness={0.72} transparent opacity={0.82} />
      </mesh>
      <group ref={headRef} position={[0, 0, stemHeight + trackingRadius]}>
        <mesh geometry={headGeometry}>
          <meshStandardMaterial
            color="#ff1f2d"
            emissive="#6a070c"
            roughness={0.55}
            transparent
            opacity={0.78}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-3}
            polygonOffsetUnits={-3}
          />
        </mesh>
        <mesh geometry={centerGeometry} position={[0, 0, 0.003]}>
          <meshStandardMaterial
            color="#8b160f"
            emissive="#2a0302"
            roughness={0.75}
            transparent
            opacity={0.84}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-4}
            polygonOffsetUnits={-4}
          />
        </mesh>
      </group>
    </group>
  );
}

function orientHeadToCamera(head: THREE.Object3D, parent: THREE.Object3D, camera: THREE.Camera) {
  const cameraWorldQuaternion = camera.getWorldQuaternion(new THREE.Quaternion());
  const parentWorldQuaternion = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  head.quaternion.copy(parentWorldQuaternion.multiply(cameraWorldQuaternion));
}

function getTiltLimitedDirection(cameraLocal: THREE.Vector3, sphereCenter: THREE.Vector3) {
  const ideal = cameraLocal.sub(sphereCenter).normalize();
  if (!Number.isFinite(ideal.x) || !Number.isFinite(ideal.y) || !Number.isFinite(ideal.z)) {
    return UP.clone();
  }

  ideal.z = Math.max(ideal.z, MIN_UPWARDNESS);
  ideal.normalize();

  const angleFromUp = UP.angleTo(ideal);
  if (angleFromUp <= MAX_TILT) return ideal;

  return UP.clone().lerp(ideal, MAX_TILT / angleFromUp).normalize();
}

function createStemCurve(sphereCenter: THREE.Vector3, headCenter: THREE.Vector3, stemHeight: number) {
  const lowerStem = new THREE.Vector3(0, 0, stemHeight * 0.48);
  const neckControl = sphereCenter.clone().lerp(headCenter, 0.42);
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    lowerStem,
    sphereCenter,
    neckControl,
    headCenter,
  ]);
}

function createPetalledHeadGeometry() {
  const shape = new THREE.Shape();
  const segmentsPerPetal = 8;
  const totalSegments = PETAL_LOBE_COUNT * segmentsPerPetal;

  for (let index = 0; index <= totalSegments; index += 1) {
    const angle = (index / totalSegments) * Math.PI * 2;
    const petalWave = (1 + Math.cos(angle * PETAL_LOBE_COUNT)) / 2;
    const radius = HEAD_RADIUS * (0.76 + petalWave * 0.24);
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;

    if (index === 0) {
      shape.moveTo(x, y);
    } else {
      shape.lineTo(x, y);
    }
  }

  shape.closePath();
  return new THREE.ShapeGeometry(shape, totalSegments);
}

function createInitialStemGeometry(stemHeight: number, trackingRadius: number) {
  const sphereCenter = new THREE.Vector3(0, 0, stemHeight);
  const headCenter = new THREE.Vector3(0, 0, stemHeight + trackingRadius);
  return new THREE.TubeGeometry(createStemCurve(sphereCenter, headCenter, stemHeight), 18, STEM_RADIUS, 8, false);
}

function getHeightScale(placementName: string) {
  const length = placementName.trim().length;
  const normalized = THREE.MathUtils.clamp((length - 8) / 40, 0, 1);
  return THREE.MathUtils.lerp(0.8, 1.2, normalized);
}
