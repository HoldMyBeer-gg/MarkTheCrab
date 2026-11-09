import { describe, it, expect, vi } from "vitest";
import {
  saveTab,
  saveTabAs,
  reloadTab,
  statAll,
  findTabByPath,
  createPauseGate,
  wrapDialogs,
} from "./tab-io.js";

// A promise we resolve/reject by hand, to hold an await open while the test
// changes the world underneath it (tab switch, typing, Cmd+S).
function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Tabs in these tests carry their live text in `text`; contentOf reads it.
const contentOf = (t) => t.text;
const tick = () => new Promise((r) => setTimeout(r, 0));

describe("saveTab", () => {
  it("writes the path and content captured when Cmd+S was pressed, even if the tab changes during the mtime check", async () => {
    const tab = { file: "/a.md", mtime: 10, isModified: true, text: "v1" };
    const stat = deferred();
    const writeFile = vi.fn(async () => 20);
    const p = saveTab(tab, {
      contentOf,
      statMtime: () => stat.promise,
      writeFile,
      confirmOverwrite: async () => true,
    });
    tab.text = "v2"; // user keeps typing while the stat is in flight
    stat.resolve(10);
    const result = await p;
    expect(writeFile).toHaveBeenCalledWith("/a.md", "v1");
    expect(result.saved).toBe(true);
    expect(tab.mtime).toBe(20);
    // What's in the tab now differs from what was written: still dirty.
    expect(tab.isModified).toBe(true);
  });

  it("marks the tab clean and clears a declined-reload mtime when nothing changed during the save", async () => {
    const tab = { file: "/a.md", mtime: 10, isModified: true, text: "v1", ignoredMtime: 15 };
    await saveTab(tab, {
      contentOf,
      statMtime: async () => 10,
      writeFile: async () => 20,
      confirmOverwrite: async () => true,
    });
    expect(tab.isModified).toBe(false);
    expect(tab.mtime).toBe(20);
    expect(tab.ignoredMtime).toBeUndefined();
  });

  it("does not write when the file changed on disk and the user declines to overwrite", async () => {
    const tab = { file: "/a.md", mtime: 10, isModified: true, text: "v1" };
    const writeFile = vi.fn();
    const result = await saveTab(tab, {
      contentOf,
      statMtime: async () => 99,
      writeFile,
      confirmOverwrite: async () => false,
    });
    expect(result.saved).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
    expect(tab.isModified).toBe(true);
    expect(tab.mtime).toBe(10);
  });

  it("skips the external-change check when the tab has no known mtime", async () => {
    const statMtime = vi.fn();
    const tab = { file: "/a.md", mtime: null, isModified: true, text: "v1" };
    await saveTab(tab, { contentOf, statMtime, writeFile: async () => 5, confirmOverwrite: vi.fn() });
    expect(statMtime).not.toHaveBeenCalled();
    expect(tab.mtime).toBe(5);
  });

  it("leaves the tab untouched when the write fails", async () => {
    const tab = { file: "/a.md", mtime: 10, isModified: true, text: "v1" };
    await expect(saveTab(tab, {
      contentOf,
      statMtime: async () => 10,
      writeFile: async () => { throw new Error("EACCES"); },
      confirmOverwrite: async () => true,
    })).rejects.toThrow("EACCES");
    expect(tab).toEqual({ file: "/a.md", mtime: 10, isModified: true, text: "v1" });
  });
});

describe("saveTabAs", () => {
  const io = (overrides = {}) => ({
    contentOf,
    writeFile: vi.fn(async () => 30),
    confirmReplaceDirty: vi.fn(async () => true),
    ...overrides,
  });

  it("asks before replacing a file another tab has open with unsaved edits, and does nothing if declined", async () => {
    const a = { file: null, mtime: null, isModified: true, text: "new", title: "Untitled" };
    const b = { file: "/notes.md", mtime: 10, isModified: true, text: "precious" };
    const tabs = [a, b];
    const deps = io({ confirmReplaceDirty: vi.fn(async () => false) });
    const result = await saveTabAs(a, "/notes.md", { tabs, ...deps });
    expect(deps.confirmReplaceDirty).toHaveBeenCalledWith([b]);
    expect(result.saved).toBe(false);
    expect(deps.writeFile).not.toHaveBeenCalled();
    expect(tabs).toEqual([a, b]);
    expect(a.file).toBe(null);
  });

  it("writes, retargets the tab and drops the other tab once the user agrees", async () => {
    const a = { file: null, mtime: null, isModified: true, text: "new", title: "Untitled" };
    const b = { file: "/notes.md", mtime: 10, isModified: true, text: "precious" };
    const tabs = [a, b];
    const deps = io();
    const result = await saveTabAs(a, "/notes.md", { tabs, ...deps });
    expect(deps.writeFile).toHaveBeenCalledWith("/notes.md", "new");
    expect(result).toEqual({ saved: true, mtime: 30, dropped: [b] });
    expect(tabs).toEqual([a]);
    expect(a).toMatchObject({ file: "/notes.md", mtime: 30, title: null, isModified: false });
  });

  it("drops a clean duplicate tab without asking", async () => {
    const a = { file: "/x.md", mtime: 1, isModified: false, text: "x" };
    const b = { file: "/y.md", mtime: 2, isModified: false, text: "y" };
    const tabs = [a, b];
    const deps = io();
    await saveTabAs(a, "/y.md", { tabs, ...deps });
    expect(deps.confirmReplaceDirty).not.toHaveBeenCalled();
    expect(tabs).toEqual([a]);
  });

  it("changes nothing when the write fails: tab keeps its old path and mtime, other tabs stay open", async () => {
    const a = { file: "/x.md", mtime: 1, isModified: true, text: "x", title: null };
    const b = { file: "/ro/y.md", mtime: 2, isModified: false, text: "y" };
    const tabs = [a, b];
    const deps = io({ writeFile: vi.fn(async () => { throw new Error("read-only"); }) });
    await expect(saveTabAs(a, "/ro/y.md", { tabs, ...deps })).rejects.toThrow("read-only");
    expect(tabs).toEqual([a, b]);
    expect(a).toMatchObject({ file: "/x.md", mtime: 1, isModified: true });
  });
});

describe("saveTabAs with differently spelled paths", () => {
  // Windows: same file, different case and separators.
  const samePath = async (a, b) => a.toLowerCase().replace(/\\/g, "/") === b.toLowerCase().replace(/\\/g, "/");

  it("treats a differently spelled path to an open file as the same file and asks first", async () => {
    const a = { file: null, mtime: null, isModified: true, text: "new" };
    const b = { file: "C:\\Notes\\style.md", mtime: 10, isModified: true, text: "precious" };
    const tabs = [a, b];
    const confirmReplaceDirty = vi.fn(async () => false);
    const writeFile = vi.fn();
    const result = await saveTabAs(a, "c:/notes/style.md", { tabs, contentOf, writeFile, confirmReplaceDirty, samePath });
    expect(confirmReplaceDirty).toHaveBeenCalledWith([b]);
    expect(writeFile).not.toHaveBeenCalled();
    expect(result.saved).toBe(false);
  });

  it("drops the differently spelled duplicate once the user agrees", async () => {
    const a = { file: null, mtime: null, isModified: true, text: "new" };
    const b = { file: "C:\\Notes\\style.md", mtime: 10, isModified: false, text: "old" };
    const tabs = [a, b];
    await saveTabAs(a, "c:/notes/style.md", {
      tabs, contentOf, writeFile: async () => 30, confirmReplaceDirty: async () => true, samePath,
    });
    expect(tabs).toEqual([a]);
  });
});

describe("findTabByPath", () => {
  const samePath = async (a, b) => a.toLowerCase() === b.toLowerCase();

  it("finds the tab holding the file even when the path is spelled differently", async () => {
    const tabs = [{ file: null }, { file: "/Users/x/Note.md" }, { file: "/Users/x/other.md" }];
    expect(await findTabByPath(tabs, "/users/x/note.md", samePath)).toBe(tabs[1]);
  });

  it("returns null when no tab has the file", async () => {
    expect(await findTabByPath([{ file: "/a.md" }, { file: null }], "/b.md", samePath)).toBe(null);
  });
});

describe("reloadTab", () => {
  const setup = (overrides = {}) => {
    const tab = { file: "/a.md", mtime: 10, text: "old" };
    const read = deferred();
    let paused = false;
    let open = true;
    const apply = vi.fn();
    const deps = {
      contentOf,
      readFile: () => read.promise,
      isPaused: () => paused,
      isOpen: () => open,
      apply,
      ...overrides,
    };
    return {
      tab, read, apply, deps,
      pause: () => { paused = true; },
      close: () => { open = false; },
    };
  };

  it("applies the disk content when nothing changed during the read", async () => {
    const { tab, read, apply, deps } = setup();
    const p = reloadTab(tab, deps);
    read.resolve(["disk", 20]);
    expect(await p).toBe(true);
    expect(apply).toHaveBeenCalledWith(tab, "disk", 20);
  });

  it("does not overwrite keystrokes typed while the read was in flight", async () => {
    const { tab, read, apply, deps } = setup();
    const p = reloadTab(tab, deps);
    tab.text = "old + typing";
    read.resolve(["disk", 20]);
    expect(await p).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("backs off if a save or dialog started during the read", async () => {
    const { tab, read, apply, deps, pause } = setup();
    const p = reloadTab(tab, deps);
    pause();
    read.resolve(["disk", 20]);
    expect(await p).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("backs off if the tab was closed during the read", async () => {
    const { tab, read, apply, deps, close } = setup();
    const p = reloadTab(tab, deps);
    close();
    read.resolve(["disk", 20]);
    expect(await p).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });

  it("returns false when the read fails", async () => {
    const { tab, read, apply, deps } = setup();
    const p = reloadTab(tab, deps);
    read.reject(new Error("gone"));
    expect(await p).toBe(false);
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("statAll", () => {
  it("stats every file concurrently instead of one after another", async () => {
    const pending = new Map();
    const statMtime = vi.fn((path) => {
      const d = deferred();
      pending.set(path, d);
      return d.promise;
    });
    const tabs = [{ file: "/a.md" }, { file: "/b.md" }];
    const p = statAll(tabs, statMtime);
    await tick();
    // Both requests are out before either answers.
    expect(statMtime).toHaveBeenCalledTimes(2);
    pending.get("/b.md").resolve(2);
    pending.get("/a.md").resolve(1);
    expect(await p).toEqual([1, 2]);
  });

  it("maps a failed stat to undefined without failing the rest", async () => {
    const statMtime = async (path) => {
      if (path === "/a.md") throw new Error("nope");
      return 7;
    };
    expect(await statAll([{ file: "/a.md" }, { file: "/b.md" }], statMtime)).toEqual([undefined, 7]);
  });
});

describe("createPauseGate / wrapDialogs", () => {
  it("is paused for exactly the life of a wrapped dialog, nested or not", async () => {
    const gate = createPauseGate();
    const seen = [];
    const ask = deferred();
    const dialogs = wrapDialogs(
      {
        ask: () => ask.promise,
        message: async () => { seen.push(gate.paused); },
        open: async () => "/p.md",
        save: async () => { throw new Error("boom"); },
      },
      gate,
    );
    expect(gate.paused).toBe(false);
    const p = dialogs.ask("Q?");
    expect(gate.paused).toBe(true);
    await dialogs.message("m"); // nested
    expect(seen).toEqual([true]);
    expect(gate.paused).toBe(true);
    ask.resolve(true);
    expect(await p).toBe(true);
    expect(gate.paused).toBe(false);
    expect(await dialogs.open({})).toBe("/p.md");
    await expect(dialogs.save({})).rejects.toThrow("boom");
    expect(gate.paused).toBe(false);
  });

  it("during() pauses around an arbitrary async operation and releases on throw", async () => {
    const gate = createPauseGate();
    await expect(gate.during(async () => {
      expect(gate.paused).toBe(true);
      throw new Error("x");
    })).rejects.toThrow("x");
    expect(gate.paused).toBe(false);
  });
});
