import { useEffect, useRef, useState } from "react";
import { cancelDriveAutoImport, fetchDriveAutoImportResults, fetchDriveAutoImportStatus, startDriveAutoImport,
  type DriveAutoImportResult, type DriveAutoImportStatus } from "../../api/client";

const statusLabels = {
  running: "In progress", completed: "Completed successfully", completed_with_issues: "Completed with issues",
  no_matches: "No matching activity folders", failed: "Failed", cancelled: "Cancelled", interrupted: "Interrupted by a server restart",
};
const phaseLabels = { scanning: "Scanning Drive folders", indexing: "Checking existing Immich assets", importing: "Importing media", verifying: "Verifying imported tags", done: "Finished" };

export default function DriveAutoImportPanel(props: {
  placementId: number;
  folderId?: string;
  authenticated: boolean;
  manualImportRunning: boolean;
  onRunningChange: (running: boolean) => void;
  onCompleted: (placementId: number) => void;
}) {
  const [status, setStatus] = useState<DriveAutoImportStatus | null>(null);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [acting, setActing] = useState(false);
  const [results, setResults] = useState<DriveAutoImportResult[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(0);
  const [resultsLoading, setResultsLoading] = useState(false);
  const callbacks = useRef(props);
  callbacks.current = props;
  const mounted = useRef(false);
  const generation = useRef(0);
  const latestJob = useRef<string>();
  const notified = useRef<string>();
  const job = status?.latest;
  latestJob.current = job?.jobId;
  const running = job?.status === "running";

  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      const requestGeneration = generation.current;
      let interval = 15_000;
      try {
        const update = await fetchDriveAutoImportStatus(props.placementId);
        if (stopped) return;
        failures = 0;
        if (requestGeneration === generation.current) { setStatus(update); setConnectionError(""); }
        interval = update.latest?.status === "running" ? 1500 : 15_000;
      } catch (err) {
        if (stopped) return;
        setConnectionError(`Could not refresh progress. The server job may still be running. ${(err as Error).message}`);
        interval = Math.min(30_000, 2000 * 2 ** failures++);
      }
      if (!stopped) timer = setTimeout(poll, interval);
    }
    void poll();
    return () => { stopped = true; mounted.current = false; clearTimeout(timer); callbacks.current.onRunningChange(false); };
  }, [props.placementId, running]);

  useEffect(() => { callbacks.current.onRunningChange(running); }, [running]);
  useEffect(() => {
    setResults([]); setNextCursor(0);
  }, [job?.jobId, job?.status]);
  useEffect(() => {
    if (job && job.status !== "running" && job.jobId !== notified.current) {
      notified.current = job.jobId;
      callbacks.current.onCompleted(job.placementId);
    }
  }, [job?.jobId, job?.status]);

  async function start() {
    setActing(true); setError(""); generation.current++;
    try {
      const started = await startDriveAutoImport(props.placementId);
      if (!mounted.current) return;
      setStatus((current) => ({ latest: started, lastSuccessful: current?.lastSuccessful ?? null, configurationChanged: current?.configurationChanged ?? false }));
    } catch (err) { if (mounted.current) setError((err as Error).message); }
    finally { if (mounted.current) setActing(false); }
  }
  async function cancel() {
    if (!job) return;
    setActing(true); setError(""); generation.current++;
    try {
      const cancelled = await cancelDriveAutoImport(job.jobId);
      if (mounted.current) setStatus((current) => current ? { ...current, latest: cancelled } : null);
    } catch (err) { if (mounted.current) setError((err as Error).message); }
    finally { if (mounted.current) setActing(false); }
  }
  async function loadResults() {
    if (!job || nextCursor === null) return;
    const id = job.jobId;
    setResultsLoading(true); setError("");
    try {
      const page = await fetchDriveAutoImportResults(id, nextCursor);
      if (!mounted.current || latestJob.current !== id) return;
      setResults((current) => [...current, ...page.results]); setNextCursor(page.nextCursor);
    } catch (err) { if (mounted.current) setError((err as Error).message); }
    finally { if (mounted.current) setResultsLoading(false); }
  }
  const disabledReason = !props.authenticated ? "Sign in to auto-import." : !props.folderId?.trim()
    ? "Configure this placement's Google Drive folder first." : props.manualImportRunning ? "Wait for the selected-file import to finish." : !status ? "Loading sync history…" : "";
  const completed = job ? job.eligible - job.counts.pending : 0;

  return <section aria-label="Placement auto-import" style={{ border: "1px solid #cbd5e1", background: "#f8fafc", borderRadius: 12, padding: 18, color: "#172033", display: "grid", gap: 12 }}>
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div><h3 style={{ margin: 0, fontSize: 16 }}>Placement auto-import</h3>
        <p style={{ margin: "6px 0 0", fontSize: 13, maxWidth: 680 }}>Import new media from all matching activity folders and their subfolders. Existing sources—including archive and trash—are skipped. Nothing is replaced or published.</p>
      </div>
      {running ? <button type="button" style={buttonStyle} onClick={() => void cancel()} disabled={acting || job.cancelRequested}>
        {job.cancelRequested ? "Cancelling…" : "Cancel auto-import"}
      </button> : <button type="button" style={buttonStyle} onClick={() => void start()} disabled={acting || Boolean(disabledReason)} title={disabledReason}>
        {acting ? "Starting…" : "Auto-import placement"}
      </button>}
    </div>
    {disabledReason && !running && <div style={{ fontSize: 13 }}>{disabledReason}</div>}
    <div style={{ fontSize: 13 }}>
      Last successful sync: {status?.lastSuccessful?.finishedAt ? <time dateTime={status.lastSuccessful.finishedAt}>{new Date(status.lastSuccessful.finishedAt).toLocaleString()}</time> : status ? "Never" : "Loading…"}
      {status?.configurationChanged && <span> — source folder or configuration has changed since this run.</span>}
    </div>
    {job && <div style={{ display: "grid", gap: 8 }}>
      <div role="status" aria-live="polite" style={{ fontSize: 14 }}>
        <strong>{running ? phaseLabels[job.phase] : statusLabels[job.status]}</strong>
        {running && <> · {job.foldersScanned} folders scanned · {job.counts.discovered} files found</>}
        {!running && job.finishedAt && <> · {new Date(job.finishedAt).toLocaleString()}</>}
      </div>
      {running && (job.phase === "importing" || job.phase === "verifying") && <>
        <progress aria-label="Eligible files processed" max={Math.max(job.eligible, 1)} value={completed} style={{ width: "100%" }} />
        <span style={{ fontSize: 12 }}>{completed} of {job.eligible} eligible files processed (file count, not bytes)</span>
      </>}
      {job.current && <div style={{ fontSize: 12, overflowWrap: "anywhere" }}>{job.current}</div>}
      <div style={{ fontSize: 13 }}>{job.counts.imported} imported · {job.counts.existing} already present · {job.counts.excluded} excluded · {job.counts.needsReview} need review · {job.counts.failed} failed</div>
      {job.status === "no_matches" && <div style={{ fontSize: 13 }}>No activity folders matched the existing week-number rules. Check the folder names and activity configuration.</div>}
      {job.status === "completed_with_issues" && <div style={{ fontSize: 13 }}>Review the results below. The last successful sync has not been changed.</div>}
      {job.error && <div role="alert" style={{ color: "#9b1c1c", fontSize: 13 }}>{job.error}</div>}
      {!running && job.resultCount > 0 && <details onToggle={(event) => { if (event.currentTarget.open && results.length === 0 && !resultsLoading) void loadResults(); }}>
        <summary style={{ cursor: "pointer", fontSize: 13 }}>View folder and file results ({job.resultCount})</summary>
        <ul style={{ listStyle: "none", padding: 0, maxHeight: 360, overflow: "auto" }}>
          {results.map((item, index) => <li key={`${item.fileId}-${index}`} style={{ borderBottom: "1px solid #dbe2ea", padding: "9px 0", fontSize: 12, overflowWrap: "anywhere" }}>
            <a href={`https://drive.google.com/open?id=${encodeURIComponent(item.fileId)}`} target="_blank" rel="noopener noreferrer">{item.path}</a>
            <div>{item.status.replaceAll("_", " ")}{item.activityLabel ? ` · ${item.activityLabel}` : ""}{item.detail ? ` — ${item.detail}` : ""}</div>
          </li>)}
        </ul>
        {nextCursor !== null && <button type="button" style={buttonStyle} disabled={resultsLoading} onClick={() => void loadResults()}>{resultsLoading ? "Loading…" : "Load results"}</button>}
      </details>}
    </div>}
    {(error || connectionError) && <div role="alert" style={{ color: "#9b1c1c", fontSize: 13 }}>{error || connectionError}</div>}
  </section>;
}

const buttonStyle = { border: "1px solid #334155", borderRadius: 7, padding: "9px 14px", background: "#fff", color: "#172033", fontSize: 13, cursor: "pointer" };
