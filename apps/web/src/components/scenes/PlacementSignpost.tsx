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
  placementName?: string;
  partnerBrandColor?: string;
  partnerBrandColorTwo?: string;
  isSelected?: boolean;
  onClick?: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

const POST_RADIUS = 0.035;
export const PLACEMENT_SIGN_SPACING = 0.05;
const SIGN_TOP_OFFSET = 0.18;
const SIGNPOST_MIN_HEIGHT = 2.8;
const SIGNPOST_NAME_SIGN_GAP = 0.08;
const SIGN_GROUP_GAP = 0.4;
const NAME_SIGN_TEXT_DEPTH = 0.012;
const POST_COLOR = "#687581";
const POST_HIGHLIGHT_COLOR = "#aebbc4";
const SIGN_COLOR = "#ffffff";
const SIGN_HOVER_COLOR = "#eee111";
const SIGN_TEXT_COLOR = "#253746";
const SIGN_TEXT_PADDING = 0.28;
const SIGN_MIN_WIDTH = 0.9;
const SHARED_SIGN_MIN_WIDTH = 0.7;
const SHARED_SIGN_FONT_SIZE = 0.075;
const SIGN_TIP_LENGTH = 0.085;
const SHARED_SIGN_HALF_HEIGHT = 0.075;
const SIGN_INNER_EDGE = POST_RADIUS;
// Keep centered shared-location signs just in front of the pole so the pole
// does not visually cut through their labels.
const SIGN_SHARED_TANGENT_OFFSET = POST_RADIUS + 0.04;
const NAME_SIGN_TANGENT_OFFSET = POST_RADIUS + 0.002;
const NAME_SIGN_CORNER_RADIUS = 0.055;
const SIGN_HOVER_SCALE = 1.06;
const SIGN_DIMMED_OPACITY = 0.7;
const SIGN_POINTER_RENDER_ORDER = 1;
const SIGN_POLE_RENDER_ORDER = 3;
const SIGN_SHARED_LOCATION_RENDER_ORDER = 5;

export default function PlacementSignpost({
  markerId,
  position,
  height,
  signs,
  placementName,
  partnerBrandColor,
  partnerBrandColorTwo,
  isSelected = false,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: PlacementSignpostProps) {
  const [x, y, z] = position;
  const [hoveredSignId, setHoveredSignId] = useState<string | null>(null);
  const hoveredSignIndex = signs.findIndex((sign) => sign.id === hoveredSignId);
  const hoveredSign = hoveredSignIndex >= 0 ? signs[hoveredSignIndex] : null;
  const signOffsets = getPlacementSignOffsets(signs);
  const signStackHeight = Math.max(
    SIGNPOST_MIN_HEIGHT,
    height,
    getPlacementSignStackHeight(signs),
  );
  const nameSignLayout = getPlacementNameSignLayout(placementName);
  const nameSignBottom = signStackHeight + SIGNPOST_NAME_SIGN_GAP;
  const nameSignTop = nameSignBottom + nameSignLayout.height;
  const postHeight = nameSignTop;
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
  const nameSignColor = useMemo(
    () => getDarkerBrandColor(partnerBrandColor, partnerBrandColorTwo),
    [partnerBrandColor, partnerBrandColorTwo],
  );
  useEffect(() => () => postGeometry.dispose(), [postGeometry]);
  useEffect(() => () => {
    baseGeometry.dispose();
    collarGeometry.dispose();
  }, [baseGeometry, collarGeometry]);
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
      {placementName && (
        <PlacementNameSign
          layout={nameSignLayout}
          color={nameSignColor}
          positionZ={nameSignBottom + nameSignLayout.height / 2}
        />
      )}
      {signs.map((sign, index) => (
        <SignBoard
          key={sign.id}
          sign={sign}
          verticalOffset={signOffsets[index]}
          postHeight={signStackHeight}
          isHovered={hoveredSignId === sign.id}
          isDimmed={
            hoveredSign !== null &&
            index > hoveredSignIndex &&
            sign.direction === hoveredSign.direction
          }
          onPointerEnter={() => setHoveredSignId(sign.id)}
          onPointerLeave={() => setHoveredSignId((current) =>
            current === sign.id ? null : current
          )}
        />
      ))}
    </group>
  );
}

function PlacementNameSign({
  layout,
  color,
  positionZ,
}: {
  layout: PlacementNameSignLayout;
  color: THREE.Color;
  positionZ: number;
}) {
  const geometry = useMemo(
    () => createRoundedRectangleGeometry(
      layout.width,
      layout.height,
      Math.min(
        NAME_SIGN_CORNER_RADIUS,
        layout.width * 0.12,
        layout.height * 0.25,
      ),
    ),
    [layout.height, layout.width],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group
      position={[0, -NAME_SIGN_TANGENT_OFFSET, positionZ]}
      rotation={[Math.PI / 2, 0, 0]}
      renderOrder={SIGN_SHARED_LOCATION_RENDER_ORDER}
    >
      <mesh renderOrder={SIGN_SHARED_LOCATION_RENDER_ORDER}>
        <primitive object={geometry} attach="geometry" />
        <meshBasicMaterial
          color={color}
          side={THREE.DoubleSide}
          depthTest
          depthWrite
        />
      </mesh>
      <Text
        position={[0, 0, NAME_SIGN_TEXT_DEPTH]}
        renderOrder={SIGN_SHARED_LOCATION_RENDER_ORDER + 1}
        fontSize={layout.fontSize}
        sdfGlyphSize={128}
        lineHeight={1.15}
        maxWidth={layout.textWidth}
        anchorX="center"
        anchorY="middle"
        textAlign="center"
        color="#ffffff"
        fillOpacity={1}
        depthOffset={-3}
        material-depthTest
        material-depthWrite={false}
        material-toneMapped={false}
      >
        {layout.text}
      </Text>
    </group>
  );
}

function createRoundedRectangleGeometry(width: number, height: number, radius: number) {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + radius, -halfHeight);
  shape.lineTo(halfWidth - radius, -halfHeight);
  shape.quadraticCurveTo(halfWidth, -halfHeight, halfWidth, -halfHeight + radius);
  shape.lineTo(halfWidth, halfHeight - radius);
  shape.quadraticCurveTo(halfWidth, halfHeight, halfWidth - radius, halfHeight);
  shape.lineTo(-halfWidth + radius, halfHeight);
  shape.quadraticCurveTo(-halfWidth, halfHeight, -halfWidth, halfHeight - radius);
  shape.lineTo(-halfWidth, -halfHeight + radius);
  shape.quadraticCurveTo(-halfWidth, -halfHeight, -halfWidth + radius, -halfHeight);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

interface PlacementNameSignLayout {
  text: string;
  width: number;
  height: number;
  textWidth: number;
  fontSize: number;
}

function getPlacementNameSignLayout(name?: string): PlacementNameSignLayout {
  const normalizedName = name?.trim().replace(/\s+/g, " ") || "SITE";
  const maxLineCharacters = 18;
  const words = normalizedName.split(" ");
  const lines: string[] = [];
  let currentLine = "";
  for (const word of words) {
    const nextLine = currentLine ? `${currentLine} ${word}` : word;
    if (currentLine && nextLine.length > maxLineCharacters) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = nextLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  const longestLineCharacters = Math.max(...lines.map((line) => line.length));
  const fontSize = SHARED_SIGN_FONT_SIZE;
  const textWidth = longestLineCharacters * fontSize * 0.56;
  return {
    text: lines.join("\n"),
    width: Math.max(0.72, textWidth + 0.2),
    height: lines.length * fontSize * 1.15 + 0.16,
    textWidth,
    fontSize,
  };
}

function getDarkerBrandColor(colorOne?: string, colorTwo?: string) {
  const first = new THREE.Color(colorOne || POST_COLOR);
  if (!colorTwo?.trim()) return first;
  const second = new THREE.Color(colorTwo);
  return getColorLuminance(first) <= getColorLuminance(second) ? first : second;
}

function getColorLuminance(color: THREE.Color) {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

function SignBoard({
  sign,
  verticalOffset,
  postHeight,
  isHovered,
  isDimmed,
  onPointerEnter,
  onPointerLeave,
}: {
  sign: PlacementSign;
  verticalOffset: number;
  postHeight: number;
  isHovered: boolean;
  isDimmed: boolean;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}) {
  const isDown = sign.direction === "down";
  const renderOrder = isDown
    ? SIGN_SHARED_LOCATION_RENDER_ORDER
    : SIGN_POINTER_RENDER_ORDER;
  const signZ = postHeight - SIGN_TOP_OFFSET - verticalOffset;
  const fontSize = isDown ? SHARED_SIGN_FONT_SIZE : 0.085;
  const signWidth = getSignWidth(sign.label, isDown, fontSize);
  const opacity = isDimmed ? SIGN_DIMMED_OPACITY : 1;
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
      scale={isHovered ? SIGN_HOVER_SCALE : 1}
      onClick={sign.onClick ? (event) => {
        event.stopPropagation();
        sign.onClick?.();
      } : undefined}
      onPointerEnter={(event) => {
        event.stopPropagation();
        onPointerEnter();
        document.body.style.cursor = sign.onClick ? "pointer" : "";
      }}
      onPointerLeave={(event) => {
        event.stopPropagation();
        onPointerLeave();
        document.body.style.cursor = "";
      }}
    >
      <group rotation={[Math.PI / 2, 0, 0]}>
        <mesh geometry={geometry} renderOrder={renderOrder}>
          <meshBasicMaterial
            color={isHovered ? SIGN_HOVER_COLOR : SIGN_COLOR}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
            transparent={isDimmed}
            opacity={opacity}
            depthTest
            depthWrite={!isDimmed}
          />
        </mesh>
        <Text
          position={[textOffsetX, 0, 0.012]}
          renderOrder={renderOrder + 1}
          fontSize={fontSize}
          sdfGlyphSize={128}
          maxWidth={signWidth - SIGN_TEXT_PADDING}
          anchorX="center"
          anchorY="middle"
          textAlign="center"
          color={SIGN_TEXT_COLOR}
          fillOpacity={opacity}
          depthOffset={-2}
          material-transparent
          material-opacity={opacity}
          material-depthTest
          material-depthWrite={false}
          material-toneMapped={false}
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

function getPlacementSignOffsets(signs: PlacementSign[]) {
  const offsets: number[] = [];
  const lastNearbyOffsetByDirection = new Map<PlacementSignDirection, number>();
  let offset = 0;

  for (let index = 0; index < signs.length; index += 1) {
    const sign = signs[index];
    const isShared = sign.direction === "down";

    if (index > 0) {
      const previousIsShared = signs[index - 1].direction === "down";

      if (isShared && previousIsShared) {
        offset += SHARED_SIGN_HALF_HEIGHT * 2 + PLACEMENT_SIGN_SPACING;
      } else if (isShared) {
        offset += SIGN_TIP_LENGTH + SIGN_GROUP_GAP + SHARED_SIGN_HALF_HEIGHT;
      } else {
        const compactOffset = offset + PLACEMENT_SIGN_SPACING;
        const previousSameDirectionOffset = lastNearbyOffsetByDirection.get(
          sign.direction,
        );
        const sameDirectionOffset = previousSameDirectionOffset == null
          ? 0
          : previousSameDirectionOffset + SIGN_TIP_LENGTH * 2 + PLACEMENT_SIGN_SPACING;
        offset = Math.max(compactOffset, sameDirectionOffset);
      }
    }
    if (!isShared) lastNearbyOffsetByDirection.set(sign.direction, offset);
    offsets.push(offset);
  }

  return offsets;
}

export function getPlacementSignStackHeight(signs: PlacementSign[]) {
  const offsets = getPlacementSignOffsets(signs);
  const finalOffset = offsets.at(-1) ?? 0;
  return 1.2 + finalOffset + PLACEMENT_SIGN_SPACING;
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
