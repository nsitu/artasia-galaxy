import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const buildLabelFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Toronto",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  day: "numeric",
});
const buildTime = process.env.VITE_ARTASIA_BUILD_TIME;
const buildLabelParts = buildLabelFormatter.formatToParts(new Date());
const buildLabelPart = (type: Intl.DateTimeFormatPartTypes) =>
  buildLabelParts.find((part) => part.type === type)?.value ?? "";
const buildLabel = buildTime
  ? `Built at ${buildLabelFormatter.format(new Date(buildTime))}`
  : `Built at ${buildLabelPart("hour")}:${buildLabelPart("minute")}${buildLabelPart("dayPeriod").toLowerCase()} on ${buildLabelPart("month")} ${buildLabelPart("day")}`;
const buildId = process.env.VITE_ARTASIA_BUILD_ID ?? "dev";

export default defineConfig({
  plugins: [react()],
  define: {
    __ARTASIA_BUILD_LABEL__: JSON.stringify(buildLabel),
    __ARTASIA_BUILD_ID__: JSON.stringify(buildId),
  },
  envDir: "../..",
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
