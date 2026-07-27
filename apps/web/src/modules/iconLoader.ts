// Loads Material Symbols Outlined as a variable font from Google CDN.
// The font supports variable axes: opsz (20-48), wght (100-700), FILL (0-1), GRAD (-50-200).
const MATERIAL_SYMBOLS_LINK_ID = "material-symbols-outlined-font";
const loadedIconNames = new Set<string>();
let loadsFullFont = false;

export function loadMaterialSymbols(iconNames: string[] = ["home"]) {
  if (loadsFullFont) return;
  const baseUrl = "https://fonts.googleapis.com/css2";
  const fontFamily = "Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200";

  for (const name of iconNames) {
    const normalizedName = name.trim();
    if (!normalizedName) continue;
    loadedIconNames.add(normalizedName);
  }

  const sortedIconNames = Array.from(loadedIconNames).sort();
  const href = `${baseUrl}?family=${fontFamily}&icon_names=${encodeURIComponent(sortedIconNames.join(","))}&display=block`;
  const existingLink = document.getElementById(MATERIAL_SYMBOLS_LINK_ID) as HTMLLinkElement | null;
  if (existingLink) {
    if (existingLink.href !== href) existingLink.href = href;
    return;
  }

  const linkElement = document.createElement("link");
  linkElement.id = MATERIAL_SYMBOLS_LINK_ID;
  linkElement.rel = "stylesheet";
  linkElement.href = href;
  document.head.appendChild(linkElement);
}

export function loadAllMaterialSymbols() {
  loadsFullFont = true;
  const baseUrl = "https://fonts.googleapis.com/css2";
  const fontFamily =
    "Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200";
  const href = `${baseUrl}?family=${fontFamily}&display=block`;
  const existingLink = document.getElementById(
    MATERIAL_SYMBOLS_LINK_ID,
  ) as HTMLLinkElement | null;
  if (existingLink) {
    existingLink.href = href;
    return;
  }

  const linkElement = document.createElement("link");
  linkElement.id = MATERIAL_SYMBOLS_LINK_ID;
  linkElement.rel = "stylesheet";
  linkElement.href = href;
  document.head.appendChild(linkElement);
}
