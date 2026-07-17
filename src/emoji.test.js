import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { CompletionContext } from "@codemirror/autocomplete";
import { emojiSource } from "./emoji.js";

// Build a completion context with the cursor at the end of `doc` (or at the
// given pos). Mirrors how CodeMirror invokes the source while typing.
function contextFor(doc, { explicit = false, pos = doc.length } = {}) {
  const state = EditorState.create({
    doc,
    selection: { anchor: pos },
    extensions: [markdown({ base: markdownLanguage, codeLanguages: languages })],
  });
  return new CompletionContext(state, pos, explicit);
}

const labels = (res) => (res ? res.options.map((o) => o.label) : []);
const applies = (res) => (res ? res.options.map((o) => o.apply) : []);

describe("emoji shortcode completion", () => {
  it("suggests crab for :cra and inserts the glyph", () => {
    const res = emojiSource(contextFor(":cra"));
    expect(res).not.toBeNull();
    expect(res.from).toBe(0);
    expect(res.to).toBe(4);
    expect(applies(res)).toContain("🦀");
    expect(labels(res).some((l) => l.includes(":crab:"))).toBe(true);
  });

  it("ranks shortcode-prefix matches ahead of keyword-only matches", () => {
    // ':fire' is a shortcode prefix of :fire/:fireworks-style entries, so the
    // flame lands first, ahead of anything that only mentions fire elsewhere.
    const res = emojiSource(contextFor(":fire"));
    expect(applies(res)[0]).toBe("🔥");
  });

  it("matches on keywords, not just the shortcode", () => {
    const res = emojiSource(contextFor(":laugh"));
    // :joy has keyword "laugh"
    expect(applies(res)).toContain("😂");
  });

  it("does not fire on a bare colon unless explicit", () => {
    expect(emojiSource(contextFor(":"))).toBeNull();
    const res = emojiSource(contextFor(":", { explicit: true }));
    expect(res).not.toBeNull();
    expect(res.options.length).toBeGreaterThan(0);
  });

  it("does not fire inside a URL (http://)", () => {
    // cursor right after the second slash — colon is preceded by 'p'
    const res = emojiSource(contextFor("see http://"));
    expect(res).toBeNull();
  });

  it("does not fire inside a closed inline code span", () => {
    // `:crab` — cursor just before the closing backtick (pos 6), inside code.
    const res = emojiSource(contextFor("`:crab`", { pos: 6 }));
    expect(res).toBeNull();
  });

  it("does not fire inside a fenced code block", () => {
    const doc = "```\n:crab\n```";
    const res = emojiSource(contextFor(doc, { pos: 9 })); // end of ":crab" line
    expect(res).toBeNull();
  });

  it("only completes shortcodes that exist", () => {
    const res = emojiSource(contextFor(":zzzzzzzzznope"));
    expect(res).toBeNull();
  });
});

describe("emoji emoticon completion", () => {
  it("turns :) into a smiley", () => {
    const res = emojiSource(contextFor(":)"));
    expect(res).not.toBeNull();
    expect(applies(res)).toContain("🙂");
    expect(res.from).toBe(0);
  });

  it("turns <3 into a heart", () => {
    const res = emojiSource(contextFor("i <3 you", { pos: 4 }));
    expect(res).not.toBeNull();
    expect(applies(res)).toContain("❤️");
  });

  it("previews emoticons from a leading > as you type >:(", () => {
    const res = emojiSource(contextFor(">"));
    expect(res).not.toBeNull();
    // both >:( (angry) and >:) (imp) start with '>'
    expect(applies(res)).toEqual(expect.arrayContaining(["😠", "😈"]));
  });

  it("puts the exact emoticon match first", () => {
    const res = emojiSource(contextFor(":)"));
    expect(applies(res)[0]).toBe("🙂");
  });

  it("does not treat ordinary prose punctuation as an emoticon", () => {
    // 'foo)' after a space: no emoticon starts with 'foo)'
    expect(emojiSource(contextFor("a foo)"))).toBeNull();
  });
});
