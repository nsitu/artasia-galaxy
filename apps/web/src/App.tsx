import { useEffect, useState, type CSSProperties } from "react";
import ArtScene from "./components/scenes/ArtScene";
import { fetchAuthUser } from "./api/client";
import LoadingIndicator from "./components/ui/LoadingIndicator";
import UploadPanel from "./components/ui/UploadPanel";

function getAdminAuthError() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("auth") !== "error") return null;
  return params.get("message") ?? "Google sign-in failed.";
}

export default function App() {
  const [path, setPath] = useState(window.location.pathname);
  const [adminAuthError, setAdminAuthError] = useState<string | null>(() => getAdminAuthError());
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState<boolean | null>(null);
  const [adminAccessError, setAdminAccessError] = useState<string | null>(null);

  useEffect(() => {
    if (window.location.search.includes("auth=")) {
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    }

    const onPopState = () => {
      setPath(window.location.pathname);
      setAdminAuthError(getAdminAuthError());
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("admin-page", path === "/admin");
    return () => document.documentElement.classList.remove("admin-page");
  }, [path]);

  useEffect(() => {
    if (path !== "/admin") return;

    let cancelled = false;
    setIsAdminAuthenticated(null);
    setAdminAccessError(null);

    fetchAuthUser()
      .then((auth) => {
        if (cancelled) return;
        setIsAdminAuthenticated(auth.authenticated);
      })
      .catch((err) => {
        if (cancelled) return;
        setAdminAccessError((err as Error).message);
        setIsAdminAuthenticated(false);
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  if (path === "/admin") {
    if (isAdminAuthenticated === null) {
      return (
        <LoadingIndicator
          label="Checking admin access"
          detail="Verifying your Google session before opening the publishing console."
        />
      );
    }

    if (!isAdminAuthenticated) {
      return <AdminSignInScreen authError={adminAuthError ?? adminAccessError} />;
    }

    return (
      <UploadPanel
        initialError={adminAuthError}
        onSignedOut={() => {
          setIsAdminAuthenticated(false);
          setAdminAccessError(null);
        }}
      />
    );
  }

  return <ArtScene />;
}

interface AdminSignInScreenProps {
  authError?: string | null;
}

function AdminSignInScreen({ authError }: AdminSignInScreenProps) {
  return (
    <main style={adminGatePageStyle}>
      <div style={adminGateBackdropStyle} />
      <section style={adminGateCardStyle}>
        <div style={adminGateKickerStyle}>Private admin area</div>
        <h1 style={adminGateTitleStyle}>Sign in to manage uploads</h1>
        <p style={adminGateBodyStyle}>
          The admin console is now behind Google Workspace authentication. Once signed in, you can
          import photos, manage placements, and publish content.
        </p>
        {authError && <div style={adminGateErrorStyle}>{authError}</div>}
        <div style={adminGateActionsStyle}>
          <a href="/api/v1/auth/google/start" style={adminGatePrimaryButtonStyle}>
            Sign in with Google
          </a>
          <a href="/" style={adminGateSecondaryButtonStyle}>
            Open viewer
          </a>
        </div>
      </section>
    </main>
  );
}

const adminGatePageStyle: CSSProperties = {
  minHeight: "100vh",
  display: "grid",
  placeItems: "center",
  position: "relative",
  overflow: "hidden",
  background:
    "radial-gradient(circle at top left, rgba(255, 214, 160, 0.18), transparent 34%), radial-gradient(circle at bottom right, rgba(78, 110, 255, 0.16), transparent 30%), linear-gradient(180deg, #06070d 0%, #11131c 52%, #090a10 100%)",
  color: "#f3f6fb",
  padding: 24,
};

const adminGateBackdropStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "repeating-linear-gradient(135deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 16px)",
  opacity: 0.24,
  pointerEvents: "none",
};

const adminGateCardStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  width: "min(640px, 100%)",
  borderRadius: 20,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(9, 12, 19, 0.82)",
  boxShadow: "0 28px 70px rgba(0,0,0,0.45)",
  padding: "32px clamp(24px, 5vw, 40px)",
  backdropFilter: "blur(18px)",
};

const adminGateKickerStyle: CSSProperties = {
  color: "#a9b4c9",
  textTransform: "uppercase",
  letterSpacing: "0.22em",
  fontSize: 11,
  marginBottom: 12,
};

const adminGateTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(30px, 5vw, 48px)",
  lineHeight: 1.03,
  letterSpacing: "-0.04em",
};

const adminGateBodyStyle: CSSProperties = {
  margin: "16px 0 0",
  maxWidth: 520,
  fontSize: 16,
  lineHeight: 1.6,
  color: "#c8d0df",
};

const adminGateErrorStyle: CSSProperties = {
  marginTop: 20,
  padding: "12px 14px",
  borderRadius: 12,
  border: "1px solid rgba(255, 139, 139, 0.3)",
  background: "rgba(255, 85, 85, 0.08)",
  color: "#ffb0b0",
  fontSize: 13,
  lineHeight: 1.45,
  overflowWrap: "anywhere",
};

const adminGateActionsStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  marginTop: 28,
};

const adminGateButtonBaseStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 44,
  padding: "0 18px",
  borderRadius: 999,
  textDecoration: "none",
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: "0.01em",
};

const adminGatePrimaryButtonStyle: CSSProperties = {
  ...adminGateButtonBaseStyle,
  background: "linear-gradient(135deg, #f5d28c 0%, #f0b96a 100%)",
  color: "#14110a",
  boxShadow: "0 10px 24px rgba(240, 185, 106, 0.24)",
};

const adminGateSecondaryButtonStyle: CSSProperties = {
  ...adminGateButtonBaseStyle,
  background: "rgba(255,255,255,0.04)",
  color: "#e9eef7",
  border: "1px solid rgba(255,255,255,0.12)",
};
