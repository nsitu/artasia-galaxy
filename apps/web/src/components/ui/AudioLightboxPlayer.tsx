import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fetchAudioWaveform, type AudioWaveform } from "../../api/client";

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const remainder = Math.floor(safe % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export default function AudioLightboxPlayer({
  assetId,
  audioUrl,
  style,
}: {
  assetId: string;
  audioUrl: string;
  style?: CSSProperties;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [waveform, setWaveform] = useState<AudioWaveform | null>(null);
  const [waveformError, setWaveformError] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setWaveform(null);
    setWaveformError(null);
    fetchAudioWaveform(assetId)
      .then((result) => {
        if (!cancelled) {
          setWaveform(result);
          setDuration(result.durationSeconds);
        }
      })
      .catch((error) => {
        if (!cancelled) setWaveformError((error as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [assetId]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !waveform) return;

    const draw = () => {
      const width = Math.max(1, canvas.clientWidth);
      const height = Math.max(1, canvas.clientHeight);
      const ratio = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);
      const center = height / 2;
      const barWidth = width / Math.max(1, waveform.peaks.length);
      context.fillStyle = "rgba(191, 211, 255, 0.9)";
      waveform.peaks.forEach((peak, index) => {
        const barHeight = Math.max(2, peak * (height - 12));
        context.fillRect(
          index * barWidth,
          center - barHeight / 2,
          Math.max(1, barWidth - 0.5),
          barHeight,
        );
      });
      if (duration > 0) {
        const playheadX = (currentTime / duration) * width;
        context.fillStyle = "#f6cc55";
        context.fillRect(Math.max(0, playheadX - 1), 0, 2, height);
      }
    };

    draw();
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(draw);
    observer?.observe(canvas);
    return () => observer?.disconnect();
  }, [currentTime, duration, waveform]);

  function seek(event: React.PointerEvent<HTMLCanvasElement>) {
    if (duration <= 0 || !audioRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const nextTime = Math.min(
      duration,
      Math.max(0, ((event.clientX - bounds.left) / bounds.width) * duration),
    );
    audioRef.current.currentTime = nextTime;
    setCurrentTime(nextTime);
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try {
        await audio.play();
      } catch (error) {
        setWaveformError((error as Error).message);
      }
    } else {
      audio.pause();
    }
  }

  return (
    <div
      className="atlas-photo-lightbox-audio"
      style={{ ...audioLightboxPlayerStyle, ...style }}
      onClick={(event) => event.stopPropagation()}
    >
      <audio
        ref={audioRef}
        src={audioUrl}
        preload="metadata"
        onLoadedMetadata={(event) => {
          if (Number.isFinite(event.currentTarget.duration)) {
            setDuration(event.currentTarget.duration);
          }
        }}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
      />
      <div style={audioLightboxControlsStyle}>
        <button
          type="button"
          onClick={() => void togglePlayback()}
          style={audioLightboxPlayButtonStyle}
          aria-label={playing ? "Pause audio" : "Play audio"}
        >
          {playing ? "Ⅱ" : "▶"}
        </button>
        <span style={audioLightboxTimeStyle}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        aria-label="Audio waveform"
        onPointerDown={seek}
        style={audioLightboxWaveformStyle}
      />
      {!waveform && !waveformError && (
        <span style={audioLightboxMessageStyle}>Generating waveform…</span>
      )}
      {waveformError && (
        <span style={audioLightboxErrorStyle}>{waveformError}</span>
      )}
    </div>
  );
}

const audioLightboxPlayerStyle: CSSProperties = {
  width: "min(620px, calc(100vw - 48px))",
  padding: 18,
  boxSizing: "border-box",
  borderRadius: 8,
  background: "rgba(10, 10, 20, 0.92)",
  border: "1px solid rgba(255,255,255,0.18)",
  color: "#eef2f8",
  boxShadow: "0 18px 60px rgba(0,0,0,0.5)",
  cursor: "default",
};

const audioLightboxControlsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  marginBottom: 14,
};

const audioLightboxPlayButtonStyle: CSSProperties = {
  width: 42,
  height: 42,
  border: "1px solid rgba(255,255,255,0.3)",
  borderRadius: "50%",
  background: "rgba(255,255,255,0.12)",
  color: "#fff",
  cursor: "pointer",
  fontSize: 16,
};

const audioLightboxTimeStyle: CSSProperties = {
  fontFamily: "monospace",
  fontSize: 12,
  color: "#c7ccd6",
};

const audioLightboxWaveformStyle: CSSProperties = {
  display: "block",
  width: "100%",
  height: 112,
  borderRadius: 4,
  background: "rgba(255,255,255,0.06)",
  cursor: "pointer",
};

const audioLightboxMessageStyle: CSSProperties = {
  display: "block",
  marginTop: 10,
  color: "#aeb8c9",
  fontFamily: "monospace",
  fontSize: 11,
};

const audioLightboxErrorStyle: CSSProperties = {
  ...audioLightboxMessageStyle,
  color: "#f0a3a3",
};
