import { Text } from "@react-three/drei";
import { useMemo } from "react";

interface DocumentationPullQuotePanelProps {
  quote: string;
  position: [number, number, number];
  width: number;
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
  attribution,
}: DocumentationPullQuotePanelProps) {
  const fontSize = getQuoteFontSize(quote);
  const attributionFontSize = Math.max(0.19, fontSize * 0.62);
  const contentWidth = width;
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
  const attributionY = -estimatedQuoteHeight - attributionGap - attributionFontSize / 2;
  const displayQuote = useMemo(
    () => `“${quote.replace(/^[“\"]|[”\"]$/g, "").trim()}”`,
    [quote],
  );

  return (
    <group position={position}>
      <Text
        position={[0, 0, 0.018]}
        renderOrder={1}
        raycast={() => null}
        fontSize={fontSize}
        sdfGlyphSize={128}
        lineHeight={1.35}
        maxWidth={width}
        anchorX="left"
        anchorY="top"
        textAlign="left"
        color="#ffffff"
        fillOpacity={1}
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
          position={[width, attributionY, 0.018]}
          renderOrder={1}
          raycast={() => null}
          fontSize={attributionFontSize}
          sdfGlyphSize={128}
          lineHeight={1.2}
          maxWidth={width}
          anchorX="right"
          anchorY="middle"
          textAlign="right"
          color="#ffffff"
          fillOpacity={1}
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
