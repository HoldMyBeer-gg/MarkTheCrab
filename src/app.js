import { createEditor, setContent, getContent, setNightMode, setLineNumbers, setWordWrap, setFontSize, wrapSelection, insertAtCursor, insertAtLineStart, getWordCount } from "./editor.js";
import hljs from "highlight.js";

// Make hljs available globally for preview highlighting
window.hljs = hljs;

const { invoke } = window.__TAURI__.core;
const { open, save, message } = window.__TAURI__.dialog;

// State
let editor;
let currentFile = null;
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

// Theme CSS cache
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

  // Load tutorial or empty
  updatePreview("");
}

function applySettings() {
  setNightMode(editor, settings.night_mode);
  setLineNumbers(editor, settings.line_numbers);
  setWordWrap(editor, settings.word_wrap);
  setFontSize(editor, settings.font_size);

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

  if (settings.rtl) {
    previewEl.style.direction = "rtl";
  }
}

async function applyTheme(themeName) {
  // Load theme CSS for preview
  if (currentThemeLink) {
    currentThemeLink.remove();
  }
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `themes/${themeName}.css`;
  link.id = "theme-css";
  document.head.appendChild(link);
  currentThemeLink = link;
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

  // Highlight code blocks
  previewEl.querySelectorAll("pre code").forEach((block) => {
    if (window.hljs) {
      window.hljs.highlightElement(block);
    }
  });
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

  const content = await invoke("read_file", { path });
  setContent(editor, content);
  currentFile = path;
  isModified = false;
  statusFile.textContent = path.split(/[\\/]/).pop();
  statusModified.classList.add("hidden");
  await invoke("set_current_file", { path });
  updatePreview(content);
}

async function saveFile() {
  if (!currentFile) {
    return saveFileAs();
  }
  const content = getContent(editor);
  await invoke("write_file", { path: currentFile, content });
  isModified = false;
  statusModified.classList.add("hidden");
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

  currentFile = path;
  statusFile.textContent = path.split(/[\\/]/).pop();
  await invoke("set_current_file", { path });
  return saveFile();
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
    const md = title
      ? `![${alt}](${url} "${title}")`
      : `![${alt}](${url})`;
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

async function handleImageFile(file) {
  const buffer = await file.arrayBuffer();
  const bytes = Array.from(new Uint8Array(buffer));
  const relativePath = await invoke("save_image", {
    imageData: bytes,
    filename: file.name,
  });
  insertAtCursor(editor, `![${file.name}](${relativePath})\n`);
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
        insertAtCursor(editor, `![pasted image](${relativePath})\n`);
        return; // Handle one image per paste
      }
    }
    // If no image data, let the default paste handle text
  });
}

// Synchronized scrolling
(function setupSyncScroll() {
  const editorEl = document.getElementById("editor");

  let isSyncing = false;

  editorEl.addEventListener("scroll", () => {
    if (isSyncing) return;
    isSyncing = true;

    const scroller = editorEl.querySelector(".cm-scroller");
    if (scroller && previewPane) {
      const ratio = scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight || 1);
      previewPane.scrollTop = ratio * (previewPane.scrollHeight - previewPane.clientHeight);
    }

    requestAnimationFrame(() => (isSyncing = false));
  }, true);
})();

// Initialize
init();
