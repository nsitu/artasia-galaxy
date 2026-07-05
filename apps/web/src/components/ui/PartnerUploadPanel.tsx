import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fetchUploadOptions, uploadFiles, type UploadOptions } from "../../api/client";

interface UploadItem {
  id: string;
  file: File;
  status: "queued" | "uploading" | "processing" | "completed" | "failed" | "retrying";
  progress: number;
  error?: string;
  assetId?: string;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

export default function PartnerUploadPanel() {
  const [options, setOptions] = useState<UploadOptions | null>(null);
  const [partnerName, setPartnerName] = useState("");
  const [placementKey, setPlacementKey] = useState("");
  const [items, setItems] = useState<UploadItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadInProgressRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    fetchUploadOptions()
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message);
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const partners = useMemo(() => {
    if (!options) return [];
    return Array.from(new Set(options.placements.map((placement) => placement.partner_name).filter(Boolean))).sort((a, b) =>
      a.localeCompare(b)
    );
  }, [options]);

  const partnerPlacements = useMemo(() => {
    if (!options || !partnerName) return [];
    return options.placements.filter((placement) => placement.partner_name === partnerName);
  }, [options, partnerName]);

  const selectedPlacement = useMemo(() => {
    return partnerPlacements.find((placement) => String(placement.placement_id) === placementKey) ?? null;
  }, [partnerPlacements, placementKey]);

  const activeStep = !partnerName ? 1 : !selectedPlacement ? 2 : 3;

  useEffect(() => {
    setPlacementKey((current) =>
      partnerPlacements.some((placement) => String(placement.placement_id) === current) ? current : ""
    );
  }, [partnerPlacements]);

  useEffect(() => {
    if (selectedPlacement) return;
    setItems([]);
  }, [selectedPlacement]);

  useEffect(() => {
    if (uploadInProgressRef.current) return;
    if (!selectedPlacement) return;
    if (!items.some((item) => item.status === "queued" || item.status === "failed")) return;
    void uploadQueued();
  }, [items, selectedPlacement]);

  function resetSelection() {
    setPlacementKey("");
    setItems([]);
    setError(null);
  }

  function selectPartner(value: string) {
    setPartnerName(value);
    resetSelection();
  }

  function selectPlacement(value: string) {
    setPlacementKey(value);
    setItems([]);
    setError(null);
  }

  function addFiles(fileList: FileList | File[]) {
    if (!selectedPlacement) {
      setError("Select a placement before adding files.");
      return;
    }

    const files = Array.from(fileList);
    if (files.length === 0) return;

    setError(null);
    setItems((current) => [
      ...current,
      ...files.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${crypto.randomUUID()}`,
        file,
        status: "queued" as const,
        progress: 0,
      })),
    ]);
  }

  async function uploadQueued() {
    if (uploadInProgressRef.current) return;
    if (!selectedPlacement) {
      setError("Select a placement.");
      return;
    }

    uploadInProgressRef.current = true;
    setUploading(true);
    const queued = items.filter((item) => item.status === "queued" || item.status === "failed");

    try {
      for (const item of queued) {
        setItems((current) =>
          current.map((entry) =>
            entry.id === item.id
              ? {
                  ...entry,
                  status: entry.status === "failed" ? "retrying" : "uploading",
                  progress: 0,
                  error: undefined,
                }
              : entry
          )
        );

        try {
          const results = await uploadFiles({
            files: [item.file],
            location: selectedPlacement,
            onProgress: (progress) => {
              setItems((current) =>
                current.map((entry) =>
                  entry.id === item.id
                    ? {
                        ...entry,
                        status: progress >= 100 ? "processing" : "uploading",
                        progress,
                      }
                    : entry
                )
              );
            },
          });

          const result = results[0];
          setItems((current) =>
            current.map((entry) =>
              entry.id === item.id
                ? result?.status === "completed"
                  ? { ...entry, status: "completed", progress: 100, assetId: result.assetId }
                  : {
                      ...entry,
                      status: "failed",
                      progress: 100,
                      error: result?.error ?? "Upload failed",
                    }
                : entry
            )
          );
        } catch (err) {
          setItems((current) =>
            current.map((entry) =>
              entry.id === item.id ? { ...entry, status: "failed", error: (err as Error).message } : entry
            )
          );
        }
      }
    } finally {
      uploadInProgressRef.current = false;
      setUploading(false);
    }
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  }

  const completedCount = items.filter((item) => item.status === "completed").length;
  const failedCount = items.filter((item) => item.status === "failed").length;

  return (
    <main style={pageStyle} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <div style={backgroundGlowStyle} />
      <section style={panelStyle}>
        <div style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>Partner uploads</div>
            <h1 style={titleStyle}>Share photos for a placement</h1>
            <p style={subtitleStyle}>
              Choose your organization, pick the placement, then add photos. Uploads land in the right
              place without publishing controls.
            </p>
          </div>
          <a href="/" style={secondaryLinkStyle}>
            Viewer
          </a>
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        <div style={stepperStyle}>
          <section style={stepCardStyle(activeStep >= 1, activeStep === 1)}>
            <div style={stepHeaderStyle}>
              <div style={stepBadgeStyle(activeStep >= 1)}>{partnerName ? "✓" : "1"}</div>
              <div style={stepHeaderTextStyle}>
                <div style={stepLabelStyle}>Step 1</div>
                <div style={stepTitleStyle}>Which organization do you represent?</div>
              </div>
            </div>
            <label style={fieldStyle}>
              <span style={labelStyle}>Partner organization</span>
              <select value={partnerName} onChange={(event) => selectPartner(event.target.value)} style={selectStyle}>
                <option value="">Select your organization</option>
                {partners.map((partner) => (
                  <option key={partner} value={partner}>
                    {partner}
                  </option>
                ))}
              </select>
            </label>
            {partnerName && <div style={stepHintStyle}>Selected: {partnerName}</div>}
          </section>

          <section style={stepCardStyle(activeStep >= 2, activeStep === 2)}>
            <div style={stepHeaderStyle}>
              <div style={stepBadgeStyle(activeStep >= 2)}>{selectedPlacement ? "✓" : "2"}</div>
              <div style={stepHeaderTextStyle}>
                <div style={stepLabelStyle}>Step 2</div>
                <div style={stepTitleStyle}>Which placement is this for?</div>
              </div>
            </div>
            <label style={fieldStyle}>
              <span style={labelStyle}>Placement</span>
              <select
                value={placementKey}
                onChange={(event) => selectPlacement(event.target.value)}
                disabled={!partnerName}
                style={selectStyle}
              >
                <option value="">
                  {partnerName ? "Select a placement" : "Choose an organization first"}
                </option>
                {partnerPlacements.map((placement) => (
                  <option key={placement.placement_id} value={String(placement.placement_id)}>
                    {placement.placement_name}
                    {placement.delivery_schedule ? ` · ${placement.delivery_schedule}` : ""}
                  </option>
                ))}
              </select>
            </label>
            {selectedPlacement ? (
              <div style={stepHintStyle}>
                {selectedPlacement.partner_name} · {selectedPlacement.placement_name}
              </div>
            ) : (
              <div style={stepHintStyle}>Choose the placement that should receive these photos.</div>
            )}
          </section>

          <section style={stepCardStyle(activeStep >= 3, activeStep === 3)}>
            <div style={stepHeaderStyle}>
              <div style={stepBadgeStyle(activeStep >= 3)}>{selectedPlacement ? "✓" : "3"}</div>
              <div style={stepHeaderTextStyle}>
                <div style={stepLabelStyle}>Step 3</div>
                <div style={stepTitleStyle}>Add photos</div>
              </div>
            </div>
            <div style={fieldStyle}>
              <div
                style={{
                  ...dropzoneStyle,
                  ...(selectedPlacement ? {} : dropzoneDisabledStyle),
                }}
                role="button"
                tabIndex={0}
                onClick={() => selectedPlacement && inputRef.current?.click()}
              >
                <div style={dropzoneTitleStyle}>Drop files here or click to choose</div>
                <div style={dropzoneBodyStyle}>
                  {selectedPlacement
                    ? `Uploads will be tagged to ${selectedPlacement.placement_name}.`
                    : "Select a placement first to enable uploading."}
                </div>
                <div style={dropzoneMetaStyle}>
                  Max batch: {options ? formatBytes(options.limits.maxBatchBytes) : "..."}
                </div>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                hidden
                disabled={!selectedPlacement}
                onChange={(event) => {
                  if (event.target.files) addFiles(event.target.files);
                  event.target.value = "";
                }}
              />
            </div>
          </section>
        </div>

        <div style={summaryBarStyle}>
          <div>{partnerName ? `Organization: ${partnerName}` : "Organization not selected"}</div>
          <div>{selectedPlacement ? `Placement: ${selectedPlacement.placement_name}` : "Placement not selected"}</div>
          <div>{items.length} file{items.length === 1 ? "" : "s"} in queue</div>
          <div>{completedCount} completed</div>
          <div>{failedCount} failed</div>
        </div>

        <div style={queueStyle}>
          {loading ? (
            <div style={emptyStateStyle}>Loading partner placements...</div>
          ) : items.length === 0 ? (
            <div style={emptyStateStyle}>No files added yet.</div>
          ) : (
            items.map((item) => (
              <div key={item.id} style={queueItemStyle}>
                <div style={queueItemMainStyle}>
                  <div style={queueItemNameStyle}>{item.file.name}</div>
                  <div style={queueItemMetaStyle}>
                    {formatBytes(item.file.size)} · {item.status}
                    {item.error ? ` · ${item.error}` : ""}
                  </div>
                </div>
                <div style={progressTrackStyle} aria-hidden="true">
                  <div style={{ ...progressFillStyle, width: `${item.progress}%` }} />
                </div>
              </div>
            ))
          )}
        </div>

        <div style={actionsStyle}>
          <button
            type="button"
            onClick={() => uploadQueued()}
            disabled={!selectedPlacement || uploading || items.every((item) => item.status === "completed")}
            style={primaryButtonStyle}
          >
            {uploading ? "Uploading..." : "Upload photos"}
          </button>
          <button
            type="button"
            onClick={() => {
              setItems([]);
              setError(null);
            }}
            style={secondaryButtonStyle}
          >
            Clear queue
          </button>
        </div>
      </section>
    </main>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  position: "relative",
  overflow: "hidden",
  background:
    "radial-gradient(circle at top left, rgba(219, 172, 112, 0.20), transparent 28%), radial-gradient(circle at bottom right, rgba(88, 138, 255, 0.15), transparent 24%), linear-gradient(180deg, #0a0b12 0%, #10131b 50%, #0b0d14 100%)",
  color: "#f2f6fc",
  padding: 24,
};

const backgroundGlowStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  background:
    "repeating-linear-gradient(135deg, rgba(255,255,255,0.03) 0 1px, transparent 1px 18px)",
  opacity: 0.18,
  pointerEvents: "none",
};

const panelStyle: CSSProperties = {
  position: "relative",
  zIndex: 1,
  width: "min(1040px, 100%)",
  margin: "0 auto",
  borderRadius: 24,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(10, 13, 20, 0.82)",
  boxShadow: "0 30px 72px rgba(0,0,0,0.42)",
  backdropFilter: "blur(18px)",
  padding: "28px clamp(20px, 4vw, 36px)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  alignItems: "flex-start",
  marginBottom: 24,
};

const eyebrowStyle: CSSProperties = {
  color: "#aeb7c7",
  textTransform: "uppercase",
  letterSpacing: "0.24em",
  fontSize: 11,
  marginBottom: 10,
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: "clamp(30px, 5vw, 46px)",
  lineHeight: 1.02,
  letterSpacing: "-0.04em",
};

const subtitleStyle: CSSProperties = {
  margin: "12px 0 0",
  maxWidth: 650,
  color: "#c4ccda",
  lineHeight: 1.6,
};

const secondaryLinkStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 42,
  padding: "0 16px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.05)",
  color: "#eef3fb",
  border: "1px solid rgba(255,255,255,0.12)",
  textDecoration: "none",
  fontSize: 14,
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const errorStyle: CSSProperties = {
  marginBottom: 18,
  padding: "12px 14px",
  borderRadius: 12,
  background: "rgba(255, 92, 92, 0.10)",
  border: "1px solid rgba(255, 132, 132, 0.24)",
  color: "#ffb3b3",
  fontSize: 13,
  lineHeight: 1.45,
};

const stepperStyle: CSSProperties = {
  display: "grid",
  gap: 16,
};

const stepCardStyle = (completed: boolean, active: boolean): CSSProperties => ({
  borderRadius: 20,
  border: active
    ? "1px solid rgba(245, 210, 140, 0.34)"
    : "1px solid rgba(255,255,255,0.10)",
  background: active ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.035)",
  boxShadow: active
    ? "0 16px 36px rgba(0,0,0,0.24)"
    : completed
      ? "0 10px 24px rgba(0,0,0,0.18)"
      : "none",
  padding: 18,
  display: "grid",
  gap: 14,
});

const stepHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 12,
};

const stepBadgeStyle = (completed: boolean): CSSProperties => ({
  flex: "0 0 auto",
  width: 28,
  height: 28,
  borderRadius: 999,
  display: "grid",
  placeItems: "center",
  background: completed ? "linear-gradient(135deg, #f5d28c 0%, #efb86b 100%)" : "rgba(255,255,255,0.08)",
  color: completed ? "#17120a" : "#eef3fb",
  border: completed ? "none" : "1px solid rgba(255,255,255,0.12)",
  fontSize: 13,
  fontWeight: 800,
  lineHeight: 1,
});

const stepHeaderTextStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 2,
};

const stepLabelStyle: CSSProperties = {
  color: "#aeb7c7",
  fontSize: 11,
  letterSpacing: "0.18em",
  textTransform: "uppercase",
};

const stepTitleStyle: CSSProperties = {
  color: "#f5f8fd",
  fontSize: 16,
  fontWeight: 700,
  lineHeight: 1.25,
};

const stepHintStyle: CSSProperties = {
  color: "#aeb7c7",
  fontSize: 12,
  lineHeight: 1.45,
};

const dropzoneDisabledStyle: CSSProperties = {
  opacity: 0.56,
  cursor: "not-allowed",
};

const fieldStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

const labelStyle: CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: "#e7edf7",
};

const selectStyle: CSSProperties = {
  minHeight: 48,
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.05)",
  color: "#f5f8fd",
  padding: "0 14px",
  fontSize: 14,
};

const helpTextStyle: CSSProperties = {
  color: "#aeb7c7",
  fontSize: 12,
};

const dropzoneStyle: CSSProperties = {
  minHeight: 160,
  borderRadius: 18,
  border: "1px dashed rgba(255,255,255,0.18)",
  background: "rgba(255,255,255,0.03)",
  padding: 18,
  cursor: "pointer",
  display: "flex",
  flexDirection: "column",
  justifyContent: "center",
  gap: 8,
};

const dropzoneTitleStyle: CSSProperties = {
  fontSize: 18,
  fontWeight: 700,
};

const dropzoneBodyStyle: CSSProperties = {
  color: "#c5ccdb",
  lineHeight: 1.55,
};

const dropzoneMetaStyle: CSSProperties = {
  color: "#8f98a9",
  fontSize: 12,
};

const summaryBarStyle: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 12,
  justifyContent: "space-between",
  marginTop: 20,
  padding: "14px 16px",
  borderRadius: 16,
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  color: "#c4ccda",
  fontSize: 13,
};

const queueStyle: CSSProperties = {
  marginTop: 18,
  display: "grid",
  gap: 12,
};

const queueItemStyle: CSSProperties = {
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.10)",
  background: "rgba(255,255,255,0.03)",
  padding: 14,
};

const queueItemMainStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "baseline",
  marginBottom: 10,
};

const queueItemNameStyle: CSSProperties = {
  fontSize: 14,
  fontWeight: 700,
};

const queueItemMetaStyle: CSSProperties = {
  fontSize: 12,
  color: "#a6b0c2",
  textAlign: "right",
};

const progressTrackStyle: CSSProperties = {
  width: "100%",
  height: 8,
  borderRadius: 999,
  background: "rgba(255,255,255,0.08)",
  overflow: "hidden",
};

const progressFillStyle: CSSProperties = {
  height: "100%",
  borderRadius: 999,
  background: "linear-gradient(90deg, #f0c67a 0%, #93c5fd 100%)",
  transition: "width 120ms linear",
};

const emptyStateStyle: CSSProperties = {
  borderRadius: 16,
  border: "1px dashed rgba(255,255,255,0.12)",
  padding: 18,
  color: "#aab3c4",
  textAlign: "center",
};

const actionsStyle: CSSProperties = {
  display: "flex",
  gap: 12,
  flexWrap: "wrap",
  marginTop: 20,
};

const buttonBaseStyle: CSSProperties = {
  minHeight: 44,
  padding: "0 16px",
  borderRadius: 999,
  border: "1px solid transparent",
  fontSize: 14,
  fontWeight: 700,
  cursor: "pointer",
};

const primaryButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: "linear-gradient(135deg, #f5d28c 0%, #efb86b 100%)",
  color: "#17120a",
};

const secondaryButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: "rgba(255,255,255,0.05)",
  color: "#eef3fb",
  borderColor: "rgba(255,255,255,0.12)",
};