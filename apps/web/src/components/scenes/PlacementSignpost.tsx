import { Text } from "@react-three/drei";
import { type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";

export type PlacementSignDirection = "left" | "right" | "down";

export interface PlacementSign {
  id: string;
  label: string;
  direction: PlacementSignDirection;
  angle?: number;
}

interface PlacementSignpostProps {
  markerId: string;
  position: [number, number, number];
  height: number;
  signs: PlacementSign[];
  isSelected?: boolean;
  onClick?: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
}

const POST_RADIUS = 0.035;
const SIGN_SPACING = 0.34;
const SIGN_TOP_OFFSET = 0.18;
const SIGNPOST_MIN_HEIGHT = 2.8;
const POST_COLOR = "#687581";
const POST_HIGHLIGHT_COLOR = "#aebbc4";
const SIGN_COLOR = "#ffffff";
const SIGN_TEXT_COLOR = "#253746";
const SIGN_TEXT_PADDING = 0.28;
const SIGN_MIN_WIDTH = 0.9;
const SHARED_SIGN_MIN_WIDTH = 0.7;
const SIGN_TIP_LENGTH = 0.085;
const SIGN_INNER_EDGE = POST_RADIUS;
const SIGN_POINTER_RENDER_ORDER = 1;
const SIGN_POLE_RENDER_ORDER = 3;
const SIGN_SHARED_LOCATION_RENDER_ORDER = 5;

export default function PlacementSignpost({
  markerId,
  position,
  height,
  signs,
  isSelected = false,
  onClick,
  onPointerEnter,
  onPointerLeave,
}: PlacementSignpostProps) {
  const [x, y, z] = position;
  const postHeight = Math.max(
    SIGNPOST_MIN_HEIGHT,
    height,
    1.2 + signs.length * SIGN_SPACING,
  );
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
          depthTest={false}
          depthWrite={false}
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
          depthTest={false}
          depthWrite={false}
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
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
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
    () => new THREE.ShapeGeometry(createArrowShape(sign.direction, signWidth, sign.angle ?? 0)),
    [sign.direction, sign.angle, signWidth],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  return (
    <group
      position={[0, 0, signZ]}
      rotation={[Math.PI / 2, 0, 0]}
    >
      <group rotation={[0, 0, sign.angle ?? 0]}>
        <mesh geometry={geometry} renderOrder={renderOrder}>
          <meshBasicMaterial
            color={SIGN_COLOR}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={-2}
            polygonOffsetUnits={-2}
            depthTest={isDown ? false : true}
            depthWrite={false}
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
          material-depthTest={!isDown}
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

function createArrowShape(direction: PlacementSignDirection, width: number, angle: number) {
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
  const angleCosine = Math.cos(angle);
  const angleSine = Math.sin(angle);
  const innerEdgeX = (y: number) =>
    (SIGN_INNER_EDGE + directionMultiplier * y * angleSine) / angleCosine;
  const points = [
    [innerEdgeX(-SIGN_TIP_LENGTH), -SIGN_TIP_LENGTH],
    [outerEdge - SIGN_TIP_LENGTH, -SIGN_TIP_LENGTH],
    [outerEdge, 0],
    [outerEdge - SIGN_TIP_LENGTH, SIGN_TIP_LENGTH],
    [innerEdgeX(SIGN_TIP_LENGTH), SIGN_TIP_LENGTH],
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
