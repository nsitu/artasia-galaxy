import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { fetchUploadOptions, updateAssetCaption, uploadFiles, type UploadOptions } from "../../api/client";
import RetryableUploadThumbnail from "./RetryableUploadThumbnail";

interface UploadItem {
  id: string;
  file: File;
  status: "queued" | "uploading" | "processing" | "completed" | "failed" | "retrying";
  progress: number;
  error?: string;
  assetId?: string;
  caption?: string;
  captionStatus?: "idle" | "saving" | "saved" | "failed";
  captionError?: string;
}

type UploadPlacement = UploadOptions["placements"][number];

const UPLOAD_ACCEPT_TYPES = "image/*,video/*,.heic,.heif,image/heic,image/heif";

interface PartnerOption {
  name: string;
  logo?: UploadPlacement["partner_logo"];
  placements: UploadPlacement[];
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

function formatParticipantAge(age?: string) {
  const value = age?.trim();
  if (!value) return "";
  return /\d/.test(value) ? `age ${value}` : value;
}

function formatPlaceAddress(placement: UploadPlacement) {
  const address = placement.address?.trim() ?? "";
  const city = placement.place_city?.trim() ?? "";
  if (!address) return city;
  if (!city || address.toLowerCase().includes(city.toLowerCase())) return address;
  return `${address}, ${city}`;
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

  const partners = useMemo<PartnerOption[]>(() => {
    if (!options) return [];
    const grouped = new Map<string, PartnerOption>();
    for (const placement of options.placements) {
      const name = placement.partner_name?.trim();
      if (!name) continue;
      const current = grouped.get(name);
      if (current) {
        current.placements.push(placement);
        if (!current.logo && placement.partner_logo) current.logo = placement.partner_logo;
      } else {
        grouped.set(name, {
          name,
          logo: placement.partner_logo,
          placements: [placement],
        });
      }
    }
    return Array.from(grouped.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [options]);

  const selectedPartner = useMemo(() => {
    return partners.find((partner) => partner.name === partnerName) ?? null;
  }, [partnerName, partners]);

  const partnerPlacements = useMemo(() => {
    return selectedPartner?.placements ?? [];
  }, [selectedPartner]);

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

  function goBack() {
    if (activeStep === 3) {
      setPlacementKey("");
      setItems([]);
      setError(null);
      return;
    }
    if (activeStep === 2) {
      setPartnerName("");
      resetSelection();
    }
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

  function updateItemCaption(itemId: string, value: string) {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              caption: value,
              captionStatus: "idle",
              captionError: undefined,
            }
          : item
      )
    );
  }

  async function saveItemCaption(item: UploadItem) {
    if (!item.assetId) return;
    const caption = item.caption?.trim() ?? "";
    setItems((current) =>
      current.map((entry) =>
        entry.id === item.id
          ? { ...entry, captionStatus: "saving", captionError: undefined }
          : entry
      )
    );

    try {
      await updateAssetCaption({ assetId: item.assetId, caption });
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, caption, captionStatus: "saved", captionError: undefined }
            : entry
        )
      );
    } catch (err) {
      setItems((current) =>
        current.map((entry) =>
          entry.id === item.id
            ? { ...entry, captionStatus: "failed", captionError: (err as Error).message }
            : entry
        )
      );
    }
  }

  function onDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    addFiles(event.dataTransfer.files);
  }

  const completedCount = items.filter((item) => item.status === "completed").length;
  const failedCount = items.filter((item) => item.status === "failed").length;

  function renderQuestion(title: string) {
    return (
      <h2 style={screenQuestionStyle}>{title}</h2>
    );
  }

  function renderPartnerLogo(partner: Pick<PartnerOption, "name" | "logo">) {
    return partner.logo?.url ? (
      <img
        src={partner.logo.url}
        alt={partner.logo.alt || partner.name}
        style={partnerButtonLogoStyle}
      />
    ) : (
      <span style={partnerButtonLogoFallbackStyle}>{partner.name.slice(0, 1).toUpperCase()}</span>
    );
  }

  function renderPartnerStep() {
    return (
      <section style={screenStyle}>
        {renderQuestion("Which organization do you represent?")}
        {loading ? (
          <div style={emptyStateStyle}>Loading partner placements...</div>
        ) : partners.length === 0 ? (
          <div style={emptyStateStyle}>No partner organizations are available.</div>
        ) : (
          <div style={buttonGridStyle}>
            {partners.map((partner) => (
              <button
                key={partner.name}
                type="button"
                onClick={() => selectPartner(partner.name)}
                style={partnerSelectionButtonStyle}
              >
                {renderPartnerLogo(partner)}
                <span style={selectionButtonTextStyle}>
                  <span style={selectionButtonTitleStyle}>{partner.name}</span>
                  <span style={selectionButtonMetaStyle}>
                    {partner.placements.length} placement{partner.placements.length === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    );
  }

  function renderPlacementStep() {
    return (
      <section style={screenStyle}>
        <div style={screenNavStyle}>
          <button type="button" onClick={goBack} style={backButtonStyle}>
            <ChevronLeftIcon />
            Back
          </button>
          {selectedPartner && (
            <>
              <span style={navSeparatorStyle} aria-hidden="true" />
              <div style={navPartnerContextStyle}>
                {renderPartnerLogo(selectedPartner)}
                <span>{selectedPartner.name}</span>
              </div>
            </>
          )}
        </div>
        {renderQuestion("Which Artasia placement is this for?")}
        {partnerPlacements.length === 0 ? (
          <div style={emptyStateStyle}>No placements are available for this organization.</div>
        ) : (
          <div style={placementButtonListStyle}>
            {partnerPlacements.map((placement) => (
              <button
                key={placement.placement_id}
                type="button"
                onClick={() => selectPlacement(String(placement.placement_id))}
                style={selectionButtonStyle}
              >
                <span style={selectionButtonTextStyle}>
                  <span style={selectionButtonTitleStyle}>{placement.placement_name}</span>
                  {placement.place_name && (
                    <span style={selectionButtonMetaStyle}>{placement.place_name}</span>
                  )}
                  {formatPlaceAddress(placement) && (
                    <span style={selectionButtonMetaStyle}>{formatPlaceAddress(placement)}</span>
                  )}
                  {[placement.delivery_schedule, formatParticipantAge(placement.participant_age)].filter(Boolean).length > 0 && (
                    <span style={selectionButtonMetaStyle}>
                      {[placement.delivery_schedule, formatParticipantAge(placement.participant_age)].filter(Boolean).join(" | ")}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>
    );
  }

  function renderUploadStep() {
    return (
      <section style={screenStyle}>
        <div style={screenNavStyle}>
          <button type="button" onClick={goBack} style={backButtonStyle}>
            <ChevronLeftIcon />
            Back
          </button>
          {selectedPartner && (
            <>
              <span style={navSeparatorStyle} aria-hidden="true" />
              <div style={navPartnerContextStyle}>
                {renderPartnerLogo(selectedPartner)}
                <span>{selectedPartner.name}</span>
              </div>
            </>
          )}
          {selectedPlacement && (
            <>
              <span style={navSeparatorStyle} aria-hidden="true" />
              <div style={navPlacementContextStyle}>
                <strong>{selectedPlacement.placement_name}</strong>
                {selectedPlacement.place_name && <span>{selectedPlacement.place_name}</span>}
                {formatPlaceAddress(selectedPlacement) && <span>{formatPlaceAddress(selectedPlacement)}</span>}
              </div>
            </>
          )}
        </div>
        {renderQuestion("Add photos")}
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
            accept={UPLOAD_ACCEPT_TYPES}
            multiple
            hidden
            disabled={!selectedPlacement}
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = "";
            }}
          />
        </div>

        <div style={summaryBarStyle}>
          <div>{items.length} file{items.length === 1 ? "" : "s"} in queue</div>
          <div>{completedCount} completed</div>
          <div>{failedCount} failed</div>
        </div>

        <div style={queueStyle}>
          {items.length === 0 ? (
            <div style={emptyStateStyle}>No files added yet.</div>
          ) : (
            items.map((item) => (
              <div key={item.id} style={queueItemStyle}>
                <div style={queueThumbStyle}>
                  {item.assetId ? (
                    <RetryableUploadThumbnail
                      assetId={item.assetId}
                      imageStyle={queueThumbImageStyle}
                      placeholderStyle={queueThumbPlaceholderStyle}
                    />
                  ) : (
                    <span style={queueThumbPlaceholderStyle}>
                      {item.status === "failed" ? "failed" : "uploading"}
                    </span>
                  )}
                </div>
                <div style={queueItemContentStyle}>
                  <div style={queueItemMainStyle}>
                    <div style={queueItemNameStyle}>{item.file.name}</div>
                    <div style={queueItemMetaStyle}>
                      <span>{formatBytes(item.file.size)}</span>
                      <span style={queueMetaSeparatorStyle} aria-hidden="true" />
                      {item.status === "completed" ? (
                        <span style={completedStatusStyle}>
                          <CheckIcon />
                          upload completed
                        </span>
                      ) : item.status}
                      {item.error && (
                        <>
                          <span style={queueMetaSeparatorStyle} aria-hidden="true" />
                          <span style={queueErrorTextStyle}>{item.error}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {item.status !== "completed" && (
                    <div style={progressTrackStyle} aria-hidden="true">
                      <div style={{ ...progressFillStyle, width: `${item.progress}%` }} />
                    </div>
                  )}
                  {item.assetId && (
                    <label style={captionFieldStyle}>
                      <span style={captionLabelStyle}>Caption</span>
                      <div style={captionRowStyle}>
                        <input
                          type="text"
                          value={item.caption ?? ""}
                          onChange={(event) => updateItemCaption(item.id, event.target.value)}
                          placeholder="Optional caption"
                          style={captionInputStyle}
                        />
                        <button
                          type="button"
                          onClick={() => void saveItemCaption(item)}
                          disabled={item.captionStatus === "saving"}
                          style={captionSaveButtonStyle}
                        >
                          {item.captionStatus === "saving" ? "Saving..." : "Save"}
                        </button>
                      </div>
                      {item.captionStatus === "saved" && <span style={captionStatusStyle}>Saved</span>}
                      {item.captionStatus === "failed" && (
                        <span style={captionErrorStyle}>{item.captionError ?? "Caption failed"}</span>
                      )}
                    </label>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        <div style={actionsStyle}>
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
    );
  }

  return (
    <main style={pageStyle} onDragOver={(event) => event.preventDefault()} onDrop={onDrop}>
      <div style={backgroundGlowStyle} />
      <section style={panelStyle}>
        <div style={headerStyle}>
          <div>
            <div style={eyebrowStyle}>Partner uploads</div>
            <h1 style={titleStyle}>Share photos with Artasia</h1>
            <p style={subtitleStyle}>
              Help us amplify children's voices! Contribute photos and videos from Artasia programming at your organization.
              Your uploads will be reviewed and possibly included in our online exhibition.
            </p>
          </div>
          <a href="/" style={secondaryLinkStyle}>
            Viewer
          </a>
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        {activeStep === 1 ? renderPartnerStep() : activeStep === 2 ? renderPlacementStep() : renderUploadStep()}
      </section>
    </main>
  );
}

function ChevronLeftIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" style={backButtonIconStyle}>
      <path
        d="M10.5 2.5 5 8l5.5 5.5"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="1.8"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" style={completedCheckStyle}>
      <path
        d="M3.25 8.25 6.5 11.5l6.25-7"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      />
    </svg>
  );
}

const pageStyle: CSSProperties = {
  minHeight: "100vh",
  position: "relative",
  overflowX: "hidden",
  overflowY: "auto",
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

const stepHintStyle: CSSProperties = {
  color: "#aeb7c7",
  fontSize: 12,
  lineHeight: 1.45,
};

const screenQuestionStyle: CSSProperties = {
  margin: 0,
  color: "#f5f8fd",
  fontSize: 20,
  fontWeight: 700,
  lineHeight: 1.25,
};

const screenStyle: CSSProperties = {
  display: "grid",
  gap: 18,
};

const screenNavStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "start",
  gap: "3rem",
  flexWrap: "wrap",
};

const backButtonStyle: CSSProperties = {
  minHeight: 38,
  padding: "0 12px 0 8px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.05)",
  color: "#eef3fb",
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
};

const backButtonIconStyle: CSSProperties = {
  width: 15,
  height: 15,
};

const buttonGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, calc((100% - 20px) / 3)))",
  gap: 10,
};

const placementButtonListStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
  gap: 8,
};

const selectionButtonStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  gap: 12,
  textAlign: "left",
  background: "rgba(255,255,255,0.04)",
  color: "#ddd",
  border: "1px solid rgba(255,255,255,0.10)",
  borderRadius: 8,
  padding: 12,
  cursor: "pointer",
};

const partnerSelectionButtonStyle: CSSProperties = {
  ...selectionButtonStyle,
  flexDirection: "column",
  alignItems: "flex-start",
};

const selectionButtonTextStyle: CSSProperties = {
  minWidth: 0,
  display: "grid",
  gap: 4,
};

const selectionButtonTitleStyle: CSSProperties = {
  color: "#f2f6fc",
  fontSize: 14,
  lineHeight: 1.3,
  fontWeight: 700,
};

const selectionButtonMetaStyle: CSSProperties = {
  color: "#9ca7b8",
  fontSize: 12,
  lineHeight: 1.3,
};

const partnerButtonLogoStyle: CSSProperties = {
  flex: "0 0 auto",
  width: 88,
  height: 48,
  objectFit: "contain",
  background: "rgba(255,255,255,0.92)",
  borderRadius: 4,
  padding: 5,
};

const partnerButtonLogoFallbackStyle: CSSProperties = {
  ...partnerButtonLogoStyle,
  display: "grid",
  placeItems: "center",
  color: "#151922",
  fontSize: 18,
  fontWeight: 800,
};

const contextLineStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  color: "#c4ccda",
  fontSize: 13,
};

const navPartnerContextStyle: CSSProperties = {
  ...contextLineStyle,
  justifyContent: "flex-end",
  fontWeight: 700,
};

const navPlacementContextStyle: CSSProperties = {
  display: "grid",
  gap: 2,
  color: "#c4ccda",
  fontSize: 12,
  lineHeight: 1.25,
};

const navSeparatorStyle: CSSProperties = {
  width: 1,
  height: 42,
  background: "rgba(255,255,255,0.14)",
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

const captionFieldStyle: CSSProperties = {
  display: "grid",
  gap: 8,
};

const captionLabelStyle: CSSProperties = {
  color: "#e7edf7",
  fontSize: 13,
  fontWeight: 700,
};

const captionInputStyle: CSSProperties = {
  minHeight: 46,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.05)",
  color: "#f5f8fd",
  padding: "0 12px",
  fontSize: 14,
  minWidth: 0,
  width: "100%",
};

const captionRowStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr auto",
  gap: 8,
};

const captionSaveButtonStyle: CSSProperties = {
  minHeight: 46,
  padding: "0 14px",
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "rgba(255,255,255,0.08)",
  color: "#eef3fb",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
};

const captionStatusStyle: CSSProperties = {
  color: "#8bd7a8",
  fontSize: 12,
};

const captionErrorStyle: CSSProperties = {
  color: "#ffb3b3",
  fontSize: 12,
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
  display: "flex",
  gap: 12,
  alignItems: "center",
};

const queueThumbStyle: CSSProperties = {
  width: 72,
  height: 56,
  borderRadius: 8,
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  overflow: "hidden",
  display: "grid",
  placeItems: "center",
};

const queueThumbImageStyle: CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const queueThumbPlaceholderStyle: CSSProperties = {
  color: "#8f98a9",
  fontSize: 10,
  textTransform: "uppercase",
};

const queueItemContentStyle: CSSProperties = {
  display: "grid",
  gap: 10,
  minWidth: 0,
  flex: "1 1 auto",
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
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
  flexWrap: "wrap",
  fontSize: 12,
  color: "#a6b0c2",
  textAlign: "right",
};

const queueMetaSeparatorStyle: CSSProperties = {
  width: 1,
  height: 12,
  background: "rgba(166,176,194,0.45)",
  flex: "0 0 auto",
};

const queueErrorTextStyle: CSSProperties = {
  color: "#ffb3b3",
};

const completedStatusStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  color: "#8bd7a8",
  fontWeight: 700,
};

const completedCheckStyle: CSSProperties = {
  width: 14,
  height: 14,
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

const secondaryButtonStyle: CSSProperties = {
  ...buttonBaseStyle,
  background: "rgba(255,255,255,0.05)",
  color: "#eef3fb",
  borderColor: "rgba(255,255,255,0.12)",
};
