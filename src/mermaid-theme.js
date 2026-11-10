// Mermaid draws with its own palette, so it has to be told whether the
// preview behind it is dark. The preview's colour comes from the theme, and
// a document's own <style> can repaint it, so read the actual computed
// background instead of guessing from setting names.

// "rgb(r, g, b)" / "rgba(r, g, b, a)" → dark? Transparent or unreadable
// colours aren't dark (they show whatever is behind them).
export function isDarkColor(css) {
  const m = /rgba?\(([^)]+)\)/.exec(css || "");
  if (!m) return false;
  const [r, g, b, a = 1] = m[1].split(",").map((v) => parseFloat(v));
  if (a === 0) return false;
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance < 0.5;
}

// Background colours from the innermost layer out (preview, then pane):
// the first opaque one decides.
export function mermaidThemeFor(backgrounds) {
  for (const bg of backgrounds) {
    const m = /rgba?\(([^)]+)\)/.exec(bg || "");
    const alpha = m ? parseFloat(m[1].split(",")[3] ?? "1") : 0;
    if (alpha === 0) continue;
    return isDarkColor(bg) ? "dark" : "default";
  }
  return "default";
}
