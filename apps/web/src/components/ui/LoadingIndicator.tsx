import type { CSSProperties } from "react";

interface LoadingIndicatorProps {
  label: string;
  detail?: string;
  tone?: "loading" | "error" | "muted";
  busy?: boolean;
}

export default function LoadingIndicator({
  label,
  detail,
  tone = "loading",
  busy = tone === "loading",
}: LoadingIndicatorProps) {
  return (
    <div style={overlayStyle}>
      <style>{loadingKeyframes}</style>
      <div style={{ ...panelStyle, ...(tone === "error" ? errorPanelStyle : {}) }}>
        <div style={headerStyle}>
          {busy && <span style={spinnerStyle} />}
          <span style={{ ...labelStyle, ...(tone === "error" ? errorLabelStyle : {}) }}>{label}</span>
        </div>
        {detail && <div style={detailStyle}>{detail}</div>}
      </div>
    </div>
  );
}

const loadingKeyframes = `
@keyframes artasia-loading-spin {
  to { transform: rotate(360deg); }
}`;

const overlayStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  pointerEvents: "none",
  zIndex: 18,
};

const panelStyle: CSSProperties = {
  width: "min(280px, calc(100vw - 48px))",
  padding: "12px 14px",
  color: "#d8dde7",
  fontFamily: "monospace",
  textAlign: "center",
};

const errorPanelStyle: CSSProperties = {
  background: "rgba(10,10,20,0.76)",
  borderRadius: 6,
};

const headerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
};

const spinnerStyle: CSSProperties = {
  width: 28,
  height: 28,
  border: "3px solid rgba(255,255,255,0.2)",
  borderTopColor: "#f5f7fb",
  borderRadius: "50%",
  animation: "artasia-loading-spin 0.85s linear infinite",
};

const labelStyle: CSSProperties = {
  color: "#f5f7fb",
  fontSize: 12,
  fontWeight: 700,
  lineHeight: 1.25,
};

const errorLabelStyle: CSSProperties = {
  color: "#ff8f8f",
};

const detailStyle: CSSProperties = {
  color: "#aeb7c6",
  fontSize: 11,
  lineHeight: 1.35,
  marginTop: 7,
  overflowWrap: "anywhere",
};
