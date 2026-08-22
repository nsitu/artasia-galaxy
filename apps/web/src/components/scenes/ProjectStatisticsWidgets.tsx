import { Html } from "@react-three/drei";
import type { CSSProperties } from "react";
import type { ProjectOption } from "../../api/client";

export type ProjectStatistics = NonNullable<ProjectOption["statistics"]>;

export interface ProjectStatisticsWidgetLayout {
  key: keyof ProjectStatistics;
  label: string;
  value: number;
  position: [number, number, number];
}

export const PROJECT_STATISTICS_WIDGET_WIDTH = 3.1;
export const PROJECT_STATISTICS_WIDGET_HEIGHT = 1.25;

const STATISTICS_HTML_DISTANCE_FACTOR = 10;

const STATISTICS_WIDGETS: Array<{
  key: keyof ProjectStatistics;
  label: string;
}> = [
  { key: "children", label: "children" },
  { key: "caregivers", label: "caregivers" },
  { key: "educators", label: "educators" },
  { key: "artist_educators", label: "artist educators" },
  { key: "partners", label: "partners" },
  { key: "neighbourhoods", label: "neighbourhoods" },
];

const STATISTICS_WIDGET_GAP = 0.9;
const STATISTICS_WIDGET_Z_OFFSET = 0.08;
const STATISTICS_WIDGET_Z_INDEX_RANGE: [number, number] = [12, 0];

export function createProjectStatisticsWidgetLayout(
  statistics: ProjectStatistics | undefined,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  z: number,
  isMobile = false,
): ProjectStatisticsWidgetLayout[] {
  if (!statistics) return [];

  if (isMobile) {
    const terrainWidth = Math.max(1, bounds.maxX - bounds.minX);
    const columnInset = terrainWidth * 0.18;
    const columnX = [
      bounds.minX + columnInset,
      (bounds.minX + bounds.maxX) / 2,
      bounds.maxX - columnInset,
    ];
    const firstRowY = bounds.maxY + STATISTICS_WIDGET_GAP + PROJECT_STATISTICS_WIDGET_HEIGHT / 2;
    const secondRowY = firstRowY + PROJECT_STATISTICS_WIDGET_HEIGHT + STATISTICS_WIDGET_GAP;
    const positions: Array<[number, number]> = [
      [columnX[0], firstRowY],
      [columnX[1], firstRowY],
      [columnX[2], firstRowY],
      [columnX[0], secondRowY],
      [columnX[1], secondRowY],
      [columnX[2], secondRowY],
    ];

    return STATISTICS_WIDGETS.map(({ key, label }, index) => ({
      key,
      label,
      value: statistics[key],
      position: [positions[index][0], positions[index][1], z + STATISTICS_WIDGET_Z_OFFSET],
    }));
  }

  const terrainHeight = Math.max(1, bounds.maxY - bounds.minY);
  const westX = bounds.minX - STATISTICS_WIDGET_GAP - PROJECT_STATISTICS_WIDGET_WIDTH / 2;
  const eastX = bounds.maxX + STATISTICS_WIDGET_GAP + PROJECT_STATISTICS_WIDGET_WIDTH / 2;
  const upperY = bounds.maxY - PROJECT_STATISTICS_WIDGET_HEIGHT / 2;
  const centerY = upperY - terrainHeight * 0.2;
  const lowerY = upperY - terrainHeight * 0.4;

  const positions: Array<[number, number]> = [
    [westX, upperY],
    [westX, centerY],
    [westX, lowerY],
    [eastX, upperY],
    [eastX, centerY],
    [eastX, lowerY],
  ];

  return STATISTICS_WIDGETS.map(({ key, label }, index) => ({
    key,
    label,
    value: statistics[key],
    position: [positions[index][0], positions[index][1], z + STATISTICS_WIDGET_Z_OFFSET],
  }));
}

export default function ProjectStatisticsWidgets({
  layout,
}: {
  layout: ProjectStatisticsWidgetLayout[];
}) {
  return (
    <group>
      {layout.map((widget) => (
        <Html
          key={widget.key}
          position={widget.position}
          transform
          distanceFactor={STATISTICS_HTML_DISTANCE_FACTOR}
          zIndexRange={STATISTICS_WIDGET_Z_INDEX_RANGE}
          pointerEvents="none"
          style={widgetStyle}
        >
          <div style={widgetInnerStyle}>
            <div style={widgetLabelStyle}>{widget.label}</div>
            <div style={widgetValueStyle}>{widget.value.toLocaleString()}</div>
          </div>
        </Html>
      ))}
    </group>
  );
}

const widgetStyle: CSSProperties = {
  width: `${PROJECT_STATISTICS_WIDGET_WIDTH * 100}px`,
  height: `${PROJECT_STATISTICS_WIDGET_HEIGHT * 100}px`,
  color: "#ffffff",
  fontFamily: '"Montserrat", Arial, sans-serif',
  textAlign: "center",
  pointerEvents: "none",
  userSelect: "none",
  textShadow: "0 2px 8px rgba(23, 32, 21, 0.65)",
};

const widgetInnerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  height: "100%",
};

const widgetLabelStyle: CSSProperties = {
  fontSize: "0.72rem",
  fontWeight: 600,
  letterSpacing: "0.08em",
  lineHeight: 1.1,
  textTransform: "uppercase",
};

const widgetValueStyle: CSSProperties = {
  marginTop: "0.08rem",
  fontSize: "2.05rem",
  fontWeight: 800,
  letterSpacing: "-0.04em",
  lineHeight: 0.95,
  fontVariantNumeric: "tabular-nums",
};
