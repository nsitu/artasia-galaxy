import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import {
  loadAllMaterialSymbols,
  loadMaterialSymbols,
} from "./modules/iconLoader";

const coreIconNames = [
  "reset_brightness",
  "reset_colors",
  "reset_shadow",
  "reset_exposure",

  "reset_settings",
  "edit",
  "schedule",
  "person",
  "upload",
  "open_in_new",
  "add_to_drive",
  "browse",
  "location_on",
  "filter_alt_off",
  "warning",
  "child_hat",
  "close",
  "play_arrow",
  "pause",
];

if (
  window.location.pathname === "/admin" ||
  window.location.pathname.startsWith("/admin/") ||
  /^\/edit\/[0-9a-f-]{36}$/i.test(window.location.pathname)
) {
  void loadAllMaterialSymbols();
} else {
  void loadMaterialSymbols(coreIconNames).catch((error) => {
    console.warn(`[icons] ${(error as Error).message}`);
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
