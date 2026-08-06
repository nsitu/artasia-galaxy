import { Text } from "@react-three/drei";
import { type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useState } from "react";
import * as THREE from "three";

export type PlacementSignDirection = "left" | "right" | "down";

export interface PlacementSign {
  id: string;
  label: string;
  direction: PlacementSignDirection;
  angle?: number;
  onClick?: () => void;
}

interface PlacementSignpostProps {
  markerId: string;
  position: [number, number, number];
  height: number;
  signs: PlacementSign[];
  partnerLogoUrl?: string;
  partnerBrandColor?: string;
  partnerBrandColorTwo?: string;
  isSelected?: boolean;
  onClick?: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

const POST_RADIUS = 0.035;
const SIGN_SPACING = 0.34;
const SIGN_TOP_OFFSET = 0.18;
const SIGNPOST_MIN_HEIGHT = 2.8;
const SIGNPOST_LOGO_EXTENSION = 0.5;
const LOGO_DISC_RADIUS = 0.22;
const LOGO_DISC_SEGMENTS = 48;
const LOGO_DISC_LOGO_SIZE = LOGO_DISC_RADIUS * 1.45;
const LOGO_DISC_DEPTH = 0.012;
const POST_COLOR = "#687581";
const POST_HIGHLIGHT_COLOR = "#aebbc4";
const SIGN_COLOR = "#ffffff";
const SIGN_TEXT_COLOR = "#253746";
const SIGN_TEXT_PADDING = 0.28;
const SIGN_MIN_WIDTH = 0.9;
const SHARED_SIGN_MIN_WIDTH = 0.7;
const SIGN_TIP_LENGTH = 0.085;
const SIGN_INNER_EDGE = POST_RADIUS;
const SIGN_SHARED_TANGENT_OFFSET = POST_RADIUS + 0.002;
const SIGN_POINTER_RENDER_ORDER = 1;
const SIGN_POLE_RENDER_ORDER = 3;
const SIGN_SHARED_LOCATION_RENDER_ORDER = 5;

export default function PlacementSignpost({
  markerId,
  position,
  height,
  signs,
  partnerLogoUrl,
  partnerBrandColor,
  partnerBrandColorTwo,
  isSelected = false,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: PlacementSignpostProps) {
  const [x, y, z] = position;
  const signStackHeight = Math.max(
    SIGNPOST_MIN_HEIGHT,
    height,
    1.2 + signs.length * SIGN_SPACING,
  );
  const postHeight = signStackHeight + SIGNPOST_LOGO_EXTENSION;
  const postGeometry = useMemo(
    () => new THREE.CylinderGeometry(POST_RADIUS, POST_RADIUS * 1.35, postHeight, 16),
    [postHeight],
  );
  const baseGeometry = useMemo(
    () => new THREE.CylinderGeometry(POST_RADIUS * 2.6, POST_RADIUS * 3.1, 0.06, 16),
    [],
  );
  const collarGeometry = useMemo(
    () => new THREE.CylinderGeometry(POST_RADIUS * 1.45, POST_RADIUS * 1.45, 0.045, 16),
    [],
  );
  const logoDiscGeometry = useMemo(
    () => new THREE.CircleGeometry(LOGO_DISC_RADIUS, LOGO_DISC_SEGMENTS),
    [],
  );
  const logoTexture = useLogoTexture(partnerLogoUrl);
  const logoAspect = getLogoTextureAspect(logoTexture);
  const logoWidth = logoAspect >= 1
    ? LOGO_DISC_LOGO_SIZE
    : LOGO_DISC_LOGO_SIZE * logoAspect;
  const logoHeight = logoAspect >= 1
    ? LOGO_DISC_LOGO_SIZE / logoAspect
    : LOGO_DISC_LOGO_SIZE;
  const logoDiscMaterial = useMemo(
    () => createLogoDiscMaterial(partnerBrandColor, partnerBrandColorTwo),
    [partnerBrandColor, partnerBrandColorTwo],
  );
  useEffect(() => () => postGeometry.dispose(), [postGeometry]);
  useEffect(() => () => {
    baseGeometry.dispose();
    collarGeometry.dispose();
    logoDiscGeometry.dispose();
    logoDiscMaterial.dispose();
  }, [baseGeometry, collarGeometry, logoDiscGeometry, logoDiscMaterial]);
  const pointerHandlers = useMemo(() => ({
    onClick: onClick
      ? (event: ThreeEvent<MouseEvent>) => {
          event.stopPropagation();
          onClick();
        }
      : undefined,
    onPointerOver: onPointerEnter
      ? (event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          document.body.style.cursor = onClick ? "pointer" : "";
          onPointerEnter();
        }
      : undefined,
    onPointerOut: onPointerLeave
      ? (event: ThreeEvent<PointerEvent>) => {
          event.stopPropagation();
          document.body.style.cursor = "";
          onPointerLeave();
        }
      : undefined,
  }), [onClick, onPointerEnter, onPointerLeave]);

  return (
    <group
      position={[x, y, z]}
      {...pointerHandlers}
      userData={{ markerId }}
    >
      <mesh
        geometry={baseGeometry}
        position={[0, 0, 0.03]}
        rotation={[Math.PI / 2, 0, 0]}
        renderOrder={SIGN_POLE_RENDER_ORDER}
      >
        <meshBasicMaterial
          color={isSelected ? POST_HIGHLIGHT_COLOR : POST_COLOR}
          depthTest
          depthWrite
        />
      </mesh>
      <mesh
        geometry={postGeometry}
        position={[0, 0, postHeight / 2]}
        rotation={[Math.PI / 2, 0, 0]}
        renderOrder={SIGN_POLE_RENDER_ORDER}
      >
        <meshBasicMaterial
          color={isSelected ? POST_HIGHLIGHT_COLOR : POST_COLOR}
          depthTest
          depthWrite
        />
      </mesh>
      <mesh
        geometry={collarGeometry}
        position={[0, 0, Math.min(postHeight - 0.04, 0.14)]}
        rotation={[Math.PI / 2, 0, 0]}
        renderOrder={SIGN_POLE_RENDER_ORDER}
      >
        <meshBasicMaterial
          color={isSelected ? POST_HIGHLIGHT_COLOR : POST_COLOR}
          depthTest
          depthWrite
        />
      </mesh>
      <group
        position={[0, 0, postHeight + LOGO_DISC_RADIUS]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <mesh geometry={logoDiscGeometry} renderOrder={SIGN_SHARED_LOCATION_RENDER_ORDER}>
          <primitive object={logoDiscMaterial} attach="material" />
        </mesh>
        {partnerLogoUrl && (
          <mesh
            position={[0, 0, LOGO_DISC_DEPTH]}
            renderOrder={SIGN_SHARED_LOCATION_RENDER_ORDER + 1}
          >
            <planeGeometry args={[logoWidth, logoHeight]} />
            <meshBasicMaterial
              map={logoTexture}
              color="#ffffff"
              transparent
              alphaTest={0.05}
              side={THREE.DoubleSide}
              toneMapped={false}
              depthTest
              depthWrite
            />
          </mesh>
        )}
      </group>
      {signs.map((sign, index) => (
        <SignBoard
          key={sign.id}
          sign={sign}
          index={index}
          postHeight={postHeight}
        />
      ))}
    </group>
  );
}

function createLogoDiscMaterial(colorOne?: string, colorTwo?: string) {
  return new THREE.ShaderMaterial({
    uniforms: {
      centerColor: { value: new THREE.Color(colorOne || POST_COLOR) },
      edgeColor: { value: new THREE.Color(colorTwo || colorOne || POST_COLOR) },
    },
    vertexShader: `
      varying vec2 vUv;

      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 centerColor;
      uniform vec3 edgeColor;
      varying vec2 vUv;

      void main() {
        float radialDistance = distance(vUv, vec2(0.5));
        float gradient = smoothstep(0.05, 0.7, radialDistance);
        gl_FragColor = vec4(mix(centerColor, edgeColor, gradient), 1.0);
      }
    `,
    side: THREE.DoubleSide,
    depthTest: true,
    depthWrite: true,
    toneMapped: false,
  });
}

function useLogoTexture(url?: string) {
  const fallbackTexture = useMemo(() => {
    const texture = new THREE.DataTexture(
      new Uint8Array([255, 255, 255, 0]),
      1,
      1,
      THREE.RGBAFormat,
    );
    texture.needsUpdate = true;
    return texture;
  }, []);
  const [texture, setTexture] = useState<THREE.Texture>(fallbackTexture);

  useEffect(() => {
    let active = true;
    let loadedTexture: THREE.Texture | null = null;
    setTexture(fallbackTexture);
    if (!url) return () => {
      active = false;
    };

    new THREE.TextureLoader().load(
      url,
      (nextTexture) => {
        loadedTexture = nextTexture;
        nextTexture.colorSpace = THREE.SRGBColorSpace;
        nextTexture.minFilter = THREE.LinearMipmapLinearFilter;
        nextTexture.magFilter = THREE.LinearFilter;
        nextTexture.generateMipmaps = true;
        nextTexture.needsUpdate = true;
        if (active) setTexture(nextTexture);
        else nextTexture.dispose();
      },
      undefined,
      () => {
        if (active) console.warn(`[signpost-logo] unavailable: ${url}`);
      },
    );

    return () => {
      active = false;
      loadedTexture?.dispose();
    };
  }, [fallbackTexture, url]);

  useEffect(() => () => fallbackTexture.dispose(), [fallbackTexture]);
  return texture;
}

function getLogoTextureAspect(texture: THREE.Texture) {
  const image = texture.image as {
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  } | null;
  const width = image?.naturalWidth ?? image?.width ?? 1;
  const height = image?.naturalHeight ?? image?.height ?? 1;
  return width > 0 && height > 0 ? width / height : 1;
}

function SignBoard({
  sign,
  index,
  postHeight,
}: {
  sign: PlacementSign;
  index: number;
  postHeight: number;
}) {
  const isDown = sign.direction === "down";
  const renderOrder = isDown
    ? SIGN_SHARED_LOCATION_RENDER_ORDER
    : SIGN_POINTER_RENDER_ORDER;
  const signZ = postHeight - SIGN_TOP_OFFSET - index * SIGN_SPACING;
  const fontSize = isDown ? 0.075 : 0.085;
  const signWidth = getSignWidth(sign.label, isDown, fontSize);
  const directionMultiplier = sign.direction === "left" ? -1 : 1;
  const textOffsetX = isDown
    ? 0
    : directionMultiplier * (SIGN_INNER_EDGE + signWidth / 2);
  const geometry = useMemo(
    () => new THREE.ShapeGeometry(createArrowShape(sign.direction, signWidth)),
    [sign.direction, signWidth],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group
      position={[0, isDown ? -SIGN_SHARED_TANGENT_OFFSET : 0, signZ]}
      rotation={[0, 0, sign.angle ?? 0]}
      onClick={sign.onClick ? (event) => {
        event.stopPropagation();
        sign.onClick?.();
      } : undefined}
      onPointerOver={sign.onClick ? (event) => {
        event.stopPropagation();
        document.body.style.cursor = "pointer";
      } : undefined}
      onPointerOut={sign.onClick ? (event) => {
        event.stopPropagation();
        document.body.style.cursor = "";
      } : undefined}
    >
      <group rotation={[Math.PI / 2, 0, 0]}>
        <mesh geometry={geometry} renderOrder={renderOrder}>
          <meshBasicMaterial
            color={SIGN_COLOR}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
            depthTest
            depthWrite
          />
        </mesh>
        <Text
          position={[textOffsetX, 0, 0.012]}
          renderOrder={renderOrder + 1}
          fontSize={fontSize}
          maxWidth={signWidth - SIGN_TEXT_PADDING}
          anchorX="center"
          anchorY="middle"
          textAlign="center"
          color={SIGN_TEXT_COLOR}
          depthOffset={-2}
          material-depthTest
          material-depthWrite
        >
          {sign.label}
        </Text>
      </group>
    </group>
  );
}

function getSignWidth(label: string, isDown: boolean, fontSize: number) {
  const estimatedTextWidth = label.length * fontSize * 0.56;
  return Math.max(
    isDown ? SHARED_SIGN_MIN_WIDTH : SIGN_MIN_WIDTH,
    estimatedTextWidth + SIGN_TEXT_PADDING,
  );
}

function createArrowShape(direction: PlacementSignDirection, width: number) {
  const shape = new THREE.Shape();
  if (direction === "down") {
    const halfWidth = width / 2;
    shape.moveTo(-halfWidth, 0.075);
    shape.lineTo(halfWidth, 0.075);
    shape.lineTo(halfWidth, -0.075);
    shape.lineTo(-halfWidth, -0.075);
    shape.closePath();
    return shape;
  }

  const directionMultiplier = direction === "right" ? 1 : -1;
  const outerEdge = SIGN_INNER_EDGE + width;
  const points = [
    [SIGN_INNER_EDGE, -SIGN_TIP_LENGTH],
    [outerEdge - SIGN_TIP_LENGTH, -SIGN_TIP_LENGTH],
    [outerEdge, 0],
    [outerEdge - SIGN_TIP_LENGTH, SIGN_TIP_LENGTH],
    [SIGN_INNER_EDGE, SIGN_TIP_LENGTH],
  ];
  const [[firstX, firstY], ...rest] = points.map(([pointX, pointY]) => [
    pointX * directionMultiplier,
    pointY,
  ]);
  shape.moveTo(firstX, firstY);
  for (const [pointX, pointY] of rest) shape.lineTo(pointX, pointY);
  shape.closePath();
  return shape;
}
