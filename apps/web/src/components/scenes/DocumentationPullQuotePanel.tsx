import { Html } from "@react-three/drei";
import type { CSSProperties } from "react";
import { useMemo } from "react";

interface DocumentationPullQuotePanelProps {
  quote: string;
  position: [number, number, number];
  width: number;
  height: number;
  attribution?: string;
}

export const DOCUMENTATION_QUOTE_DISTANCE_FACTOR = 10;
export const DOCUMENTATION_QUOTE_WORLD_UNITS_PER_PIXEL =
  DOCUMENTATION_QUOTE_DISTANCE_FACTOR / 400;

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
  const quoteFontSize = getQuoteFontSize(quote);
  const textFontSize = Math.max(0.19, quoteFontSize * 0.62);
  const displayQuote = useMemo(
    () => `“${quote.replace(/^[“\"]|[”\"]$/g, "").trim()}”`,
    [quote],
  );

  return (
    <group position={position}>
      <Html
        position={[0, 0, 0.018]}
        transform
        distanceFactor={DOCUMENTATION_QUOTE_DISTANCE_FACTOR}
        zIndexRange={[12, 0]}
        pointerEvents="none"
        style={panelStyle(width, height)}
      >
        <div style={quoteStyle(textFontSize)}>{displayQuote}</div>
        {attribution && (
          <div style={attributionStyle(textFontSize)}>
            {`— ${attribution}`}
          </div>
        )}
      </Html>
    </group>
  );
}

function panelStyle(width: number, height: number): CSSProperties {
  return {
    width: `${width * 100}px`,
    height: `${height * 100}px`,
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    justifyContent: "flex-start",
    overflow: "visible",
    pointerEvents: "none",
    userSelect: "none",
  };
}

function quoteStyle(fontSize: number): CSSProperties {
  return {
    color: "#ffffff",
    fontFamily: '"Montserrat", Arial, sans-serif',
    fontSize: `${fontSize * 100}px`,
    fontWeight: 400,
    lineHeight: 1.35,
    textAlign: "left",
    whiteSpace: "normal",
    textShadow: "0 2px 8px rgba(23, 32, 21, 0.65)",
  };
}

function attributionStyle(fontSize: number): CSSProperties {
  return {
    marginTop: "0.3rem",
    color: "#ffffff",
    fontFamily: '"Montserrat", Arial, sans-serif',
    fontSize: `${fontSize * 100}px`,
    fontWeight: 700,
    lineHeight: 1.2,
    textAlign: "left",
    whiteSpace: "normal",
    textShadow: "0 2px 8px rgba(23, 32, 21, 0.65)",
  };
}
