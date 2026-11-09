// CSS from a document's own <style> blocks, scoped to the preview pane.
//
// A document is untrusted (anyone can send you a .md), so this does not
// rewrite CSS text the way theme-scope.js does for the bundled themes: an
// unclosed brace or a brace inside a string could let a rule slip out. The
// webview parses the CSS (CSSStyleSheet.replaceSync), and the scoped sheet is
// rebuilt from the parsed rules, so what gets applied is exactly what the
// browser understood, with every selector inside the preview.

import { scopeSelector } from "./theme-scope.js";

// Split a selector list on commas that aren't inside (), [] or quotes.
export function splitSelectorList(text) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth = Math.max(0, depth - 1);
    else if (c === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

// One selector, scoped. Null if it can't be kept inside the preview: a root
// selector followed by `~` or `+` would match the preview's siblings.
export function scopeDocSelector(selector, scope) {
  const scoped = scopeSelector(selector, scope);
  if (!scoped) return null;
  const rest = scoped.slice(scope.length).trimStart();
  if (scoped.startsWith(scope) && (rest.startsWith("~") || rest.startsWith("+"))) return null;
  return scoped;
}

// Serialize a parsed rule tree with every selector scoped. Rule shapes:
//   { type: "style", selector, declarations }
//   { type: "media" | "supports", condition, rules }
//   { type: "font-face", declarations }
// Anything else (@import, @keyframes, @layer, …) is dropped.
export function serializeScopedRules(rules, scope) {
  const out = [];
  for (const rule of rules) {
    if (rule.type === "style") {
      const selectors = splitSelectorList(rule.selector)
        .map((s) => scopeDocSelector(s, scope))
        .filter(Boolean);
      if (selectors.length > 0) out.push(`${selectors.join(", ")} { ${rule.declarations} }`);
    } else if (rule.type === "media" || rule.type === "supports") {
      const inner = serializeScopedRules(rule.rules, scope);
      if (inner) out.push(`@${rule.type} ${rule.condition} { ${inner} }`);
    } else if (rule.type === "font-face") {
      out.push(`@font-face { ${rule.declarations} }`);
    }
  }
  return out.join("\n");
}

// Browser CSSOM → the plain rule tree above.
function fromCssom(cssRules) {
  const rules = [];
  for (const r of cssRules) {
    if (typeof CSSStyleRule !== "undefined" && r instanceof CSSStyleRule) {
      rules.push({ type: "style", selector: r.selectorText, declarations: r.style.cssText });
    } else if (typeof CSSMediaRule !== "undefined" && r instanceof CSSMediaRule) {
      rules.push({ type: "media", condition: r.media.mediaText, rules: fromCssom(r.cssRules) });
    } else if (typeof CSSSupportsRule !== "undefined" && r instanceof CSSSupportsRule) {
      rules.push({ type: "supports", condition: r.conditionText, rules: fromCssom(r.cssRules) });
    } else if (typeof CSSFontFaceRule !== "undefined" && r instanceof CSSFontFaceRule) {
      rules.push({ type: "font-face", declarations: r.style.cssText });
    } else {
      rules.push({ type: "other" });
    }
  }
  return rules;
}

// Parse `css` the way the webview would and return it scoped to `scope`.
// Empty if it can't be parsed here (no constructable stylesheets).
export function scopeDocumentCss(css, scope) {
  if (!css || !css.trim() || typeof CSSStyleSheet === "undefined") return "";
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css); // ignores @import by design
    return serializeScopedRules(fromCssom(sheet.cssRules), scope);
  } catch (_) {
    return "";
  }
}
