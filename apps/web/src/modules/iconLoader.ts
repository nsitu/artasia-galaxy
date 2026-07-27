// Loads Material Symbols Outlined as a variable font from Google CDN.
// The font supports variable axes: opsz (20-48), wght (100-700), FILL (0-1), GRAD (-50-200).
const MATERIAL_SYMBOLS_LINK_ID = "material-symbols-outlined-font";
const MATERIAL_SYMBOLS_FONT = '"Material Symbols Outlined"';
const loadedIconNames = new Set<string>();
let loadsFullFont = false;
let stylesheetReady: Promise<void> = Promise.resolve();

function loadStylesheet(href: string) {
  const existingLink = document.getElementById(
    MATERIAL_SYMBOLS_LINK_ID,
  ) as HTMLLinkElement | null;
  const linkElement = existingLink ?? document.createElement("link");
  if (linkElement.href === href) return stylesheetReady;

  stylesheetReady = new Promise<void>((resolve) => {
    const finish = () => resolve();
    linkElement.addEventListener("load", finish, { once: true });
    linkElement.addEventListener("error", finish, { once: true });
  });
  linkElement.id = MATERIAL_SYMBOLS_LINK_ID;
  linkElement.rel = "stylesheet";
  linkElement.href = href;
  if (!existingLink) document.head.appendChild(linkElement);
  return stylesheetReady;
}

async function waitForGlyphs(iconNames: string[]) {
  await stylesheetReady;
  if (!document.fonts) return;
  const loadedFaces = await Promise.all(
    iconNames.map((name) =>
      document.fonts.load(`400 128px ${MATERIAL_SYMBOLS_FONT}`, name),
    ),
  );
  if (loadedFaces.some((faces) => faces.length === 0)) {
    throw new Error("Material Symbols font glyphs could not be loaded.");
  }
}

export async function loadMaterialSymbols(iconNames: string[] = ["home"]) {
  const requestedIconNames = iconNames
    .map((name) => name.trim())
    .filter(Boolean);
  if (loadsFullFont) {
    await waitForGlyphs(requestedIconNames);
    return;
  }
  const baseUrl = "https://fonts.googleapis.com/css2";
  const fontFamily = "Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200";

  for (const name of requestedIconNames) loadedIconNames.add(name);

  const sortedIconNames = Array.from(loadedIconNames).sort();
  const href = `${baseUrl}?family=${fontFamily}&icon_names=${encodeURIComponent(sortedIconNames.join(","))}&display=block`;
  await loadStylesheet(href);
  await waitForGlyphs(requestedIconNames);
}

export async function loadAllMaterialSymbols() {
  loadsFullFont = true;
  const baseUrl = "https://fonts.googleapis.com/css2";
  const fontFamily =
    "Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200";
  const href = `${baseUrl}?family=${fontFamily}&display=block`;
  await loadStylesheet(href);
}
