import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
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
  autoPlay = true,
  activityColour = "#b7bac3",
  style,
}: {
  assetId: string;
  audioUrl: string;
  autoPlay?: boolean;
  activityColour?: string;
  style?: CSSProperties;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
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
    if (!autoPlay) return;
    const audio = audioRef.current;
    if (!audio) return;
    void audio.play().catch(() => {
      // The play button remains available when the browser blocks autoplay.
    });
  }, [audioUrl, autoPlay]);

  const waveformBars = useMemo(() => {
    if (!waveform) return [];
    const barCount = Math.min(180, waveform.peaks.length);
    return Array.from({ length: barCount }, (_, index) => {
      const start = Math.floor((index * waveform.peaks.length) / barCount);
      const end = Math.max(
        start + 1,
        Math.floor(((index + 1) * waveform.peaks.length) / barCount),
      );
      return Math.max(0.04, Math.max(...waveform.peaks.slice(start, end)));
    });
  }, [waveform]);

  function seek(event: React.PointerEvent<SVGSVGElement>) {
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
        autoPlay={autoPlay}
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
          <span aria-hidden="true" style={audioLightboxPlayIconStyle}>
            {playing ? "pause" : "play_arrow"}
          </span>
        </button>
        <span style={audioLightboxTimeStyle}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>
      </div>
      <svg
        viewBox="0 0 180 100"
        preserveAspectRatio="none"
        role="img"
        aria-label="Audio waveform"
        onPointerDown={seek}
        style={audioLightboxWaveformStyle}
      >
        {waveformBars.map((peak, index) => {
          const x = index + 0.5;
          const height = Math.max(5, peak * 82);
          return (
            <rect
              key={index}
              x={x - 0.36}
              y={(100 - height) / 2}
              width={0.72}
              height={height}
              rx={0.36}
              fill={activityColour}
              opacity={0.88}
            />
          );
        })}
        {duration > 0 && (
          <line
            x1={(currentTime / duration) * 180}
            x2={(currentTime / duration) * 180}
            y1={4}
            y2={96}
            stroke="#ffffff"
            strokeWidth={1.1}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
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

const audioLightboxPlayIconStyle: CSSProperties = {
  fontFamily: "'Material Symbols Outlined'",
  fontSize: 24,
  lineHeight: 1,
  fontVariationSettings: "'FILL' 1, 'wght' 500, 'GRAD' 0, 'opsz' 24",
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
  overflow: "hidden",
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
