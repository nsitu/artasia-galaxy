import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

interface Props {
  markerId: string;
  position: [number, number, number];
  brandColorOne?: string;
  brandColorTwo?: string;
  isForked?: boolean;
  clusterIndex?: number;
  clusterCount?: number;
  isSelected?: boolean;
  onClick?: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

const BASE_LIFT = 0.025;
const MIN_STEM_HEIGHT = 0.38;
const MAX_STEM_HEIGHT = 0.92;
const CLUSTER_FORK_HEIGHT = 0.3;
const CLUSTER_BASE_STEM_HEIGHT = 0.72;
const HEAD_RADIUS = 0.2295;
const PETAL_LOBE_COUNT = 10;
const STEM_RADIUS = 0.011;
const SELECTED_STEM_RADIUS_MULTIPLIER = 1.3;
const HEAD_FULL_SCALE_DISTANCE = 8;
const HEAD_MIN_SCALE_DISTANCE = 1.6;
const HEAD_MIN_SCALE = 0.24;
const HEAD_MAX_SCALE = 1.08;
const HEAD_AGENT_PADDING_PX = 10;
const HEAD_AGENT_REPULSION = 0.62;
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
  isForked = false,
  clusterIndex = 0,
  clusterCount = 1,
  isSelected = false,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const stemRef = useRef<THREE.Mesh>(null);
  const currentHeadCenter = useRef<THREE.Vector3 | null>(null);
  const lastStemAttachment = useRef<THREE.Vector3 | null>(null);
  const lastStemRadius = useRef(0);
  const selectionScale = useRef(1);
  const selectedRotation = useRef(0);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const [x, y, z] = position;
  const flowerColors = useMemo(() => getFlowerColors(brandColorOne, brandColorTwo), [brandColorOne, brandColorTwo]);
  const clusterLane = clusterIndex - (clusterCount - 1) / 2;
  const rendersClusterTrunk = !isForked || clusterIndex === 0;
  const stemHeight = useMemo(() => {
    if (!isForked) return getNaturalStemHeight(markerId);
    const distanceFromCenter = Math.abs(clusterLane);
    return THREE.MathUtils.clamp(
      CLUSTER_BASE_STEM_HEIGHT - distanceFromCenter * 0.08,
      0.54,
      MAX_STEM_HEIGHT,
    );
  }, [clusterLane, isForked, markerId]);
  const headLayoutRadius = THREE.MathUtils.clamp(
    stemHeight * 0.72,
    0.3,
    0.7,
  );
  const stemRadius = STEM_RADIUS * (
    isSelected ? SELECTED_STEM_RADIUS_MULTIPLIER : 1
  );

  const headGeometry = useMemo(() => createPetalledHeadGeometry(), []);
  const centerGeometry = useMemo(() => new THREE.CircleGeometry(HEAD_RADIUS * 0.34, 24), []);
  const baseGeometry = useMemo(() => new THREE.SphereGeometry(STEM_RADIUS * 1.45, 12, 8), []);
  const initialStemGeometry = useMemo(
    () => createInitialStemGeometry(
      stemHeight,
      isForked,
      rendersClusterTrunk,
      STEM_RADIUS,
    ),
    [isForked, rendersClusterTrunk, stemHeight]
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

    const naturalHeadCenter = new THREE.Vector3(0, 0, stemHeight);
    const cameraLocal = group.worldToLocal(camera.position.clone());
    const cameraDistance = cameraLocal.distanceTo(naturalHeadCenter);
    const anchorIsVisible = isAnchorInsideViewport(group, camera);

    selectionScale.current = THREE.MathUtils.lerp(
      selectionScale.current,
      isSelected ? 1.38 : 1,
      0.14,
    );
    const headScale =
      getCameraResponsiveHeadScale(cameraDistance) * selectionScale.current;
    const preferredHeadCenter = naturalHeadCenter.clone();
    if (isForked && clusterCount > 1) {
      const cameraWorldQuaternion = camera.getWorldQuaternion(
        new THREE.Quaternion(),
      );
      const groupWorldQuaternion = group
        .getWorldQuaternion(new THREE.Quaternion())
        .invert();
      const cameraLocalQuaternion =
        groupWorldQuaternion.multiply(cameraWorldQuaternion);
      const cameraRight = new THREE.Vector3(1, 0, 0)
        .applyQuaternion(cameraLocalQuaternion)
        .normalize();
      preferredHeadCenter.addScaledVector(
        cameraRight,
        clusterLane * HEAD_RADIUS * headScale * 2.55,
      );
    }
    const resolvedHeadCenter = resolveAgentHeadCenter({
      markerId,
      group,
      camera,
      size,
      stemHeight,
      trackingRadius: headLayoutRadius,
      headScale,
      preferredHeadCenter,
      currentHeadCenter: currentHeadCenter.current,
      arrangeForCamera: anchorIsVisible,
    });
    currentHeadCenter.current = resolvedHeadCenter.clone();
    head.position.copy(resolvedHeadCenter);
    head.scale.setScalar(headScale);
    orientHeadToCamera(head, group, camera);
    const headUp = new THREE.Vector3(0, 1, 0)
      .applyQuaternion(head.quaternion)
      .normalize();
    const stemAttachment = resolvedHeadCenter
      .clone()
      .addScaledVector(headUp, -HEAD_RADIUS * headScale * 0.72);
    if (isSelected) {
      selectedRotation.current =
        (selectedRotation.current + delta * 1.35) % (Math.PI * 2);
      head.rotateZ(selectedRotation.current);
    } else {
      selectedRotation.current = 0;
    }

    if (
      !lastStemAttachment.current ||
      lastStemAttachment.current.distanceToSquared(stemAttachment) > 0.000025 ||
      lastStemRadius.current !== stemRadius ||
      stemRef.current.geometry === initialStemGeometry
    ) {
      const curve = createStemCurve(
        stemAttachment,
        headUp,
        stemHeight,
        isForked,
        rendersClusterTrunk,
      );
      const nextGeometry = new THREE.TubeGeometry(curve, 24, stemRadius, 8, false);
      stem.geometry.dispose();
      stem.geometry = nextGeometry;
      lastStemAttachment.current = stemAttachment.clone();
      lastStemRadius.current = stemRadius;
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
      <mesh ref={stemRef} geometry={initialStemGeometry} renderOrder={1}>
        <meshStandardMaterial
          color={isSelected ? "#8cff98" : "#49d05a"}
          emissive={isSelected ? "#3ecf55" : "#000000"}
          emissiveIntensity={isSelected ? 0.7 : 0}
          roughness={0.62}
          transparent={false}
          opacity={1}
          depthWrite={false}
        />
      </mesh>
      {rendersClusterTrunk && <mesh geometry={baseGeometry} renderOrder={1}>
        <meshStandardMaterial
          color={isSelected ? "#79f18a" : "#33b84a"}
          emissive={isSelected ? "#2eaa43" : "#000000"}
          emissiveIntensity={isSelected ? 0.55 : 0}
          roughness={0.72}
          transparent={false}
          opacity={1}
        />
      </mesh>}
      <group ref={headRef} position={[0, 0, stemHeight]} {...pointerHandlers}>
        <mesh geometry={headGeometry} renderOrder={3}>
          <meshStandardMaterial
            color={flowerColors.head}
            emissive={flowerColors.headEmissive}
            roughness={0.55}
            transparent={false}
            opacity={1}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-3}
            polygonOffsetUnits={-3}
          />
        </mesh>
        <mesh geometry={centerGeometry} position={[0, 0, 0.003]} renderOrder={4}>
          <meshStandardMaterial
            color={flowerColors.center}
            emissive={flowerColors.centerEmissive}
            roughness={0.75}
            transparent={false}
            opacity={1}
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
  arrangeForCamera,
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
  arrangeForCamera: boolean;
}) {
  group.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);

  const state = getMarkerAgentState(markerId);
  const preferredWorld = group.localToWorld(preferredHeadCenter.clone());
  const preferredScreen = projectToScreen(preferredWorld, camera, size);
  const radiusPx = estimateScreenRadius(preferredWorld, HEAD_RADIUS * headScale, camera, size);
  if (!arrangeForCamera) {
    const easedLocal = currentHeadCenter
      ? currentHeadCenter.clone().lerp(preferredHeadCenter, HEAD_AGENT_EASE)
      : preferredHeadCenter.clone();
    const easedWorld = group.localToWorld(easedLocal.clone());
    state.screen.copy(projectToScreen(easedWorld, camera, size));
    state.radiusPx = 0;
    state.world.copy(easedWorld);
    return easedLocal;
  }
  let screenOffset = new THREE.Vector2();

  for (const other of markerAgents.values()) {
    if (other.id === markerId || other.radiusPx <= 0) continue;
    const delta = preferredScreen.clone().sub(other.screen);
    let distance = delta.length();
    if (distance < 0.001) {
      const angle = getStableMarkerAngle(markerId);
      delta.set(Math.cos(angle), Math.sin(angle));
      distance = 1;
    }
    const minDistance = radiusPx + other.radiusPx + HEAD_AGENT_PADDING_PX;
    if (distance >= minDistance) continue;

    const direction = delta.divideScalar(distance);
    const upwardPreference = new THREE.Vector2(
      direction.x >= 0 ? 0.34 : -0.34,
      -1,
    ).normalize();
    direction.lerp(upwardPreference, 0.38).normalize();
    screenOffset.add(
      direction.multiplyScalar(
        (minDistance - distance) * HEAD_AGENT_REPULSION,
      ),
    );
  }

  const resolvedScreen = preferredScreen.add(screenOffset);
  const viewportPadding = radiusPx + 8;
  resolvedScreen.set(
    THREE.MathUtils.clamp(
      resolvedScreen.x,
      viewportPadding,
      Math.max(viewportPadding, size.width - viewportPadding),
    ),
    THREE.MathUtils.clamp(
      resolvedScreen.y,
      viewportPadding,
      Math.max(viewportPadding, size.height - viewportPadding),
    ),
  );
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

function isAnchorInsideViewport(group: THREE.Group, camera: THREE.Camera) {
  group.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  const anchorNdc = group
    .localToWorld(new THREE.Vector3(0, 0, 0))
    .project(camera);
  return (
    anchorNdc.z >= -1 &&
    anchorNdc.z <= 1 &&
    anchorNdc.x >= -1 &&
    anchorNdc.x <= 1 &&
    anchorNdc.y >= -1 &&
    anchorNdc.y <= 1
  );
}

function getStableMarkerAngle(markerId: string) {
  return getStableUnit(markerId) * Math.PI * 2;
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

function createStemCurve(
  attachment: THREE.Vector3,
  headUp: THREE.Vector3,
  stemHeight: number,
  isForked = false,
  includeClusterTrunk = true,
) {
  const base = new THREE.Vector3(0, 0, 0);
  const lowerControl = new THREE.Vector3(0, 0, stemHeight * 0.34);
  const upperControlDistance = THREE.MathUtils.clamp(
    stemHeight * 0.28,
    0.12,
    0.3,
  );
  const upperControl = attachment
    .clone()
    .addScaledVector(headUp, -upperControlDistance);

  if (isForked) {
    const forkHeight = Math.min(CLUSTER_FORK_HEIGHT, stemHeight * 0.56);
    const forkPoint = new THREE.Vector3(0, 0, forkHeight);
    const trunk = new THREE.CubicBezierCurve3(
      base,
      new THREE.Vector3(0, 0, forkHeight * 0.3),
      new THREE.Vector3(0, 0, forkHeight * 0.76),
      forkPoint,
    );
    const branch = new THREE.CubicBezierCurve3(
      forkPoint,
      forkPoint.clone().addScaledVector(
        UP,
        THREE.MathUtils.clamp(stemHeight * 0.28, 0.14, 0.24),
      ),
      upperControl,
      attachment,
    );
    const curve = new THREE.CurvePath<THREE.Vector3>();
    if (includeClusterTrunk) curve.add(trunk);
    curve.add(branch);
    return curve;
  }

  return new THREE.CubicBezierCurve3(
    base,
    lowerControl,
    upperControl,
    attachment,
  );
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

function createInitialStemGeometry(
  stemHeight: number,
  isForked: boolean,
  includeClusterTrunk: boolean,
  stemRadius: number,
) {
  const attachment = new THREE.Vector3(
    0,
    0,
    stemHeight - HEAD_RADIUS * 0.72,
  );
  return new THREE.TubeGeometry(
    createStemCurve(
      attachment,
      UP,
      stemHeight,
      isForked,
      includeClusterTrunk,
    ),
    24,
    stemRadius,
    8,
    false,
  );
}

function getNaturalStemHeight(markerId: string) {
  const unit = getStableUnit(markerId);
  const eased = THREE.MathUtils.smoothstep(unit, 0, 1);
  return THREE.MathUtils.lerp(MIN_STEM_HEIGHT, MAX_STEM_HEIGHT, eased);
}

function getStableUnit(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16777619);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967295;
}
