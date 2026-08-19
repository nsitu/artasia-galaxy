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

export interface ProjectStatisticsWidgetBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export const PROJECT_STATISTICS_WIDGET_WIDTH = 3.1;
export const PROJECT_STATISTICS_WIDGET_HEIGHT = 1.25;

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

  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  const terrainHeight = Math.max(1, bounds.maxY - bounds.minY);
  const westX = bounds.minX - STATISTICS_WIDGET_GAP - PROJECT_STATISTICS_WIDGET_WIDTH / 2;
  const eastX = bounds.maxX + STATISTICS_WIDGET_GAP + PROJECT_STATISTICS_WIDGET_WIDTH / 2;
  const northY = bounds.maxY + STATISTICS_WIDGET_GAP + PROJECT_STATISTICS_WIDGET_HEIGHT / 2;
  const upperY = bounds.minY + terrainHeight * 0.7;
  const lowerY = bounds.minY + terrainHeight * 0.3;

  const positions: Array<[number, number]> = [
    [westX, upperY],
    [westX, centerY],
    [westX, lowerY],
    [centerX, northY],
    [eastX, upperY],
    [eastX, lowerY],
  ];

  return STATISTICS_WIDGETS.map(({ key, label }, index) => ({
    key,
    label,
    value: statistics[key],
    position: [positions[index][0], positions[index][1], z + STATISTICS_WIDGET_Z_OFFSET],
  }));
}

export function getProjectStatisticsWidgetBounds(
  layout: ProjectStatisticsWidgetLayout[],
): ProjectStatisticsWidgetBounds | null {
  if (layout.length === 0) return null;

  const halfWidth = PROJECT_STATISTICS_WIDGET_WIDTH / 2;
  const halfHeight = PROJECT_STATISTICS_WIDGET_HEIGHT / 2;
  return layout.reduce<ProjectStatisticsWidgetBounds>(
    (bounds, widget) => ({
      minX: Math.min(bounds.minX, widget.position[0] - halfWidth),
      maxX: Math.max(bounds.maxX, widget.position[0] + halfWidth),
      minY: Math.min(bounds.minY, widget.position[1] - halfHeight),
      maxY: Math.max(bounds.maxY, widget.position[1] + halfHeight),
    }),
    {
      minX: Infinity,
      maxX: -Infinity,
      minY: Infinity,
      maxY: -Infinity,
    },
  );
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
