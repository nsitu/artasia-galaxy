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
export const PROJECT_STATISTICS_TITLE_WIDTH = 6.5;
export const PROJECT_STATISTICS_TITLE_HEIGHT = 0.8;

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

export function createProjectStatisticsWidgetLayout(
  statistics: ProjectStatistics | undefined,
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  z: number,
): ProjectStatisticsWidgetLayout[] {
  if (!statistics) return [];

  const centerY = (bounds.minY + bounds.maxY) / 2;
  const terrainHeight = Math.max(1, bounds.maxY - bounds.minY);
  const westX = bounds.minX - STATISTICS_WIDGET_GAP - PROJECT_STATISTICS_WIDGET_WIDTH / 2;
  const eastX = bounds.maxX + STATISTICS_WIDGET_GAP + PROJECT_STATISTICS_WIDGET_WIDTH / 2;
  const upperY = bounds.minY + terrainHeight * 0.7;
  const lowerY = bounds.minY + terrainHeight * 0.3;

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

export function getProjectStatisticsTitlePosition(
  bounds: { minX: number; maxX: number; minY: number; maxY: number },
  z: number,
): [number, number, number] {
  return [
    (bounds.minX + bounds.maxX) / 2,
    bounds.maxY + STATISTICS_WIDGET_GAP + PROJECT_STATISTICS_TITLE_HEIGHT / 2,
    z + STATISTICS_WIDGET_Z_OFFSET,
  ];
}

export default function ProjectStatisticsWidgets({
  layout,
  projectLabel,
  titlePosition,
}: {
  layout: ProjectStatisticsWidgetLayout[];
  projectLabel?: string;
  titlePosition?: [number, number, number] | null;
}) {
  return (
    <group>
      {projectLabel && titlePosition && (
        <Html
          position={titlePosition}
          transform
          distanceFactor={10}
          pointerEvents="none"
          style={titleStyle}
        >
          {projectLabel}
        </Html>
      )}
      {layout.map((widget) => (
        <Html
          key={widget.key}
          position={widget.position}
          transform
          distanceFactor={10}
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
  transform: "translate(-50%, -50%)",
  color: "#ffffff",
  fontFamily: '"Montserrat", Arial, sans-serif',
  textAlign: "center",
  pointerEvents: "none",
  userSelect: "none",
  textShadow: "0 2px 8px rgba(23, 32, 21, 0.65)",
};

const titleStyle: CSSProperties = {
  width: `${PROJECT_STATISTICS_TITLE_WIDTH * 100}px`,
  height: `${PROJECT_STATISTICS_TITLE_HEIGHT * 100}px`,
  transform: "translate(-50%, -50%)",
  color: "#ffffff",
  fontFamily: '"Montserrat", Arial, sans-serif',
  fontSize: "1.2rem",
  fontWeight: 800,
  letterSpacing: "0.02em",
  lineHeight: 1,
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
