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
    if (ready) startButtonRef.current?.focus();
  }, [ready]);

  return (
    <div
      style={{ ...overlayStyle, ...(exiting ? exitingOverlayStyle : {}) }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      <style>{spinnerKeyframes}</style>
      <div style={cardStyle}>
        <div style={presenterStyle}>
          <a
            href="https://artsforall.co"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Arts For All"
            style={presenterLogoLinkStyle}
          >
            <img src="/afa-horizontal.svg" alt="Arts For All" style={presenterLogoStyle} />
          </a>
          <span style={presenterTextStyle}>PRESENTS</span>
        </div>
        <div style={brandRowStyle}>
          <img src="/artasia-atlas.svg" alt="Artasia Atlas" style={logoStyle} />
        </div>
        <p style={descriptionStyle}>
          Welcome to Artasia Atlas! Explore creative projects made by children
          and communities across the Greater Hamilton Area.
        </p>
        {ready && <button
          ref={startButtonRef}
          type="button"
          disabled={!ready}
          onClick={onStart}
          style={{ ...buttonStyle, ...(ready ? {} : disabledButtonStyle) }}
        >
          Start Exploring
        </button>}
        {!ready && <p style={loadingStyle}><span aria-hidden="true" style={spinnerStyle} />Preparing the map…</p>}
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
  background:
    "linear-gradient(130deg, #8E1D58 0%, #F28B20DD 100%)",
  color: "#eef2f8",
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

const presenterStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-end",
  justifyContent: "center",
  gap: 8,
  marginBottom: -16,
};

const presenterLogoLinkStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
};

const presenterLogoStyle: React.CSSProperties = {
  width: "clamp(92px, 21vw, 132px)",
  height: "auto",
  display: "block",
};

const presenterTextStyle: React.CSSProperties = {
  marginBottom: "clamp(0.35rem, 1.1vw, 0.5rem)",
  color: "#ffffff",
  fontSize: 10,
  fontWeight: 600,
  fontVariant: "small-caps",
  letterSpacing: "0.16em",
  lineHeight: 1,
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
  color: "#ffffff",
  fontSize: 15,
  fontWeight: 400,
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
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  margin: 0,
  color: "#ffffff",
  fontSize: 11,
};

const spinnerStyle: React.CSSProperties = {
  width: 12,
  height: 12,
  flex: "0 0 auto",
  border: "2px solid rgba(132, 144, 163, 0.35)",
  borderTopColor: "#c7ec9d",
  borderRadius: "50%",
  animation: "atlas-welcome-spin 800ms linear infinite",
};

const spinnerKeyframes = `
  @keyframes atlas-welcome-spin {
    to { transform: rotate(360deg); }
  }
`;
