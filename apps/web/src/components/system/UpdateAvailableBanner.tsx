import { useEffect, useState } from "react";
import { fetchBuildMeta } from "../../api/client";

const CHECK_INTERVAL_MS = 5 * 60 * 1000;

export default function UpdateAvailableBanner() {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();

    async function checkForUpdate() {
      try {
        const metadata = await fetchBuildMeta(controller.signal);
        if (
          !disposed &&
          metadata.buildId.length > 0 &&
          metadata.buildId !== __ARTASIA_BUILD_ID__
        ) {
          setUpdateAvailable(true);
        }
      } catch {
        // A failed check is usually a network problem, not evidence of an update.
      }
    }

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") void checkForUpdate();
    };

    void checkForUpdate();
    const intervalId = window.setInterval(checkWhenVisible, CHECK_INTERVAL_MS);
    window.addEventListener("focus", checkWhenVisible);
    window.addEventListener("online", checkWhenVisible);
    document.addEventListener("visibilitychange", checkWhenVisible);

    return () => {
      disposed = true;
      controller.abort();
      window.clearInterval(intervalId);
      window.removeEventListener("focus", checkWhenVisible);
      window.removeEventListener("online", checkWhenVisible);
      document.removeEventListener("visibilitychange", checkWhenVisible);
    };
  }, []);

  if (!updateAvailable) return null;

  return (
    <div role="status" aria-live="polite" style={bannerStyle}>
      <span>A new version of Atlas is available.</span>
      <button type="button" onClick={() => window.location.reload()} style={buttonStyle}>
        Reload to update
      </button>
    </div>
  );
}

const bannerStyle: React.CSSProperties = {
  position: "fixed",
  left: "50%",
  bottom: 20,
  zIndex: 10000,
  display: "flex",
  alignItems: "center",
  gap: 14,
  maxWidth: "calc(100vw - 32px)",
  padding: "12px 14px",
  transform: "translateX(-50%)",
  color: "#1b1407",
  background: "#ffe2a8",
  border: "1px solid #f1bd5b",
  borderRadius: 6,
  boxShadow: "0 8px 28px rgba(0, 0, 0, 0.35)",
  fontSize: 13,
};

const buttonStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "7px 10px",
  color: "#fff",
  background: "#3d2a09",
  border: "0",
  borderRadius: 4,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
};
