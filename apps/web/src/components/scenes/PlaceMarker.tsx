import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

interface Props {
  markerId: string;
  stemColorSeed?: string;
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
const HEAD_NEAR_SCALE_DISTANCE = 2;
const HEAD_FAR_SCALE_DISTANCE = 14;
const HEAD_NEAR_SCREEN_RADIUS_PX = 30;
const HEAD_FAR_SCREEN_RADIUS_PX = 16;
const HEAD_AGENT_PADDING_PX = 10;
const HEAD_AGENT_EASE = 0.18;
const HEAD_AGENT_TETHER_EXTENSION = 1.9;
const DEFAULT_HEAD_COLOR = "#ff1f2d";
const DEFAULT_HEAD_EMISSIVE = "#6a070c";
const DEFAULT_CENTER_COLOR = "#8b160f";
const DEFAULT_CENTER_EMISSIVE = "#2a0302";
const UP = new THREE.Vector3(0, 0, 1);

export default function PlaceMarker({
  markerId,
  stemColorSeed,
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
  const lastIncludesClusterTrunk = useRef<boolean | null>(null);
  const currentStemHeight = useRef<number | null>(null);
  const selectionScale = useRef(1);
  const selectedRotation = useRef(0);
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const [x, y, z] = position;
  const flowerColors = useMemo(() => getFlowerColors(brandColorOne, brandColorTwo), [brandColorOne, brandColorTwo]);
  const clusterLane = clusterIndex - (clusterCount - 1) / 2;
  const rendersClusterTrunk = !isForked || clusterIndex === 0;
  const includesActiveClusterTrunk = rendersClusterTrunk || isSelected;
  const baseStemHeight = useMemo(() => {
    if (!isForked) return getNaturalStemHeight(markerId);
    const distanceFromCenter = Math.abs(clusterLane);
    return THREE.MathUtils.clamp(
      CLUSTER_BASE_STEM_HEIGHT - distanceFromCenter * 0.08,
      0.54,
      MAX_STEM_HEIGHT,
    );
  }, [clusterLane, isForked, markerId]);
  const headLayoutRadius = THREE.MathUtils.clamp(
    baseStemHeight * 0.72,
    0.3,
    0.7,
  );
  const stemRadius = STEM_RADIUS * (
    isSelected ? SELECTED_STEM_RADIUS_MULTIPLIER : 1
  );
  const stemColors = useMemo(
    () => getStemColors(stemColorSeed ?? markerId, isSelected),
    [isSelected, markerId, stemColorSeed],
  );

  const headGeometry = useMemo(() => createPetalledHeadGeometry(), []);
  const centerGeometry = useMemo(() => new THREE.CircleGeometry(HEAD_RADIUS * 0.34, 24), []);
  const baseGeometry = useMemo(() => new THREE.SphereGeometry(STEM_RADIUS * 1.45, 12, 8), []);
  const initialStemGeometry = useMemo(
    () => createInitialStemGeometry(
      baseStemHeight,
      isForked,
      rendersClusterTrunk,
      STEM_RADIUS,
    ),
    [baseStemHeight, isForked, rendersClusterTrunk]
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

    const anchorNdc = getAnchorNdc(group, camera);
    const anchorScreenY = ((1 - anchorNdc.y) / 2) * size.height;
    const upperViewportProgress = THREE.MathUtils.smoothstep(
      anchorScreenY / Math.max(1, size.height),
      0.12,
      0.38,
    );
    const targetStemHeight =
      baseStemHeight *
      THREE.MathUtils.lerp(0.6, 1, upperViewportProgress);
    currentStemHeight.current = currentStemHeight.current === null
      ? targetStemHeight
      : THREE.MathUtils.lerp(
          currentStemHeight.current,
          targetStemHeight,
          0.12,
        );
    const stemHeight = currentStemHeight.current;
    const naturalHeadCenter = new THREE.Vector3(0, 0, stemHeight);
    const cameraLocal = group.worldToLocal(camera.position.clone());
    const cameraDistance = cameraLocal.distanceTo(naturalHeadCenter);
    const anchorIsVisible = isNdcInsideViewport(anchorNdc);
    const adaptiveHeadLayoutRadius = THREE.MathUtils.clamp(
      stemHeight * 0.72,
      0.3,
      headLayoutRadius,
    );

    selectionScale.current = THREE.MathUtils.lerp(
      selectionScale.current,
      isSelected ? 1.38 : 1,
      0.14,
    );
    const headScale =
      getCameraResponsiveHeadScale(
        cameraDistance,
        camera,
        size.height,
      ) * selectionScale.current;
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
      trackingRadius: adaptiveHeadLayoutRadius,
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
      lastIncludesClusterTrunk.current !== includesActiveClusterTrunk ||
      stemRef.current.geometry === initialStemGeometry
    ) {
      const curve = createStemCurve(
        stemAttachment,
        headUp,
        stemHeight,
        isForked,
        includesActiveClusterTrunk,
        THREE.MathUtils.lerp(0.25, 0.68, upperViewportProgress),
      );
      const nextGeometry = new THREE.TubeGeometry(curve, 24, stemRadius, 8, false);
      stem.geometry.dispose();
      stem.geometry = nextGeometry;
      lastStemAttachment.current = stemAttachment.clone();
      lastStemRadius.current = stemRadius;
      lastIncludesClusterTrunk.current = includesActiveClusterTrunk;
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
          color={stemColors.stem}
          emissive={stemColors.stemEmissive}
          emissiveIntensity={isSelected ? 0.7 : 0}
          roughness={0.62}
          transparent={false}
          opacity={1}
          depthWrite={false}
        />
      </mesh>
      {includesActiveClusterTrunk && <mesh geometry={baseGeometry} renderOrder={2}>
        <meshStandardMaterial
          color={stemColors.base}
          emissive={stemColors.baseEmissive}
          emissiveIntensity={isSelected ? 0.55 : 0}
          roughness={0.72}
          transparent={false}
          opacity={1}
          depthTest={false}
        />
      </mesh>}
      <group ref={headRef} position={[0, 0, baseStemHeight]} {...pointerHandlers}>
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

function getCameraResponsiveHeadScale(
  cameraDistance: number,
  camera: THREE.Camera,
  viewportHeight: number,
) {
  if (!Number.isFinite(cameraDistance)) return 1;
  const distanceProgress = THREE.MathUtils.smoothstep(
    cameraDistance,
    HEAD_NEAR_SCALE_DISTANCE,
    HEAD_FAR_SCALE_DISTANCE,
  );
  const desiredRadiusPx = THREE.MathUtils.lerp(
    HEAD_NEAR_SCREEN_RADIUS_PX,
    HEAD_FAR_SCREEN_RADIUS_PX,
    distanceProgress,
  );
  if (camera instanceof THREE.PerspectiveCamera) {
    const visibleHeight =
      2 *
      Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) *
      cameraDistance;
    return THREE.MathUtils.clamp(
      (desiredRadiusPx * visibleHeight) /
        Math.max(1, viewportHeight) /
        HEAD_RADIUS,
      0.18,
      1.4,
    );
  }
  return 1;
}

function getStemColors(markerId: string, isSelected: boolean) {
  // Keep stems recognisably green, but give neighbouring markers a stable,
  // subtle hue shift so their paths remain legible when they overlap.
  const hash = hashString(markerId);
  const hue = 0.34 + ((hash % 17) - 8) * 0.0045;
  const brightness = 0.72 + ((hash >>> 8) % 29) / 100;
  const stem = new THREE.Color().setHSL(
    hue,
    isSelected ? 0.62 : 0.72,
    (isSelected ? 0.7 : 0.39) * brightness,
  );
  const base = stem.clone().multiplyScalar(isSelected ? 0.9 : 0.82);
  return {
    stem: stem.getStyle(),
    stemEmissive: isSelected ? stem.clone().multiplyScalar(0.35).getStyle() : "#000000",
    base: base.getStyle(),
    baseEmissive: isSelected ? base.clone().multiplyScalar(0.32).getStyle() : "#000000",
  };
}

function hashString(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

type MarkerAgentState = {
  id: string;
  preferredScreen: THREE.Vector2;
  targetScreen: THREE.Vector2;
  screen: THREE.Vector2;
  radiusPx: number;
  world: THREE.Vector3;
  visible: boolean;
  hasTarget: boolean;
};

const markerAgents = new Map<string, MarkerAgentState>();

function getMarkerAgentState(id: string) {
  let state = markerAgents.get(id);
  if (!state) {
    state = {
      id,
      preferredScreen: new THREE.Vector2(),
      targetScreen: new THREE.Vector2(),
      screen: new THREE.Vector2(),
      radiusPx: 0,
      world: new THREE.Vector3(),
      visible: false,
      hasTarget: false,
    };
    markerAgents.set(id, state);
  }
  return state;
}

const FLOWER_LAYOUT_INTERVAL_SECONDS = 1 / 15;
const FLOWER_LAYOUT_ITERATIONS = 6;
const FLOWER_LAYOUT_DEAD_ZONE_PX = 3;
const FLOWER_LAYOUT_ANCHOR_SPRING = 0.12;
const FLOWER_LAYOUT_RELAXATION = 0.58;

export function FlowerLayoutCoordinator() {
  const size = useThree((state) => state.size);
  const lastLayoutAt = useRef(Number.NEGATIVE_INFINITY);

  useFrame(({ clock }) => {
    const elapsed = clock.getElapsedTime();
    if (elapsed - lastLayoutAt.current < FLOWER_LAYOUT_INTERVAL_SECONDS) return;
    lastLayoutAt.current = elapsed;
    solveFlowerLayout(size);
  }, -1);

  return null;
}

function solveFlowerLayout(size: { width: number; height: number }) {
  const agents = [...markerAgents.values()].filter(
    (agent) => agent.visible && agent.radiusPx > 0,
  );
  if (agents.length === 0) return;

  const positions = agents.map((agent) =>
    agent.hasTarget
      ? agent.targetScreen.clone()
      : agent.preferredScreen.clone(),
  );

  for (let iteration = 0; iteration < FLOWER_LAYOUT_ITERATIONS; iteration += 1) {
    const corrections = positions.map(() => new THREE.Vector2());

    for (let left = 0; left < agents.length; left += 1) {
      for (let right = left + 1; right < agents.length; right += 1) {
        const delta = positions[left].clone().sub(positions[right]);
        let distance = delta.length();
        if (distance < 0.001) {
          const angle = getStableMarkerAngle(
            `${agents[left].id}:${agents[right].id}`,
          );
          delta.set(Math.cos(angle), Math.sin(angle));
          distance = 1;
        }
        const requiredDistance =
          agents[left].radiusPx +
          agents[right].radiusPx +
          HEAD_AGENT_PADDING_PX;
        const overlap = requiredDistance - distance;
        if (overlap <= FLOWER_LAYOUT_DEAD_ZONE_PX) continue;

        const correction = delta
          .divideScalar(distance)
          .multiplyScalar(
            (overlap - FLOWER_LAYOUT_DEAD_ZONE_PX) *
              0.5 *
              FLOWER_LAYOUT_RELAXATION,
          );
        corrections[left].add(correction);
        corrections[right].sub(correction);
      }
    }

    for (let index = 0; index < agents.length; index += 1) {
      positions[index]
        .add(corrections[index])
        .lerp(agents[index].preferredScreen, FLOWER_LAYOUT_ANCHOR_SPRING);
      const padding = agents[index].radiusPx + 8;
      positions[index].set(
        THREE.MathUtils.clamp(
          positions[index].x,
          padding,
          Math.max(padding, size.width - padding),
        ),
        THREE.MathUtils.clamp(
          positions[index].y,
          padding,
          Math.max(padding, size.height - padding),
        ),
      );
    }
  }

  agents.forEach((agent, index) => {
    agent.targetScreen.copy(positions[index]);
    agent.hasTarget = true;
  });
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
  if (state.hasTarget && state.visible) {
    state.targetScreen.add(
      preferredScreen.clone().sub(state.preferredScreen),
    );
  }
  state.preferredScreen.copy(preferredScreen);
  state.visible = arrangeForCamera;
  state.radiusPx = arrangeForCamera ? radiusPx : 0;

  if (!arrangeForCamera) {
    const easedLocal = currentHeadCenter
      ? currentHeadCenter.clone().lerp(preferredHeadCenter, HEAD_AGENT_EASE)
      : preferredHeadCenter.clone();
    easedLocal.z = Math.max(easedLocal.z, HEAD_RADIUS * headScale * 1.18);
    const easedWorld = group.localToWorld(easedLocal.clone());
    state.screen.copy(projectToScreen(easedWorld, camera, size));
    state.world.copy(easedWorld);
    state.hasTarget = false;
    return easedLocal;
  }
  const resolvedScreen = state.hasTarget
    ? state.targetScreen
    : preferredScreen;
  const resolvedWorld = screenToWorldOnCameraPlane(resolvedScreen, preferredWorld, camera, size);
  const resolvedLocal = group.worldToLocal(resolvedWorld);
  const sphereCenter = new THREE.Vector3(0, 0, stemHeight);
  const maxTether = trackingRadius * HEAD_AGENT_TETHER_EXTENSION;
  const tetherOffset = resolvedLocal.sub(sphereCenter);

  if (tetherOffset.length() > maxTether) {
    tetherOffset.setLength(maxTether);
  }

  const targetLocal = sphereCenter.add(tetherOffset);
  // Camera-facing heads can be pushed sideways by the layout solver. Keep
  // their lowest point above the terrain anchor so the petals never clip into
  // the surface when the camera is pitched or zoomed out.
  const minimumHeadZ = HEAD_RADIUS * headScale * 1.18;
  targetLocal.z = Math.max(targetLocal.z, minimumHeadZ);
  const easedLocal = currentHeadCenter
    ? currentHeadCenter.clone().lerp(targetLocal, HEAD_AGENT_EASE)
    : targetLocal;
  easedLocal.z = Math.max(easedLocal.z, minimumHeadZ);
  const easedWorld = group.localToWorld(easedLocal.clone());

  state.screen.copy(projectToScreen(easedWorld, camera, size));
  state.world.copy(easedWorld);

  return easedLocal;
}

function getAnchorNdc(group: THREE.Group, camera: THREE.Camera) {
  group.updateMatrixWorld(true);
  camera.updateMatrixWorld(true);
  return group
    .localToWorld(new THREE.Vector3(0, 0, 0))
    .project(camera);
}

function isNdcInsideViewport(anchorNdc: THREE.Vector3) {
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
  cameraEntryWeight = 0.68,
) {
  const base = new THREE.Vector3(0, 0, 0);

  if (isForked) {
    // Let the shared trunk fork across a range of heights. Short stems fork
    // close to the terrain anchor, while taller stems get a little more
    // breathing room before branching. This avoids a uniformly mid-stem
    // pitchfork silhouette and allows the anchor itself to read as the root.
    const forkProgress = THREE.MathUtils.smoothstep(stemHeight, 0.42, 0.9);
    const forkHeight = THREE.MathUtils.clamp(
      THREE.MathUtils.lerp(0.055, CLUSTER_FORK_HEIGHT, forkProgress),
      0.045,
      stemHeight * 0.48,
    );
    const forkPoint = new THREE.Vector3(0, 0, forkHeight);
    const trunk = new THREE.CubicBezierCurve3(
      base,
      new THREE.Vector3(0, 0, forkHeight * 0.3),
      new THREE.Vector3(0, 0, forkHeight * 0.76),
      forkPoint,
    );
    const branchChord = attachment.clone().sub(forkPoint);
    const branchLength = Math.max(branchChord.length(), 0.001);
    const branchDirection = branchChord.divideScalar(branchLength);
    const entryDirection = getForwardEntryDirection(
      branchDirection,
      headUp,
      cameraEntryWeight,
    );
    const branchHandle = Math.min(
      branchLength * 0.32,
      THREE.MathUtils.clamp(stemHeight * 0.26, 0.1, 0.24),
    );
    const branch = new THREE.CubicBezierCurve3(
      forkPoint,
      forkPoint.clone().addScaledVector(
        UP,
        branchHandle,
      ),
      attachment.clone().addScaledVector(entryDirection, -branchHandle),
      attachment,
    );
    const curve = new THREE.CurvePath<THREE.Vector3>();
    if (includeClusterTrunk) curve.add(trunk);
    curve.add(branch);
    return curve;
  }

  const chord = attachment.clone().sub(base);
  const chordLength = Math.max(chord.length(), 0.001);
  const chordDirection = chord.divideScalar(chordLength);
  const lowerDirection = getForwardEntryDirection(
    chordDirection,
    UP,
    0.58,
  );
  const entryDirection = getForwardEntryDirection(
    chordDirection,
    headUp,
    cameraEntryWeight,
  );
  const handleLength = Math.min(
    chordLength * 0.32,
    THREE.MathUtils.clamp(stemHeight * 0.28, 0.1, 0.26),
  );
  return new THREE.CubicBezierCurve3(
    base,
    base.clone().addScaledVector(lowerDirection, handleLength),
    attachment.clone().addScaledVector(entryDirection, -handleLength),
    attachment,
  );
}

function getForwardEntryDirection(
  chordDirection: THREE.Vector3,
  preferredDirection: THREE.Vector3,
  preferredWeight: number,
) {
  const direction = chordDirection
    .clone()
    .lerp(preferredDirection, preferredWeight)
    .normalize();
  if (direction.dot(chordDirection) < 0.35) {
    direction.lerp(chordDirection, 0.65).normalize();
  }
  return direction;
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
