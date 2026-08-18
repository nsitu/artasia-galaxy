import { Text } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

interface DocumentationPullQuotePanelProps {
  quote: string;
  position: [number, number, number];
  width: number;
  height: number;
  backgroundColour?: string;
  accentColour?: string;
}

function getQuoteFontSize(quote: string) {
  if (quote.length <= 160) return 0.28;
  if (quote.length <= 280) return 0.23;
  if (quote.length <= 420) return 0.19;
  return 0.16;
}

export default function DocumentationPullQuotePanel({
  quote,
  position,
  width,
  height,
  backgroundColour,
  accentColour,
}: DocumentationPullQuotePanelProps) {
  const fontSize = getQuoteFontSize(quote);
  const displayQuote = useMemo(
    () => `“${quote.replace(/^[“\"]|[”\"]$/g, "").trim()}”`,
    [quote],
  );

  return (
    <group position={position}>
      <mesh renderOrder={1} raycast={() => null}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          color={backgroundColour || "#8e1d58"}
          transparent
          opacity={0.86}
          side={THREE.DoubleSide}
          depthTest
          depthWrite
          toneMapped={false}
        />
      </mesh>
      <Text
        position={[-width / 2 + 0.42, 0, 0.018]}
        renderOrder={2}
        raycast={() => null}
        fontSize={fontSize}
        sdfGlyphSize={128}
        lineHeight={1.35}
        maxWidth={width - 0.84}
        anchorX="left"
        anchorY="middle"
        textAlign="left"
        color="#ffffff"
        outlineWidth={fontSize * 0.012}
        outlineColor="#000000"
        outlineOpacity={0.22}
        depthOffset={-3}
        material-transparent
        material-depthTest
        material-depthWrite={false}
        material-toneMapped={false}
      >
        {displayQuote}
      </Text>
      <mesh
        position={[-width / 2 + 0.18, 0, 0.012]}
        renderOrder={2}
        raycast={() => null}
      >
        <planeGeometry args={[0.045, height - 0.7]} />
        <meshBasicMaterial
          color={accentColour || "#eee111"}
          side={THREE.DoubleSide}
          depthTest
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}
