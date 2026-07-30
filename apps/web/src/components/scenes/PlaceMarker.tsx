import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

interface Props {
  markerId: string;
  position: [number, number, number];
  brandColorOne?: string;
  brandColorTwo?: string;
  headPlaneZ: number;
  isSelected?: boolean;
  onClick?: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

const BASE_LIFT = 0.025;
const MIN_STEM_HEIGHT = 0.18;
const HEAD_LAYOUT_RADIUS = 0.28;
const HEAD_RADIUS = 0.2295;
const PETAL_LOBE_COUNT = 10;
const STEM_RADIUS = 0.011;
const HEAD_FULL_SCALE_DISTANCE = 8;
const HEAD_MIN_SCALE_DISTANCE = 1.6;
const HEAD_MIN_SCALE = 0.24;
const HEAD_MAX_SCALE = 1.08;
const HEAD_AGENT_PADDING_PX = 10;
const HEAD_AGENT_REPULSION = 0.5;
const HEAD_AGENT_EASE = 0.18;
const HEAD_AGENT_TETHER_EXTENSION = 1.9;
const DEFAULT_HEAD_COLOR = "#ff1f2d";
const DEFAULT_HEAD_EMISSIVE = "#6a070c";
const DEFAULT_CENTER_COLOR = "#8b160f";
const DEFAULT_CENTER_EMISSIVE = "#2a0302";
const UP = new THREE.Vector3(0, 0, 1);

export default function PlaceMarker({
  markerId,
  position,
  brandColorOne,
  brandColorTwo,
  headPlaneZ,
  isSelected = false,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const stemRef = useRef<THREE.Mesh>(null);
  const currentHeadCenter = useRef<THREE.Vector3 | null>(null);
  const lastStemDirection = useRef(new THREE.Vector3(0, 0, 1));
  const selectionScale = useRef(1);
  const selectedRotation = useRef(0);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const [x, y, z] = position;
  const flowerColors = useMemo(() => getFlowerColors(brandColorOne, brandColorTwo), [brandColorOne, brandColorTwo]);
  const stemHeight = Math.max(
    MIN_STEM_HEIGHT,
    headPlaneZ - (z + BASE_LIFT),
  );

  const headGeometry = useMemo(() => createPetalledHeadGeometry(), []);
  const centerGeometry = useMemo(() => new THREE.CircleGeometry(HEAD_RADIUS * 0.34, 24), []);
  const baseGeometry = useMemo(() => new THREE.SphereGeometry(STEM_RADIUS * 1.45, 12, 8), []);
  const initialStemGeometry = useMemo(
    () => createInitialStemGeometry(stemHeight),
    [stemHeight]
  );

  useEffect(() => {
    const state = getMarkerAgentState(markerId);
    return () => {
      headGeometry.dispose();
      centerGeometry.dispose();
      baseGeometry.dispose();
      stemRef.current?.geometry.dispose();
      markerAgents.delete(state.id);
    };
  }, [baseGeometry, centerGeometry, headGeometry, initialStemGeometry, markerId]);

  useFrame((_, delta) => {
    const group = groupRef.current;
    const head = headRef.current;
    const stem = stemRef.current;
    if (!group || !head || !stem) return;

    const planeHeadCenter = new THREE.Vector3(0, 0, stemHeight);
    const cameraLocal = group.worldToLocal(camera.position.clone());
    const cameraDistance = cameraLocal.distanceTo(planeHeadCenter);

    selectionScale.current = THREE.MathUtils.lerp(
      selectionScale.current,
      isSelected ? 1.38 : 1,
      0.14,
    );
    const headScale =
      getCameraResponsiveHeadScale(cameraDistance) * selectionScale.current;
    const resolvedHeadCenter = resolveAgentHeadCenter({
      markerId,
      group,
      camera,
      size,
      stemHeight,
      trackingRadius: HEAD_LAYOUT_RADIUS,
      headScale,
      preferredHeadCenter: planeHeadCenter,
      currentHeadCenter: currentHeadCenter.current,
    });
    currentHeadCenter.current = resolvedHeadCenter.clone();
    head.position.copy(resolvedHeadCenter);
    head.scale.setScalar(headScale);
    orientHeadToCamera(head, group, camera);
    if (isSelected) {
      selectedRotation.current =
        (selectedRotation.current + delta * 1.35) % (Math.PI * 2);
      head.rotateZ(selectedRotation.current);
    } else {
      selectedRotation.current = 0;
    }

    const stemOffset = resolvedHeadCenter
      .clone()
      .sub(new THREE.Vector3(0, 0, stemHeight));
    const stemDirection = stemOffset.lengthSq() > 0.000001
      ? stemOffset.normalize()
      : UP;
    if (
      lastStemDirection.current.angleTo(stemDirection) > 0.025 ||
      stemRef.current.geometry === initialStemGeometry
    ) {
      const curve = createStemCurve(
        new THREE.Vector3(0, 0, stemHeight),
        resolvedHeadCenter,
        stemHeight,
      );
      const nextGeometry = new THREE.TubeGeometry(curve, 18, STEM_RADIUS, 8, false);
      stem.geometry.dispose();
      stem.geometry = nextGeometry;
      lastStemDirection.current.copy(stemDirection);
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
      ? (event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          if (onClick) document.body.style.cursor = "pointer";
          onPointerEnter?.();
        }
      : undefined,
    onPointerOut: onClick || onPointerLeave
      ? (event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          document.body.style.cursor = "";
          onPointerLeave?.();
        }
      : undefined,
  };

  return (
    <group ref={groupRef} position={[x, y, z + BASE_LIFT]}>
      <mesh ref={stemRef} geometry={initialStemGeometry}>
        <meshStandardMaterial
          color={isSelected ? "#8cff98" : "#49d05a"}
          emissive={isSelected ? "#3ecf55" : "#000000"}
          emissiveIntensity={isSelected ? 0.7 : 0}
          roughness={0.62}
          transparent
          opacity={isSelected ? 1 : 0.82}
        />
      </mesh>
      <mesh geometry={baseGeometry}>
        <meshStandardMaterial
          color={isSelected ? "#79f18a" : "#33b84a"}
          emissive={isSelected ? "#2eaa43" : "#000000"}
          emissiveIntensity={isSelected ? 0.55 : 0}
          roughness={0.72}
          transparent
          opacity={isSelected ? 1 : 0.82}
        />
      </mesh>
      <group ref={headRef} position={[0, 0, stemHeight]} {...pointerHandlers}>
        <mesh geometry={headGeometry}>
          <meshStandardMaterial
            color={flowerColors.head}
            emissive={flowerColors.headEmissive}
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
            color={flowerColors.center}
            emissive={flowerColors.centerEmissive}
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

function getFlowerColors(brandColorOne?: string, brandColorTwo?: string) {
  const head = normalizeHexColor(brandColorOne) ?? DEFAULT_HEAD_COLOR;
  const center = normalizeHexColor(brandColorTwo) ?? DEFAULT_CENTER_COLOR;

  return {
    head,
    headEmissive: darkenHexColor(head, DEFAULT_HEAD_EMISSIVE),
    center,
    centerEmissive: darkenHexColor(center, DEFAULT_CENTER_EMISSIVE),
  };
}

function normalizeHexColor(value?: string) {
  const color = value?.trim();
  return color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
}

function darkenHexColor(value: string, fallback: string) {
  const color = normalizeHexColor(value);
  if (!color) return fallback;
  return new THREE.Color(color).multiplyScalar(0.38).getStyle();
}

function getCameraResponsiveHeadScale(cameraDistance: number) {
  if (!Number.isFinite(cameraDistance)) return 1;
  const t = THREE.MathUtils.smoothstep(cameraDistance, HEAD_MIN_SCALE_DISTANCE, HEAD_FULL_SCALE_DISTANCE);
  return THREE.MathUtils.lerp(HEAD_MIN_SCALE, HEAD_MAX_SCALE, t);
}

type MarkerAgentState = {
  id: string;
  screen: THREE.Vector2;
  radiusPx: number;
  world: THREE.Vector3;
};

const markerAgents = new Map<string, MarkerAgentState>();

function getMarkerAgentState(id: string) {
  let state = markerAgents.get(id);
  if (!state) {
    state = {
      id,
      screen: new THREE.Vector2(),
      radiusPx: 0,
      world: new THREE.Vector3(),
    };
    markerAgents.set(id, state);
  }
  return state;
}

function resolveAgentHeadCenter({
  markerId,
  group,
  camera,
  size,
  stemHeight,
  trackingRadius,
  headScale,
  preferredHeadCenter,
  currentHeadCenter,
}: {
  markerId: string;
  group: THREE.Group;
  camera: THREE.Camera;
  size: { width: number; height: number };
  stemHeight: number;
  trackingRadius: number;
  headScale: number;
  preferredHeadCenter: THREE.Vector3;
  currentHeadCenter: THREE.Vector3 | null;
}) {
  group.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);

  const state = getMarkerAgentState(markerId);
  const preferredWorld = group.localToWorld(preferredHeadCenter.clone());
  const preferredScreen = projectToScreen(preferredWorld, camera, size);
  const radiusPx = estimateScreenRadius(preferredWorld, HEAD_RADIUS * headScale, camera, size);
  let screenOffset = new THREE.Vector2();

  for (const other of markerAgents.values()) {
    if (other.id === markerId || other.radiusPx <= 0) continue;
    const delta = preferredScreen.clone().sub(other.screen);
    const distance = Math.max(delta.length(), 0.001);
    const minDistance = radiusPx + other.radiusPx + HEAD_AGENT_PADDING_PX;
    if (distance >= minDistance) continue;

    screenOffset.add(delta.multiplyScalar(((minDistance - distance) / distance) * HEAD_AGENT_REPULSION));
  }

  const resolvedScreen = preferredScreen.add(screenOffset);
  const resolvedWorld = screenToWorldOnCameraPlane(resolvedScreen, preferredWorld, camera, size);
  const resolvedLocal = group.worldToLocal(resolvedWorld);
  const sphereCenter = new THREE.Vector3(0, 0, stemHeight);
  const maxTether = trackingRadius * HEAD_AGENT_TETHER_EXTENSION;
  const tetherOffset = resolvedLocal.sub(sphereCenter);

  if (tetherOffset.length() > maxTether) {
    tetherOffset.setLength(maxTether);
  }

  const targetLocal = sphereCenter.add(tetherOffset);
  const easedLocal = currentHeadCenter
    ? currentHeadCenter.clone().lerp(targetLocal, HEAD_AGENT_EASE)
    : targetLocal;
  const easedWorld = group.localToWorld(easedLocal.clone());

  state.screen.copy(projectToScreen(easedWorld, camera, size));
  state.radiusPx = estimateScreenRadius(easedWorld, HEAD_RADIUS * headScale, camera, size);
  state.world.copy(easedWorld);

  return easedLocal;
}

function projectToScreen(point: THREE.Vector3, camera: THREE.Camera, size: { width: number; height: number }) {
  const projected = point.clone().project(camera);
  return new THREE.Vector2(
    ((projected.x + 1) / 2) * size.width,
    ((-projected.y + 1) / 2) * size.height
  );
}

function screenToWorldOnCameraPlane(
  screen: THREE.Vector2,
  planePoint: THREE.Vector3,
  camera: THREE.Camera,
  size: { width: number; height: number }
) {
  const ndc = new THREE.Vector3(
    (screen.x / size.width) * 2 - 1,
    -(screen.y / size.height) * 2 + 1,
    0.5
  );
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);
  const normal = camera.getWorldDirection(new THREE.Vector3());
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, planePoint);
  return raycaster.ray.intersectPlane(plane, new THREE.Vector3()) ?? planePoint.clone();
}

function estimateScreenRadius(
  center: THREE.Vector3,
  radiusWorld: number,
  camera: THREE.Camera,
  size: { width: number; height: number }
) {
  const distance = camera.position.distanceTo(center);
  if (!Number.isFinite(distance) || distance <= 0) return 0;
  if (camera instanceof THREE.PerspectiveCamera) {
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance;
    return (radiusWorld / visibleHeight) * size.height;
  }
  if (camera instanceof THREE.OrthographicCamera) {
    return (radiusWorld * camera.zoom * size.height) / (camera.top - camera.bottom);
  }
  return 0;
}

function createStemCurve(sphereCenter: THREE.Vector3, headCenter: THREE.Vector3, stemHeight: number) {
  const lowerStem = new THREE.Vector3(0, 0, stemHeight * 0.48);
  if (sphereCenter.distanceToSquared(headCenter) < 0.000001) {
    return new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      lowerStem,
      headCenter,
    ]);
  }
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

function createInitialStemGeometry(stemHeight: number) {
  const sphereCenter = new THREE.Vector3(0, 0, stemHeight);
  return new THREE.TubeGeometry(
    createStemCurve(sphereCenter, sphereCenter, stemHeight),
    18,
    STEM_RADIUS,
    8,
    false,
  );
}
