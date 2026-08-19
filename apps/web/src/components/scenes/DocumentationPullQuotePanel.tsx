import { Html } from "@react-three/drei";
import type { CSSProperties } from "react";
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
  const quotePosition: [number, number, number] = [
    width / 2,
    -estimatedQuoteHeight / 2,
    0.018,
  ];
  const attributionPosition: [number, number, number] = [
    width / 2,
    attributionY,
    0.018,
  ];
  const displayQuote = useMemo(
    () => `“${quote.replace(/^[“\"]|[”\"]$/g, "").trim()}”`,
    [quote],
  );

  return (
    <group position={position}>
      <Html
        position={quotePosition}
        transform
        distanceFactor={10}
        zIndexRange={[12, 0]}
        pointerEvents="none"
        style={quoteStyle(width, estimatedQuoteHeight, fontSize)}
      >
        {displayQuote}
      </Html>
      {attribution && (
        <Html
          position={attributionPosition}
          transform
          distanceFactor={10}
          zIndexRange={[12, 0]}
          pointerEvents="none"
          style={attributionStyle(width, attributionFontSize)}
        >
          {`— ${attribution}`}
        </Html>
      )}
    </group>
  );
}

function quoteStyle(width: number, height: number, fontSize: number): CSSProperties {
  return {
    width: `${width * 100}px`,
    height: `${height * 100}px`,
    color: "#ffffff",
    fontFamily: '"Montserrat", Arial, sans-serif',
    fontSize: `${fontSize * 100}px`,
    fontWeight: 400,
    lineHeight: 1.35,
    textAlign: "left",
    whiteSpace: "normal",
    pointerEvents: "none",
    userSelect: "none",
    textShadow: "0 2px 8px rgba(23, 32, 21, 0.65)",
  };
}

function attributionStyle(width: number, fontSize: number): CSSProperties {
  return {
    width: `${width * 100}px`,
    height: `${fontSize * 120}px`,
    color: "#ffffff",
    fontFamily: '"Montserrat", Arial, sans-serif',
    fontSize: `${fontSize * 100}px`,
    fontWeight: 400,
    lineHeight: 1.2,
    textAlign: "left",
    whiteSpace: "normal",
    pointerEvents: "none",
    userSelect: "none",
    textShadow: "0 2px 8px rgba(23, 32, 21, 0.65)",
  };
}

function displayQuoteLength(quote: string) {
  return quote.replace(/^[“\"]|[”\"]$/g, "").trim().length + 2;
}
