import { Text } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

interface DocumentationPullQuotePanelProps {
  quote: string;
  position: [number, number, number];
  width: number;
  height: number;
  attribution?: string;
  accentColour?: string;
}

function getQuoteFontSize(quote: string) {
  if (quote.length <= 160) return 0.4;
  if (quote.length <= 280) return 0.34;
  if (quote.length <= 420) return 0.29;
  return 0.24;
}

export default function DocumentationPullQuotePanel({
  quote,
  position,
  width,
  height,
  attribution,
  accentColour,
}: DocumentationPullQuotePanelProps) {
  const fontSize = getQuoteFontSize(quote);
  const displayQuote = useMemo(
    () => `“${quote.replace(/^[“\"]|[”\"]$/g, "").trim()}”`,
    [quote],
  );

  return (
    <group position={position}>
      <Text
        position={[-width / 2 + 0.42, attribution ? 0.3 : 0, 0.018]}
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
        outlineWidth={fontSize * 0.018}
        outlineColor="#000000"
        outlineOpacity={0.42}
        depthOffset={-3}
        material-transparent
        material-depthTest
        material-depthWrite={false}
        material-toneMapped={false}
      >
        {displayQuote}
      </Text>
      {attribution && (
        <Text
          position={[width / 2 - 0.42, -height / 2 + 0.52, 0.018]}
          renderOrder={2}
          raycast={() => null}
          fontSize={Math.max(0.19, fontSize * 0.62)}
          sdfGlyphSize={128}
          lineHeight={1.2}
          maxWidth={width - 0.84}
          anchorX="right"
          anchorY="middle"
          textAlign="right"
          color="#ffffff"
          fillOpacity={0.9}
          outlineWidth={fontSize * 0.012}
          outlineColor="#000000"
          outlineOpacity={0.38}
          depthOffset={-3}
          material-transparent
          material-depthTest
          material-depthWrite={false}
          material-toneMapped={false}
        >
          {`— ${attribution}`}
        </Text>
      )}
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
