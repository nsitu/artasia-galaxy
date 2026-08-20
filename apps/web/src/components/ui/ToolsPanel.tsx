import { useEffect, useState } from "react";
import {
  applyDocumentationGalleryMigration,
  applyPlacementTagCleanup,
  deleteEmptyLegacyTags,
  fetchAuthUser,
  logoutAuthUser,
  previewDocumentationGalleryMigration,
  previewPlacementTagCleanup,
  type AuthUser,
  type DocumentationGalleryMigrationDocument,
  type DocumentationGalleryMigrationReport,
  type PlacementTagCleanupReport,
} from "../../api/client";

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
  const [report, setReport] = useState<DocumentationGalleryMigrationReport | null>(null);
  const [cleanupReport, setCleanupReport] = useState<PlacementTagCleanupReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [cleanupLoading, setCleanupLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [cleanupApplying, setCleanupApplying] = useState(false);
  const [deletingLegacyTags, setDeletingLegacyTags] = useState(false);
  const [error, setError] = useState(initialError ?? "");
  const [notice, setNotice] = useState("");

  async function loadPreview() {
    setLoading(true);
    setError("");
    setNotice("");
    try {
      const nextReport = await previewDocumentationGalleryMigration();
      setReport(nextReport);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function loadCleanupPreview() {
    setCleanupLoading(true);
    setError("");
    try {
      setCleanupReport(await previewPlacementTagCleanup());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCleanupLoading(false);
    }
  }

  useEffect(() => {
    void fetchAuthUser()
      .then(setAuthUser)
      .catch((err) => setError((err as Error).message));
    void loadPreview();
    void loadCleanupPreview();
  }, []);

  async function applyMigration() {
    if (!report || report.exactMatches === 0) return;
    const confirmed = window.confirm(
      `Apply ${report.exactMatches} exact filename match${report.exactMatches === 1 ? "" : "es"}? This will tag the matching Immich assets as Process and may update their descriptions when a WordPress caption is longer.`,
    );
    if (!confirmed) return;

    setApplying(true);
    setError("");
    setNotice("");
    try {
      const applied = await applyDocumentationGalleryMigration();
      setReport(applied);
      setNotice(
        `Migration applied: ${applied.assetsToTag} asset${applied.assetsToTag === 1 ? "" : "s"} tagged as Process, ${applied.descriptionsToUpdate} description${applied.descriptionsToUpdate === 1 ? "" : "s"} updated, and ${applied.sourceDocumentsUpdated} WordPress document${applied.sourceDocumentsUpdated === 1 ? "" : "s"} switched to Atlas.${applied.sourceUpdateError ? ` WordPress source updates failed: ${applied.sourceUpdateError}` : ""}` ,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  async function signOut() {
    try {
      await logoutAuthUser();
    } finally {
      window.location.href = "/admin";
    }
  }

  async function applyCleanup() {
    if (!cleanupReport || (cleanupReport.assetsToAnchor === 0 && cleanupReport.membershipsToRemove === 0)) return;
    const confirmed = window.confirm(
      `Backfill ${cleanupReport.assetsToAnchor} durable placement anchor${cleanupReport.assetsToAnchor === 1 ? "" : "s"} and remove ${cleanupReport.membershipsToRemove} safe legacy tag membership${cleanupReport.membershipsToRemove === 1 ? "" : "s"}? Ambiguous and conflicting assets will be left untouched.`,
    );
    if (!confirmed) return;

    setCleanupApplying(true);
    setError("");
    setNotice("");
    try {
      const applied = await applyPlacementTagCleanup();
      setCleanupReport(applied);
      setNotice(
        `Placement tag cleanup applied: ${applied.assetsToAnchor} durable anchor${applied.assetsToAnchor === 1 ? "" : "s"} backfilled and ${applied.membershipsToRemove} legacy membership${applied.membershipsToRemove === 1 ? "" : "s"} removed.`,
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCleanupApplying(false);
    }
  }

  async function removeEmptyLegacyTags() {
    if (!cleanupReport) return;
    const emptyTags = cleanupReport.legacyTags.filter((tag) => tag.assetCount === 0 && tag.membershipsToRemove === 0);
    if (emptyTags.length === 0) return;
    const confirmed = window.confirm(
      `Delete ${emptyTags.length} empty legacy placement tag${emptyTags.length === 1 ? "" : "s"}? Atlas will recheck timeline, archive, hidden, and locked assets before deleting each tag.`,
    );
    if (!confirmed) return;

    setDeletingLegacyTags(true);
    setError("");
    setNotice("");
    try {
      const result = await deleteEmptyLegacyTags();
      setNotice(
        `Deleted ${result.deleted} empty legacy tag${result.deleted === 1 ? "" : "s"}.${result.failed > 0 ? ` ${result.failed} tag${result.failed === 1 ? "" : "s"} could not be deleted.` : ""}`,
      );
      await loadCleanupPreview();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingLegacyTags(false);
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
            <span>
              {authUser?.name ?? authUser?.email ?? "Artasia user"}
            </span>
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
        {notice && <div style={successStyle}>{notice}</div>}

        <section style={contentStyle}>
          <div style={headingRowStyle}>
            <div>
              <p style={eyebrowStyle}>Maintenance</p>
              <h2 style={headingStyle}>Documentation gallery migration</h2>
            </div>
            <button type="button" onClick={() => void loadPreview()} disabled={loading || applying} style={secondaryButtonStyle}>
              {loading ? "Scanning…" : "Refresh preview"}
            </button>
          </div>
          <p style={descriptionStyle}>
            Compare legacy WordPress documentation galleries with the Immich assets already assigned to their placements. Exact, unambiguous filename matches can be tagged as Process. WordPress captions replace Immich descriptions only when the caption is non-empty and longer than the existing description.
          </p>

          {loading && <div style={loadingStyle}><span style={spinnerStyle} /> Scanning WordPress and Immich…</div>}

          {report && !loading && (
            <>
              <div style={summaryGridStyle}>
                <Summary label="Documents" value={report.documentsScanned} />
                <Summary label="Ready" value={report.documentsReady} />
                <Summary label="Exact matches" value={report.exactMatches} />
                <Summary label="Assets to tag" value={report.assetsToTag} />
                <Summary label="Descriptions to update" value={report.descriptionsToUpdate} />
                <Summary label="WordPress sources" value={report.sourceDocumentsToUpdate} />
                <Summary label="Needs review" value={report.unmatchedImages + report.ambiguousImages} warning />
              </div>

              <div style={actionRowStyle}>
                <button
                  type="button"
                  onClick={() => void applyMigration()}
                  disabled={applying || report.exactMatches === 0}
                  style={primaryButtonStyle}
                >
                  {applying ? "Applying migration…" : "Apply exact matches"}
                </button>
                <span style={mutedStyle}>
                  {report.dryRun ? "Preview only — no Immich changes have been made." : "This report reflects the completed migration pass."}
                </span>
              </div>

              <div style={documentListStyle}>
                {report.documents.map((document) => (
                  <MigrationDocumentRow key={document.documentId} document={document} />
                ))}
                {report.documents.length === 0 && (
                  <div style={emptyStyle}>No published WordPress galleries using the legacy WordPress source were found.</div>
                )}
              </div>
            </>
          )}

          <section style={toolSectionStyle}>
            <div className="atlas-tools-heading" style={headingRowStyle}>
              <div>
                <p style={eyebrowStyle}>Maintenance</p>
                <h2 style={headingStyle}>Placement tag cleanup</h2>
              </div>
              <button type="button" onClick={() => void loadCleanupPreview()} disabled={cleanupLoading || cleanupApplying} style={secondaryButtonStyle}>
                {cleanupLoading ? "Scanning…" : "Refresh preview"}
              </button>
            </div>
            <p style={descriptionStyle}>
              Backfill durable <code>placement:&lt;id&gt;</code> tags for unambiguous legacy partner or placement-name matches, then detach those human-readable tags from safely anchored assets. Legacy memberships without a unique durable match, and placement conflicts, are left untouched for manual review. The legacy read fallback remains available during this transition.
            </p>

            {cleanupLoading && <div style={loadingStyle}><span style={spinnerStyle} /> Scanning Immich placement tags…</div>}
            {cleanupReport && !cleanupLoading && (
              <>
                <div style={summaryGridStyle}>
                  <Summary label="Legacy tags" value={cleanupReport.legacyTagsFound} />
                  <Summary label="Legacy memberships" value={cleanupReport.legacyMemberships} />
                  <Summary label="Assets to anchor" value={cleanupReport.assetsToAnchor} />
                  <Summary label="Memberships to remove" value={cleanupReport.membershipsToRemove} />
                  <Summary label="Ambiguous" value={cleanupReport.ambiguousAssets.length} warning />
                  <Summary label="Conflicts" value={cleanupReport.conflictingAssets.length} warning />
                </div>
                <div style={actionRowStyle}>
                  <button
                    type="button"
                    onClick={() => void applyCleanup()}
                    disabled={cleanupApplying || (cleanupReport.assetsToAnchor === 0 && cleanupReport.membershipsToRemove === 0)}
                    style={primaryButtonStyle}
                  >
                    {cleanupApplying ? "Applying cleanup…" : "Apply safe cleanup"}
                  </button>
                  <span style={mutedStyle}>
                    {cleanupReport.dryRun ? "Preview only — no placement tags have changed." : "This report reflects the completed cleanup pass."}
                  </span>
                </div>
                {cleanupReport.legacyTags.some((tag) => tag.assetCount === 0 && tag.membershipsToRemove === 0) && (
                  <div style={actionRowStyle}>
                    <button
                      type="button"
                      onClick={() => void removeEmptyLegacyTags()}
                      disabled={deletingLegacyTags || cleanupApplying}
                      style={secondaryButtonStyle}
                    >
                      {deletingLegacyTags ? "Deleting empty tags…" : "Delete empty legacy tags"}
                    </button>
                    <span style={mutedStyle}>Only tags with no memberships in any Immich visibility state will be deleted.</span>
                  </div>
                )}
                {cleanupReport.legacyTags.length > 0 && (
                  <div style={tagTableStyle}>
                    {cleanupReport.legacyTags.map((tag) => (
                      <div key={tag.tagId} style={tagRowStyle}>
                        <strong>{tag.tagName}</strong>
                        <span style={mutedStyle}>
                          {tag.assetCount} asset{tag.assetCount === 1 ? "" : "s"} · {tag.membershipsToRemove} membership{tag.membershipsToRemove === 1 ? "" : "s"} eligible for removal
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {(cleanupReport.ambiguousAssets.length > 0 || cleanupReport.conflictingAssets.length > 0) && (
                  <details style={documentRowStyle}>
                    <summary style={documentSummaryStyle}>Review unresolved assets</summary>
                    <div style={documentDetailsStyle}>
                      {[...cleanupReport.ambiguousAssets, ...cleanupReport.conflictingAssets].map((issue) => (
                        <div key={`${issue.reason}-${issue.assetId}`} style={issueStyle}>
                          <strong>{issue.assetId}</strong> · {issue.reason} · legacy tags: {issue.legacyTags.join(", ")}
                        </div>
                      ))}
                    </div>
                  </details>
                )}
                {cleanupReport.legacyTags.length === 0 && (
                  <div style={emptyStyle}>No configured partner or placement-name tags were found in Immich.</div>
                )}
              </>
            )}
          </section>
        </section>
      </section>
      <style>{`
        @keyframes atlas-tools-spin { to { transform: rotate(360deg); } }
        @media (max-width: 760px) {
          .atlas-tools-tabs { overflow-x: auto; }
          .atlas-tools-heading { align-items: flex-start !important; flex-direction: column !important; }
        }
      `}</style>
    </main>
  );
}

function Summary({ label, value, warning = false }: { label: string; value: number; warning?: boolean }) {
  return (
    <div style={{ ...summaryCardStyle, ...(warning && value > 0 ? warningCardStyle : {}) }}>
      <strong style={summaryValueStyle}>{value}</strong>
      <span style={summaryLabelStyle}>{label}</span>
    </div>
  );
}

function MigrationDocumentRow({ document }: { document: DocumentationGalleryMigrationDocument }) {
  const issueCount = document.unmatched.length + document.ambiguous.length;
  const status = document.skippedReason
    ? document.skippedReason
    : issueCount > 0
      ? `${issueCount} image${issueCount === 1 ? "" : "s"} need review`
      : `${document.matches.length} exact match${document.matches.length === 1 ? "" : "es"}`;

  return (
    <details style={documentRowStyle}>
      <summary style={documentSummaryStyle}>
        <span>
          <strong>{document.documentTitle}</strong>
          <span style={documentMetaStyle}>{document.placementNames.join(", ") || "No placement"}</span>
        </span>
        <span style={issueCount > 0 || document.skippedReason ? warningTextStyle : successTextStyle}>{status}</span>
      </summary>
      <div style={documentDetailsStyle}>
        <details style={assetInventoryStyle}>
          <summary style={assetInventorySummaryStyle}>
            Immich placement filenames ({document.placementAssets.reduce((total, placement) => total + placement.fileNames.length, 0)})
          </summary>
          <div style={assetInventoryDetailsStyle}>
            {document.placementAssets.map((placement) => (
              <div key={placement.placementId}>
                <strong>{placement.placementName}</strong>
                {placement.fileNames.length > 0 ? (
                  <ul style={assetFileListStyle}>
                    {placement.fileNames.map((fileName, index) => <li key={`${placement.placementId}-${index}-${fileName}`}>{fileName}</li>)}
                  </ul>
                ) : (
                  <div style={mutedStyle}>No published image assets found for this placement.</div>
                )}
              </div>
            ))}
            {document.placementAssets.length === 0 && (
              <div style={mutedStyle}>No placement is selected.</div>
            )}
          </div>
        </details>
        {document.matches.map((match) => (
          <div key={`${match.assetId}-${match.attachmentId}`} style={matchStyle}>
            <span>{match.wordpressFileName} → {match.immichFileName}</span>
            <span style={mutedStyle}>
              {match.assetAlreadyProcess ? "Already Process" : "Will tag Process"}
              {match.descriptionAction === "update" ? " · WordPress caption will replace description" : ""}
              {match.descriptionAction === "preserve" ? " · Existing Immich description preserved" : ""}
            </span>
          </div>
        ))}
        {document.unmatched.map((item) => (
          <div key={`unmatched-${item.attachmentId}`} style={issueStyle}>
            No Immich placement asset matched <strong>{item.wordpressFileName}</strong>.
          </div>
        ))}
        {document.ambiguous.map((item) => (
          <div key={`ambiguous-${item.attachmentId}`} style={issueStyle}>
            <strong>{item.wordpressFileName}</strong> matched {item.assetIds.length} Immich assets and was not changed.
          </div>
        ))}
      </div>
    </details>
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
const contentStyle: React.CSSProperties = { maxWidth: 1180 };
const toolSectionStyle: React.CSSProperties = { marginTop: 42, paddingTop: 28, borderTop: "1px solid rgba(255,255,255,0.14)" };
const headingRowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 18, marginBottom: 12 };
const eyebrowStyle: React.CSSProperties = { margin: "0 0 4px", color: "#9aa3b3", textTransform: "uppercase", letterSpacing: "0.12em", fontSize: 11, fontWeight: 700 };
const headingStyle: React.CSSProperties = { margin: 0, fontSize: 28, fontWeight: 600, color: "#f3f5fa" };
const descriptionStyle: React.CSSProperties = { maxWidth: 820, color: "#aeb6c5", lineHeight: 1.6 };
const summaryGridStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))", gap: 10, margin: "22px 0" };
const summaryCardStyle: React.CSSProperties = { padding: "14px 16px", background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5 };
const warningCardStyle: React.CSSProperties = { borderColor: "rgba(240,185,80,0.45)" };
const summaryValueStyle: React.CSSProperties = { display: "block", color: "#f3f5fa", fontSize: 24 };
const summaryLabelStyle: React.CSSProperties = { color: "#9aa3b3", fontSize: 12 };
const actionRowStyle: React.CSSProperties = { display: "flex", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 24 };
const primaryButtonStyle: React.CSSProperties = { background: "#e8edf8", color: "#0b0d12", border: "1px solid #e8edf8", borderRadius: 4, padding: "9px 13px", fontWeight: 700, cursor: "pointer" };
const secondaryButtonStyle: React.CSSProperties = { background: "transparent", color: "#ddd", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 4, padding: "8px 11px", cursor: "pointer", whiteSpace: "nowrap" };
const mutedStyle: React.CSSProperties = { color: "#8f98a8", fontSize: 12 };
const loadingStyle: React.CSSProperties = { display: "flex", alignItems: "center", gap: 9, padding: 18, color: "#c9d1df" };
const spinnerStyle: React.CSSProperties = { width: 15, height: 15, border: "3px solid #c9d1df", borderRightColor: "transparent", borderRadius: "50%", animation: "atlas-tools-spin 700ms linear infinite" };
const documentListStyle: React.CSSProperties = { display: "grid", gap: 8 };
const assetInventoryStyle: React.CSSProperties = { marginBottom: 14, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 4 };
const assetInventorySummaryStyle: React.CSSProperties = { cursor: "pointer", padding: "10px 12px", color: "#c9d1df", fontSize: 13, fontWeight: 600 };
const assetInventoryDetailsStyle: React.CSSProperties = { display: "grid", gap: 14, padding: "0 12px 12px", color: "#c9d1df", fontSize: 13 };
const assetFileListStyle: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", columnGap: 24, margin: "8px 0 0", paddingLeft: 22, color: "#aeb6c5", lineHeight: 1.6 };
const tagTableStyle: React.CSSProperties = { display: "grid", gap: 6, marginBottom: 18 };
const tagRowStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap", padding: "9px 11px", background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.10)", color: "#dce2ec", fontSize: 13 };
const documentRowStyle: React.CSSProperties = { background: "rgba(255,255,255,0.045)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 5 };
const documentSummaryStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14, padding: "13px 15px", cursor: "pointer", listStyle: "none" };
const documentMetaStyle: React.CSSProperties = { display: "block", marginTop: 4, color: "#8f98a8", fontSize: 12 };
const documentDetailsStyle: React.CSSProperties = { padding: "0 15px 13px", display: "grid", gap: 7 };
const matchStyle: React.CSSProperties = { display: "grid", gap: 3, padding: "8px 10px", background: "rgba(70,190,110,0.08)", color: "#dce7e0", fontSize: 13 };
const issueStyle: React.CSSProperties = { padding: "8px 10px", background: "rgba(230,170,60,0.10)", color: "#ffe2a8", fontSize: 13 };
const successTextStyle: React.CSSProperties = { color: "#9df7a8", fontSize: 12, whiteSpace: "nowrap" };
const warningTextStyle: React.CSSProperties = { color: "#ffe2a8", fontSize: 12, whiteSpace: "nowrap" };
const emptyStyle: React.CSSProperties = { padding: 18, color: "#9aa3b3" };
const successStyle: React.CSSProperties = { color: "#9df7a8", background: "rgba(20,180,80,0.13)", border: "1px solid rgba(80,220,120,0.25)", padding: 10, borderRadius: 4, marginBottom: 12 };
const errorStyle: React.CSSProperties = { color: "#ffb0b0", background: "rgba(255,0,0,0.12)", border: "1px solid rgba(255,0,0,0.22)", padding: 10, borderRadius: 4, marginBottom: 12 };
