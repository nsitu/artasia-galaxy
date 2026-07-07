import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const buildLabelFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  day: "numeric",
});
const buildLabelParts = buildLabelFormatter.formatToParts(new Date());
const buildLabelPart = (type: Intl.DateTimeFormatPartTypes) =>
  buildLabelParts.find((part) => part.type === type)?.value ?? "";
const buildLabel = `Built at ${buildLabelPart("hour")}:${buildLabelPart("minute")}${buildLabelPart("dayPeriod").toLowerCase()} on ${buildLabelPart("month")} ${buildLabelPart("day")}`;

export default defineConfig({
  plugins: [react()],
  define: {
    __ARTASIA_BUILD_LABEL__: JSON.stringify(buildLabel),
  },
  envDir: "../..",
  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
