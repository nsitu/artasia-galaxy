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
  background: "rgba(10,10,20,0.86)",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 6,
  boxShadow: "0 16px 40px rgba(0,0,0,0.32)",
  padding: "12px 14px",
  color: "#d8dde7",
  fontFamily: "monospace",
};

const errorPanelStyle: CSSProperties = {
  borderColor: "rgba(255,105,105,0.38)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 9,
};

const spinnerStyle: CSSProperties = {
  width: 14,
  height: 14,
  border: "2px solid rgba(255,255,255,0.18)",
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
