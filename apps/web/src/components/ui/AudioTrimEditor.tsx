import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  fetchAudioWaveform,
  type AudioWaveform,
  type PlacementAsset,
} from "../../api/client";

const MIN_SELECTION_SECONDS = 0.5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = safe - minutes * 60;
  return `${String(minutes).padStart(2, "0")}:${remainder.toFixed(2).padStart(5, "0")}`;
}

function parseTime(value: string) {
  const normalized = value.trim();
  if (/^\d+(?:\.\d+)?$/.test(normalized)) return Number(normalized);
  const match = /^(\d+):(\d{1,2}(?:\.\d+)?)$/.exec(normalized);
  if (!match) return Number.NaN;
  return Number(match[1]) * 60 + Number(match[2]);
}

interface AudioTrimEditorProps {
  asset: PlacementAsset;
  startSeconds: number;
  endSeconds: number;
  disabled?: boolean;
  onChange: (startSeconds: number, endSeconds: number) => void;
  onDuration: (durationSeconds: number) => void;
}

export default function AudioTrimEditor({
  asset,
  startSeconds,
  endSeconds,
  disabled,
  onChange,
  onDuration,
}: AudioTrimEditorProps) {
  const mediaRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const draggedBoundaryRef = useRef<"start" | "end" | null>(null);
  const [waveform, setWaveform] = useState<AudioWaveform | null>(null);
  const [waveformError, setWaveformError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [startText, setStartText] = useState(formatTime(startSeconds));
  const [endText, setEndText] = useState(formatTime(endSeconds));
  const duration = waveform?.durationSeconds || asset.durationSeconds || 0;

  useEffect(() => {
    let cancelled = false;
    setWaveform(null);
    setWaveformError(null);
    fetchAudioWaveform(asset.id)
      .then((result) => {
        if (cancelled) return;
        setWaveform(result);
        onDuration(result.durationSeconds);
      })
      .catch((error) => {
        if (!cancelled) setWaveformError((error as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [asset.id]);

  useEffect(() => setStartText(formatTime(startSeconds)), [startSeconds]);
  useEffect(() => setEndText(formatTime(endSeconds)), [endSeconds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveform) return;
    const ratio = window.devicePixelRatio || 1;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, width, height);
    const center = height / 2;
    const barWidth = width / Math.max(1, waveform.peaks.length);
    context.fillStyle = "#83aef2";
    waveform.peaks.forEach((peak, index) => {
      const barHeight = Math.max(1, peak * (height - 14));
      context.fillRect(index * barWidth, center - barHeight / 2, Math.max(1, barWidth), barHeight);
    });
    const startX = (startSeconds / duration) * width;
    const endX = (endSeconds / duration) * width;
    context.fillStyle = "rgba(4, 7, 12, 0.66)";
    context.fillRect(0, 0, startX, height);
    context.fillRect(endX, 0, width - endX, height);
    context.strokeStyle = "#f6cc55";
    context.lineWidth = 3;
    context.beginPath();
    context.moveTo(startX, 0);
    context.lineTo(startX, height);
    context.moveTo(endX, 0);
    context.lineTo(endX, height);
    context.stroke();
    const playheadX = (currentTime / duration) * width;
    context.strokeStyle = "#ffffff";
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(playheadX, 0);
    context.lineTo(playheadX, height);
    context.stroke();
  }, [waveform, duration, startSeconds, endSeconds, currentTime]);

  function updateBoundary(kind: "start" | "end", value: number) {
    if (!Number.isFinite(value) || duration <= 0) return;
    const rounded = Math.round(value * 100) / 100;
    if (kind === "start") {
      onChange(clamp(rounded, 0, endSeconds - MIN_SELECTION_SECONDS), endSeconds);
    } else {
      onChange(startSeconds, clamp(rounded, startSeconds + MIN_SELECTION_SECONDS, duration));
    }
  }

  function pointerTime(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return clamp(((event.clientX - rect.left) / rect.width) * duration, 0, duration);
  }

  function handleWaveformPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled || duration <= 0) return;
    const value = pointerTime(event);
    const kind = Math.abs(value - startSeconds) <= Math.abs(value - endSeconds) ? "start" : "end";
    draggedBoundaryRef.current = kind;
    event.currentTarget.setPointerCapture(event.pointerId);
    updateBoundary(kind, value);
  }

  function seek(value: number) {
    const media = mediaRef.current;
    if (!media) return;
    media.currentTime = clamp(value, 0, duration);
    setCurrentTime(media.currentTime);
  }

  async function togglePlayback() {
    const media = mediaRef.current;
    if (!media) return;
    if (media.paused) {
      if (media.currentTime < startSeconds || media.currentTime >= endSeconds) seek(startSeconds);
      await media.play();
    } else {
      media.pause();
    }
  }

  async function previewSelection() {
    const media = mediaRef.current;
    if (!media) return;
    seek(startSeconds);
    await media.play();
  }

  return (
    <div style={editorStyle}>
      <video
        ref={mediaRef}
        src={asset.originalUrl}
        preload="metadata"
        style={hiddenMediaStyle}
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) onDuration(event.currentTarget.duration);
        }}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => {
          const next = event.currentTarget.currentTime;
          setCurrentTime(next);
          if (next >= endSeconds) {
            event.currentTarget.pause();
            event.currentTarget.currentTime = endSeconds;
          }
        }}
      />
      <div style={playbackRowStyle}>
        <button type="button" onClick={togglePlayback} disabled={disabled} style={buttonStyle}>
          {playing ? "Pause" : "Play"}
        </button>
        <span>{formatTime(currentTime)} / {formatTime(duration)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.01)}
          step={0.01}
          value={Math.min(currentTime, duration)}
          disabled={disabled || duration <= 0}
          onChange={(event) => seek(Number(event.target.value))}
          style={{ flex: "1 1 220px" }}
        />
      </div>
      <div style={waveformShellStyle}>
        <canvas
          ref={canvasRef}
          aria-label="Audio waveform. Click near the start or end boundary to adjust it."
          onPointerDown={handleWaveformPointerDown}
          onPointerMove={(event) => {
            if (draggedBoundaryRef.current) {
              updateBoundary(draggedBoundaryRef.current, pointerTime(event));
            }
          }}
          onPointerUp={(event) => {
            draggedBoundaryRef.current = null;
            event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            draggedBoundaryRef.current = null;
          }}
          style={waveformCanvasStyle}
        />
        {!waveform && !waveformError && <span style={waveformMessageStyle}>Generating waveform…</span>}
        {waveformError && <span style={waveformErrorStyle}>{waveformError}</span>}
      </div>
      <div style={boundaryGridStyle}>
        <label style={fieldStyle}>
          Start (mm:ss.hh)
          <input
            type="text"
            value={startText}
            disabled={disabled}
            onChange={(event) => setStartText(event.target.value)}
            onBlur={() => {
              updateBoundary("start", parseTime(startText));
              setStartText(formatTime(startSeconds));
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              const direction = event.key === "ArrowUp" ? 1 : -1;
              const step = event.ctrlKey || event.metaKey ? 1 : event.shiftKey ? 0.1 : 0.01;
              updateBoundary("start", startSeconds + direction * step);
            }}
            style={timeInputStyle}
          />
          <button type="button" disabled={disabled} onClick={() => updateBoundary("start", currentTime)} style={buttonStyle}>
            Set to playhead
          </button>
        </label>
        <label style={fieldStyle}>
          End (mm:ss.hh)
          <input
            type="text"
            value={endText}
            disabled={disabled}
            onChange={(event) => setEndText(event.target.value)}
            onBlur={() => {
              updateBoundary("end", parseTime(endText));
              setEndText(formatTime(endSeconds));
            }}
            onKeyDown={(event) => {
              if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
              event.preventDefault();
              const direction = event.key === "ArrowUp" ? 1 : -1;
              const step = event.ctrlKey || event.metaKey ? 1 : event.shiftKey ? 0.1 : 0.01;
              updateBoundary("end", endSeconds + direction * step);
            }}
            style={timeInputStyle}
          />
          <button type="button" disabled={disabled} onClick={() => updateBoundary("end", currentTime)} style={buttonStyle}>
            Set to playhead
          </button>
        </label>
      </div>
      <div style={selectionRowStyle}>
        <span>Selected: {formatTime(Math.max(0, endSeconds - startSeconds))}</span>
        <button type="button" onClick={previewSelection} disabled={disabled} style={buttonStyle}>Preview selection</button>
        <button
          type="button"
          onClick={() => onChange(0, duration)}
          disabled={disabled || duration <= 0}
          style={buttonStyle}
        >
          Reset trim
        </button>
      </div>
    </div>
  );
}

const editorStyle: CSSProperties = {
  display: "grid",
  gap: 14,
  width: "100%",
  padding: 16,
  background: "#171a22",
  borderRadius: 6,
};
const hiddenMediaStyle: CSSProperties = { display: "none" };
const playbackRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  color: "#d8e7ff",
};
const waveformShellStyle: CSSProperties = {
  position: "relative",
  minHeight: 180,
  background: "#090b10",
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 4,
  overflow: "hidden",
};
const waveformCanvasStyle: CSSProperties = {
  width: "100%",
  height: 180,
  display: "block",
  cursor: "ew-resize",
  touchAction: "none",
};
const waveformMessageStyle: CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "grid",
  placeItems: "center",
  color: "#9aa3b3",
};
const waveformErrorStyle: CSSProperties = {
  ...waveformMessageStyle,
  color: "#ffb0b0",
  padding: 16,
};
const boundaryGridStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: 12,
};
const fieldStyle: CSSProperties = { display: "grid", gap: 7, color: "#c8d1df" };
const timeInputStyle: CSSProperties = {
  background: "#0f1118",
  color: "#f2f2f2",
  border: "1px solid rgba(255,255,255,0.18)",
  borderRadius: 4,
  padding: "9px 10px",
  font: "inherit",
  fontVariantNumeric: "tabular-nums",
};
const selectionRowStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  flexWrap: "wrap",
  color: "#c8d1df",
};
const buttonStyle: CSSProperties = {
  background: "transparent",
  color: "#d8e7ff",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: 4,
  padding: "8px 10px",
  cursor: "pointer",
};
