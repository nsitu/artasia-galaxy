import { useEffect, useState } from "react";
import {
  clearScreenshotAssetCaptions,
  fetchAuthUser,
  lookupMissingUploadAssetDriveSources,
  logoutAuthUser,
  type AuthUser,
} from "../../api/client";

type NoticeTone = "success" | "warning";

const tabs = [
  { href: "/admin", label: "Sites", icon: "location_on" },
  { href: "/admin/browse", label: "Browse", icon: "browse" },
  { href: "/admin", label: "Edit", icon: "edit" },
  { href: "/admin/upload", label: "Upload", icon: "upload" },
  { href: "/admin/import", label: "Import", icon: "add_to_drive" },
  { href: "/admin/tools", label: "Tools", icon: "build" },
];

export default function ToolsPanel({ initialError }: { initialError?: string | null }) {
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState(initialError ?? "");
  const [notice, setNotice] = useState<{
    tone: NoticeTone;
    message: string;
  } | null>(null);
  const [driveLookupRunning, setDriveLookupRunning] = useState(false);
  const [screenshotCleanupRunning, setScreenshotCleanupRunning] = useState(false);

  useEffect(() => {
    void fetchAuthUser()
      .then(setAuthUser)
      .catch((err) => setError((err as Error).message));
  }, []);

  async function signOut() {
    try {
      await logoutAuthUser();
    } finally {
      window.location.href = "/admin";
    }
  }

  async function lookupMissingDriveSources() {
    if (!authUser?.authenticated) {
      setError("Sign in with Google to look up Drive files.");
      return;
    }
    if (!window.confirm("Look up Google Drive files for every unlinked asset? This may take a while.")) {
      return;
    }

    setDriveLookupRunning(true);
    setError("");
    setNotice(null);
    try {
      const summary = await lookupMissingUploadAssetDriveSources();
      console.groupCollapsed(
        `[Drive maintenance] scanned ${summary.scanned} assets: linked ${summary.linked}, not found ${summary.notFound}, ambiguous ${summary.ambiguous}, skipped ${summary.skipped}, failed ${summary.failed}`,
      );
      console.table(summary.results.map((result) => ({
        status: result.status,
        assetId: result.assetId,
        fileName: result.fileName,
        placement: result.placementName
          ? `${result.placementName} (${result.placementId ?? "?"})`
          : result.placementTags?.join(", "),
        folder: result.folderName
          ? `${result.folderName} (${result.folderId ?? "?"})`
          : result.folderId,
        searchedFileName: result.searchedFileName,
        matches: result.matches
          ?.map((match) => `${match.name} (${match.id})`)
          .join(" | "),
        detail: result.error ?? result.driveFileName ?? "",
      })));
      console.log("Full Drive maintenance results", summary.results);
      console.groupEnd();
      setNotice({
        tone: summary.linked > 0 ? "success" : "warning",
        message: `Drive maintenance scanned ${summary.scanned} assets: linked ${summary.linked}, not found ${summary.notFound}, ambiguous ${summary.ambiguous}, skipped ${summary.skipped}${summary.failed ? `, failed ${summary.failed}` : ""}. Detailed results were logged to the browser console.`,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDriveLookupRunning(false);
    }
  }

  async function clearScreenshotCaptions() {
    if (!authUser?.authenticated) {
      setError("Sign in with Google to use Atlas administration tools.");
      return;
    }
    if (!window.confirm("Remove the exact caption ‘Screenshot’ from every matching asset? This updates Immich metadata.")) {
      return;
    }

    setScreenshotCleanupRunning(true);
    setError("");
    setNotice(null);
    try {
      const summary = await clearScreenshotAssetCaptions();
      console.groupCollapsed(
        `[Caption maintenance] scanned ${summary.scanned} assets: matched ${summary.matched}, cleared ${summary.cleared}, failed ${summary.failed}`,
      );
      console.table(summary.results);
      console.groupEnd();
      setNotice({
        tone: summary.failed > 0 ? "warning" : "success",
        message: `Caption maintenance scanned ${summary.scanned} assets: found ${summary.matched} exact “Screenshot” captions, cleared ${summary.cleared}${summary.failed ? `, failed ${summary.failed}` : ""}. Detailed results were logged to the browser console.`,
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScreenshotCleanupRunning(false);
    }
  }

  return (
    <main style={pageStyle}>
      <section style={panelStyle}>
        <header style={headerStyle}>
          <a href="/admin" style={brandStyle}>
            <img src="/artasia-atlas.svg" alt="Artasia Atlas" style={logoStyle} />
            <h1 style={titleStyle}>Admin</h1>
          </a>
          <div style={accountStyle}>
            <span>{authUser?.name ?? authUser?.email ?? "Artasia user"}</span>
            <button type="button" onClick={() => void signOut()} style={secondaryButtonStyle}>
              Sign out
            </button>
          </div>
        </header>

        <nav className="atlas-tools-tabs" aria-label="Atlas admin sections" style={tabsStyle}>
          {tabs.map((tab) => (
            <a
              key={tab.label}
              href={tab.href}
              aria-current={tab.label === "Tools" ? "page" : undefined}
              style={{ ...tabStyle, ...(tab.label === "Tools" ? activeTabStyle : {}) }}
            >
              <span style={iconStyle} aria-hidden="true">{tab.icon}</span>
              {tab.label}
            </a>
          ))}
        </nav>

        {error && <div style={errorStyle}>{error}</div>}

        <section style={contentStyle}>
          <p style={eyebrowStyle}>Tools</p>
          <h2 style={headingStyle}>Atlas administration tools</h2>

          {notice && (
            <div style={notice.tone === "success" ? successNoticeStyle : warningNoticeStyle}>
              {notice.message}
            </div>
          )}

          <section style={toolSectionStyle}>
            <p style={eyebrowStyle}>Drive maintenance</p>
            <h3 style={toolHeadingStyle}>Lookup missing Drive IDs</h3>
            <p style={descriptionStyle}>
              Look up Google Drive files for uploaded assets that do not yet have a known Drive ID. This can take a while; detailed results are written to the browser console.
            </p>
            {authUser?.authenticated && (
              <button
                type="button"
                onClick={() => void lookupMissingDriveSources()}
                disabled={driveLookupRunning}
                title="Look up Drive files for all assets that do not have a known Drive ID"
                style={secondaryButtonStyle}
              >
                <span style={iconStyle} aria-hidden="true">manage_search</span>
                {driveLookupRunning ? "Looking up Drive IDs..." : "Lookup missing Drive IDs"}
              </button>
            )}
          </section>

          <section style={toolSectionStyle}>
            <p style={eyebrowStyle}>Caption maintenance</p>
            <h3 style={toolHeadingStyle}>Remove accidental “Screenshot” captions</h3>
            <p style={descriptionStyle}>
              Find assets whose caption is exactly “Screenshot” and clear that caption. Other captions are left unchanged.
            </p>
            {authUser?.authenticated && (
              <button
                type="button"
                onClick={() => void clearScreenshotCaptions()}
                disabled={screenshotCleanupRunning}
                title="Clear exact Screenshot captions from Immich assets"
                style={secondaryButtonStyle}
              >
                <span style={iconStyle} aria-hidden="true">cleaning_services</span>
                {screenshotCleanupRunning ? "Removing captions..." : "Remove Screenshot captions"}
              </button>
            )}
          </section>

          <p style={descriptionStyle}>
            The retired documentation gallery migration tools have been removed. Additional Atlas administration tools can be added here in the future.
          </p>
        </section>
      </section>
      <style>{`
        @media (max-width: 760px) {
          .atlas-tools-tabs { overflow-x: auto; }
        }
      `}</style>
    </main>
  );
}

const pageStyle: React.CSSProperties = {
  minHeight: "100vh",
  background: "#0b0d12",
  color: "#ddd",
  padding: "22px 24px 28px",
  boxSizing: "border-box",
};
const panelStyle: React.CSSProperties = { width: "100%", minHeight: "calc(100vh - 50px)" };
const headerStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 18 };
const brandStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 14, color: "inherit", textDecoration: "none" };
const logoStyle: React.CSSProperties = { height: 40, width: "auto" };
const titleStyle: React.CSSProperties = { margin: 0, fontSize: 22, fontWeight: 600 };
const accountStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 10, color: "#aeb6c5", fontSize: 13 };
const tabsStyle: React.CSSProperties = { display: "flex", gap: 8, marginBottom: 22, borderBottom: "1px solid rgba(255,255,255,0.14)" };
const tabStyle: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, background: "transparent", color: "#9aa3b3", borderBottom: "2px solid transparent", padding: "10px 14px", cursor: "pointer", fontSize: 15, fontWeight: 600, textDecoration: "none", whiteSpace: "nowrap" };
const activeTabStyle: React.CSSProperties = { color: "#eef3fb", borderBottomColor: "#e8edf8" };
const iconStyle: React.CSSProperties = { fontFamily: "'Material Symbols Outlined'", fontSize: 20 };
const contentStyle: React.CSSProperties = { maxWidth: 820, paddingTop: 24 };
const eyebrowStyle: React.CSSProperties = { margin: "0 0 4px", color: "#9aa3b3", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 11, fontWeight: 700 };
const headingStyle: React.CSSProperties = { margin: 0, fontSize: 28, fontWeight: 600, color: "#f3f5fa" };
const toolSectionStyle: React.CSSProperties = { marginTop: 28, padding: 20, border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6, background: "rgba(255,255,255,0.025)" };
const toolHeadingStyle: React.CSSProperties = { margin: "0 0 8px", fontSize: 20, fontWeight: 600, color: "#f3f5fa" };
const descriptionStyle: React.CSSProperties = { color: "#aeb6c5", lineHeight: 1.6 };
const secondaryButtonStyle: React.CSSProperties = { background: "transparent", color: "#ddd", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 4, padding: "8px 11px", cursor: "pointer", whiteSpace: "nowrap" };
const successNoticeStyle: React.CSSProperties = { color: "#9df7a8", background: "rgba(20,180,80,0.13)", border: "1px solid rgba(80,220,120,0.25)", padding: 10, borderRadius: 4, margin: "18px 0 0" };
const warningNoticeStyle: React.CSSProperties = { color: "#ffe2a8", background: "rgba(220,150,40,0.14)", border: "1px solid rgba(240,185,80,0.28)", padding: 10, borderRadius: 4, margin: "18px 0 0" };
const errorStyle: React.CSSProperties = { color: "#ffb0b0", background: "rgba(255,0,0,0.12)", border: "1px solid rgba(255,0,0,0.22)", padding: 10, borderRadius: 4, marginBottom: 12 };
