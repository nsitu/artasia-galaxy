import { useSettingsStore } from "../../stores/settingsStore";

interface Props {
  visible: boolean;
  onClose: () => void;
}

export default function SettingsPanel({ visible, onClose }: Props) {
  const playback = useSettingsStore((s) => s.playback);
  const display = useSettingsStore((s) => s.display);
  const toggleAutoplay = useSettingsStore((s) => s.toggleAutoplay);
  const setInterval = useSettingsStore((s) => s.setInterval);
  const toggleShuffle = useSettingsStore((s) => s.toggleShuffle);
  const updateDisplay = useSettingsStore((s) => s.updateDisplay);

  if (!visible) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        right: 0,
        bottom: 0,
        width: 280,
        zIndex: 20,
        background: "rgba(10,10,20,0.95)",
        borderLeft: "1px solid rgba(255,255,255,0.1)",
        padding: 20,
        fontFamily: "monospace",
        color: "#ccc",
        fontSize: 13,
        overflowY: "auto",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
        }}
      >
        <span style={{ fontSize: 15, color: "#fff" }}>Settings</span>
        <button
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#888",
            fontSize: 18,
            cursor: "pointer",
          }}
        >
          ✕
        </button>
      </div>

      {/* Playback section */}
      <div style={{ marginBottom: 20 }}>
        <div
          style={{
            fontSize: 12,
            color: "#666",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          Playback
        </div>

        <label
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
            cursor: "pointer",
          }}
        >
          Autoplay
          <button
            onClick={() => toggleAutoplay()}
            style={{
              background: playback.autoplay
                ? "rgba(100,200,100,0.2)"
                : "rgba(255,255,255,0.05)",
              border: `1px solid ${playback.autoplay ? "rgba(100,200,100,0.4)" : "rgba(255,255,255,0.1)"}`,
              color: playback.autoplay ? "#8d8" : "#888",
              padding: "4px 12px",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "monospace",
            }}
          >
            {playback.autoplay ? "ON" : "OFF"}
          </button>
        </label>

        <label
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
            cursor: "pointer",
          }}
        >
          Shuffle
          <button
            onClick={() => toggleShuffle()}
            style={{
              background: playback.shuffle
                ? "rgba(100,200,100,0.2)"
                : "rgba(255,255,255,0.05)",
              border: `1px solid ${playback.shuffle ? "rgba(100,200,100,0.4)" : "rgba(255,255,255,0.1)"}`,
              color: playback.shuffle ? "#8d8" : "#888",
              padding: "4px 12px",
              borderRadius: 4,
              cursor: "pointer",
              fontSize: 12,
              fontFamily: "monospace",
            }}
          >
            {playback.shuffle ? "ON" : "OFF"}
          </button>
        </label>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <span>Interval</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <input
              type="range"
              min={2}
              max={30}
              value={playback.intervalSec}
              onChange={(e) => setInterval(Number(e.target.value))}
              style={{ width: 100 }}
            />
            <span style={{ minWidth: 32, textAlign: "right" }}>
              {playback.intervalSec}s
            </span>
          </div>
        </div>
      </div>

      {/* Display section */}
      <div>
        <div
          style={{
            fontSize: 12,
            color: "#666",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          Display
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <span>Columns</span>
          <div style={{ display: "flex", gap: 4 }}>
            {[2, 3, 4, 5].map((n) => (
              <button
                key={n}
                onClick={() => updateDisplay({ columns: n })}
                style={{
                  background:
                    display.columns === n
                      ? "rgba(100,200,100,0.2)"
                      : "rgba(255,255,255,0.05)",
                  border: `1px solid ${display.columns === n ? "rgba(100,200,100,0.4)" : "rgba(255,255,255,0.1)"}`,
                  color: display.columns === n ? "#8d8" : "#888",
                  padding: "3px 10px",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily: "monospace",
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: 8,
          }}
        >
          <span>Mode</span>
          <div style={{ display: "flex", gap: 4 }}>
            {(["wall", "terrain"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => updateDisplay({ mode })}
                style={{
                  background:
                    display.mode === mode
                      ? "rgba(100,200,100,0.2)"
                      : "rgba(255,255,255,0.05)",
                  border: `1px solid ${display.mode === mode ? "rgba(100,200,100,0.4)" : "rgba(255,255,255,0.1)"}`,
                  color: display.mode === mode ? "#8d8" : "#888",
                  padding: "3px 10px",
                  borderRadius: 4,
                  cursor: "pointer",
                  fontSize: 12,
                  fontFamily: "monospace",
                  textTransform: "capitalize",
                }}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Keyboard shortcuts */}
      <div style={{ marginTop: 24 }}>
        <div
          style={{
            fontSize: 12,
            color: "#666",
            textTransform: "uppercase",
            marginBottom: 10,
          }}
        >
          Shortcuts
        </div>
        <div style={{ color: "#555", lineHeight: 1.8 }}>
          <div>← → = navigate</div>
          <div>Esc = deselect</div>
          <div>A = albums</div>
          <div>S = settings</div>
          <div>Space = autoplay</div>
        </div>
      </div>
    </div>
  );
}
