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
        saturation: { value: 1 },
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
        uniform float saturation;
        uniform float petalCount;
        uniform vec3 borderColor;
        uniform float borderWidth;
        uniform float imageAspect;
        varying vec2 vUv;

        vec4 applyCssLikeAdjustments(vec4 linearColor, float brightnessValue, float contrastValue, float saturationValue) {
          vec4 displayColor = sRGBTransferOETF(linearColor);
          displayColor.rgb = (displayColor.rgb - 0.5) * contrastValue + 0.5;
          displayColor.rgb *= brightnessValue;
          float luma = dot(displayColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          displayColor.rgb = mix(vec3(luma), displayColor.rgb, saturationValue);
          displayColor.rgb = clamp(displayColor.rgb, 0.0, 1.0);
          return sRGBTransferEOTF(displayColor);
        }

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
          color = applyCssLikeAdjustments(color, brightness, contrast, saturation);
          float borderMix = 1.0 - smoothstep(0.0, borderWidth, edge);
          vec3 finalColor = mix(color.rgb, borderColor, borderMix);
          gl_FragColor = vec4(finalColor, color.a * alpha * flowerOpacity);
          #include <colorspace_fragment>
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

  get saturation() {
    return this.uniforms.saturation.value as number;
  }

  set saturation(value: number) {
    this.uniforms.saturation.value = value;
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
        saturation: { value: 1 },
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
        uniform float saturation;
        varying vec2 vUv;

        vec4 applyCssLikeAdjustments(vec4 linearColor, float brightnessValue, float contrastValue, float saturationValue) {
          vec4 displayColor = sRGBTransferOETF(linearColor);
          displayColor.rgb = (displayColor.rgb - 0.5) * contrastValue + 0.5;
          displayColor.rgb *= brightnessValue;
          float luma = dot(displayColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          displayColor.rgb = mix(vec3(luma), displayColor.rgb, saturationValue);
          displayColor.rgb = clamp(displayColor.rgb, 0.0, 1.0);
          return sRGBTransferEOTF(displayColor);
        }

        void main() {
          vec4 color = texture2D(photoMap, vUv);
          color = applyCssLikeAdjustments(color, brightness, contrast, saturation);
          gl_FragColor = color;
          #include <colorspace_fragment>
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

  get saturation() {
    return this.uniforms.saturation.value as number;
  }

  set saturation(value: number) {
    this.uniforms.saturation.value = value;
  }
}

class OrbitingCutoutPhotoMaterial extends THREE.ShaderMaterial {
  constructor() {
    super({
      uniforms: {
        photoMap: { value: null },
        brightness: { value: 1 },
        contrast: { value: 1 },
        saturation: { value: 1 },
        cardAspect: { value: 1 },
        cornerBottomLeft: { value: new THREE.Vector2(0.08, 0.08) },
        cornerBottomRight: { value: new THREE.Vector2(0.92, 0.08) },
        cornerTopRight: { value: new THREE.Vector2(0.92, 0.92) },
        cornerTopLeft: { value: new THREE.Vector2(0.08, 0.92) },
        borderColor: { value: new THREE.Color("#ffffff") },
        borderWidth: { value: 0.04 },
        dashLength: { value: 0.11 },
        dashGap: { value: 0.065 },
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
        uniform float saturation;
        uniform float cardAspect;
        uniform vec2 cornerBottomLeft;
        uniform vec2 cornerBottomRight;
        uniform vec2 cornerTopRight;
        uniform vec2 cornerTopLeft;
        uniform vec3 borderColor;
        uniform float borderWidth;
        uniform float dashLength;
        uniform float dashGap;
        varying vec2 vUv;

        vec4 applyCssLikeAdjustments(vec4 linearColor, float brightnessValue, float contrastValue, float saturationValue) {
          vec4 displayColor = sRGBTransferOETF(linearColor);
          displayColor.rgb = (displayColor.rgb - 0.5) * contrastValue + 0.5;
          displayColor.rgb *= brightnessValue;
          float luma = dot(displayColor.rgb, vec3(0.2126, 0.7152, 0.0722));
          displayColor.rgb = mix(vec3(luma), displayColor.rgb, saturationValue);
          displayColor.rgb = clamp(displayColor.rgb, 0.0, 1.0);
          return sRGBTransferEOTF(displayColor);
        }

        vec2 metricPoint(vec2 point) {
          return vec2(point.x * cardAspect, point.y);
        }

        float signedEdgeDistance(vec2 point, vec2 start, vec2 end) {
          vec2 edge = end - start;
          return (edge.x * (point.y - start.y) - edge.y * (point.x - start.x)) / max(length(edge), 0.0001);
        }

        float edgePosition(vec2 point, vec2 start, vec2 end) {
          vec2 edge = end - start;
          return clamp(dot(point - start, edge) / max(dot(edge, edge), 0.0001), 0.0, 1.0);
        }

        void main() {
          vec2 point = metricPoint(vUv);
          vec2 bottomLeft = metricPoint(cornerBottomLeft);
          vec2 bottomRight = metricPoint(cornerBottomRight);
          vec2 topRight = metricPoint(cornerTopRight);
          vec2 topLeft = metricPoint(cornerTopLeft);

          float distanceBottom = signedEdgeDistance(point, bottomLeft, bottomRight);
          float distanceRight = signedEdgeDistance(point, bottomRight, topRight);
          float distanceTop = signedEdgeDistance(point, topRight, topLeft);
          float distanceLeft = signedEdgeDistance(point, topLeft, bottomLeft);
          float edgeDistance = min(min(distanceBottom, distanceRight), min(distanceTop, distanceLeft));
          if (edgeDistance < -0.002) discard;

          float edgeIndex = 0.0;
          float nearestDistance = distanceBottom;
          if (distanceRight < nearestDistance) {
            nearestDistance = distanceRight;
            edgeIndex = 1.0;
          }
          if (distanceTop < nearestDistance) {
            nearestDistance = distanceTop;
            edgeIndex = 2.0;
          }
          if (distanceLeft < nearestDistance) {
            edgeIndex = 3.0;
          }

          vec2 edgeStart = bottomLeft;
          vec2 edgeEnd = bottomRight;
          if (edgeIndex == 1.0) {
            edgeStart = bottomRight;
            edgeEnd = topRight;
          } else if (edgeIndex == 2.0) {
            edgeStart = topRight;
            edgeEnd = topLeft;
          } else if (edgeIndex == 3.0) {
            edgeStart = topLeft;
            edgeEnd = bottomLeft;
          }

          float alongEdge = edgePosition(point, edgeStart, edgeEnd) * length(edgeEnd - edgeStart);
          float dashPeriod = dashLength + dashGap;
          float dashMask = 1.0 - step(dashLength, mod(alongEdge, dashPeriod));
          float borderMask = (1.0 - smoothstep(borderWidth, borderWidth + 0.008, edgeDistance)) * dashMask;
          float cutoutAlpha = smoothstep(-0.002, 0.004, edgeDistance);

          vec4 color = texture2D(photoMap, vUv);
          color = applyCssLikeAdjustments(color, brightness, contrast, saturation);
          color.rgb = mix(color.rgb, borderColor, borderMask);
          gl_FragColor = vec4(color.rgb, color.a * cutoutAlpha);
          #include <colorspace_fragment>
        }
      `,
    });
  }

  get photoMap() { return this.uniforms.photoMap.value as THREE.Texture | null; }
  set photoMap(value: THREE.Texture | null) { this.uniforms.photoMap.value = value; }
  get brightness() { return this.uniforms.brightness.value as number; }
  set brightness(value: number) { this.uniforms.brightness.value = value; }
  get contrast() { return this.uniforms.contrast.value as number; }
  set contrast(value: number) { this.uniforms.contrast.value = value; }
  get saturation() { return this.uniforms.saturation.value as number; }
  set saturation(value: number) { this.uniforms.saturation.value = value; }
  get cardAspect() { return this.uniforms.cardAspect.value as number; }
  set cardAspect(value: number) { this.uniforms.cardAspect.value = value; }
  get cornerBottomLeft() { return this.uniforms.cornerBottomLeft.value as THREE.Vector2; }
  set cornerBottomLeft(value: THREE.Vector2) { this.uniforms.cornerBottomLeft.value = value; }
  get cornerBottomRight() { return this.uniforms.cornerBottomRight.value as THREE.Vector2; }
  set cornerBottomRight(value: THREE.Vector2) { this.uniforms.cornerBottomRight.value = value; }
  get cornerTopRight() { return this.uniforms.cornerTopRight.value as THREE.Vector2; }
  set cornerTopRight(value: THREE.Vector2) { this.uniforms.cornerTopRight.value = value; }
  get cornerTopLeft() { return this.uniforms.cornerTopLeft.value as THREE.Vector2; }
  set cornerTopLeft(value: THREE.Vector2) { this.uniforms.cornerTopLeft.value = value; }
  get borderColor() { return this.uniforms.borderColor.value as THREE.Color; }
  set borderColor(value: THREE.Color | string | number) {
    this.uniforms.borderColor.value = value instanceof THREE.Color ? value : new THREE.Color(value);
  }
  get borderWidth() { return this.uniforms.borderWidth.value as number; }
  set borderWidth(value: number) { this.uniforms.borderWidth.value = value; }
  get dashLength() { return this.uniforms.dashLength.value as number; }
  set dashLength(value: number) { this.uniforms.dashLength.value = value; }
  get dashGap() { return this.uniforms.dashGap.value as number; }
  set dashGap(value: number) { this.uniforms.dashGap.value = value; }
}

extend({ FlowerPhotoMaterial, AdjustedPhotoMaterial, OrbitingCutoutPhotoMaterial });

declare module "@react-three/fiber" {
  interface ThreeElements {
    flowerPhotoMaterial: ThreeElements["shaderMaterial"] & {
      photoMap?: THREE.Texture | null;
      flowerOpacity?: number;
      brightness?: number;
      contrast?: number;
      saturation?: number;
      petalCount?: number;
      borderColor?: THREE.Color | string | number;
      borderWidth?: number;
      imageAspect?: number;
    };
    adjustedPhotoMaterial: ThreeElements["shaderMaterial"] & {
      photoMap?: THREE.Texture | null;
      brightness?: number;
      contrast?: number;
      saturation?: number;
    };
    orbitingCutoutPhotoMaterial: ThreeElements["shaderMaterial"] & {
      photoMap?: THREE.Texture | null;
      brightness?: number;
      contrast?: number;
      saturation?: number;
      cardAspect?: number;
      cornerBottomLeft?: THREE.Vector2;
      cornerBottomRight?: THREE.Vector2;
      cornerTopRight?: THREE.Vector2;
      cornerTopLeft?: THREE.Vector2;
      borderColor?: THREE.Color | string | number;
      borderWidth?: number;
      dashLength?: number;
      dashGap?: number;
    };
  }
}

interface PhotoAdjustments {
  brightness?: number;
  contrast?: number;
  saturation?: number;
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

interface OrbitAudioProps {
  id: string;
  audioUrl: string;
  center: [number, number, number];
  isPlaying: boolean;
  isHighlighted: boolean;
  onPlaybackStart: () => void;
  onPlaybackStop: () => void;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}

interface CutoutCorners {
  bottomLeft: THREE.Vector2;
  bottomRight: THREE.Vector2;
  topRight: THREE.Vector2;
  topLeft: THREE.Vector2;
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
const CUTOUT_BORDER_COLORS = [
  "#8e1d58",
  "#eee111",
  "#ec008c",
  "#f28b20",
] as const;
const STEM_COLOR = new THREE.Color("#49d05a");
const STEM_SELECTED_COLOR = new THREE.Color("#9df7a8");
const STEM_HOVER_EMISSIVE = new THREE.Color("#d7ff8f");
const BASE_COLOR = new THREE.Color("#33b84a");
const BASE_SELECTED_COLOR = new THREE.Color("#9df7a8");

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
  const stemMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const baseMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const currentDirection = useRef(new THREE.Vector3(0, 0, 1));
  const lastStemDirection = useRef(new THREE.Vector3(0, 0, 1));
  const camera = useThree((state) => state.camera);
  const texture = usePhotoTexture(url);
  const [x, y, z] = position;

  const imageAspect = getTextureAspect(texture, width, height);
  const brightness = adjustmentScalar(adjustments?.brightness);
  const contrast = adjustmentScalar(adjustments?.contrast);
  const saturation = adjustmentScalar(adjustments?.saturation);
  const headSize = HEAD_RADIUS * 2;
  const stemGeometry = useMemo(() => createInitialStemGeometry(), []);
  const baseGeometry = useMemo(() => new THREE.SphereGeometry(STEM_RADIUS * 1.45, 12, 8), []);
  const pointerHandlers = useMemo(
    () => createPointerHandlers(onClick, onPointerEnter, onPointerLeave),
    [onClick, onPointerEnter, onPointerLeave],
  );

  useEffect(() => {
    return () => {
      stemGeometry.dispose();
      baseGeometry.dispose();
      stemRef.current?.geometry.dispose();
    };
  }, [baseGeometry, stemGeometry]);

  useFrame((state) => {
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

    const pulse = isHighlighted ? (Math.sin(state.clock.elapsedTime * 9) + 1) * 0.5 : 0;
    const stemMaterial = stemMaterialRef.current;
    const baseMaterial = baseMaterialRef.current;
    if (stemMaterial) {
      stemMaterial.color.copy(isSelected ? STEM_SELECTED_COLOR : STEM_COLOR);
      stemMaterial.emissive.copy(STEM_HOVER_EMISSIVE);
      stemMaterial.emissiveIntensity = isHighlighted ? THREE.MathUtils.lerp(0.15, 1.25, pulse) : 0;
    }
    if (baseMaterial) {
      baseMaterial.color.copy(isSelected ? BASE_SELECTED_COLOR : BASE_COLOR);
      baseMaterial.emissive.copy(STEM_HOVER_EMISSIVE);
      baseMaterial.emissiveIntensity = isHighlighted ? THREE.MathUtils.lerp(0.06, 0.55, pulse) : 0;
    }
  });

  return (
    <group ref={groupRef} position={[x, y, z + BASE_LIFT]} {...pointerHandlers}>
      <mesh ref={stemRef} geometry={stemGeometry}>
        <meshStandardMaterial ref={stemMaterialRef} color={isSelected ? "#9df7a8" : "#49d05a"} roughness={0.62} transparent opacity={0.9} />
      </mesh>
      <mesh geometry={baseGeometry}>
        <meshStandardMaterial ref={baseMaterialRef} color={isSelected ? "#9df7a8" : "#33b84a"} roughness={0.72} transparent opacity={0.9} />
      </mesh>
      <group
        ref={headRef}
        position={[0, 0, STEM_HEIGHT + TRACKING_RADIUS]}
        scale={isHighlighted || isSelected ? 1.14 : 1}
      >
        <mesh {...pointerHandlers}>
          <planeGeometry args={[headSize, headSize]} />
          <flowerPhotoMaterial
            photoMap={texture}
            brightness={brightness}
            contrast={contrast}
            saturation={saturation}
            petalCount={PETAL_LOBE_COUNT}
            flowerOpacity={0.96}
            borderColor="#ffffff"
            borderWidth={0.12}
            imageAspect={imageAspect}
            transparent
            side={THREE.DoubleSide}
            toneMapped={false}
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
  const pointerInsideRef = useRef(false);
  const texture = usePhotoTexture(url);
  const orbit = useMemo(() => ({
    radius: stableRange(`${id}:radius`, ORBIT_MIN_UNITS, ORBIT_MAX_UNITS),
    phase: stableRange(`${id}:phase`, 0, Math.PI * 2),
    speed: stableRange(`${id}:speed`, ORBIT_SPEED * 0.75, ORBIT_SPEED * 1.25),
  }), [id]);
  const cutout = useMemo(() => createCutoutCorners(id), [id]);
  const borderColor = useMemo(() => {
    const index = Math.min(
      CUTOUT_BORDER_COLORS.length - 1,
      Math.floor(stableRange(`${id}:cutout:border-color`, 0, CUTOUT_BORDER_COLORS.length)),
    );
    return CUTOUT_BORDER_COLORS[index];
  }, [id]);
  const [cx, cy, cz] = center;
  const aspect = getTextureAspect(texture, width, height);
  const brightness = adjustmentScalar(adjustments?.brightness);
  const contrast = adjustmentScalar(adjustments?.contrast);
  const saturation = adjustmentScalar(adjustments?.saturation);
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
            if (!isPointInsideCutout(event.uv, cutout)) return;
            event.stopPropagation();
            onClick();
          }}
          onPointerMove={(event) => {
            const inside = isPointInsideCutout(event.uv, cutout);
            if (inside === pointerInsideRef.current) return;
            pointerInsideRef.current = inside;
            document.body.style.cursor = inside ? "pointer" : "";
            if (inside) onPointerEnter();
            else onPointerLeave();
          }}
          onPointerOut={() => {
            if (pointerInsideRef.current) onPointerLeave();
            pointerInsideRef.current = false;
            document.body.style.cursor = "";
          }}
        >
          <planeGeometry args={[imageW, imageH]} />
          <orbitingCutoutPhotoMaterial
            photoMap={texture}
            brightness={brightness}
            contrast={contrast}
            saturation={saturation}
            cardAspect={imageW / imageH}
            cornerBottomLeft={cutout.bottomLeft}
            cornerBottomRight={cutout.bottomRight}
            cornerTopRight={cutout.topRight}
            cornerTopLeft={cutout.topLeft}
            borderColor={borderColor}
            borderWidth={0.04}
            dashLength={0.11}
            dashGap={0.065}
            transparent
            side={THREE.DoubleSide}
            toneMapped={false}
            depthWrite={false}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
          />
        </mesh>
      </Billboard>
    </group>
  );
}

export function OrbitingAudioMarker({
  id,
  audioUrl,
  center,
  isPlaying,
  isHighlighted,
  onPlaybackStart,
  onPlaybackStop,
  onPointerEnter,
  onPointerLeave,
}: OrbitAudioProps) {
  const groupRef = useRef<THREE.Group>(null);
  const iconRef = useRef<THREE.Group>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackStopRef = useRef(onPlaybackStop);
  playbackStopRef.current = onPlaybackStop;
  const orbit = useMemo(() => ({
    radius: stableRange(`${id}:radius`, ORBIT_MIN_UNITS, ORBIT_MAX_UNITS),
    phase: stableRange(`${id}:phase`, 0, Math.PI * 2),
    speed: stableRange(`${id}:speed`, ORBIT_SPEED * 0.75, ORBIT_SPEED * 1.25),
  }), [id]);
  const triangle = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.055, -0.09);
    shape.lineTo(0.105, 0);
    shape.lineTo(-0.055, 0.09);
    shape.closePath();
    return shape;
  }, []);
  const [cx, cy, cz] = center;
  const color = isPlaying ? "#eee111" : "#ffffff";

  useEffect(() => {
    const audio = new Audio(audioUrl);
    audio.preload = "metadata";
    const handleEnded = () => playbackStopRef.current();
    audio.addEventListener("ended", handleEnded);
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.removeEventListener("ended", handleEnded);
      audio.src = "";
      audioRef.current = null;
    };
  }, [audioUrl]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!isPlaying && audio && !audio.paused) {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [isPlaying]);

  useFrame((state) => {
    const group = groupRef.current;
    const icon = iconRef.current;
    if (!group || !icon) return;
    const angle = orbit.phase + state.clock.elapsedTime * orbit.speed;
    group.position.set(
      cx + Math.cos(angle) * orbit.radius,
      cy + Math.sin(angle) * orbit.radius,
      cz + ORBIT_HEIGHT,
    );
    const targetScale = isHighlighted || isPlaying ? 1.16 : 1;
    icon.scale.lerp(tempVector.set(targetScale, targetScale, 1), 0.15);
  });

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.pause();
      audio.currentTime = 0;
      onPlaybackStop();
      return;
    }
    try {
      audio.currentTime = 0;
      await audio.play();
      onPlaybackStart();
    } catch (error) {
      console.warn(`[audio] playback failed for ${id}: ${(error as Error).message}`);
      onPlaybackStop();
    }
  }

  return (
    <group ref={groupRef} position={[cx + orbit.radius, cy, cz + ORBIT_HEIGHT]}>
      <Billboard>
        <group
          ref={iconRef}
          onClick={(event) => {
            event.stopPropagation();
            void togglePlayback();
          }}
          onPointerOver={(event) => {
            event.stopPropagation();
            document.body.style.cursor = "pointer";
            onPointerEnter();
          }}
          onPointerOut={(event) => {
            event.stopPropagation();
            document.body.style.cursor = "";
            onPointerLeave();
          }}
        >
          <mesh position={[0, 0, -0.001]}>
            <circleGeometry args={[0.225, 48]} />
            <meshBasicMaterial
              transparent
              opacity={0}
              depthWrite={false}
              color="#ffffff"
            />
          </mesh>
          <mesh>
            <ringGeometry args={[0.16, 0.205, 48]} />
            <meshBasicMaterial color={color} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
          <mesh position={[0.018, 0, 0.002]}>
            <shapeGeometry args={[triangle]} />
            <meshBasicMaterial color={color} side={THREE.DoubleSide} toneMapped={false} />
          </mesh>
        </group>
      </Billboard>
    </group>
  );
}

function adjustmentScalar(value?: number) {
  if (!Number.isFinite(value)) return 1;
  return THREE.MathUtils.clamp(Math.round(value as number), 50, 150) / 100;
}

function getTextureAspect(texture: THREE.Texture, fallbackWidth: number, fallbackHeight: number) {
  const image = texture.image as {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  } | null;
  const textureWidth = image?.naturalWidth ?? image?.width ?? 0;
  const textureHeight = image?.naturalHeight ?? image?.height ?? 0;
  if (textureWidth > 0 && textureHeight > 0) return textureWidth / textureHeight;
  return Number.isFinite(fallbackWidth / fallbackHeight) && fallbackHeight > 0
    ? fallbackWidth / fallbackHeight
    : 1;
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
    onPointerOver: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      document.body.style.cursor = "pointer";
      onPointerEnter();
    },
    onPointerOut: (event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
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

function createCutoutCorners(id: string): CutoutCorners {
  const inset = (corner: string, axis: string) =>
    stableRange(`${id}:cutout:${corner}:${axis}`, 0.03, 0.13);
  return {
    bottomLeft: new THREE.Vector2(inset("bottom-left", "x"), inset("bottom-left", "y")),
    bottomRight: new THREE.Vector2(1 - inset("bottom-right", "x"), inset("bottom-right", "y")),
    topRight: new THREE.Vector2(1 - inset("top-right", "x"), 1 - inset("top-right", "y")),
    topLeft: new THREE.Vector2(inset("top-left", "x"), 1 - inset("top-left", "y")),
  };
}

function isPointInsideCutout(point: THREE.Vector2 | undefined, corners: CutoutCorners) {
  if (!point) return false;
  const polygon = [
    corners.bottomLeft,
    corners.bottomRight,
    corners.topRight,
    corners.topLeft,
  ];
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    const cross =
      (end.x - start.x) * (point.y - start.y) -
      (end.y - start.y) * (point.x - start.x);
    if (cross < 0) return false;
  }
  return true;
}

function stableRange(seed: string, min: number, max: number) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  const normalized = (Math.abs(hash) % 1000) / 999;
  return min + normalized * (max - min);
}
