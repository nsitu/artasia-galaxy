import { useEffect, useRef } from "react";

interface WelcomeOverlayProps {
  exiting: boolean;
  ready: boolean;
  onStart: () => void;
}

export default function WelcomeOverlay({
  exiting,
  ready,
  onStart,
}: WelcomeOverlayProps) {
  const startButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    startButtonRef.current?.focus();
  }, []);

  return (
    <div
      style={{ ...overlayStyle, ...(exiting ? exitingOverlayStyle : {}) }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <div style={cardStyle}>
        <div style={brandRowStyle}>
          <img src="/artasia-atlas.svg" alt="Artasia Atlas" style={logoStyle} />
          <img src="/spider.png" alt="Spider" style={spiderLogoStyle} />
        </div>
        <p style={descriptionStyle}>
          Welcome to Artasia Atlas! Explore creative projects made by children
          and communities across the Greater Hamilton Area.
        </p>
        <button
          ref={startButtonRef}
          type="button"
          disabled={!ready}
          onClick={onStart}
          style={{ ...buttonStyle, ...(ready ? {} : disabledButtonStyle) }}
        >
          Start Exploring
        </button>
        {!ready && <p style={loadingStyle}>Preparing the map…</p>}
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 100,
  display: "grid",
  placeItems: "center",
  padding: 24,
  background: "rgba(10, 10, 20, 0.98)",
  color: "#eef2f8",
  fontFamily: "monospace",
  opacity: 1,
  transition: "opacity 300ms ease-out",
};

const exitingOverlayStyle: React.CSSProperties = {
  opacity: 0,
  pointerEvents: "none",
};

const cardStyle: React.CSSProperties = {
  width: "min(560px, 100%)",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 16,
  textAlign: "center",
};

const logoStyle: React.CSSProperties = {
  width: "clamp(180px, 48vw, 300px)",
  height: "auto",
  objectFit: "contain",
};

const brandRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "clamp(10px, 2.5vw, 20px)",
  width: "100%",
  marginBottom: 6,
};

const spiderLogoStyle: React.CSSProperties = {
  width: "clamp(56px, 14vw, 96px)",
  height: "clamp(68px, 18vw, 116px)",
  objectFit: "contain",
};

const taglineStyle: React.CSSProperties = {
  margin: 0,
  color: "#a9d77e",
  fontSize: 12,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: "clamp(28px, 5vw, 46px)",
  lineHeight: 1.08,
  letterSpacing: "-0.03em",
};

const descriptionStyle: React.CSSProperties = {
  maxWidth: 520,
  margin: 0,
  color: "#c1c9d7",
  fontSize: 15,
  lineHeight: 1.6,
};

const buttonStyle: React.CSSProperties = {
  minWidth: 178,
  minHeight: 48,
  marginTop: 8,
  padding: "12px 22px",
  border: "1px solid #c7ec9d",
  borderRadius: 999,
  background: "#c7ec9d",
  color: "#172015",
  fontFamily: "inherit",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const disabledButtonStyle: React.CSSProperties = {
  opacity: 0.55,
  cursor: "wait",
};

const loadingStyle: React.CSSProperties = {
  margin: "-8px 0 0",
  color: "#8490a3",
  fontSize: 11,
};
