import { createEditor, setContent, getContent, setNightMode, setLineNumbers, setWordWrap, setFontSize, setFontFamily, setSpellcheck, wrapSelection, insertAtCursor, insertAtLineStart, getWordCount } from "./editor.js";
import hljs from "./hljs-setup.js";

// Make hljs available globally for preview highlighting
window.hljs = hljs;

const { invoke, convertFileSrc } = window.__TAURI__.core;
const { open, save, message, ask } = window.__TAURI__.dialog;
const tauriEvent = window.__TAURI__.event;

// State
let editor;
let currentFile = null;
let currentFileMtime = null; // ms since epoch, for external-change detection
let isModified = false;
let settings = {};
let previewVisible = true;
let renderTimeout = null;

// Elements
const previewEl = document.getElementById("preview");
const previewPane = document.getElementById("preview-pane");
const editorPane = document.getElementById("editor-pane");
const mainEl = document.getElementById("main");
const toolbarEl = document.getElementById("toolbar");
const statusbarEl = document.getElementById("statusbar");
const findbarEl = document.getElementById("findbar");
const themeSelect = document.getElementById("theme-select");

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

  // Set up findbar
  setupFindbar();

  // Set up drag-drop
  setupDragDrop();

  // Set up clipboard image paste
  setupClipboardPaste();

  // Guard window close against unsaved changes
  setupCloseGuard();

  // Populate recent-files dropdown from settings
  refreshRecentFiles();

  // Load tutorial or empty
  updatePreview("");
}

async function setupCloseGuard() {
  if (!tauriEvent) return;
  await tauriEvent.listen("mtc:close-requested", async () => {
    if (isModified) {
      const discard = await ask(
        "You have unsaved changes. Close without saving?",
        { title: "Unsaved changes", kind: "warning", okLabel: "Discard", cancelLabel: "Keep editing" }
      );
      if (!discard) return;
    }
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
  }

  themeSelect.value = settings.theme;
  applyTheme(settings.theme);
  applyCustomCss(settings.custom_css);

  applyFontFamily(settings.font_family);
  const fontSelect = document.getElementById("font-select");
  if (fontSelect) fontSelect.value = fontFamilyKey(settings.font_family);

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

async function applyTheme(themeName) {
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
  isModified = true;
  statusModified.classList.remove("hidden");

  // Debounce preview rendering
  clearTimeout(renderTimeout);
  renderTimeout = setTimeout(() => updatePreview(content), 150);

  // Update word count
  const { words, chars } = getWordCount(editor);
  statusWords.textContent = `${words} words`;
  statusChars.textContent = `${chars} chars`;
}

function onCursorChange(line, col) {
  statusCursor.textContent = `Ln ${line}, Col ${col}`;
}

async function updatePreview(content) {
  if (!previewVisible) return;
  const html = await invoke("render_markdown", { text: content });
  previewEl.innerHTML = html;

  resolvePreviewImageSrcs();

  // Highlight code blocks (skip mermaid — that runs through its own render
  // pass below and shouldn't be pre-styled)
  previewEl.querySelectorAll("pre code").forEach((block) => {
    if (!window.hljs) return;
    if (block.classList.contains("language-mermaid") || block.classList.contains("lang-mermaid")) {
      return;
    }
    window.hljs.highlightElement(block);
  });

  renderMathInPreview();
  renderMermaidInPreview();
}

// Mermaid diagrams from ```mermaid fenced blocks. Lazily loaded because
// the library is ~1 MB; most docs don't use it.
let mermaidPromise = null;
let mermaidBlockCounter = 0;
async function renderMermaidInPreview() {
  const blocks = previewEl.querySelectorAll("pre code.language-mermaid, pre code.lang-mermaid");
  if (blocks.length === 0) return;
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: settings.night_mode ? "dark" : "default",
      });
      return mermaid;
    });
  }
  let mermaid;
  try {
    mermaid = await mermaidPromise;
  } catch (err) {
    console.warn("Mermaid failed to load:", err);
    return;
  }
  for (const block of blocks) {
    const pre = block.parentElement;
    const source = block.textContent;
    const id = `mtc-mermaid-${++mermaidBlockCounter}`;
    try {
      const { svg } = await mermaid.render(id, source);
      const container = document.createElement("div");
      container.className = "mermaid";
      container.innerHTML = svg;
      pre.replaceWith(container);
    } catch (err) {
      pre.classList.add("mermaid-error");
      pre.title = String(err && err.message ? err.message : err);
    }
  }
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

function parentDir(p) {
  const sep = p.includes("\\") && !p.includes("/") ? "\\" : "/";
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(0, i) : "";
}

function joinPath(dir, rel) {
  const useBackslash = dir.includes("\\") && !dir.includes("/");
  const sep = useBackslash ? "\\" : "/";
  const trimmed = dir.replace(/[\\/]+$/, "");
  const cleanedRel = rel.replace(/^[\\/]+/, "");
  return `${trimmed}${sep}${cleanedRel}`;
}

// File operations
async function newFile() {
  if (isModified) {
    const proceed = await message("You have unsaved changes. Discard them?", {
      title: "New File",
      kind: "warning",
      okLabel: "Discard",
      cancelLabel: "Cancel",
    });
    if (!proceed) return;
  }
  setContent(editor, "");
  currentFile = null;
  currentFileMtime = null;
  isModified = false;
  statusFile.textContent = "Untitled";
  statusModified.classList.add("hidden");
  await invoke("set_current_file", { path: null });
  updatePreview("");
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
  const [content, mtime] = await invoke("read_file_with_mtime", { path });
  setContent(editor, content);
  currentFile = path;
  currentFileMtime = mtime;
  isModified = false;
  statusFile.textContent = path.split(/[\\/]/).pop();
  statusModified.classList.add("hidden");
  await invoke("set_current_file", { path });
  updatePreview(content);
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
}

async function openRecent(path) {
  if (isModified) {
    const discard = await ask(
      "You have unsaved changes. Open another file and discard them?",
      { title: "Unsaved changes", kind: "warning", okLabel: "Discard", cancelLabel: "Cancel" }
    );
    if (!discard) return;
  }
  try {
    await loadFile(path);
  } catch (err) {
    await message(`Could not open ${path}: ${err}`, { title: "Open failed", kind: "error" });
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
  isModified = false;
  statusModified.classList.add("hidden");
  await refreshRecentFiles();
}

async function saveFileAs() {
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
  await invoke("set_current_file", { path });
  return saveFile();
}

async function printPreview() {
  // Ensure the preview is rendered with current content; the print CSS
  // (see styles/app.css) hides chrome and shows only the preview, so the
  // system print dialog's "Save as PDF" produces a clean styled PDF.
  const wasHidden = !previewVisible;
  if (wasHidden) {
    togglePreview(true);
  }
  await updatePreview(getContent(editor));
  // Give the layout a tick to settle before the print snapshot.
  await new Promise((resolve) => setTimeout(resolve, 50));
  window.print();
  if (wasHidden) togglePreview(false);
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

  settings.live_preview = show;
  invoke("update_setting", { key: "live_preview", value: String(show) });
}

function toggleLayout() {
  const isVertical = mainEl.classList.contains("vertical");
  mainEl.classList.toggle("horizontal", isVertical);
  mainEl.classList.toggle("vertical", !isVertical);
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
    link: () => document.getElementById("link-dialog").showModal(),
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
    "custom-css": showCustomCss,
    about: showAbout,
  };

  toolbarEl.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = actions[btn.dataset.action];
    if (action) action();
  });

  themeSelect.addEventListener("change", (e) => {
    settings.theme = e.target.value;
    applyTheme(settings.theme);
    invoke("update_setting", { key: "theme", value: settings.theme });
    updatePreview(getContent(editor));
  });

  const fontSelect = document.getElementById("font-select");
  if (fontSelect) {
    fontSelect.addEventListener("change", (e) => {
      const key = e.target.value;
      const stored = key === "opendyslexic" ? "OpenDyslexic" : "";
      settings.font_family = stored;
      applyFontFamily(stored);
      invoke("update_setting", { key: "font_family", value: stored });
    });
  }

  const recentSelect = document.getElementById("recent-select");
  if (recentSelect) {
    recentSelect.addEventListener("change", async (e) => {
      const path = e.target.value;
      if (path) await openRecent(path);
      e.target.value = "";
    });
  }
}

// Keyboard shortcuts
function setupShortcuts() {
  document.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;

    if (ctrl && !shift) {
      switch (e.key.toLowerCase()) {
        case "n": e.preventDefault(); newFile(); break;
        case "o": e.preventDefault(); openFile(); break;
        case "s": e.preventDefault(); saveFile(); break;
        case "p": e.preventDefault(); printPreview(); break;
        case "b": e.preventDefault(); wrapSelection(editor, "**"); break;
        case "i": e.preventDefault(); wrapSelection(editor, "*"); break;
        case "d": e.preventDefault(); wrapSelection(editor, "~~"); break;
        case "l": e.preventDefault(); document.getElementById("link-dialog").showModal(); break;
        case "h": e.preventDefault(); insertAtCursor(editor, "\n\n---\n\n"); break;
        case "f": e.preventDefault(); toggleFindbar(); break;
        case "e": e.preventDefault(); exportHtml(true); break;
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

    if (e.key === "Escape") {
      findbarEl.classList.add("hidden");
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
  document.getElementById("link-cancel").onclick = () =>
    document.getElementById("link-dialog").close();
  document.getElementById("link-insert").onclick = () => {
    const url = document.getElementById("link-url").value;
    const text = document.getElementById("link-text").value || url;
    insertAtCursor(editor, `[${text}](${url})`);
    document.getElementById("link-dialog").close();
    document.getElementById("link-url").value = "";
    document.getElementById("link-text").value = "";
  };

  // Image dialog
  document.getElementById("image-cancel").onclick = () =>
    document.getElementById("image-dialog").close();
  document.getElementById("image-browse").onclick = async () => {
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

// Find bar
function toggleFindbar() {
  findbarEl.classList.toggle("hidden");
  if (!findbarEl.classList.contains("hidden")) {
    document.getElementById("find-input").focus();
  }
}

function setupFindbar() {
  document.getElementById("find-close").onclick = () =>
    findbarEl.classList.add("hidden");

  // Basic find implementation using CodeMirror search
  // The actual search is handled by CodeMirror's built-in search via Ctrl+F
  // This findbar provides a custom UI for it
  const findInput = document.getElementById("find-input");
  const replaceInput = document.getElementById("replace-input");

  findInput.addEventListener("input", () => doFind());
  document.getElementById("find-next").onclick = () => doFind("next");
  document.getElementById("find-prev").onclick = () => doFind("prev");
  document.getElementById("find-regex").onchange = () => doFind();
  document.getElementById("find-case").onchange = () => doFind();
  document.getElementById("find-whole").onchange = () => doFind();

  document.getElementById("replace-one").onclick = () => doReplace(false);
  document.getElementById("replace-all").onclick = () => doReplace(true);
}

function doFind(direction) {
  const query = document.getElementById("find-input").value;
  if (!query) {
    document.getElementById("find-count").textContent = "";
    return;
  }

  const isRegex = document.getElementById("find-regex").checked;
  const caseSensitive = document.getElementById("find-case").checked;
  const wholeWord = document.getElementById("find-whole").checked;

  const content = getContent(editor);
  let pattern;
  try {
    let src = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (wholeWord) src = `\\b${src}\\b`;
    pattern = new RegExp(src, caseSensitive ? "g" : "gi");
  } catch {
    document.getElementById("find-count").textContent = "Invalid regex";
    return;
  }

  const matches = [...content.matchAll(pattern)];
  document.getElementById("find-count").textContent =
    matches.length > 0 ? `${matches.length} matches` : "No matches";
}

function doReplace(all) {
  const query = document.getElementById("find-input").value;
  const replacement = document.getElementById("replace-input").value;
  if (!query) return;

  const isRegex = document.getElementById("find-regex").checked;
  const caseSensitive = document.getElementById("find-case").checked;
  const wholeWord = document.getElementById("find-whole").checked;

  let content = getContent(editor);
  let src = isRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (wholeWord) src = `\\b${src}\\b`;

  try {
    const flags = (caseSensitive ? "" : "i") + (all ? "g" : "");
    const pattern = new RegExp(src, flags);
    const newContent = content.replace(pattern, replacement);
    if (newContent !== content) {
      setContent(editor, newContent);
    }
  } catch {
    // Invalid regex, ignore
  }
}

// Image helpers
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|svg|webp|bmp|ico|tiff?)$/i;

// Wrap URLs that contain spaces/parens in CommonMark's `<...>` form so they
// survive the `[alt](url)` syntax. Leaves clean URLs untouched to avoid
// unnecessarily double-encoding pre-encoded remote links.
function encodeMarkdownUrl(url) {
  if (!url) return "";
  if (/[\s()<>]/.test(url)) {
    return `<${url.replace(/[<>]/g, "")}>`;
  }
  return url;
}

async function handleImageFile(file) {
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
        // Markdown file: open it
        const text = await file.text();
        setContent(editor, text);
        currentFile = null;
        statusFile.textContent = file.name;
        isModified = false;
        statusModified.classList.add("hidden");
        updatePreview(text);
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
  let isSyncing = false;
  let markersCache = null;

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
    const markers = [];
    for (const el of nodes) {
      const line = parseInt(el.dataset.srcLine, 10);
      if (Number.isNaN(line)) continue;
      // Use the following element's top if present — the empty <a> often
      // sits inline, whereas the real block is where the user thinks the
      // content starts.
      const target = el.nextElementSibling || el;
      const top = target.getBoundingClientRect().top - paneRect.top + scrollY;
      markers.push({ line, top });
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
      if (isSyncing) return;
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

      isSyncing = true;
      previewPane.scrollTop = target;
      requestAnimationFrame(() => (isSyncing = false));
    },
    true
  );
})();

// Initialize
init();
