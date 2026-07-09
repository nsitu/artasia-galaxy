import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { loadMaterialSymbols } from "./modules/iconLoader";

loadMaterialSymbols(["upload", "add_to_drive", "browse", "location_on"]);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
