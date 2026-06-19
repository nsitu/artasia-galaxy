import { useEffect, useMemo, useRef, useState } from "react";
import {
  fetchUploadOptions,
  uploadFiles,
  type UploadLocation,
  type UploadOptions,
} from "../../api/client";

interface UploadItem {
  id: string;
  file: File;
  status: "queued" | "uploading" | "processing" | "completed" | "failed" | "retrying";
  progress: number;
  error?: string;
  assetId?: string;
}

interface UploadPanelProps {
  visible: boolean;
  onClose: () => void;
}

export default function UploadPanel({ visible, onClose }: UploadPanelProps) {
  const [options, setOptions] = useState<UploadOptions | null>(null);
  const [uploader, setUploader] = useState("");
  const [locationKey, setLocationKey] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const uploadInProgressRef = useRef(false);

  useEffect(() => {
    if (!visible || options) return;
    fetchUploadOptions()
      .then((data) => {
        setOptions(data);
        setUploader(data.uploaders[0] ?? "");
        const firstLocation = data.locations[0];
        if (firstLocation) setLocationKey(keyForLocation(firstLocation));
      })
      .catch((err) => setError((err as Error).message));
  }, [visible, options]);

  const selectedLocation = useMemo(() => {
    if (!options) return null;
    return options.locations.find((location) => keyForLocation(location) === locationKey) ?? null;
  }, [locationKey, options]);

  function addFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList);
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

  function toggleTag(tag: string) {
    setSelectedTags((current) =>
      current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]
    );
  }

  useEffect(() => {
    if (!visible) return;
    const hasQueued = items.some((item) => item.status === "queued");
    if (!hasQueued || uploadInProgressRef.current) return;
    void uploadQueued();
  }, [items, visible, uploader, selectedLocation, selectedTags]);

  async function uploadQueued() {
    if (uploadInProgressRef.current) return;
    if (!selectedLocation) {
      setError("Select a location.");
      return;
    }
    if (!uploader) {
      setError("Select an uploader.");
      return;
    }

    uploadInProgressRef.current = true;
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
            uploader,
            location: selectedLocation,
            tags: selectedTags,
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
              entry.id === item.id
                ? { ...entry, status: "failed", error: (err as Error).message }
                : entry
            )
          );
        }
      }
    } finally {
      uploadInProgressRef.current = false;
    }
  }

  if (!visible) return null;

  return (
    <div style={backdropStyle}>
      <div style={panelStyle}>
        <div style={headerStyle}>
          <h2 style={titleStyle}>Upload</h2>
          <button onClick={onClose} style={iconButtonStyle} aria-label="Close upload panel">
            X
          </button>
        </div>

        {error && <div style={errorStyle}>{error}</div>}

        <div style={fieldGridStyle}>
          <label style={labelStyle}>
            Uploader
            <select value={uploader} onChange={(e) => setUploader(e.target.value)} style={inputStyle}>
              {(options?.uploaders ?? []).map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>

          <label style={labelStyle}>
            Location
            <select
              value={locationKey}
              onChange={(e) => setLocationKey(e.target.value)}
              style={inputStyle}
            >
              {(options?.locations ?? []).map((location) => (
                <option key={keyForLocation(location)} value={keyForLocation(location)}>
                  {location.partner} - {location.site}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={tagListStyle}>
          {(options?.tags ?? []).map((tag) => (
            <label key={tag} style={tagStyle}>
              <input
                type="checkbox"
                checked={selectedTags.includes(tag)}
                onChange={() => toggleTag(tag)}
              />
              {tag}
            </label>
          ))}
        </div>

        <div
          style={dropzoneStyle}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
        >
          Drop images or videos here
          <span style={{ color: "#777", marginTop: 6 }}>or click to choose files</span>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            style={{ display: "none" }}
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
        </div>

        <div style={actionsStyle}>
          <button onClick={uploadQueued} style={primaryButtonStyle}>
            Retry failed
          </button>
          <button onClick={() => setItems([])} style={secondaryButtonStyle}>
            Clear
          </button>
        </div>

        <div style={listStyle}>
          {items.map((item) => (
            <div key={item.id} style={itemStyle}>
              <div style={thumbStyle}>
                {item.assetId ? (
                  <img
                    src={`/api/v1/assets/${item.assetId}/thumbnail`}
                    alt=""
                    style={thumbImageStyle}
                  />
                ) : (
                  <span style={{ color: "#666", fontSize: 11 }}>
                    {item.status === "failed" ? "failed" : "uploading"}
                  </span>
                )}
              </div>
              <div>
                <div style={{ color: "#eee" }}>{item.file.name}</div>
                <div style={{ color: item.status === "failed" ? "#f88" : "#888", fontSize: 12 }}>
                  {item.status}
                  {item.error ? ` - ${item.error}` : ""}
                </div>
              </div>
              <div style={progressTrackStyle}>
                <div style={{ ...progressBarStyle, width: `${item.progress}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function keyForLocation(location: UploadLocation) {
  return `${location.partner}||${location.site}`;
}

const backdropStyle: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  zIndex: 50,
  background: "rgba(0,0,0,0.72)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 16,
};

const panelStyle: React.CSSProperties = {
  width: "min(760px, 100%)",
  maxHeight: "90vh",
  overflowY: "auto",
  background: "#11131a",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 8,
  padding: 18,
  color: "#ddd",
  fontFamily: "system-ui, sans-serif",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: 16,
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 22,
  fontWeight: 600,
};

const iconButtonStyle: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgba(255,255,255,0.22)",
  color: "#ddd",
  width: 32,
  height: 32,
  borderRadius: 4,
  cursor: "pointer",
};

const fieldGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 12,
};

const labelStyle: React.CSSProperties = {
  display: "grid",
  gap: 6,
  fontSize: 13,
  color: "#aaa",
};

const inputStyle: React.CSSProperties = {
  background: "#191c25",
  color: "#f2f2f2",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 4,
  padding: "9px 10px",
};

const tagListStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: 10,
  marginTop: 14,
};

const tagStyle: React.CSSProperties = {
  display: "flex",
  gap: 6,
  alignItems: "center",
  background: "#191c25",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 4,
  padding: "7px 10px",
};

const dropzoneStyle: React.CSSProperties = {
  marginTop: 16,
  minHeight: 150,
  border: "1px dashed rgba(255,255,255,0.35)",
  borderRadius: 6,
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  color: "#ccc",
  cursor: "pointer",
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  gap: 10,
  marginTop: 14,
};

const primaryButtonStyle: React.CSSProperties = {
  background: "#f0f0f0",
  color: "#111",
  border: 0,
  borderRadius: 4,
  padding: "9px 14px",
  cursor: "pointer",
};

const secondaryButtonStyle: React.CSSProperties = {
  background: "transparent",
  color: "#ddd",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: 4,
  padding: "9px 14px",
  cursor: "pointer",
};

const listStyle: React.CSSProperties = {
  display: "grid",
  gap: 8,
  marginTop: 14,
};

const itemStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "54px 1fr 140px",
  gap: 12,
  alignItems: "center",
  background: "#171a22",
  borderRadius: 4,
  padding: 10,
};

const progressTrackStyle: React.CSSProperties = {
  height: 6,
  background: "#2a2e3a",
  borderRadius: 999,
  overflow: "hidden",
};

const progressBarStyle: React.CSSProperties = {
  height: "100%",
  background: "#d8e7ff",
};

const thumbStyle: React.CSSProperties = {
  width: 54,
  height: 44,
  background: "#0c0e13",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 4,
  overflow: "hidden",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};

const thumbImageStyle: React.CSSProperties = {
  width: "100%",
  height: "100%",
  objectFit: "cover",
};

const errorStyle: React.CSSProperties = {
  color: "#ffb0b0",
  background: "rgba(255,0,0,0.12)",
  border: "1px solid rgba(255,0,0,0.22)",
  padding: 10,
  borderRadius: 4,
  marginBottom: 12,
};
