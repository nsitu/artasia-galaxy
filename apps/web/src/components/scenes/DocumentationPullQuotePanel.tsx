import { Text } from "@react-three/drei";
import { useMemo } from "react";
import * as THREE from "three";

interface DocumentationPullQuotePanelProps {
  quote: string;
  position: [number, number, number];
  width: number;
  height: number;
  attribution?: string;
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
}: DocumentationPullQuotePanelProps) {
  const fontSize = getQuoteFontSize(quote);
  const attributionFontSize = Math.max(0.19, fontSize * 0.62);
  const contentWidth = width - 0.84;
  const estimatedCharactersPerLine = Math.max(
    10,
    Math.floor(contentWidth / (fontSize * 0.54)),
  );
  const estimatedQuoteLines = Math.max(
    1,
    Math.ceil(displayQuoteLength(quote) / estimatedCharactersPerLine),
  );
  const estimatedQuoteHeight = estimatedQuoteLines * fontSize * 1.35;
  const attributionGap = 0.3;
  const combinedHeight = estimatedQuoteHeight
    + (attribution ? attributionGap + attributionFontSize : 0);
  const quoteTopY = Math.min(height / 2 - 0.52, combinedHeight / 2);
  const attributionY = quoteTopY
    - estimatedQuoteHeight
    - attributionGap
    - attributionFontSize / 2;
  const displayQuote = useMemo(
    () => `“${quote.replace(/^[“\"]|[”\"]$/g, "").trim()}”`,
    [quote],
  );

  return (
    <group position={position}>
      <mesh renderOrder={1} raycast={() => null}>
        <planeGeometry args={[width, height]} />
        <meshBasicMaterial
          color="#000000"
          transparent
          opacity={0.46}
          side={THREE.DoubleSide}
          depthTest
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <Text
        position={[-width / 2 + 0.42, quoteTopY, 0.018]}
        renderOrder={2}
        raycast={() => null}
        fontSize={fontSize}
        sdfGlyphSize={128}
        lineHeight={1.35}
        maxWidth={width - 0.84}
        anchorX="left"
        anchorY="top"
        textAlign="left"
        color="#ffffff"
        fillOpacity={1}
        outlineWidth={fontSize * 0.018}
        outlineColor="#000000"
        outlineOpacity={0.42}
        depthOffset={-3}
        material-transparent
        material-color="#ffffff"
        material-opacity={1}
        material-fog={false}
        material-depthTest
        material-depthWrite={false}
        material-toneMapped={false}
      >
        {displayQuote}
      </Text>
      {attribution && (
        <Text
          position={[width / 2 - 0.42, attributionY, 0.018]}
          renderOrder={2}
          raycast={() => null}
          fontSize={attributionFontSize}
          sdfGlyphSize={128}
          lineHeight={1.2}
          maxWidth={width - 0.84}
          anchorX="right"
          anchorY="middle"
          textAlign="right"
          color="#ffffff"
          fillOpacity={1}
          outlineWidth={fontSize * 0.012}
          outlineColor="#000000"
          outlineOpacity={0.38}
          depthOffset={-3}
          material-transparent
          material-color="#ffffff"
          material-opacity={1}
          material-fog={false}
          material-depthTest
          material-depthWrite={false}
          material-toneMapped={false}
        >
          {`— ${attribution}`}
        </Text>
      )}
    </group>
  );
}

function displayQuoteLength(quote: string) {
  return quote.replace(/^[“\"]|[”\"]$/g, "").trim().length + 2;
}
