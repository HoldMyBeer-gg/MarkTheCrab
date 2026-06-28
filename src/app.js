import { createEditor, createDocState, activateState, setContent, getContent, setNightMode, setLineNumbers, setWordWrap, setFontSize, setFontFamily, setSpellcheck, wrapSelection, insertAtCursor, insertAtLineStart, getWordCount, editorUndo, editorRedo, openFind } from "./editor.js";
import hljs from "./hljs-setup.js";
import { Mascot } from "./mascot.js";

// Make hljs available globally for preview highlighting
window.hljs = hljs;

import { invoke, convertFileSrc, dialog, event as tauriEvent, currentWindow, isBrowser } from "./runtime.js";
import { isMobilePlatform, parentDir, joinPath, encodeMarkdownUrl, rebaseDocumentsPath, bytesToBase64 } from "./util.js";
const { open, save, message, ask } = dialog;

// State
let editor;
// The active document's fields are mirrored into these globals so the many
// callers that read them (save, preview image base, etc.) need no rewrite.
// They are kept in sync with the active tab on every switch.
let currentFile = null;
let currentFileMtime = null; // ms since epoch, for external-change detection
let isModified = false;
let settings = {};

// ────── TABS ──────────────────────────────────────────────────────
// Each open document is a tab. A tab owns its own CodeMirror EditorState
// (isolated undo history, selection and content) plus file metadata. The
// live editor view shows the active tab; inactive tabs live in `state`.
let tabs = [];
let activeTabId = null;
let tabSeq = 0;
// Set while swapping the editor to another tab's state, so the swap isn't
// mistaken for a user edit (which would mark the incoming tab modified).
let suppressChange = false;
let previewVisible = true;
let renderTimeout = null;
let platformName = "desktop";
let isMobile = false; // iOS/Android: no native save-as picker, sandboxed fs

// Elements
const previewEl = document.getElementById("preview");
const previewPane = document.getElementById("preview-pane");
const editorPane = document.getElementById("editor-pane");
const mainEl = document.getElementById("main");
const toolbarEl = document.getElementById("toolbar");
const statusbarEl = document.getElementById("statusbar");
const tabbarEl = document.getElementById("tabbar");
const tabListEl = document.getElementById("tab-list");
const tabNewBtn = document.getElementById("tab-new");

// Status bar elements
const statusFile = document.getElementById("status-file");
const statusModified = document.getElementById("status-modified");
const statusCursor = document.getElementById("status-cursor");
const statusWords = document.getElementById("status-words");
const statusChars = document.getElementById("status-chars");

// Theme CSS cache (scoped source text per theme name)
const themeCache = {};
let currentThemeLink = null;

async function init() {
  // Detect the platform up front so the file UI (save, image picking) can
  // branch: iOS has no native save-as path picker and a sandboxed fs.
  try {
    platformName = await invoke("platform");
  } catch (_) {
    platformName = "desktop";
  }
  isMobile = isMobilePlatform(platformName);
  document.documentElement.dataset.mtcPlatform = platformName;

  // On mobile there's no print dialog; the print action opens the native
  // share sheet (which offers Print / Save to PDF), so label it as Share.
  if (isMobile) {
    const printBtn = document.querySelector('[data-action="print"]');
    if (printBtn) {
      printBtn.title = "Share";
      printBtn.setAttribute("aria-label", "Share");
    }
  }

  // Load settings from Rust backend
  settings = await invoke("load_settings");

  // Create CodeMirror editor
  editor = createEditor(document.getElementById("editor"), {
    onChange: onContentChange,
    onCursorChange: onCursorChange,
  });

  // Apply settings
  applySettings();

  // Set up toolbar
  setupToolbar();

  // Set up keyboard shortcuts
  setupShortcuts();

  // Set up resizer
  setupResizer();

  // Set up dialogs
  setupDialogs();

  // Keep preview links from navigating the webview away (and nuking the app)
  setupPreviewLinks();

  // Set up drag-drop
  setupDragDrop();

  // Set up clipboard image paste
  setupClipboardPaste();

  // Guard window close against unsaved changes
  setupCloseGuard();

  // Native menu wiring (Tauri only)
  setupMenuEvents();

  // Populate recent-files dropdown from settings
  refreshRecentFiles();

  // Mascot: empty-state overlay + first-launch welcome
  setupMascot();

  // Tabs: start with one empty Untitled tab backed by the live editor.
  initTabs();
  setupTabBar();

  // Open file passed via CLI args, file-association double-click, or
  // `open foo.md` on macOS. Falls back to welcome dialog on first launch.
  const opened = await maybeOpenStartupFile();
  if (!opened) maybeShowWelcome();

  // Load tutorial or empty
  updatePreview("");
}

async function maybeOpenStartupFile() {
  if (isBrowser) return false;
  try {
    const path = await invoke("take_pending_open_file");
    if (path) {
      await loadFile(path);
      return true;
    }
  } catch (_) {
    /* ignore */
  }
  return false;
}

// ────── MASCOT LAYER ──────────────────────────────────────────────
// See handoff/README.md for the full placement rationale.

let thinkingTimer = null;

function setupMascot() {
  refreshEmptyMascot();
}

function refreshEmptyMascot() {
  const host = document.getElementById("editor-mascot");
  if (!host) return;
  const empty = !currentFile && !getContent(editor).trim();
  if (empty) {
    if (!host.querySelector(".mascot")) {
      Mascot.show(host, "sleepy", { size: 180 });
    }
    host.classList.add("visible");
  } else if (host.classList.contains("visible")) {
    host.classList.remove("visible");
    // Wait for the fade, then clear the DOM — but only if still non-empty.
    setTimeout(() => {
      if (!(!currentFile && !getContent(editor).trim())) {
        host.innerHTML = "";
      }
    }, 400);
  }
}

async function maybeShowWelcome() {
  try {
    const s = settings && settings.recent_files ? settings : await invoke("load_settings");
    const first = !s.recent_files || s.recent_files.length === 0;
    if (!first) return;
    const dialog = document.getElementById("welcome-dialog");
    if (!dialog) return;
    Mascot.show("#welcome-mascot", "excited", { size: 140 });
    dialog.showModal();
    const go = document.getElementById("welcome-go");
    if (go) go.onclick = () => dialog.close();
  } catch (_) {
    /* ignore */
  }
}

// Listen scoped to this window when possible. The native menu and the Rust
// open/close events are emitted to a single window (emit_to), so each window
// must register its own scoped listener; a plain global `event.listen` is an
// "Any" sniffer that would fire in every window. Falls back to the global
// listener (single-window behavior) if the current window isn't available.
function listenScoped(event, handler) {
  if (currentWindow) return currentWindow.listen(event, handler);
  return tauriEvent.listen(event, handler);
}

async function setupMenuEvents() {
  if (!tauriEvent || isBrowser) return;
  await listenScoped("mtc:menu", async (e) => {
    const id = typeof e.payload === "string" ? e.payload : "";
    await dispatchMenu(id);
  });
  await listenScoped("mtc:menu:open-recent", async (e) => {
    const path = typeof e.payload === "string" ? e.payload : null;
    if (path) await openRecent(path);
  });
  await listenScoped("mtc:open-path", async (e) => {
    const path = typeof e.payload === "string" ? e.payload : null;
    if (path) await openRecent(path);
  });
}

async function dispatchMenu(id) {
  switch (id) {
    case "file.new": return newWindow();
    case "file.new_tab": return newFile();
    case "file.open": return openFile();
    case "file.save": return saveFile();
    case "file.save_as": return saveFileAs();
    case "file.export_styled": return exportHtml(true);
    case "file.export_raw": return exportHtml(false);
    case "file.print": return printPreview();
    case "file.recent.cleared": return refreshRecentFiles();

    case "edit.undo": editorUndo(editor); return;
    case "edit.redo": editorRedo(editor); return;
    case "edit.find": return openFind(editor);

    case "insert.bold": return wrapSelection(editor, "**");
    case "insert.italic": return wrapSelection(editor, "*");
    case "insert.strike": return wrapSelection(editor, "~~");
    case "insert.h1": return insertAtLineStart(editor, "# ");
    case "insert.h2": return insertAtLineStart(editor, "## ");
    case "insert.h3": return insertAtLineStart(editor, "### ");
    case "insert.h4": return insertAtLineStart(editor, "#### ");
    case "insert.link": {
      const sel = editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to);
      if (sel) document.getElementById("link-text").value = sel;
      document.getElementById("link-dialog").showModal();
      document.getElementById("link-url").focus();
      return;
    }
    case "insert.image": document.getElementById("image-dialog").showModal(); return;
    case "insert.table": document.getElementById("table-dialog").showModal(); return;
    case "insert.hr": return insertAtCursor(editor, "\n\n---\n\n");
    case "insert.code": return wrapSelection(editor, "```\n", "\n```");
    case "insert.ul": return insertAtLineStart(editor, "- ");
    case "insert.ol": return insertAtLineStart(editor, "1. ");
    case "insert.checklist": return insertAtLineStart(editor, "- [ ] ");
    case "insert.quote": return insertAtLineStart(editor, "> ");

    case "view.toggle_preview": return togglePreview();
    case "view.toggle_layout": return toggleLayout();
    case "view.zoom_in": return zoomPreview(0.1);
    case "view.zoom_out": return zoomPreview(-0.1);
    case "view.zoom_reset": return zoomPreview(0);
    case "view.settings": return showSettings();

    case "help.about": return showAbout();

    case "app.quit": return quitApp();
  }
}

async function confirmDiscardUnsaved() {
  if (!isModified) return true;
  return await ask(
    "You have unsaved changes. Close without saving?",
    { title: "Unsaved changes", kind: "warning", okLabel: "Discard", cancelLabel: "Keep editing" }
  );
}

// Quit / window-close guard: any tab with unsaved changes counts.
async function confirmDiscardAllUnsaved() {
  saveActiveTabState(); // flush the live editor into the active tab first
  const dirty = tabs.filter((t) => t.isModified).length;
  if (dirty === 0) return true;
  return await ask(
    dirty > 1
      ? `You have unsaved changes in ${dirty} tabs. Close without saving?`
      : "You have unsaved changes. Close without saving?",
    { title: "Unsaved changes", kind: "warning", okLabel: "Discard", cancelLabel: "Keep editing" }
  );
}

async function quitApp() {
  // quit_app closes every window; each window's close guard
  // (mtc:close-requested) prompts for its own unsaved changes before the app
  // exits, so no pre-check here (it would double-prompt the focused window).
  await invoke("quit_app");
}

async function setupCloseGuard() {
  if (!tauriEvent) return;
  await listenScoped("mtc:close-requested", async () => {
    if (!(await confirmDiscardAllUnsaved())) return;
    await invoke("confirm_close");
  });
}

function applySettings() {
  setNightMode(editor, settings.night_mode);
  setLineNumbers(editor, settings.line_numbers);
  setWordWrap(editor, settings.word_wrap);
  setFontSize(editor, settings.font_size);
  setSpellcheck(editor, settings.spellcheck !== false);

  if (settings.night_mode) {
    document.body.classList.add("night-mode");
  } else {
    document.body.classList.remove("night-mode");
  }

  if (!settings.show_toolbar) toolbarEl.classList.add("hidden");
  if (!settings.show_statusbar) statusbarEl.classList.add("hidden");
  if (!settings.live_preview) togglePreview(false);

  if (settings.vertical_layout) {
    mainEl.classList.remove("horizontal");
    mainEl.classList.add("vertical");
    document.querySelector('[data-action="toggle-layout"]')?.setAttribute("aria-pressed", "true");
  }

  applyTheme(settings.theme);
  applyCustomCss(settings.custom_css);

  applyFontFamily(settings.font_family);

  Mascot.configure({
    enabled: settings.show_mascot !== false,
    animations: settings.mascot_animations !== false,
  });

  if (settings.rtl) {
    previewEl.style.direction = "rtl";
  }
}

// Known font-family presets. "default" falls back to the app stylesheet's
// system font; "opendyslexic" enables the embedded OpenDyslexic face.
const FONT_FAMILIES = {
  default: "",
  opendyslexic: "'OpenDyslexic', Georgia, serif",
};

function fontFamilyKey(stored) {
  if (!stored) return "default";
  const normalized = stored.toLowerCase();
  if (normalized.includes("opendyslexic")) return "opendyslexic";
  return "default";
}

function applyFontFamily(stored) {
  const key = fontFamilyKey(stored);
  document.body.classList.toggle("font-opendyslexic", key === "opendyslexic");
  if (editor) setFontFamily(editor, FONT_FAMILIES[key] || "");
}

const KNOWN_THEMES = new Set([
  "dark", "foghorn", "github", "handwriting", "markdown",
  "metro-vibes", "metro-vibes-dark", "modern", "solarized-dark", "solarized-light",
]);

async function applyTheme(themeName) {
  if (!KNOWN_THEMES.has(themeName)) themeName = "github";
  if (currentThemeLink) {
    currentThemeLink.remove();
    currentThemeLink = null;
  }
  let scoped = themeCache[themeName];
  if (scoped == null) {
    const res = await fetch(`themes/${themeName}.css`);
    scoped = scopeThemeCss(await res.text(), "#preview");
    themeCache[themeName] = scoped;
  }
  const style = document.createElement("style");
  style.id = "theme-css";
  style.textContent = scoped;
  document.head.appendChild(style);
  currentThemeLink = style;
}

// Prefix every selector in the theme stylesheet with `scope` so theme rules
// only hit the preview pane. Root-ish selectors (body/html/:root/
// .remarkable-preview) map to the scope element itself; everything else
// becomes a descendant. @media print blocks are preserved verbatim so their
// rules apply to the actual printed page (where the preview is the only
// visible content — see the print rules in styles/app.css).
function scopeThemeCss(css, scope) {
  css = css.replace(/\/\*[\s\S]*?\*\//g, "");
  // Pull @media print blocks out before scoping so their inner rules keep
  // targeting `body`, `html`, etc. for the print output.
  const protected_ = [];
  css = extractBalancedAtBlocks(css, /@media\s+print\b/gi, protected_);
  css = css.replace(/([^{}@]+)\{([^{}]*)\}/g, (match, selectors, body) => {
    const scoped = selectors
      .split(",")
      .map((s) => scopeSelector(s, scope))
      .filter(Boolean)
      .join(", ");
    return scoped ? `${scoped} { ${body} }` : match;
  });
  for (const [placeholder, block] of protected_) {
    css = css.replace(placeholder, block);
  }
  return css;
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
    const placeholder = `___MTC_PH_${out.length}___`;
    out.push([placeholder, block]);
    result += css.slice(idx, start) + placeholder;
    idx = j;
    startRegex.lastIndex = j;
  }
  result += css.slice(idx);
  return result;
}

function scopeSelector(raw, scope) {
  const s = raw.trim();
  if (!s) return "";
  if (s === "body" || s === "html" || s === ":root" || s === ".remarkable-preview") return scope;
  if (s === "*") return `${scope} *`;
  const rootMatch = s.match(/^(html\s+body|html|body|\.remarkable-preview)(?=[\s>+~:.#\[])/);
  if (rootMatch) return scope + s.slice(rootMatch[0].length);
  return `${scope} ${s}`;
}

function onContentChange(content) {
  if (suppressChange) return;
  setActiveModified(true);

  // Debounce preview rendering
  clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => updatePreview(content), 150);

  // Update word count
  const { words, chars } = getWordCount(editor);
  statusWords.textContent = `${words} words`;
  statusChars.textContent = `${chars} chars`;

  // Mascot: first keystroke dismisses the sleepy overlay (and welcome card).
  refreshEmptyMascot();
  const welcome = document.getElementById("welcome-dialog");
  if (welcome && welcome.open) welcome.close();
}

function onCursorChange(line, col) {
  statusCursor.textContent = `Ln ${line}, Col ${col}`;
}

let _renderGen = 0;
async function updatePreview(content) {
  if (!previewVisible) return;
  const gen = ++_renderGen;

  // Schedule a "thinking" mascot in the preview corner if render takes
  // longer than 400ms. Cancelled below if render finishes faster.
  clearTimeout(thinkingTimer);
  thinkingTimer = setTimeout(() => {
    const corner = document.getElementById("preview-mascot");
    if (!corner) return;
    Mascot.show(corner, "thinking", { size: 48, blink: false });
    corner.classList.add("visible");
  }, 400);

  const html = await invoke("render_markdown", { text: content });
  if (gen !== _renderGen) return;
  previewEl.innerHTML = html;

  resolvePreviewImageSrcs();

  // Highlight code blocks (skip mermaid/katex/math — those are replaced by
  // their own render passes and shouldn't be syntax-coloured first)
  previewEl.querySelectorAll("pre code").forEach((block) => {
    if (!window.hljs) return;
    if (
      block.classList.contains("language-mermaid") ||
      block.classList.contains("lang-mermaid") ||
      block.classList.contains("language-katex") ||
      block.classList.contains("lang-katex") ||
      block.classList.contains("language-math") ||
      block.classList.contains("lang-math")
    ) {
      return;
    }
    window.hljs.highlightElement(block);
  });

  renderFencedKatex();
  renderMathInPreview();
  await renderMermaidInPreview();

  // Render done — cancel the pending thinking mascot or hide it if shown.
  clearTimeout(thinkingTimer);
  const corner = document.getElementById("preview-mascot");
  if (corner && corner.classList.contains("visible")) {
    corner.classList.remove("visible");
    setTimeout(() => {
      if (!corner.classList.contains("visible")) corner.innerHTML = "";
    }, 320);
  }
}

// ────── Lazy fenced-block rendering (KaTeX + Mermaid) ─────────────
// Docs with thousands of `$$` or ```katex / ```mermaid fences used to
// block the main thread for seconds while every block rendered up
// front. Now each fenced block becomes a placeholder and only renders
// when it scrolls into (or near) the viewport. A source-text cache
// makes repeated formulas/diagrams nearly free.

const katexCache = new Map(); // source → rendered HTML
const mermaidCache = new Map();
const CACHE_MAX = 1000;

function cachePut(map, key, value) {
  if (map.size >= CACHE_MAX) {
    map.delete(map.keys().next().value);
  }
  map.set(key, value);
}

function getLazyObserver() {
  if (!getLazyObserver._o) {
    getLazyObserver._o = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const target = entry.target;
          getLazyObserver._o.unobserve(target);
          if (!document.contains(target)) continue;
          const render = target.__mtcLazyRender;
          if (render) render();
        }
      },
      { root: previewPane, rootMargin: "400px 0px" }
    );
  }
  return getLazyObserver._o;
}

let katexPromise = null;
function loadKatex() {
  if (!katexPromise) {
    katexPromise = import("katex").then((m) => m.default);
  }
  return katexPromise;
}

// Render fenced ```katex / ```math blocks as display-mode KaTeX, lazily.
async function renderFencedKatex() {
  const blocks = previewEl.querySelectorAll(
    "pre code.language-katex, pre code.lang-katex, pre code.language-math, pre code.lang-math"
  );
  if (blocks.length === 0) return;

  // Swap every fenced block for a placeholder container up front. The
  // actual katex.render calls happen on viewport entry. This keeps the
  // first paint fast even when the doc has thousands of math blocks.
  const observer = getLazyObserver();
  let katex = null;
  for (const block of blocks) {
    const pre = block.parentElement;
    const source = block.textContent;
    const container = document.createElement("div");
    container.className = "katex-block katex-pending";
    container.style.minHeight = "1.6em"; // reserve some space
    pre.replaceWith(container);

    container.__mtcLazyRender = async () => {
      container.classList.remove("katex-pending");
      container.style.minHeight = "";
      const cached = katexCache.get(source);
      if (cached != null) {
        container.innerHTML = cached;
        return;
      }
      try {
        if (!katex) katex = await loadKatex();
      } catch (err) {
        console.warn("KaTeX failed to load:", err);
        return;
      }
      try {
        katex.render(source, container, { displayMode: true, throwOnError: false });
        cachePut(katexCache, source, container.innerHTML);
      } catch (err) {
        renderMascotErrorCard(container, "KaTeX error", err);
      }
    };
    observer.observe(container);
  }
}

// Strip script elements and event-handler attributes from an SVG string.
// Mermaid's securityLevel:"strict" runs DOMPurify internally, but defence-in-depth
// is cheap and mermaid has had several XSS CVEs in past releases.
function sanitizeSvg(svgString) {
  const div = document.createElement("div");
  div.innerHTML = svgString;
  div.querySelectorAll("script").forEach((el) => el.remove());
  div.querySelectorAll("*").forEach((el) => {
    [...el.attributes].forEach((attr) => {
      if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
    });
  });
  return div.innerHTML;
}

// Mermaid diagrams from ```mermaid fenced blocks. Same lazy strategy.
let mermaidPromise = null;
let mermaidBlockCounter = 0;
async function renderMermaidInPreview() {
  const blocks = previewEl.querySelectorAll(
    "pre code.language-mermaid, pre code.lang-mermaid"
  );
  if (blocks.length === 0) return;

  const observer = getLazyObserver();
  let mermaid = null;
  for (const block of blocks) {
    const pre = block.parentElement;
    const source = block.textContent;
    const container = document.createElement("div");
    container.className = "mermaid mermaid-pending";
    container.style.minHeight = "40px";
    pre.replaceWith(container);

    container.__mtcLazyRender = async () => {
      container.classList.remove("mermaid-pending");
      container.style.minHeight = "";
      const cached = mermaidCache.get(source);
      if (cached != null) {
        container.innerHTML = cached;
        return;
      }
      if (!mermaidPromise) {
        mermaidPromise = import("mermaid").then(({ default: m }) => {
          m.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: settings.night_mode ? "dark" : "default",
          });
          return m;
        });
      }
      try {
        if (!mermaid) mermaid = await mermaidPromise;
      } catch (err) {
        console.warn("Mermaid failed to load:", err);
        return;
      }
      const id = `mtc-mermaid-${++mermaidBlockCounter}`;
      try {
        const { svg } = await mermaid.render(id, source);
        document.getElementById(`d${id}`)?.remove();
        const safeSvg = sanitizeSvg(svg);
        container.innerHTML = safeSvg;
        cachePut(mermaidCache, source, safeSvg);
      } catch (err) {
        document.getElementById(`d${id}`)?.remove();
        renderMascotErrorCard(container, "Mermaid parse error", err);
      }
    };
    observer.observe(container);
  }
}

// Shared helper: replaces a silent tooltip with an inline mascot-led error.
function renderMascotErrorCard(host, title, err) {
  const msg = String(err && err.message ? err.message : err);
  host.className = "mascot-error-card";
  host.innerHTML = "";
  host.appendChild(Mascot.build("error", 56));
  const body = document.createElement("div");
  body.className = "mascot-error-body";
  const titleEl = document.createElement("div");
  titleEl.className = "mascot-error-title";
  titleEl.textContent = title;
  const msgEl = document.createElement("div");
  msgEl.className = "mascot-error-msg";
  msgEl.textContent = msg;
  body.appendChild(titleEl);
  body.appendChild(msgEl);
  host.appendChild(body);
}

// KaTeX auto-render. Lazily loads the library on first use so docs without
// math don't pay the ~300 kB cost. Delimiters chosen to match Pandoc/Typora
// conventions.
async function renderMathInPreview() {
  if (!/\$|\\\(|\\\[/.test(previewEl.textContent)) return;
  try {
    const { default: renderMathInElement } = await import(
      "katex/contrib/auto-render/auto-render.js"
    );
    renderMathInElement(previewEl, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "\\[", right: "\\]", display: true },
        { left: "\\(", right: "\\)", display: false },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
      ignoredTags: ["script", "noscript", "style", "textarea", "pre", "code"],
    });
  } catch (err) {
    console.warn("KaTeX render failed:", err);
  }
}

// Rewrite <img src="..."> in the preview so local paths (relative to the
// current markdown file, or absolute filesystem paths) load through Tauri's
// asset protocol. Remote URLs and data/blob URLs pass through untouched.
function resolvePreviewImageSrcs() {
  const baseDir = currentFile ? parentDir(currentFile) : null;
  previewEl.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src");
    if (!src) return;
    if (/^(https?:|data:|blob:|asset:|tauri:|https?:\/\/asset\.localhost)/i.test(src)) return;
    let abs;
    if (src.startsWith("/") || /^[A-Za-z]:[\\/]/.test(src)) {
      abs = src;
    } else if (baseDir) {
      abs = joinPath(baseDir, src);
    } else {
      return;
    }
    try {
      img.src = convertFileSrc(abs);
    } catch (_) {
      /* leave original src */
    }
  });
}

// ────── Tab management ─────────────────────────────────────────────

function initTabs() {
  const t = newTab();
  t.state = editor.state; // back the first tab with the live (empty) state
  tabs = [t];
  activeTabId = t.id;
  renderTabs();
}

function activeTab() {
  return tabs.find((t) => t.id === activeTabId) || null;
}

function tabTitle(t) {
  if (t.file) return t.file.split(/[\\/]/).pop();
  return t.title || "Untitled";
}

function editorScroller() {
  return document.querySelector("#editor .cm-scroller");
}

// Snapshot the live editor (content, selection, scroll) and the active-tab
// mirror globals back into the active tab object before we switch away.
function saveActiveTabState() {
  const t = activeTab();
  if (!t) return;
  t.state = editor.state;
  const scroller = editorScroller();
  t.scrollTop = scroller ? scroller.scrollTop : 0;
  t.file = currentFile;
  t.mtime = currentFileMtime;
  t.isModified = isModified;
}

// Make `t` the active tab: swap the editor to its state, mirror its metadata
// into the globals, and refresh status bar + preview. Assumes any outgoing
// tab has already been saved (or there is none).
function mountTab(t) {
  activeTabId = t.id;
  currentFile = t.file;
  currentFileMtime = t.mtime;
  isModified = t.isModified;

  suppressChange = true;
  activateState(editor, t.state);
  suppressChange = false;
  const scroller = editorScroller();
  if (scroller) {
    scroller.scrollTop = t.scrollTop || 0;
    requestAnimationFrame(() => { scroller.scrollTop = t.scrollTop || 0; });
  }

  statusFile.textContent = tabTitle(t);
  statusModified.classList.toggle("hidden", !t.isModified);
  updateCursorStatus();
  updateWordCountStatus();
  invoke("set_current_file", { path: t.file });
  updatePreview(getContent(editor));
  renderTabs();
  refreshEmptyMascot();
  editor.focus();
}

function newTab({ file = null, mtime = null, content = "", title = null } = {}) {
  return {
    id: ++tabSeq,
    file,
    mtime,
    title,
    isModified: false,
    state: createDocState(content),
    scrollTop: 0,
  };
}

// Open a brand-new document in a fresh tab and focus it.
function openInNewTab(opts) {
  saveActiveTabState();
  const t = newTab(opts);
  tabs.push(t);
  mountTab(t);
  return t;
}

function activateTab(id) {
  if (id === activeTabId) return;
  const t = tabs.find((x) => x.id === id);
  if (!t) return;
  saveActiveTabState();
  mountTab(t);
}

function cycleTab(dir) {
  if (tabs.length < 2) return;
  const idx = tabs.findIndex((t) => t.id === activeTabId);
  const next = tabs[(idx + dir + tabs.length) % tabs.length];
  activateTab(next.id);
}

async function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;

  // Bring the tab to the front so the discard prompt is about a visible doc.
  if (id !== activeTabId) activateTab(id);
  if (!(await confirmDiscardUnsaved())) return;

  tabs.splice(idx, 1);
  if (tabs.length === 0) {
    const t = newTab();
    tabs.push(t);
    activeTabId = null;
    mountTab(t);
    return;
  }
  activeTabId = null; // force mountTab to perform the swap
  mountTab(tabs[Math.min(idx, tabs.length - 1)]);
}

// Reflect the active tab's modified flag into globals, status bar and the
// tab's dot without a full re-render.
function setActiveModified(on) {
  isModified = on;
  const t = activeTab();
  if (t) t.isModified = on;
  statusModified.classList.toggle("hidden", !on);
  const dot = tabListEl?.querySelector(`.tab[data-tab-id="${activeTabId}"] .tab-dot`);
  if (dot) dot.classList.toggle("visible", on);
}

function updateWordCountStatus() {
  const { words, chars } = getWordCount(editor);
  statusWords.textContent = `${words} words`;
  statusChars.textContent = `${chars} chars`;
}

function updateCursorStatus() {
  const pos = editor.state.selection.main.head;
  const line = editor.state.doc.lineAt(pos);
  statusCursor.textContent = `Ln ${line.number}, Col ${pos - line.from + 1}`;
}

function renderTabs() {
  if (!tabListEl) return;
  tabListEl.innerHTML = "";
  for (const t of tabs) {
    const isActive = t.id === activeTabId;
    const modified = isActive ? isModified : t.isModified;

    const el = document.createElement("div");
    el.className = "tab" + (isActive ? " active" : "");
    el.setAttribute("role", "tab");
    el.setAttribute("aria-selected", String(isActive));
    el.dataset.tabId = String(t.id);
    el.title = t.file || tabTitle(t);

    const label = document.createElement("span");
    label.className = "tab-label";
    label.textContent = tabTitle(t);
    el.appendChild(label);

    const dot = document.createElement("span");
    dot.className = "tab-dot" + (modified ? " visible" : "");
    dot.setAttribute("aria-hidden", "true");
    el.appendChild(dot);

    const close = document.createElement("button");
    close.className = "tab-close";
    close.type = "button";
    close.setAttribute("aria-label", `Close ${tabTitle(t)}`);
    close.textContent = "×";
    el.appendChild(close);

    tabListEl.appendChild(el);
  }
}

function setupTabBar() {
  tabListEl.addEventListener("click", (e) => {
    const tabEl = e.target.closest(".tab");
    if (!tabEl) return;
    const id = parseInt(tabEl.dataset.tabId, 10);
    if (e.target.closest(".tab-close")) {
      closeTab(id);
    } else {
      activateTab(id);
    }
  });
  // Middle-click closes a tab.
  tabListEl.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    const tabEl = e.target.closest(".tab");
    if (!tabEl) return;
    e.preventDefault();
    closeTab(parseInt(tabEl.dataset.tabId, 10));
  });
  if (tabNewBtn) tabNewBtn.addEventListener("click", () => newFile());
}

// File operations
async function newFile() {
  openInNewTab();
}

// Open a brand-new window (Cmd+N). The browser build has no concept of OS
// windows, so it falls back to a new tab.
async function newWindow() {
  if (isBrowser) { newFile(); return; }
  try {
    await invoke("new_window");
  } catch (_) {
    newFile();
  }
}

async function openFile() {
  const path = await open({
    filters: [
      { name: "Markdown", extensions: ["md", "markdown", "txt"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (!path) return;
  await loadFile(path);
}

async function loadFile(path) {
  // Already open? Just switch to that tab.
  const existing = tabs.find((t) => t.file === path);
  if (existing) {
    activateTab(existing.id);
    await refreshRecentFiles();
    return;
  }

  const [content, mtime] = await invoke("read_file_with_mtime", { path });

  // If the active tab is a pristine empty Untitled, load into it rather than
  // leaving an empty tab behind (covers the very first open after launch).
  const cur = activeTab();
  if (cur && !cur.file && !cur.isModified && getContent(editor).trim() === "") {
    setContent(editor, content);
    currentFile = path;
    currentFileMtime = mtime;
    cur.file = path;
    cur.mtime = mtime;
    cur.title = null;
    setActiveModified(false);
    statusFile.textContent = path.split(/[\\/]/).pop();
    await invoke("set_current_file", { path });
    updatePreview(content);
    renderTabs();
    await refreshRecentFiles();
    refreshEmptyMascot();
    return;
  }

  openInNewTab({ file: path, mtime, content });
  await refreshRecentFiles();
}

async function refreshRecentFiles() {
  const select = document.getElementById("recent-select");
  if (!select) return;
  try {
    settings = await invoke("load_settings");
  } catch (_) {
    return;
  }
  const list = settings.recent_files || [];
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = list.length ? "Recent…" : "No recent files";
  select.appendChild(placeholder);
  for (const p of list) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p.split(/[\\/]/).pop();
    opt.title = p;
    select.appendChild(opt);
  }
  select.disabled = list.length === 0;
  select.value = "";

  if (!isBrowser) {
    try { await invoke("refresh_recent_menu"); } catch (_) { /* desktop-only */ }
  }
}

async function openRecent(path) {
  const resolved = await rebaseMobilePath(path);
  try {
    await loadFile(resolved);
  } catch (err) {
    await message(`Could not open ${resolved}: ${err}`, { title: "Open failed", kind: "error" });
  }
}

// iOS regenerates the app's sandbox container UUID on every reinstall, so a
// stored absolute path under .../Documents/ goes stale after a new build.
// Everything after the last "/Documents/" is stable, so re-base the tail
// onto the live Documents directory. No-op on desktop.
async function rebaseMobilePath(path) {
  if (!isMobile) return path;
  if (!path.includes("/Documents/")) return path;
  try {
    const dir = await invoke("documents_dir");
    return rebaseDocumentsPath(path, dir);
  } catch (_) {
    return path;
  }
}

async function saveFile() {
  if (!currentFile) {
    return saveFileAs();
  }

  // External-change check: if the on-disk mtime is newer than what we
  // loaded, someone else edited the file while it was open. Don't
  // silently clobber.
  if (currentFileMtime != null) {
    const diskMtime = await invoke("stat_mtime", { path: currentFile });
    if (diskMtime != null && diskMtime > currentFileMtime) {
      const overwrite = await ask(
        "This file was modified outside MarkTheCrab since you opened it. Overwrite the external changes?",
        { title: "External changes", kind: "warning", okLabel: "Overwrite", cancelLabel: "Cancel" }
      );
      if (!overwrite) return;
    }
  }

  const content = getContent(editor);
  currentFileMtime = await invoke("write_file_with_mtime", { path: currentFile, content });
  const t = activeTab();
  if (t) t.mtime = currentFileMtime;
  setActiveModified(false);
  Mascot.flash("#mascot-slot", "celebrating", 1200, 32);
  await refreshRecentFiles();
}

async function saveFileAs() {
  if (isMobile) return saveFileAsMobile();
  const path = await save({
    filters: [
      { name: "Markdown", extensions: ["md"] },
      { name: "All Files", extensions: ["*"] },
    ],
    defaultPath: currentFile || "untitled.md",
  });
  if (!path) return;

  // Fresh destination — the OS dialog handled the overwrite prompt,
  // so suppress the external-change check for this first write.
  currentFile = path;
  currentFileMtime = null;
  statusFile.textContent = path.split(/[\\/]/).pop();
  const t = activeTab();
  if (t) { t.file = path; t.mtime = null; t.title = null; }
  renderTabs();
  await invoke("set_current_file", { path });
  return saveFile();
}

// iOS save-as. There's no native save path picker, and the sandbox only
// lets us write under the app's Documents directory. So: ask for a file
// name in an editable in-app dialog (the native popup wasn't editable),
// then write into Documents. Subsequent Ctrl/Cmd+S writes back to that
// absolute path, which stays inside the sandbox.
async function saveFileAsMobile() {
  const suggested = currentFile ? currentFile.split("/").pop() : "untitled.md";
  const name = await promptFilename(suggested);
  if (!name) return;
  const finalName = /\.\w+$/.test(name) ? name : `${name}.md`;

  let dir;
  try {
    dir = await invoke("documents_dir");
  } catch (e) {
    await message(`Couldn't find a place to save: ${e}`, { title: "Save failed", kind: "error" });
    return;
  }
  const path = `${dir.replace(/\/+$/, "")}/${finalName}`;

  currentFile = path;
  currentFileMtime = null;
  statusFile.textContent = finalName;
  const t = activeTab();
  if (t) { t.file = path; t.mtime = null; t.title = null; }
  renderTabs();
  await invoke("set_current_file", { path });
  return saveFile();
}

// Editable filename prompt for platforms without a usable native save
// dialog. Resolves to the entered name, or null if cancelled.
function promptFilename(defaultName) {
  return new Promise((resolve) => {
    const dlg = document.getElementById("filename-dialog");
    const input = document.getElementById("filename-input");
    input.value = defaultName || "untitled.md";

    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      input.onkeydown = null;
      if (dlg.open) dlg.close();
      resolve(val);
    };

    document.getElementById("filename-save").onclick = () => finish(input.value.trim() || null);
    document.getElementById("filename-cancel").onclick = () => finish(null);
    dlg.addEventListener("close", () => finish(null), { once: true });
    input.onkeydown = (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        finish(input.value.trim() || null);
      }
    };

    dlg.showModal();
    input.focus();
    // Preselect the stem so renaming doesn't fight the extension.
    const dot = input.value.lastIndexOf(".");
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
  });
}

async function printPreview() {
  // iOS WKWebView ignores window.print(), so route through the native share
  // sheet instead (Web Share API). Sharing the rendered doc as an HTML file
  // surfaces Print and Save-to-PDF among the share targets.
  if (isMobile) return sharePreviewMobile();

  // Ensure the preview is rendered with current content; the print CSS
  // (see styles/app.css) hides chrome so only the preview prints. On
  // macOS, Tauri routes window.print() through its webview plugin — that
  // requires the `core:webview:allow-print` permission (see
  // capabilities/default.json).
  const wasHidden = !previewVisible;
  if (wasHidden) togglePreview(true);
  await updatePreview(getContent(editor));
  await new Promise((r) => setTimeout(r, 50));
  window.print();
  if (wasHidden) togglePreview(false);
}

// iOS share: build a styled HTML file of the rendered document and hand it
// to the native share sheet, which includes Print and Save to PDF.
async function sharePreviewMobile() {
  const content = getContent(editor);
  const html = await invoke("export_html", {
    markdownText: content,
    styled: true,
    theme: settings.theme,
    customCss: settings.custom_css,
  });
  const base = (currentFile ? currentFile.split("/").pop() : "untitled").replace(/\.\w+$/, "");
  const file = new File([html], `${base}.html`, { type: "text/html" });

  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: base });
    } else if (navigator.share) {
      // Older WebKit without file sharing: share the text so the sheet still
      // opens (Print may not appear for plain text).
      await navigator.share({ title: base, text: content });
    } else {
      await message("Sharing isn't available on this device.", { title: "Share", kind: "error" });
    }
  } catch (e) {
    if (e?.name === "AbortError") return; // user dismissed the sheet
    await message(`Couldn't share: ${e?.message || e}`, { title: "Share failed", kind: "error" });
  }
}

async function exportHtml(styled) {
  const path = await save({
    filters: [{ name: "HTML", extensions: ["html"] }],
    defaultPath: (currentFile || "untitled").replace(/\.\w+$/, "") + ".html",
  });
  if (!path) return;

  const content = getContent(editor);
  const html = await invoke("export_html", {
    markdownText: content,
    styled,
    theme: settings.theme,
    customCss: settings.custom_css,
  });
  await invoke("write_file", { path, content: html });
}

function togglePreview(show) {
  if (show === undefined) show = !previewVisible;
  previewVisible = show;

  if (show) {
    previewPane.classList.remove("hidden");
    document.getElementById("resizer").classList.remove("hidden");
    updatePreview(getContent(editor));
  } else {
    previewPane.classList.add("hidden");
    document.getElementById("resizer").classList.add("hidden");
  }

  document.querySelector('[data-action="toggle-preview"]')?.setAttribute("aria-pressed", String(show));
  settings.live_preview = show;
  invoke("update_setting", { key: "live_preview", value: String(show) });
}

function toggleLayout() {
  const isVertical = mainEl.classList.contains("vertical");
  mainEl.classList.toggle("horizontal", isVertical);
  mainEl.classList.toggle("vertical", !isVertical);
  document.querySelector('[data-action="toggle-layout"]')?.setAttribute("aria-pressed", String(!isVertical));
  settings.vertical_layout = !isVertical;
  invoke("update_setting", { key: "vertical_layout", value: String(!isVertical) });
}

function toggleNightMode() {
  settings.night_mode = !settings.night_mode;
  document.body.classList.toggle("night-mode", settings.night_mode);
  setNightMode(editor, settings.night_mode);
  invoke("update_setting", { key: "night_mode", value: String(settings.night_mode) });
}

// Toolbar setup
function setupToolbar() {
  const actions = {
    new: newFile,
    open: openFile,
    save: saveFile,
    bold: () => wrapSelection(editor, "**"),
    italic: () => wrapSelection(editor, "*"),
    strikethrough: () => wrapSelection(editor, "~~"),
    heading1: () => insertAtLineStart(editor, "# "),
    heading2: () => insertAtLineStart(editor, "## "),
    heading3: () => insertAtLineStart(editor, "### "),
    link: () => {
      const sel = editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to);
      if (sel) document.getElementById("link-text").value = sel;
      document.getElementById("link-dialog").showModal();
      document.getElementById("link-url").focus();
    },
    image: () => document.getElementById("image-dialog").showModal(),
    table: () => document.getElementById("table-dialog").showModal(),
    hr: () => insertAtCursor(editor, "\n\n---\n\n"),
    code: () => wrapSelection(editor, "```\n", "\n```"),
    ul: () => insertAtLineStart(editor, "- "),
    ol: () => insertAtLineStart(editor, "1. "),
    checklist: () => insertAtLineStart(editor, "- [ ] "),
    blockquote: () => insertAtLineStart(editor, "> "),
    "toggle-preview": () => togglePreview(),
    "toggle-layout": toggleLayout,
    print: printPreview,
    settings: showSettings,
    about: showAbout,
  };

  toolbarEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = actions[btn.dataset.action];
    if (action) action();
  });

  const recentSelect = document.getElementById("recent-select");
  if (recentSelect) {
    recentSelect.addEventListener("change", async (e) => {
      const path = e.target.value;
      if (path) await openRecent(path);
      e.target.value = "";
    });
  }
}

// A click on a real link in the preview otherwise navigates the single
// webview to that URL, replacing the whole app and discarding unsaved work.
// On iOS there's no "back" to the app, so it reads as a blank window and the
// document is gone. Intercept every external link: cancel the navigation and
// hand the URL to the OS (system browser) when an opener is available. Empty
// src-line anchors (no href) and in-document "#" anchors are left alone.
function setupPreviewLinks() {
  previewEl.addEventListener("click", (e) => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || href.startsWith("#")) return;

    // Never let the webview navigate itself.
    e.preventDefault();

    try {
      const opener =
        window.__TAURI__?.opener?.openUrl ||
        window.__TAURI__?.shell?.open;
      if (opener) {
        opener(a.href);
      } else if (!isBrowser) {
        // No opener plugin exposed; at least don't lose the doc.
      } else {
        window.open(a.href, "_blank", "noopener");
      }
    } catch (_) {
      /* swallow — protecting the document is what matters */
    }
  });
}

// Keyboard shortcuts
function setupShortcuts() {
  document.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    // Ctrl/Cmd+Tab cycles tabs (forward, or backward with Shift).
    if (ctrl && e.key === "Tab") {
      e.preventDefault();
      cycleTab(shift ? -1 : 1);
      return;
    }

    if (ctrl && !shift) {
      switch (e.key.toLowerCase()) {
        case "n": e.preventDefault(); newWindow(); break;
        case "t": e.preventDefault(); newFile(); break;
        case "w": e.preventDefault(); if (activeTabId != null) closeTab(activeTabId); break;
        case "o": e.preventDefault(); openFile(); break;
        case "s": e.preventDefault(); saveFile(); break;
        case "p": e.preventDefault(); printPreview(); break;
        case "b": e.preventDefault(); wrapSelection(editor, "**"); break;
        case "i": e.preventDefault(); wrapSelection(editor, "*"); break;
        case "d": e.preventDefault(); wrapSelection(editor, "~~"); break;
        case "l": e.preventDefault(); { const sel = editor.state.sliceDoc(editor.state.selection.main.from, editor.state.selection.main.to); if (sel) document.getElementById("link-text").value = sel; document.getElementById("link-dialog").showModal(); document.getElementById("link-url").focus(); } break;
        case "h": e.preventDefault(); insertAtCursor(editor, "\n\n---\n\n"); break;
        case "f": e.preventDefault(); openFind(editor); break;
        case "e": e.preventDefault(); exportHtml(true); break;
        case ",": e.preventDefault(); showSettings(); break;
        case "1": e.preventDefault(); insertAtLineStart(editor, "# "); break;
        case "2": e.preventDefault(); insertAtLineStart(editor, "## "); break;
        case "3": e.preventDefault(); insertAtLineStart(editor, "### "); break;
        case "4": e.preventDefault(); insertAtLineStart(editor, "#### "); break;
        case "=":
        case "+": e.preventDefault(); zoomPreview(0.1); break;
        case "-": e.preventDefault(); zoomPreview(-0.1); break;
        case "0": e.preventDefault(); zoomPreview(0); break;
      }
    } else if (ctrl && shift) {
      switch (e.key.toLowerCase()) {
        case "s": e.preventDefault(); saveFileAs(); break;
        case "i": e.preventDefault(); document.getElementById("image-dialog").showModal(); break;
        case "t": e.preventDefault(); document.getElementById("table-dialog").showModal(); break;
        case "e": e.preventDefault(); exportHtml(false); break;
        case "p": e.preventDefault(); togglePreview(); break;
      }
    }

    if (e.key === "F11") {
      e.preventDefault();
      // Tauri handles fullscreen via window API if needed
    }

  });
}

function zoomPreview(delta) {
  if (delta === 0) {
    settings.zoom_level = 1.0;
  } else {
    settings.zoom_level = Math.max(0.5, Math.min(3.0, settings.zoom_level + delta));
  }
  previewEl.style.zoom = settings.zoom_level;
  invoke("update_setting", { key: "zoom_level", value: String(settings.zoom_level) });
}

// Resizer
function setupResizer() {
  const resizer = document.getElementById("resizer");
  let isResizing = false;

  resizer.addEventListener("mousedown", (e) => {
    isResizing = true;
    resizer.classList.add("active");
    document.body.style.cursor = mainEl.classList.contains("vertical") ? "row-resize" : "col-resize";
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isResizing) return;
    const rect = mainEl.getBoundingClientRect();
    const isVertical = mainEl.classList.contains("vertical");

    if (isVertical) {
      const ratio = (e.clientY - rect.top) / rect.height;
      editorPane.style.flex = `${ratio}`;
      previewPane.style.flex = `${1 - ratio}`;
    } else {
      const ratio = (e.clientX - rect.left) / rect.width;
      editorPane.style.flex = `${ratio}`;
      previewPane.style.flex = `${1 - ratio}`;
    }
  });

  document.addEventListener("mouseup", () => {
    if (isResizing) {
      isResizing = false;
      resizer.classList.remove("active");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
  });
}

// Dialogs
function setupDialogs() {
  // Link dialog
  const linkDialog = document.getElementById("link-dialog");
  const clearLinkDialog = () => {
    document.getElementById("link-url").value = "";
    document.getElementById("link-text").value = "";
  };
  document.getElementById("link-cancel").onclick = () => { linkDialog.close(); clearLinkDialog(); };
  document.getElementById("link-insert").onclick = () => {
    const url = document.getElementById("link-url").value;
    const text = document.getElementById("link-text").value || url;
    const { from, to } = editor.state.selection.main;
    const insertion = `[${text}](${url})`;
    editor.dispatch({ changes: { from, to, insert: insertion }, selection: { anchor: from + insertion.length } });
    editor.focus();
    linkDialog.close();
    clearLinkDialog();
  };

  // Image dialog
  document.getElementById("image-cancel").onclick = () =>
    document.getElementById("image-dialog").close();
  // iOS: drive the in-dialog file input (the WKWebView photo/Files picker)
  // and embed the chosen image directly. The input is a child of the modal
  // dialog so its picker presents from an active, non-inert subtree — the
  // earlier body-appended input couldn't present its secondary picker.
  const imageFileInput = document.getElementById("image-file-input");
  imageFileInput.addEventListener("change", async () => {
    const file = imageFileInput.files?.[0];
    imageFileInput.value = ""; // allow re-picking the same file later
    if (!file) return;
    document.getElementById("image-dialog").close();
    try {
      await handleImageFile(file);
    } catch (e) {
      await message(`Couldn't insert that image: ${e?.message || e}`, {
        title: "Image failed",
        kind: "error",
      });
    }
  });

  document.getElementById("image-browse").onclick = async () => {
    if (isMobile) {
      imageFileInput.click();
      return;
    }
    const path = await open({
      filters: [
        { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp", "ico"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    if (path) {
      document.getElementById("image-url").value = path;
    }
  };
  document.getElementById("image-insert").onclick = () => {
    const url = document.getElementById("image-url").value;
    const alt = document.getElementById("image-alt").value || "image";
    const title = document.getElementById("image-title").value;
    const encoded = encodeMarkdownUrl(url);
    const md = title
      ? `![${alt}](${encoded} "${title.replace(/"/g, '\\"')}")`
      : `![${alt}](${encoded})`;
    insertAtCursor(editor, md);
    document.getElementById("image-dialog").close();
    document.getElementById("image-url").value = "";
    document.getElementById("image-alt").value = "";
    document.getElementById("image-title").value = "";
  };

  // Table dialog
  document.getElementById("table-cancel").onclick = () =>
    document.getElementById("table-dialog").close();
  document.getElementById("table-insert").onclick = () => {
    const rows = parseInt(document.getElementById("table-rows").value) || 3;
    const cols = parseInt(document.getElementById("table-cols").value) || 3;
    let md = "\n";
    // Header
    md += "| " + Array.from({ length: cols }, (_, i) => `Header ${i + 1}`).join(" | ") + " |\n";
    // Separator
    md += "| " + Array.from({ length: cols }, () => "---").join(" | ") + " |\n";
    // Rows
    for (let r = 0; r < rows; r++) {
      md += "| " + Array.from({ length: cols }, () => "   ").join(" | ") + " |\n";
    }
    md += "\n";
    insertAtCursor(editor, md);
    document.getElementById("table-dialog").close();
  };

  // About dialog
  document.getElementById("about-close").onclick = () =>
    document.getElementById("about-dialog").close();

  setupSettingsDialog();

  // Custom CSS dialog
  document.getElementById("custom-css-cancel").onclick = () =>
    document.getElementById("custom-css-dialog").close();
  document.getElementById("custom-css-apply").onclick = () => {
    const css = document.getElementById("custom-css-input").value;
    settings.custom_css = css;
    applyCustomCss(css);
    invoke("update_setting", { key: "custom_css", value: css });
    document.getElementById("custom-css-dialog").close();
  };
}

let customCssStyleEl = null;
function applyCustomCss(css) {
  if (customCssStyleEl) {
    customCssStyleEl.remove();
    customCssStyleEl = null;
  }
  if (!css || !css.trim()) return;
  const scoped = scopeThemeCss(css, "#preview");
  const style = document.createElement("style");
  style.id = "custom-css";
  style.textContent = scoped;
  document.head.appendChild(style);
  customCssStyleEl = style;
}

// ────── Settings dialog ───────────────────────────────────────────
function setupSettingsDialog() {
  const dialog = document.getElementById("settings-dialog");
  if (!dialog) return;

  const themeSel = document.getElementById("settings-theme-select");
  themeSel.addEventListener("change", (e) => {
    settings.theme = e.target.value;
    applyTheme(settings.theme);
    invoke("update_setting", { key: "theme", value: settings.theme });
    updatePreview(getContent(editor));
  });

  const fontSel = document.getElementById("settings-font-select");
  fontSel.addEventListener("change", (e) => {
    const key = e.target.value;
    const stored = key === "opendyslexic" ? "OpenDyslexic" : "";
    settings.font_family = stored;
    applyFontFamily(stored);
    invoke("update_setting", { key: "font_family", value: stored });
  });

  document.getElementById("settings-custom-css-open").onclick = () => {
    dialog.close();
    showCustomCss();
  };

  bindToggle("settings-word-wrap", "word_wrap", (on) => {
    settings.word_wrap = on;
    setWordWrap(editor, on);
  });
  bindToggle("settings-line-numbers", "line_numbers", (on) => {
    settings.line_numbers = on;
    setLineNumbers(editor, on);
  });
  bindToggle("settings-show-toolbar", "show_toolbar", (on) => {
    settings.show_toolbar = on;
    toolbarEl.classList.toggle("hidden", !on);
  });
  bindToggle("settings-spellcheck", "spellcheck", (on) => {
    settings.spellcheck = on;
    setSpellcheck(editor, on);
  });
  bindToggle("settings-show-mascot", "show_mascot", (on) => {
    settings.show_mascot = on;
    Mascot.configure({ enabled: on });
    refreshEmptyMascot();
  });
  bindToggle("settings-mascot-animations", "mascot_animations", (on) => {
    settings.mascot_animations = on;
    Mascot.configure({ animations: on });
  });

  document.getElementById("settings-close").onclick = () => dialog.close();
  document.getElementById("settings-done").onclick = () => dialog.close();
}

// Bind a button[role=switch] to a boolean setting. `apply` runs the
// side-effect; the persisted value goes through update_setting.
function bindToggle(elementId, settingKey, apply) {
  const btn = document.getElementById(elementId);
  if (!btn) return;
  btn.addEventListener("click", () => {
    const on = btn.getAttribute("aria-checked") !== "true";
    btn.setAttribute("aria-checked", String(on));
    apply(on);
    invoke("update_setting", { key: settingKey, value: String(on) });
  });
}

function syncSettingsDialog() {
  const set = (id, on) => {
    const el = document.getElementById(id);
    if (el) el.setAttribute("aria-checked", String(!!on));
  };
  const sel = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value;
  };
  sel("settings-theme-select", settings.theme || "github");
  sel("settings-font-select", fontFamilyKey(settings.font_family));
  set("settings-word-wrap", settings.word_wrap !== false);
  set("settings-line-numbers", settings.line_numbers !== false);
  set("settings-show-toolbar", settings.show_toolbar !== false);
  set("settings-spellcheck", settings.spellcheck !== false);
  set("settings-show-mascot", settings.show_mascot !== false);
  set("settings-mascot-animations", settings.mascot_animations !== false);
}

function showSettings() {
  syncSettingsDialog();
  const dlg = document.getElementById("settings-dialog");
  dlg.showModal();
  // showModal() auto-focuses the first control, which here is the theme
  // <select>. On iOS a focused select immediately pops its native picker, so
  // opening settings lands the user inside the theme wheel. Move focus to the
  // dialog title instead so it just opens to the top.
  const title = document.getElementById("settings-dialog-title");
  if (title) {
    title.tabIndex = -1;
    title.focus();
  } else if (document.activeElement?.tagName === "SELECT") {
    document.activeElement.blur();
  }
}

function showCustomCss() {
  const dialog = document.getElementById("custom-css-dialog");
  const textarea = document.getElementById("custom-css-input");
  textarea.value = settings.custom_css || "";
  dialog.showModal();
}

let creditsCache = null;
async function showAbout() {
  const dialog = document.getElementById("about-dialog");
  const textarea = document.getElementById("about-credits");
  Mascot.show("#about-mascot", "happy", { size: 96 });
  if (creditsCache == null) {
    try {
      creditsCache = await invoke("get_credits");
    } catch (err) {
      creditsCache = `Failed to load credits: ${err}`;
    }
  }
  textarea.value = creditsCache;
  dialog.showModal();
  textarea.scrollTop = 0;
}

// Image helpers
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|bmp|ico|tiff?)$/i;

// Read a picked file's bytes and build a base64 data URL. Goes through
// arrayBuffer() rather than FileReader.readAsDataURL — iOS hands back
// iCloud/HEIC-backed Files that FileReader can fail to read, while
// arrayBuffer() materializes them reliably.
async function fileToDataUrl(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = file.type || "image/png";
  return `data:${type};base64,${bytesToBase64(bytes)}`;
}

async function handleImageFile(file) {
  // On iOS there's no stable sibling images/ dir to reference, so embed the
  // image inline as a data URL — it always renders and travels with the doc.
  if (isMobile) {
    const dataUrl = await fileToDataUrl(file);
    insertAtCursor(editor, `![${file.name || "image"}](${dataUrl})\n`);
    return;
  }
  const buffer = await file.arrayBuffer();
  const bytes = Array.from(new Uint8Array(buffer));
  const relativePath = await invoke("save_image", {
    imageData: bytes,
    filename: file.name,
  });
  insertAtCursor(editor, `![${file.name}](${encodeMarkdownUrl(relativePath)})\n`);
}

// Drag and drop files
function setupDragDrop() {
  document.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
  });

  document.addEventListener("drop", async (e) => {
    e.preventDefault();
    e.stopPropagation();

    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;

    for (const file of files) {
      if (file.name.match(/\.(md|markdown|txt)$/i)) {
        // Markdown file: open it in a new tab. The browser sandbox gives no
        // real path, so it lands as an Untitled tab carrying the dropped name.
        const text = await file.text();
        openInNewTab({ content: text, title: file.name });
        return; // Only open one markdown file
      } else if (file.name.match(IMAGE_EXTENSIONS)) {
        // Image file: save to images/ and insert reference
        await handleImageFile(file);
      }
    }
  });
}

// Clipboard paste: detect image data and save it
function setupClipboardPaste() {
  document.addEventListener("paste", async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith("image/")) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (!blob) continue;

        // Generate filename from type: paste-20260422-143052.png
        const now = new Date();
        const ts = now.toISOString().replace(/[-:T]/g, "").slice(0, 14);
        const ext = item.type.split("/")[1].replace("jpeg", "jpg");
        const filename = `paste-${ts}.${ext}`;

        const buffer = await blob.arrayBuffer();
        const bytes = Array.from(new Uint8Array(buffer));
        const relativePath = await invoke("save_image", {
          imageData: bytes,
          filename,
        });
        insertAtCursor(editor, `![pasted image](${encodeMarkdownUrl(relativePath)})\n`);
        return; // Handle one image per paste
      }
    }
    // If no image data, let the default paste handle text
  });
}

// Synchronized scrolling — source-map based.
// Rust emits empty <a class="src-line" data-src-line="N"> anchors before
// every top-level block in the preview. We build a sorted [{line, top}]
// list from those and interpolate between them as the editor scrolls.
// Invalidates the cache on every preview re-render.
(function setupSyncScroll() {
  const editorEl = document.getElementById("editor");
  let markersCache = null;

  // Which pane the user is actively driving; the other pane follows.
  // A programmatic scroll fires an echo `scroll` event on the follower,
  // and WKWebView can deliver that echo several frames late. The old
  // single-rAF `isSyncing` flag had already cleared by then, so the
  // follower treated the echo as a real user scroll and yanked the
  // driver back — scrolling the editor to the bottom made it crawl
  // back to the top. Track an owner with a short timeout instead: it
  // outlives a late echo, and every genuine scroll event refreshes it.
  let scrollOwner = null; // "editor" | "preview" | null
  let scrollOwnerTimer = 0;
  function claimScroll(owner) {
    scrollOwner = owner;
    clearTimeout(scrollOwnerTimer);
    scrollOwnerTimer = setTimeout(() => {
      scrollOwner = null;
    }, 120);
  }

  // Invalidate cache when preview changes. We bump via a MutationObserver
  // so any caller (including mermaid/katex async passes) is covered.
  const observer = new MutationObserver(() => {
    markersCache = null;
  });
  observer.observe(previewEl, { childList: true, subtree: true, characterData: false });

  function getMarkers() {
    if (markersCache) return markersCache;
    const paneRect = previewPane.getBoundingClientRect();
    const scrollY = previewPane.scrollTop;
    const nodes = previewEl.querySelectorAll("a.src-line[data-src-line]");
    // On huge docs (test.md has ~4000 top-level blocks) taking getBoundingClientRect
    // for every marker on every scroll event is a bottleneck. Sample uniformly to
    // keep the marker list bounded — the interpolation between samples is enough
    // for smooth sync.
    const MAX_MARKERS = 500;
    const stride = nodes.length > MAX_MARKERS ? Math.ceil(nodes.length / MAX_MARKERS) : 1;
    const markers = [];
    for (let i = 0; i < nodes.length; i += stride) {
      const el = nodes[i];
      const line = parseInt(el.dataset.srcLine, 10);
      if (Number.isNaN(line)) continue;
      // Use the following element's top if present — the empty <a> often
      // sits inline, whereas the real block is where the user thinks the
      // content starts.
      const target = el.nextElementSibling || el;
      const top = target.getBoundingClientRect().top - paneRect.top + scrollY;
      markers.push({ line, top });
    }
    // Always include the last marker so we don't lose end-of-doc accuracy.
    if (stride > 1 && nodes.length > 0) {
      const el = nodes[nodes.length - 1];
      const line = parseInt(el.dataset.srcLine, 10);
      if (!Number.isNaN(line)) {
        const target = el.nextElementSibling || el;
        const top = target.getBoundingClientRect().top - paneRect.top + scrollY;
        markers.push({ line, top });
      }
    }
    markers.sort((a, b) => a.line - b.line || a.top - b.top);
    markersCache = markers;
    return markers;
  }

  function editorTopLine() {
    if (!editor) return null;
    const scroller = editorEl.querySelector(".cm-scroller");
    if (!scroller) return null;
    // Convert scroll offset to a 0-indexed source line. lineBlockAtHeight
    // expects document-coordinate height; scroller.scrollTop is already
    // that in CM6.
    try {
      const block = editor.lineBlockAtHeight(scroller.scrollTop);
      const lineObj = editor.state.doc.lineAt(block.from);
      return lineObj.number - 1;
    } catch (_) {
      return null;
    }
  }

  editorEl.addEventListener(
    "scroll",
    () => {
      if (scrollOwner === "preview") return;
      const markers = getMarkers();
      if (markers.length === 0 || !previewPane) return;
      const topLine = editorTopLine();
      if (topLine == null) return;

      // Binary search: largest marker with line <= topLine.
      let lo = 0;
      let hi = markers.length - 1;
      let idx = 0;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (markers[mid].line <= topLine) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      const current = markers[idx];
      const next = markers[idx + 1];
      let target = current ? current.top : 0;
      if (current && next && next.line > current.line) {
        const frac = (topLine - current.line) / (next.line - current.line);
        target = current.top + frac * (next.top - current.top);
      } else if (!current && next) {
        target = next.top;
      }

      claimScroll("editor");
      previewPane.scrollTop = target;
    },
    true
  );

  // Reverse direction: preview → editor. Find the marker pair bracketing
  // the preview's scrollTop, interpolate a fractional source line, then
  // translate that to an editor scrollTop via CodeMirror block heights.
  previewPane.addEventListener("scroll", () => {
    if (scrollOwner === "editor") return;
    if (!editor) return;
    const markers = getMarkers();
    if (markers.length === 0) return;
    const scroller = editorEl.querySelector(".cm-scroller");
    if (!scroller) return;

    const y = previewPane.scrollTop;

    // Binary search on marker `top`. Markers come from DOM order so they're
    // monotonic in top under normal layout.
    let lo = 0;
    let hi = markers.length - 1;
    let idx = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (markers[mid].top <= y) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    const current = markers[idx];
    const next = markers[idx + 1];

    let fracLine = current ? current.line : 0;
    if (current && next && next.top > current.top) {
      const frac = (y - current.top) / (next.top - current.top);
      fracLine = current.line + frac * (next.line - current.line);
    } else if (!current && next) {
      fracLine = next.line;
    }

    let editorTop;
    try {
      const doc = editor.state.doc;
      const maxLine = doc.lines;
      const baseLineNum = Math.min(Math.max(Math.floor(fracLine) + 1, 1), maxLine);
      const baseBlock = editor.lineBlockAt(doc.line(baseLineNum).from);
      if (baseLineNum < maxLine) {
        const nextBlock = editor.lineBlockAt(doc.line(baseLineNum + 1).from);
        const frac = fracLine - Math.floor(fracLine);
        editorTop = baseBlock.top + frac * (nextBlock.top - baseBlock.top);
      } else {
        editorTop = baseBlock.top;
      }
    } catch (_) {
      return;
    }

    claimScroll("preview");
    scroller.scrollTop = editorTop;
  });
})();

// When the preview is copied, scrub the scroll-sync anchors out of the
// HTML clipboard. Without this, every paste into a rich-text target
// carries empty <a class="src-line" data-src-line="N"> debris that
// looks like dangling references to line numbers in the source doc.
previewPane.addEventListener("copy", (ev) => {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const frag = sel.getRangeAt(0).cloneContents();
  const wrap = document.createElement("div");
  wrap.appendChild(frag);
  wrap.querySelectorAll("a.src-line").forEach((n) => n.remove());
  ev.clipboardData.setData("text/html", wrap.innerHTML);
  ev.clipboardData.setData("text/plain", wrap.innerText);
  ev.preventDefault();
});

// Initialize
init();
