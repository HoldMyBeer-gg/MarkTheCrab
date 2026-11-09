// Editor font setting: how it's stored, what CSS it becomes, and the search
// used by the "Choose a font…" dialog. No DOM here so it can be tested.
//
// Stored values (settings.font_family):
//   ""                 Default (the editor theme's monospace)
//   "OpenDyslexic"     the bundled OpenDyslexic
//   "system:<Family>"  an installed font, referenced by name only
// Older builds stored "monospace" as the default; it reads as Default.

const SYSTEM_PREFIX = "system:";

export const BUNDLED_FONTS = {
  opendyslexic: { label: "OpenDyslexic", stored: "OpenDyslexic", stack: "'OpenDyslexic', Georgia, serif" },
};

export function parseFontSetting(stored) {
  if (typeof stored !== "string") return { kind: "default" };
  if (stored.startsWith(SYSTEM_PREFIX)) {
    const family = stored.slice(SYSTEM_PREFIX.length).trim();
    return family ? { kind: "system", family } : { kind: "default" };
  }
  if (stored.toLowerCase().includes("opendyslexic")) return { kind: "bundled", id: "opendyslexic" };
  return { kind: "default" };
}

export function fontSettingValue(choice) {
  if (choice.kind === "system") return SYSTEM_PREFIX + choice.family;
  if (choice.kind === "bundled") return BUNDLED_FONTS[choice.id]?.stored ?? "";
  return "";
}

// A family name as a CSS string. Font names come from the OS or from what the
// user typed, so quotes and backslashes are escaped.
export function cssFamily(name) {
  return `"${String(name).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

// `fallback` covers a system font that's been uninstalled since it was chosen.
export function fontStack(choice, fallback = "monospace") {
  if (choice.kind === "system") return `${cssFamily(choice.family)}, ${fallback}`;
  if (choice.kind === "bundled") return BUNDLED_FONTS[choice.id]?.stack ?? "";
  return "";
}

// Preview elements that keep their own font whatever the preview font is.
const PREVIEW_KEEPS_FONT = "code, pre, pre *, kbd, samp, .katex, .katex *, svg, svg *";

// CSS putting the chosen font on all preview text. Themes give elements
// their own font (Solarized's `html *`, most themes' p/h1), so the preview
// root alone isn't enough: everything inside gets it too, with !important.
export function previewFontCss(choice, scope) {
  const stack = fontStack(choice, "serif");
  if (!stack) return "";
  return `${scope}, ${scope} *:not(${PREVIEW_KEEPS_FONT}) { font-family: ${stack} !important; }`;
}

// Value of the matching <option> in the settings dropdown.
export function selectValue(choice) {
  if (choice.kind === "system") return "system";
  if (choice.kind === "bundled") return choice.id;
  return "default";
}

const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: "base" });

// Families containing `query` (case-insensitive), names starting with it
// first, each group sorted by name.
export function filterFamilies(families, query) {
  const q = query.trim().toLowerCase();
  if (!q) return [...families].sort(byName);
  const starts = [];
  const contains = [];
  for (const f of families) {
    const lower = f.toLowerCase();
    if (lower.startsWith(q)) starts.push(f);
    else if (lower.includes(q)) contains.push(f);
  }
  return [...starts.sort(byName), ...contains.sort(byName)];
}
