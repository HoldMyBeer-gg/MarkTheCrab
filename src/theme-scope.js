// Scope a theme stylesheet to the preview pane so theme rules can't restyle
// the rest of the app.

// Prefix every selector in the theme stylesheet with `scope` so theme rules
// only hit the preview pane. Root-ish selectors (body/html/:root/
// .remarkable-preview) map to the scope element itself; everything else
// becomes a descendant. @media print blocks are preserved verbatim so their
// rules apply to the actual printed page (where the preview is the only
// visible content — see the print rules in styles/app.css).
//
// Themes were written for a whole page, so their root rules set margins,
// padding and a max-width. The app lays out the preview itself
// (.markdown-preview in styles/app.css), so those are dropped from root
// rules. A root background is also applied to `paneScope`, so the theme
// colours the whole pane and not only the centred column.
export function scopeThemeCss(css, scope, { paneScope = null } = {}) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Pull @media print blocks out before scoping so their inner rules keep
  // targeting `body`, `html`, etc. for the print output.
  const protected_ = [];
  css = extractBalancedAtBlocks(css, /@media\s+print\b/gi, protected_);
  css = css.replace(/([^{}@;]+)\{([^{}]*)\}/g, (match, selectors, body) => {
    const scoped = selectors.split(",").map((s) => scopeSelector(s, scope)).filter(Boolean);
    if (scoped.length === 0) return match;
    const rest = scoped.filter((s) => s !== scope);
    const out = [];
    if (rest.length > 0) out.push(`${rest.join(", ")} { ${body} }`);
    if (rest.length < scoped.length) {
      const decls = splitDeclarations(body);
      const kept = decls.filter((d) => !LAYOUT_PROP.test(propName(d)));
      if (kept.length > 0) out.push(`${scope} { ${kept.join("; ")} }`);
      const bg = decls.filter((d) => BACKGROUND_PROP.test(propName(d)));
      if (paneScope && bg.length > 0) out.push(`${paneScope} { ${bg.join("; ")} }`);
    }
    return out.join("\n");
  });
  for (const [placeholder, block] of protected_) {
    css = css.replace(placeholder, block);
  }
  return css;
}

const LAYOUT_PROP = /^(margin|padding)(-[a-z-]+)?$|^(min-|max-)?width$/;
const BACKGROUND_PROP = /^background(-[a-z-]+)?$/;

function propName(decl) {
  return decl.slice(0, decl.indexOf(":")).trim().toLowerCase();
}

// Split a declaration block on top-level semicolons (not ones inside
// url(...) or other parentheses, such as data URIs). Empty entries dropped.
function splitDeclarations(body) {
  const decls = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "(") depth++;
    else if (c === ")") depth = Math.max(0, depth - 1);
    else if (c === ";" && depth === 0) {
      decls.push(body.slice(start, i));
      start = i + 1;
    }
  }
  decls.push(body.slice(start));
  return decls.map((d) => d.trim()).filter((d) => d.includes(":"));
}

// Replace top-level at-rule blocks matching `startRegex` with placeholder
// tokens and record the originals in `out` as [placeholder, block] pairs.
// Handles nested braces.
function extractBalancedAtBlocks(css, startRegex, out) {
  let result = "";
  let idx = 0;
  let m;
  startRegex.lastIndex = 0;
  while ((m = startRegex.exec(css)) !== null) {
    const start = m.index;
    let i = start + m[0].length;
    while (i < css.length && css[i] !== "{") i++;
    if (i >= css.length) break;
    let depth = 1;
    let j = i + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    const block = css.slice(start, j);
    // Shaped like an at-statement ("@x;") so the selector regex in
    // scopeThemeCss stops at it instead of gluing it onto the next rule.
    const placeholder = `@mtc-ph-${out.length};`;
    out.push([placeholder, block]);
    result += css.slice(idx, start) + placeholder;
    idx = j;
    startRegex.lastIndex = j;
  }
  result += css.slice(idx);
  return result;
}

export function scopeSelector(raw, scope) {
  const s = raw.trim();
  if (!s) return "";
  if (s === "body" || s === "html" || s === ":root" || s === ".remarkable-preview") return scope;
  if (s === "*") return `${scope} *`;
  const rootMatch = s.match(/^(html\s+body|html|body|\.remarkable-preview)(?=$|[\s>+~:.#\[])/);
  if (rootMatch) return scope + s.slice(rootMatch[0].length);
  return `${scope} ${s}`;
}
