// Loads Material Symbols Outlined as a variable font from Google CDN.
// The font supports variable axes: opsz (20-48), wght (100-700), FILL (0-1), GRAD (-50-200).
const MATERIAL_SYMBOLS_LINK_ID = "material-symbols-outlined-font";

export function loadMaterialSymbols(iconNames: string[] = ["home"]) {
  const baseUrl = "https://fonts.googleapis.com/css2";
  const fontFamily = "Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200";

  const seen = new Set<string>();
  const duplicates = new Set<string>();
  const uniqueIconNames: string[] = [];

  for (const name of iconNames) {
    const normalizedName = name.trim();
    if (!normalizedName) continue;
    if (seen.has(normalizedName)) {
      duplicates.add(normalizedName);
    } else {
      seen.add(normalizedName);
      uniqueIconNames.push(normalizedName);
    }
  }

  if (duplicates.size > 0) {
    console.warn("[IconLoader] Duplicate icon names detected:", Array.from(duplicates));
  }

  uniqueIconNames.sort();

  const href = `${baseUrl}?family=${fontFamily}&icon_names=${encodeURIComponent(uniqueIconNames.join(","))}&display=block`;
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
