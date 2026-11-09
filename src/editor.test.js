import { describe, it, expect, vi } from "vitest";
import { undoDepth } from "@codemirror/commands";

// spellcheck.js pulls the dictionary in through esbuild's text loader, which
// vitest doesn't have; the editor's reload behaviour doesn't need it.
vi.mock("./spellcheck.js", () => ({ spellcheckExtension: () => [] }));

const { createDocState, reloadedDocState } = await import("./editor.js");

describe("reloadedDocState", () => {
  it("starts a fresh undo history, so Cmd+Z can't replay pre-reload edits into the new content", () => {
    let state = createDocState("hello foo world");
    // Delete "foo " as the user would, leaving one undo step.
    state = state.update({ changes: { from: 6, to: 10 }, userEvent: "delete" }).state;
    expect(undoDepth(state)).toBe(1);

    const reloaded = reloadedDocState(state, "edited elsewhere");
    expect(reloaded.doc.toString()).toBe("edited elsewhere");
    expect(undoDepth(reloaded)).toBe(0);
  });

  it("keeps the caret where it was, clamped to the new length", () => {
    let state = createDocState("0123456789");
    state = state.update({ selection: { anchor: 4 } }).state;
    expect(reloadedDocState(state, "abcdefgh").selection.main.head).toBe(4);

    state = state.update({ selection: { anchor: 9 } }).state;
    expect(reloadedDocState(state, "abc").selection.main.head).toBe(3);
  });
});
