import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadMaterialSymbols } from "./modules/iconLoader";

loadMaterialSymbols([
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
  "edit",
]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
