import { Billboard } from "@react-three/drei";
import { extend, useFrame, useLoader, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

class FlowerPhotoMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        photoMap: { value: null },
        flowerOpacity: { value: 1 },
        brightness: { value: 1 },
        contrast: { value: 1 },
        petalCount: { value: 10 },
        borderColor: { value: new THREE.Color("#ffffff") },
        borderWidth: { value: 0.12 },
        imageAspect: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D photoMap;
        uniform float flowerOpacity;
        uniform float brightness;
        uniform float contrast;
        uniform float petalCount;
        uniform vec3 borderColor;
        uniform float borderWidth;
        uniform float imageAspect;
        varying vec2 vUv;

        void main() {
          vec2 centered = vUv * 2.0 - 1.0;
          centered.y *= -1.0;
          float distanceFromCenter = length(centered);
          float angle = atan(centered.y, centered.x);
          float petalWave = (1.0 + cos(angle * petalCount)) * 0.5;
          float flowerRadius = 0.76 + petalWave * 0.24;
          float edge = flowerRadius - distanceFromCenter;
          float alpha = smoothstep(-0.006, 0.006, edge);

          if (alpha < 0.02) discard;

          vec2 photoUv = vUv;
          if (imageAspect > 1.0) {
            photoUv.x = (photoUv.x - 0.5) / imageAspect + 0.5;
          } else {
            photoUv.y = (photoUv.y - 0.5) * imageAspect + 0.5;
          }

          vec4 color = texture2D(photoMap, photoUv);
          color.rgb = (color.rgb - 0.5) * contrast + 0.5;
          color.rgb *= brightness;
          float borderMix = 1.0 - smoothstep(0.0, borderWidth, edge);
          vec3 finalColor = mix(color.rgb, borderColor, borderMix);
          gl_FragColor = vec4(finalColor, color.a * alpha * flowerOpacity);
        }
      `,
    });
  }

  get photoMap() {
    return this.uniforms.photoMap.value as THREE.Texture | null;
  }

  set photoMap(value: THREE.Texture | null) {
    this.uniforms.photoMap.value = value;
  }

  get flowerOpacity() {
    return this.uniforms.flowerOpacity.value as number;
  }

  set flowerOpacity(value: number) {
    this.uniforms.flowerOpacity.value = value;
  }

  get brightness() {
    return this.uniforms.brightness.value as number;
  }

  set brightness(value: number) {
    this.uniforms.brightness.value = value;
  }

  get contrast() {
    return this.uniforms.contrast.value as number;
  }

  set contrast(value: number) {
    this.uniforms.contrast.value = value;
  }

  get petalCount() {
    return this.uniforms.petalCount.value as number;
  }

  set petalCount(value: number) {
    this.uniforms.petalCount.value = value;
  }

  get borderColor() {
    return this.uniforms.borderColor.value as THREE.Color;
  }

  set borderColor(value: THREE.Color | string | number) {
    this.uniforms.borderColor.value = value instanceof THREE.Color ? value : new THREE.Color(value);
  }

  get borderWidth() {
    return this.uniforms.borderWidth.value as number;
  }

  set borderWidth(value: number) {
    this.uniforms.borderWidth.value = value;
  }

  get imageAspect() {
    return this.uniforms.imageAspect.value as number;
  }

  set imageAspect(value: number) {
    this.uniforms.imageAspect.value = value;
  }
}

class AdjustedPhotoMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        photoMap: { value: null },
        brightness: { value: 1 },
        contrast: { value: 1 },
      },
      vertexShader: `
        varying vec2 vUv;

        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D photoMap;
        uniform float brightness;
        uniform float contrast;
        varying vec2 vUv;

        void main() {
          vec4 color = texture2D(photoMap, vUv);
          color.rgb = (color.rgb - 0.5) * contrast + 0.5;
          color.rgb *= brightness;
          gl_FragColor = color;
        }
      `,
    });
  }

  get photoMap() {
    return this.uniforms.photoMap.value as THREE.Texture | null;
  }

  set photoMap(value: THREE.Texture | null) {
    this.uniforms.photoMap.value = value;
  }

  get brightness() {
    return this.uniforms.brightness.value as number;
  }

  set brightness(value: number) {
    this.uniforms.brightness.value = value;
  }

  get contrast() {
    return this.uniforms.contrast.value as number;
  }

  set contrast(value: number) {
    this.uniforms.contrast.value = value;
  }
}

extend({ FlowerPhotoMaterial, AdjustedPhotoMaterial });

declare module "@react-three/fiber" {
  interface ThreeElements {
    flowerPhotoMaterial: ThreeElements["shaderMaterial"] & {
      photoMap?: THREE.Texture | null;
      flowerOpacity?: number;
      brightness?: number;
      contrast?: number;
      petalCount?: number;
      borderColor?: THREE.Color | string | number;
      borderWidth?: number;
      imageAspect?: number;
    };
    adjustedPhotoMaterial: ThreeElements["shaderMaterial"] & {
      photoMap?: THREE.Texture | null;
      brightness?: number;
      contrast?: number;
    };
  }
}

interface PhotoAdjustments {
  brightness?: number;
  contrast?: number;
}

interface SharedPhotoProps {
  id: string;
  url: string;
  width: number;
  height: number;
  isSelected: boolean;
  isHighlighted: boolean;
  adjustments?: PhotoAdjustments;
  onClick: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

interface FlowerProps extends SharedPhotoProps {
  position: [number, number, number];
}

interface OrbitBannerProps extends SharedPhotoProps {
  center: [number, number, number];
}

const BASE_LIFT = 0.025;
const STEM_HEIGHT = 0.28;
const TRACKING_RADIUS = 0.15;
const HEAD_RADIUS = 0.26;
const PETAL_LOBE_COUNT = 10;
const STEM_RADIUS = 0.009;
const MAX_TILT = THREE.MathUtils.degToRad(48);
const MIN_UPWARDNESS = 0.34;
const TRACKING_EASE = 0.12;
const UP = new THREE.Vector3(0, 0, 1);
const BANNER_MAX_WIDTH = 0.95;
const BANNER_MAX_HEIGHT = 0.58;
const ORBIT_MIN_UNITS = 0.72;
const ORBIT_MAX_UNITS = 2.15;
const ORBIT_HEIGHT = 0.72;
const ORBIT_SPEED = 0.16;

const tempVector = new THREE.Vector3();

export function TerrainPhotoFlower({
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
  adjustments,
}: FlowerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const stemRef = useRef<THREE.Mesh>(null);
  const currentDirection = useRef(new THREE.Vector3(0, 0, 1));
  const lastStemDirection = useRef(new THREE.Vector3(0, 0, 1));
  const camera = useThree((state) => state.camera);
  const texture = usePhotoTexture(url);
  const [x, y, z] = position;

  const imageAspect = Number.isFinite(width / height) && height > 0 ? width / height : 1;
  const brightness = adjustmentScalar(adjustments?.brightness);
  const contrast = adjustmentScalar(adjustments?.contrast);
  const headSize = HEAD_RADIUS * 2;
  const stemGeometry = useMemo(() => createInitialStemGeometry(), []);
  const baseGeometry = useMemo(() => new THREE.SphereGeometry(STEM_RADIUS * 1.45, 12, 8), []);

  useEffect(() => {
    return () => {
      stemGeometry.dispose();
      baseGeometry.dispose();
      stemRef.current?.geometry.dispose();
    };
  }, [baseGeometry, stemGeometry]);

  useFrame(() => {
    const group = groupRef.current;
    const head = headRef.current;
    const stem = stemRef.current;
    if (!group || !head || !stem) return;

    const sphereCenter = new THREE.Vector3(0, 0, STEM_HEIGHT);
    const cameraLocal = group.worldToLocal(camera.position.clone());
    const targetDirection = getTiltLimitedDirection(cameraLocal, sphereCenter);
    currentDirection.current.lerp(targetDirection, TRACKING_EASE).normalize();

    const headCenter = sphereCenter.clone().add(currentDirection.current.clone().multiplyScalar(TRACKING_RADIUS));
    head.position.copy(headCenter);
    orientHeadToCamera(head, group, camera);

    if (lastStemDirection.current.angleTo(currentDirection.current) > 0.025) {
      const nextGeometry = new THREE.TubeGeometry(createStemCurve(sphereCenter, headCenter), 18, STEM_RADIUS, 8, false);
      stem.geometry.dispose();
      stem.geometry = nextGeometry;
      lastStemDirection.current.copy(currentDirection.current);
    }
  });

  return (
    <group ref={groupRef} position={[x, y, z + BASE_LIFT]} {...createPointerHandlers(onClick, onPointerEnter, onPointerLeave)}>
      <mesh ref={stemRef} geometry={stemGeometry}>
        <meshStandardMaterial color={isSelected ? "#9df7a8" : "#49d05a"} roughness={0.62} transparent opacity={0.82} />
      </mesh>
      <mesh geometry={baseGeometry}>
        <meshStandardMaterial color={isSelected ? "#9df7a8" : "#33b84a"} roughness={0.72} transparent opacity={0.82} />
      </mesh>
      <group
        ref={headRef}
        position={[0, 0, STEM_HEIGHT + TRACKING_RADIUS]}
        scale={isHighlighted || isSelected ? 1.14 : 1}
      >
        <mesh>
          <planeGeometry args={[headSize, headSize]} />
          <flowerPhotoMaterial
            photoMap={texture}
            brightness={brightness}
            contrast={contrast}
            petalCount={PETAL_LOBE_COUNT}
            flowerOpacity={0.96}
            borderColor="#ffffff"
            borderWidth={0.12}
            imageAspect={imageAspect}
            transparent
            side={THREE.DoubleSide}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-3}
            polygonOffsetUnits={-3}
          />
        </mesh>
      </group>
    </group>
  );
}

export function OrbitingPhotoBanner({
  id,
  url,
  width,
  height,
  center,
  isSelected,
  isHighlighted,
  onClick,
  onPointerEnter,
  onPointerLeave,
  adjustments,
}: OrbitBannerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const imageRef = useRef<THREE.Mesh>(null);
  const texture = usePhotoTexture(url);
  const orbit = useMemo(() => ({
    radius: stableRange(`${id}:radius`, ORBIT_MIN_UNITS, ORBIT_MAX_UNITS),
    phase: stableRange(`${id}:phase`, 0, Math.PI * 2),
    speed: stableRange(`${id}:speed`, ORBIT_SPEED * 0.75, ORBIT_SPEED * 1.25),
  }), [id]);
  const [cx, cy, cz] = center;
  const aspect = width / height;
  const brightness = adjustmentScalar(adjustments?.brightness);
  const contrast = adjustmentScalar(adjustments?.contrast);
  const imageW = aspect >= 1 ? BANNER_MAX_WIDTH : BANNER_MAX_HEIGHT * aspect;
  const imageH = aspect >= 1 ? BANNER_MAX_WIDTH / aspect : BANNER_MAX_HEIGHT;

  useFrame((state) => {
    const group = groupRef.current;
    const image = imageRef.current;
    if (!group || !image) return;
    const angle = orbit.phase + state.clock.elapsedTime * orbit.speed;
    group.position.set(
      cx + Math.cos(angle) * orbit.radius,
      cy + Math.sin(angle) * orbit.radius,
      cz + ORBIT_HEIGHT
    );
    const targetScale = isHighlighted || isSelected ? 1.14 : 1;
    image.scale.lerp(tempVector.set(targetScale, targetScale, 1), 0.15);
  });

  return (
    <group ref={groupRef} position={[cx + orbit.radius, cy, cz + ORBIT_HEIGHT]}>
      <Billboard>
        <mesh
          ref={imageRef}
          onClick={(event) => {
            event.stopPropagation();
            onClick();
          }}
          onPointerEnter={onPointerEnter}
          onPointerLeave={onPointerLeave}
        >
          <planeGeometry args={[imageW, imageH]} />
          <adjustedPhotoMaterial
            photoMap={texture}
            brightness={brightness}
            contrast={contrast}
            side={THREE.DoubleSide}
            toneMapped={false}
          />
        </mesh>
      </Billboard>
    </group>
  );
}

function adjustmentScalar(value?: number) {
  if (!Number.isFinite(value)) return 1;
  return THREE.MathUtils.clamp(Math.round(value as number), 50, 150) / 100;
}

function orientHeadToCamera(head: THREE.Object3D, parent: THREE.Object3D, camera: THREE.Camera) {
  const cameraWorldQuaternion = camera.getWorldQuaternion(new THREE.Quaternion());
  const parentWorldQuaternion = parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  head.quaternion.copy(parentWorldQuaternion.multiply(cameraWorldQuaternion));
}

function usePhotoTexture(url: string) {
  const texture = useLoader(THREE.TextureLoader, url);

  useEffect(() => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
  }, [texture]);

  return texture;
}

function createPointerHandlers(
  onClick: () => void,
  onPointerEnter: () => void,
  onPointerLeave: () => void
) {
  return {
    onClick: (event: ThreeEvent<MouseEvent>) => {
      event.stopPropagation();
      onClick();
    },
    onPointerOver: () => {
      document.body.style.cursor = "pointer";
      onPointerEnter();
    },
    onPointerOut: () => {
      document.body.style.cursor = "";
      onPointerLeave();
    },
  };
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

function createStemCurve(sphereCenter: THREE.Vector3, headCenter: THREE.Vector3) {
  const lowerStem = new THREE.Vector3(0, 0, STEM_HEIGHT * 0.48);
  const neckControl = sphereCenter.clone().lerp(headCenter, 0.42);
  return new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    lowerStem,
    sphereCenter,
    neckControl,
    headCenter,
  ]);
}

function createInitialStemGeometry() {
  const sphereCenter = new THREE.Vector3(0, 0, STEM_HEIGHT);
  const headCenter = new THREE.Vector3(0, 0, STEM_HEIGHT + TRACKING_RADIUS);
  return new THREE.TubeGeometry(createStemCurve(sphereCenter, headCenter), 18, STEM_RADIUS, 8, false);
}

function stableRange(seed: string, min: number, max: number) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const normalized = (Math.abs(hash) % 1000) / 999;
  return min + normalized * (max - min);
}
