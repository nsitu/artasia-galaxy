import { useEffect, useRef, useState } from "react";
import { cancelDriveProcessBackfill, fetchDriveProcessResults, fetchDriveProcessStatus, startDriveProcessBackfill,
  type DriveProcessJob, type DriveProcessResult } from "../../api/client";

const statusLabels = { running: "In progress", completed: "Completed successfully", completed_with_issues: "Completed with issues", cancelled: "Cancelled", failed: "Failed" };
const resultLabels = { tagged: "Tagged Process", already_process: "Already Process", not_process: "Not a Process folder", needs_review: "Needs review", failed: "Failed" };

export default function DriveProcessBackfillPanel(props: {
  authenticated: boolean;
  otherDriveToolRunning: boolean;
  onRunningChange: (running: boolean) => void;
}) {
  const [job, setJob] = useState<DriveProcessJob | null>(null);
  const [ready, setReady] = useState(false);
  const [acting, setActing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  const [connectionError, setConnectionError] = useState("");
  const [results, setResults] = useState<DriveProcessResult[]>([]);
  const [nextCursor, setNextCursor] = useState<number | null>(0);
  const [resultsLoading, setResultsLoading] = useState(false);
  const mounted = useRef(false);
  const generation = useRef(0);
  const mutating = useRef(false);
  const latestJob = useRef(job?.jobId);
  latestJob.current = job?.jobId;
  const callback = useRef(props.onRunningChange);
  callback.current = props.onRunningChange;
  const running = job?.status === "running";

  useEffect(() => {
    mounted.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      const version = generation.current;
      let interval = 10_000;
      try {
        const response = await fetchDriveProcessStatus();
        if (stopped) return;
        if (version === generation.current && !mutating.current) { setJob(response.latest); setReady(true); setConnectionError(""); }
        interval = response.latest?.status === "running" ? 1500 : 10_000;
      } catch (err) {
        if (!stopped) setConnectionError(`Could not refresh progress. A started job may still be running. ${(err as Error).message}`);
      }
      if (!stopped) timer = setTimeout(poll, interval);
    }
    if (props.authenticated) void poll();
    return () => { stopped = true; mounted.current = false; clearTimeout(timer); };
  }, [props.authenticated, running]);
  useEffect(() => { callback.current(running); }, [running]);
  useEffect(() => () => { callback.current(false); }, []);
  useEffect(() => { setResults([]); setNextCursor(0); setResultsLoading(false); }, [job?.jobId, job?.status]);

  async function act(cancel = false) {
    setConfirming(false);
    mutating.current = true; generation.current++; setActing(true); setError("");
    try {
      const update = cancel && job ? await cancelDriveProcessBackfill(job.jobId) : await startDriveProcessBackfill();
      if (mounted.current) setJob(update);
    } catch (err) { if (mounted.current) setError((err as Error).message); }
    finally { mutating.current = false; generation.current++; if (mounted.current) setActing(false); }
  }
  async function loadResults() {
    if (!job || nextCursor === null || resultsLoading) return;
    const id = job.jobId;
    setResultsLoading(true); setError("");
    try {
      const page = await fetchDriveProcessResults(id, nextCursor);
      if (!mounted.current || latestJob.current !== id) return;
      setResults((current) => [...current, ...page.results]); setNextCursor(page.nextCursor);
    } catch (err) { if (mounted.current && latestJob.current === id) setError((err as Error).message); }
    finally { if (mounted.current && latestJob.current === id) setResultsLoading(false); }
  }

  return <section aria-label="Tag existing Process assets" style={sectionStyle}>
    <h3 style={{ margin: "0 0 8px", fontSize: 20, color: "#f3f5fa" }}>Tag existing Process assets</h3>
    <p style={descriptionStyle}>Check assets with a Drive ID that are not already Process. If their immediate parent folder name contains <strong>process</strong> (any casing), add the Process asset type. This checks the parent folder only, not higher ancestors.</p>
    <p style={descriptionStyle}>Includes archived, trashed, and hidden assets accessible to Atlas. Other tags, activity assignments, and publication stay unchanged. No files are imported or restored.</p>
    {running ? <button type="button" style={buttonStyle} disabled={acting || job.cancelRequested} onClick={() => void act(true)}>{job.cancelRequested ? "Cancelling…" : "Cancel Process tagging"}</button>
      : <button type="button" style={buttonStyle} disabled={!props.authenticated || !ready || acting || props.otherDriveToolRunning || confirming} onClick={() => setConfirming(true)}>{acting ? "Starting…" : "Tag Process assets from Drive"}</button>}
    {confirming && !running && <div style={{ marginTop: 12 }}>
      <p style={descriptionStyle}>Apply this metadata update across the accessible Immich library, including archive and trash?</p>
      <button type="button" style={buttonStyle} disabled={acting || props.otherDriveToolRunning} onClick={() => void act()}>Confirm Process tagging</button>{" "}
      <button type="button" style={buttonStyle} onClick={() => setConfirming(false)}>Back</button>
    </div>}
    {props.otherDriveToolRunning && !running && <p style={descriptionStyle}>Wait for the other Drive maintenance operation to finish.</p>}
    {!props.authenticated && <p style={descriptionStyle}>Sign in with Google to check Drive folders.</p>}
    {job && <div style={{ marginTop: 16, display: "grid", gap: 8 }}>
      <div role="status" aria-live="polite"><strong>{running ? job.phase === "indexing" ? "Scanning Immich assets" : "Checking Drive folders and verifying tags" : statusLabels[job.status]}</strong>{job.finishedAt && <> · {new Date(job.finishedAt).toLocaleString()}</>}</div>
      <div>{job.counts.scanned} scanned · {job.counts.checked} checked</div>
      {running && job.phase === "checking" && <progress aria-label="Assets checked for Process type" max={Math.max(job.counts.scanned, 1)} value={job.counts.checked} style={{ width: "100%" }} />}
      {job.current && <div style={{ overflowWrap: "anywhere", fontSize: 13 }}>{job.current}</div>}
      <div style={{ fontSize: 13 }}>{job.counts.tagged} tagged Process · {job.counts.alreadyProcess} already Process · {job.counts.noSource} without Drive ID · {job.counts.notProcess} non-Process folders · {job.counts.needsReview} need review · {job.counts.failed} failed</div>
      {job.status === "cancelled" && <p style={descriptionStyle}>Stopped early. Completed tag changes remain. A tag in flight may have completed; rerun to check remaining assets.</p>}
      {job.error && <div role="alert" style={errorStyle}>{job.error}</div>}
      {!running && job.resultCount > 0 && <details key={`${job.jobId}-${job.status}`} onToggle={(event) => { if (event.currentTarget.open && results.length === 0) void loadResults(); }}>
        <summary style={{ cursor: "pointer" }}>View asset results ({job.resultCount})</summary>
        <ul style={{ paddingLeft: 20, maxHeight: 360, overflow: "auto" }}>
          {results.map((result) => <li key={result.assetId} style={{ padding: "8px 0", overflowWrap: "anywhere", fontSize: 13 }}>
            <strong>{result.fileName || result.assetId}</strong> — {resultLabels[result.status]}
            <div>Immich asset: {result.assetId}</div>
            {result.fileId && <a style={{ color: "#9fc8ff" }} href={`https://drive.google.com/open?id=${encodeURIComponent(result.fileId)}`} target="_blank" rel="noopener noreferrer">View Drive source</a>}
            {result.folderName && <div>Parent folder: {result.folderName}</div>}
            {result.detail && <div>{result.detail}</div>}
          </li>)}
        </ul>
        {nextCursor !== null && <button type="button" style={buttonStyle} disabled={resultsLoading} onClick={() => void loadResults()}>{resultsLoading ? "Loading…" : "Load results"}</button>}
      </details>}
    </div>}
    {(error || connectionError) && <p role="alert" style={errorStyle}>{error || connectionError}</p>}
    <p style={{ ...descriptionStyle, fontSize: 12 }}>Runs on the server if you leave this page. The latest report is kept until the next run or server restart. Rerunning safely skips assets already marked Process. Immich’s locked folder cannot be checked with Atlas’s API key.</p>
  </section>;
}
const sectionStyle = { marginTop: 28, padding: 20, border: "1px solid rgba(255,255,255,0.14)", borderRadius: 6, background: "rgba(255,255,255,0.025)" };
const descriptionStyle = { color: "#aeb6c5", lineHeight: 1.6 };
const buttonStyle = { background: "transparent", color: "#ddd", border: "1px solid rgba(255,255,255,0.22)", borderRadius: 4, padding: "8px 11px", cursor: "pointer" };
const errorStyle = { color: "#ffb0b0" };
