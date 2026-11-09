// Save / Save As / reload-from-disk logic for tabs, kept free of the DOM and
// of Tauri so it can be tested. app.js supplies the I/O and dialogs.
//
// Every function here captures what it needs (path, content) before its first
// await and re-checks the world after each one: tab switches, typing, Cmd+S
// and closing tabs can all happen while a native call is in flight.

// Save `tab` to its own path. Throws if the write fails, leaving `tab` as it
// was. Returns { saved: false } if the user declined to overwrite a file that
// changed on disk.
export async function saveTab(tab, { contentOf, statMtime, writeFile, confirmOverwrite }) {
  const path = tab.file;
  const content = contentOf(tab);
  if (tab.mtime != null) {
    const diskMtime = await statMtime(path);
    if (diskMtime != null && diskMtime > tab.mtime && !(await confirmOverwrite(tab))) {
      return { saved: false };
    }
  }
  const mtime = await writeFile(path, content);
  markWritten(tab, mtime, contentOf(tab) !== content);
  return { saved: true, mtime };
}

// Save `tab` to a new `path`. Another tab with that path open gets closed,
// after asking if it has unsaved edits. Nothing changes unless the write
// succeeds; a failed write throws.
export async function saveTabAs(tab, path, { tabs, contentOf, writeFile, confirmReplaceDirty }) {
  const others = tabs.filter((t) => t !== tab && t.file === path);
  const dirty = others.filter((t) => t.isModified);
  if (dirty.length > 0 && !(await confirmReplaceDirty(dirty))) return { saved: false };

  const content = contentOf(tab);
  const mtime = await writeFile(path, content);
  tab.file = path;
  tab.title = null;
  markWritten(tab, mtime, contentOf(tab) !== content);
  for (const other of others) {
    const idx = tabs.indexOf(other);
    if (idx !== -1) tabs.splice(idx, 1);
  }
  return { saved: true, mtime, dropped: others };
}

function markWritten(tab, mtime, changedSince) {
  tab.mtime = mtime;
  tab.ignoredMtime = undefined;
  // Disk now holds what we wrote; the tab is dirty only if it was edited
  // while the write was in flight.
  tab.isModified = changedSince;
}

// Re-read `tab` from disk and hand the result to `apply`, unless something
// happened during the read that makes replacing the content wrong: the tab
// was closed or edited, or a save/dialog paused the watcher. Returns whether
// it applied.
export async function reloadTab(tab, { contentOf, readFile, isPaused, isOpen, apply }) {
  const before = contentOf(tab);
  let content, mtime;
  try {
    [content, mtime] = await readFile(tab.file);
  } catch (_) {
    return false;
  }
  if (!isOpen(tab) || isPaused() || contentOf(tab) !== before) return false;
  apply(tab, content, mtime);
  return true;
}

// Stat every tab's file at once. A failed stat comes back as undefined.
export function statAll(tabs, statMtime) {
  return Promise.all(tabs.map((t) => statMtime(t.file).catch(() => undefined)));
}

// A counter the external-change watcher checks: paused while any dialog or
// save/open is in flight.
export function createPauseGate() {
  let depth = 0;
  return {
    get paused() { return depth > 0; },
    async during(fn) {
      depth++;
      try {
        return await fn();
      } finally {
        depth--;
      }
    },
  };
}

// Wrap the native dialogs so every one of them pauses the watcher while it is
// up. A check fired by a dialog's focus change can't race the dialog's caller.
export function wrapDialogs(dialog, gate) {
  const wrapped = {};
  for (const name of ["open", "save", "message", "ask"]) {
    wrapped[name] = (...args) => gate.during(() => dialog[name](...args));
  }
  return wrapped;
}
