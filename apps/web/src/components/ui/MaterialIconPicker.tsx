import { useEffect, useMemo, useState } from "react";

const RESULT_LIMIT = 120;
const SUGGESTED_ICONS = [
  "school",
  "music_note",
  "graphic_eq",
  "mic",
  "hearing",
  "record_voice_over",
  "podcasts",
  "palette",
  "groups",
  "child_care",
  "nature",
  "toys",
];

let iconCatalogRequest: Promise<string[]> | null = null;

function fetchIconCatalog() {
  if (!iconCatalogRequest) {
    iconCatalogRequest = fetch("/material-symbols.json")
      .then(async (response) => {
        if (!response.ok) throw new Error("The icon catalogue could not be loaded.");
        const payload = (await response.json()) as unknown;
        if (!Array.isArray(payload)) throw new Error("The icon catalogue is invalid.");
        return payload.filter(
          (name): name is string =>
            typeof name === "string" && /^[a-z0-9_]+$/.test(name),
        );
      })
      .catch((error) => {
        iconCatalogRequest = null;
        throw error;
      });
  }
  return iconCatalogRequest;
}

function iconLabel(name: string) {
  return name.replaceAll("_", " ");
}

interface MaterialIconPickerProps {
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
}

export default function MaterialIconPicker({
  value,
  onChange,
  disabled = false,
}: MaterialIconPickerProps) {
  const [icons, setIcons] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchIconCatalog()
      .then((catalog) => {
        if (!cancelled) setIcons(catalog);
      })
      .catch((catalogError) => {
        if (!cancelled) setError((catalogError as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const matchingIcons = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase().replaceAll(" ", "_");
    if (!normalizedQuery) {
      const suggestions = SUGGESTED_ICONS.filter((name) =>
        icons.includes(name),
      );
      return value && !suggestions.includes(value)
        ? [value, ...suggestions]
        : suggestions;
    }
    return icons
      .filter((name) => name.includes(normalizedQuery))
      .slice(0, RESULT_LIMIT);
  }, [icons, query, value]);

  return (
    <div style={pickerStyle}>
      <div style={selectedRowStyle}>
        <span style={selectedPreviewStyle} aria-hidden="true">
          {value || "hide_image"}
        </span>
        <span style={selectedTextStyle}>
          {value ? iconLabel(value) : "No icon assigned"}
        </span>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            aria-label="Clear assigned icon"
            title="Clear assigned icon"
            style={clearButtonStyle}
          >
            close
          </button>
        )}
      </div>
      <div style={searchWrapStyle}>
        <span style={searchIconStyle} aria-hidden="true">
          search
        </span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          disabled={disabled}
          placeholder="Search Material Symbols"
          aria-label="Search Material Symbols"
          style={searchInputStyle}
        />
      </div>
      {error ? (
        <span style={messageStyle}>{error}</span>
      ) : icons.length === 0 ? (
        <span style={messageStyle}>Loading icons…</span>
      ) : (
        <>
          <div style={iconGridStyle}>
            {matchingIcons.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => onChange(name)}
                disabled={disabled}
                aria-label={`Use ${iconLabel(name)} icon`}
                title={iconLabel(name)}
                style={{
                  ...iconButtonStyle,
                  ...(value === name ? selectedIconButtonStyle : {}),
                }}
              >
                <span aria-hidden="true" style={iconGlyphStyle}>
                  {name}
                </span>
              </button>
            ))}
          </div>
          {query.trim() && matchingIcons.length === 0 && (
            <span style={messageStyle}>No matching icons.</span>
          )}
          {query.trim() && matchingIcons.length === RESULT_LIMIT && (
            <span style={messageStyle}>
              Showing the first {RESULT_LIMIT} matches. Refine the search to
              narrow the list.
            </span>
          )}
        </>
      )}
    </div>
  );
}

const pickerStyle = {
  display: "grid",
  gap: "0.65rem",
  padding: "0.75rem",
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: "0.75rem",
  background: "rgba(0,0,0,0.14)",
} as const;

const selectedRowStyle = {
  display: "flex",
  alignItems: "center",
  gap: "0.6rem",
  minHeight: "2rem",
} as const;

const selectedPreviewStyle = {
  fontFamily: '"Material Symbols Outlined"',
  fontSize: "1.65rem",
  lineHeight: 1,
} as const;

const selectedTextStyle = {
  flex: 1,
  textTransform: "capitalize",
  fontSize: "0.86rem",
} as const;

const clearButtonStyle = {
  border: 0,
  padding: "0.25rem",
  color: "inherit",
  background: "transparent",
  cursor: "pointer",
  fontFamily: '"Material Symbols Outlined"',
  fontSize: "1.2rem",
  lineHeight: 1,
} as const;

const searchWrapStyle = {
  display: "flex",
  alignItems: "center",
  gap: "0.45rem",
  padding: "0 0.65rem",
  border: "1px solid rgba(255,255,255,0.22)",
  borderRadius: "0.5rem",
  background: "rgba(255,255,255,0.07)",
} as const;

const searchIconStyle = {
  fontFamily: '"Material Symbols Outlined"',
  fontSize: "1.2rem",
  opacity: 0.75,
} as const;

const searchInputStyle = {
  flex: 1,
  minWidth: 0,
  padding: "0.65rem 0",
  border: 0,
  outline: 0,
  color: "inherit",
  background: "transparent",
  font: "inherit",
} as const;

const iconGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(2.6rem, 1fr))",
  gap: "0.3rem",
  maxHeight: "12rem",
  overflowY: "auto",
} as const;

const iconButtonStyle = {
  display: "grid",
  placeItems: "center",
  minHeight: "2.6rem",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: "0.5rem",
  color: "inherit",
  background: "rgba(255,255,255,0.04)",
  cursor: "pointer",
} as const;

const selectedIconButtonStyle = {
  borderColor: "#f6c453",
  color: "#17120a",
  background: "#f6c453",
} as const;

const iconGlyphStyle = {
  fontFamily: '"Material Symbols Outlined"',
  fontSize: "1.45rem",
  lineHeight: 1,
} as const;

const messageStyle = {
  fontSize: "0.75rem",
  opacity: 0.72,
} as const;
