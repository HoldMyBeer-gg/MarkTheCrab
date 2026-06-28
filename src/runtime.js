// Unified Tauri / browser runtime.
// In Tauri: passthrough to window.__TAURI__.
// In browser: WASM renderer + File System Access API + localStorage shims.

const isTauri = typeof window !== "undefined" && !!window.__TAURI__;

if (typeof document !== "undefined") {
  document.documentElement.dataset.mtcMode = isTauri ? "tauri" : "browser";
}

const SETTINGS_KEY = "mtc:settings";
const RECENT_KEY = "mtc:recent";

const SETTINGS_DEFAULTS = {
  theme: "github",
  custom_css: "",
  font_family: "monospace",
  font_size: 14,
  line_numbers: true,
  word_wrap: true,
  live_preview: true,
  night_mode: false,
  show_toolbar: true,
  show_statusbar: true,
  vertical_layout: false,
  zoom_level: 1.0,
  rtl: false,
  recent_files: [],
  window_width: 1200,
  window_height: 800,
  spellcheck: true,
  show_mascot: true,
  mascot_animations: true,
};

let api;

if (isTauri) {
  const tauri = window.__TAURI__;
  api = {
    invoke: tauri.core.invoke,
    convertFileSrc: tauri.core.convertFileSrc,
    dialog: tauri.dialog,
    event: tauri.event,
    // The current window, used to scope event listeners so menu / close /
    // open-path events only fire in the window they were emitted to. Null if
    // the webviewWindow module isn't available (callers fall back to global).
    currentWindow: tauri.webviewWindow?.getCurrentWebviewWindow?.() ?? null,
    isBrowser: false,
  };
} else {
  api = await createBrowserApi();
  if (typeof document !== "undefined") {
    document.addEventListener("click", (e) => {
      const btn = e.target.closest('[data-action="dismiss-demo-banner"]');
      if (btn) document.body.classList.add("demo-banner-dismissed");
    });
  }
}

export const invoke = api.invoke;
export const convertFileSrc = api.convertFileSrc;
export const dialog = api.dialog;
export const event = api.event;
export const currentWindow = api.currentWindow ?? null;
export const isBrowser = api.isBrowser;

async function createBrowserApi() {
  const wasm = await import("./wasm/pkg/markthecrab_wasm.js");
  await wasm.default();

  const fileHandles = new Map(); // synthetic path -> FileSystemFileHandle
  const inputFallbackContents = new Map(); // synthetic path -> { content, mtime, name }
  let nextHandleId = 0;
  let currentFile = null;

  const hasFsa = typeof window.showOpenFilePicker === "function";

  function loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return { ...SETTINGS_DEFAULTS, ...parsed };
    } catch {
      return { ...SETTINGS_DEFAULTS };
    }
  }

  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }

  function parseBool(v) {
    return v === "true" || v === true;
  }

  function applyUpdate(s, key, value) {
    switch (key) {
      case "theme":
      case "custom_css":
      case "font_family":
        s[key] = String(value);
        break;
      case "font_size":
        s.font_size = parseInt(value, 10);
        break;
      case "zoom_level":
        s.zoom_level = parseFloat(value);
        break;
      case "line_numbers":
      case "word_wrap":
      case "live_preview":
      case "night_mode":
      case "show_toolbar":
      case "show_statusbar":
      case "vertical_layout":
      case "rtl":
      case "spellcheck":
      case "show_mascot":
      case "mascot_animations":
        s[key] = parseBool(value);
        break;
      default:
        throw new Error(`Unknown setting: ${key}`);
    }
  }

  function fsaTypesFromFilters(filters) {
    if (!filters?.length) return undefined;
    return filters.map((f) => ({
      description: f.name ?? "Files",
      accept: {
        "text/plain": (f.extensions ?? []).map((e) => (e.startsWith(".") ? e : `.${e}`)),
      },
    }));
  }

  async function pickViaInput() {
    return await new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.style.display = "none";
      input.addEventListener("change", async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve(null);
        } else {
          const text = await file.text();
          const id = `browser:input:${nextHandleId++}:${file.name}`;
          inputFallbackContents.set(id, {
            content: text,
            mtime: file.lastModified,
            name: file.name,
          });
          resolve(id);
        }
        input.remove();
      });
      input.addEventListener("cancel", () => {
        resolve(null);
        input.remove();
      });
      document.body.appendChild(input);
      input.click();
    });
  }

  function downloadBlob(name, content) {
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function readBack(syntheticPath) {
    if (fileHandles.has(syntheticPath)) {
      const fh = fileHandles.get(syntheticPath);
      const file = await fh.getFile();
      return { content: await file.text(), mtime: file.lastModified };
    }
    if (inputFallbackContents.has(syntheticPath)) {
      return inputFallbackContents.get(syntheticPath);
    }
    throw new Error(`Unknown path in browser mode: ${syntheticPath}`);
  }

  async function writeBack(syntheticPath, content) {
    if (fileHandles.has(syntheticPath)) {
      const fh = fileHandles.get(syntheticPath);
      const w = await fh.createWritable();
      await w.write(content);
      await w.close();
      const file = await fh.getFile();
      return file.lastModified;
    }
    if (inputFallbackContents.has(syntheticPath)) {
      const entry = inputFallbackContents.get(syntheticPath);
      downloadBlob(entry.name, content);
      entry.content = content;
      entry.mtime = Date.now();
      return entry.mtime;
    }
    throw new Error(`Unknown path in browser mode: ${syntheticPath}`);
  }

  async function invokeImpl(name, args = {}) {
    switch (name) {
      case "render_markdown":
        return wasm.renderMarkdown(args.text ?? "");

      case "platform":
        return "browser";

      case "export_html":
        return wasm.exportHtml(
          args.markdownText ?? args.markdown_text ?? "",
          !!args.styled,
          args.theme ?? "github",
          args.customCss ?? args.custom_css ?? "",
        );

      case "get_credits":
        return wasm.getCredits();

      case "load_settings":
        return loadSettings();

      case "save_settings": {
        saveSettings({ ...SETTINGS_DEFAULTS, ...(args.settings ?? {}) });
        return;
      }

      case "update_setting": {
        const s = loadSettings();
        applyUpdate(s, args.key, args.value);
        saveSettings(s);
        return;
      }

      case "read_file": {
        const r = await readBack(args.path);
        return r.content;
      }

      case "read_file_with_mtime": {
        const r = await readBack(args.path);
        return [r.content, r.mtime];
      }

      case "write_file": {
        await writeBack(args.path, args.content ?? "");
        return;
      }

      case "write_file_with_mtime": {
        return await writeBack(args.path, args.content ?? "");
      }

      case "stat_mtime": {
        if (fileHandles.has(args.path)) {
          try {
            const file = await fileHandles.get(args.path).getFile();
            return file.lastModified;
          } catch {
            return null;
          }
        }
        if (inputFallbackContents.has(args.path)) {
          return inputFallbackContents.get(args.path).mtime;
        }
        return null;
      }

      case "set_current_file": {
        currentFile = args.path ?? null;
        if (currentFile) {
          const recent = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]")
            .filter((p) => p !== currentFile);
          recent.unshift(currentFile);
          localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, 10)));
        }
        return;
      }

      case "get_current_file":
        return currentFile;

      case "save_image": {
        // Embed as data URL — browser can't write to a sibling images/ dir
        // without a directory handle. The returned data URL is what gets
        // inlined into the markdown.
        const bytes = new Uint8Array(args.imageData ?? args.image_data ?? []);
        const blob = new Blob([bytes]);
        return await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }

      case "confirm_close":
        return; // browser handles tab close itself

      default:
        throw new Error(`Unknown invoke command in browser mode: ${name}`);
    }
  }

  const dialogImpl = {
    async open(opts = {}) {
      if (opts.directory) {
        if (!hasFsa || typeof window.showDirectoryPicker !== "function") return null;
        try {
          const dh = await window.showDirectoryPicker();
          const id = `browser:dir:${nextHandleId++}:${dh.name}`;
          fileHandles.set(id, dh);
          return id;
        } catch (e) {
          if (e?.name === "AbortError") return null;
          throw e;
        }
      }
      if (hasFsa) {
        try {
          const [fh] = await window.showOpenFilePicker({
            multiple: false,
            types: fsaTypesFromFilters(opts.filters),
          });
          const id = `browser:fsa:${nextHandleId++}:${fh.name}`;
          fileHandles.set(id, fh);
          return id;
        } catch (e) {
          if (e?.name === "AbortError") return null;
          // Fall through to input fallback on any other error
        }
      }
      return await pickViaInput();
    },

    async save(opts = {}) {
      if (hasFsa && typeof window.showSaveFilePicker === "function") {
        try {
          const fh = await window.showSaveFilePicker({
            suggestedName: opts.defaultPath ? opts.defaultPath.split(/[/\\]/).pop() : undefined,
            types: fsaTypesFromFilters(opts.filters),
          });
          const id = `browser:fsa:${nextHandleId++}:${fh.name}`;
          fileHandles.set(id, fh);
          return id;
        } catch (e) {
          if (e?.name === "AbortError") return null;
        }
      }
      // No-FSA fallback: create a phantom entry so writes trigger downloads.
      const name = opts.defaultPath
        ? opts.defaultPath.split(/[/\\]/).pop()
        : "untitled.md";
      const id = `browser:download:${nextHandleId++}:${name}`;
      inputFallbackContents.set(id, { content: "", mtime: Date.now(), name });
      return id;
    },

    async message(text) {
      window.alert(text);
    },

    async ask(text) {
      return window.confirm(text);
    },
  };

  const eventImpl = {
    async listen(name, cb) {
      if (name === "mtc:close-requested") {
        // Best we can do: fire on beforeunload. Browser controls the prompt,
        // we just give the app a chance to flush.
        const handler = () => {
          try { cb({ payload: null }); } catch { /* ignore */ }
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
      }
      return () => {};
    },
    async emit() {},
    async once() { return () => {}; },
  };

  function convertFileSrcImpl(path) {
    if (typeof path !== "string") return path;
    if (path.startsWith("data:") || path.startsWith("blob:") || path.startsWith("http")) {
      return path;
    }
    // Local fs paths can't resolve in browser; return as-is and let the
    // <img> tag 404. The desktop app converts these via Tauri's asset proto.
    return path;
  }

  return {
    invoke: invokeImpl,
    convertFileSrc: convertFileSrcImpl,
    dialog: dialogImpl,
    event: eventImpl,
    isBrowser: true,
  };
}
