// Editor-side emoji entry: a CodeMirror completion source that turns
// `:shortcode` and ASCII emoticons into real Unicode emoji as you type.
//
// The whole point is to sidestep the OS emoji shortcut (Cmd+Ctrl+Space /
// Win+.): type `:cra` → pick 🦀, or type `:)` → pick 🙂, and the actual
// character lands in the document. Pasted emoji are never touched — we only
// act on shortcode/emoticon text the user is actively typing.
import { autocompletion, acceptCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { EMOJI, EMOTICONS } from "./emoji-data.js";

const MAX_RESULTS = 40;
const EM_SPACE = " ";

// A short, familiar set shown when the popup is triggered on a bare `:`.
const POPULAR = [
  "+1", "-1", "smile", "joy", "heart", "tada", "fire", "eyes",
  "rocket", "100", "thinking", "pray", "sob", "sunglasses", "crab",
];

// Emoticon keys sorted longest-first so a greedy match prefers `:-)` over `:`.
const EMOTICON_KEYS = Object.keys(EMOTICONS).sort((a, b) => b.length - a.length);

// Emoji completions insert the raw glyph, so the label is only ever shown,
// never used to build the inserted text. Show "🦀  :crab:" and insert "🦀".
function emojiOption(ch, code, kind) {
  return {
    label: `${ch}${EM_SPACE}${code}`,
    apply: ch,
    detail: kind,
    type: "emoji",
  };
}

// Don't fire inside code spans/blocks or URLs — a stray `:)` in a code sample
// or `http://` shouldn't turn into an emoji.
function inCodeOrUrl(state, pos) {
  let node = syntaxTree(state).resolveInner(pos, -1);
  while (node) {
    const n = node.name;
    if (
      n === "InlineCode" ||
      n === "FencedCode" ||
      n === "CodeText" ||
      n === "CodeBlock" ||
      n === "URL" ||
      n === "Autolink"
    ) {
      return true;
    }
    node = node.parent;
  }
  return false;
}

function rankShortcodes(query) {
  if (!query) {
    return POPULAR.map((sc) => {
      const e = EMOJI.find((x) => x.sc === sc);
      return e ? emojiOption(e.ch, `:${e.sc}:`, "emoji") : null;
    }).filter(Boolean);
  }
  const starts = [];
  const contains = [];
  for (const e of EMOJI) {
    if (e.sc.startsWith(query)) starts.push(e);
    else if (e.hay.includes(query)) contains.push(e);
    if (starts.length >= MAX_RESULTS) break;
  }
  return [...starts, ...contains]
    .slice(0, MAX_RESULTS)
    .map((e) => emojiOption(e.ch, `:${e.sc}:`, "emoji"));
}

// Exported for unit testing; the editor uses it via `emojiCompletion()`.
export function emojiSource(context) {
  const { state, pos } = context;
  const line = state.doc.lineAt(pos);
  const before = line.text.slice(0, pos - line.from);

  // Shortcode: a `:` on a boundary followed by word chars. The boundary
  // (start-of-line or a non-word, non-colon char before the `:`) keeps this
  // from firing on things like `http:` or `namespace::foo`.
  const sc = /(?:^|[^\w:]):([\w+-]*)$/.exec(before);
  if (sc) {
    const query = sc[1].toLowerCase();
    const from = pos - query.length - 1; // the ':' itself
    if (inCodeOrUrl(state, from)) return null;
    // A lone `:` only pops up on an explicit request (Ctrl+Space); otherwise
    // wait for at least one character so we don't nag on every colon.
    if (!query && !context.explicit) return null;
    const options = rankShortcodes(query);
    if (!options.length) return null;
    return { from, to: pos, options, filter: false };
  }

  // Emoticon: a short punctuation token on a boundary that starts one of the
  // known emoticons. `startsWith` lets the popup preview as you type `:`, `;`,
  // `<`, `>`… and settle once the full `:)` / `<3` is there.
  const em = /(?:^|\s)(\S{1,4})$/.exec(before);
  if (em) {
    const token = em[1];
    const from = pos - token.length;
    if (inCodeOrUrl(state, from)) return null;
    const matches = EMOTICON_KEYS.filter(
      (k) => k === token || k.startsWith(token)
    );
    if (!matches.length) return null;
    // Exact match first, then shortest remaining, so `:)` outranks `:-)`.
    matches.sort((a, b) => {
      if (a === token) return -1;
      if (b === token) return 1;
      return a.length - b.length;
    });
    const options = matches
      .slice(0, MAX_RESULTS)
      .map((k) => emojiOption(EMOTICONS[k], k, "emoticon"));
    return { from, to: pos, options, filter: false };
  }

  return null;
}

// The emoji autocomplete extension, plus a Tab binding to accept the
// highlighted emoji. `acceptCompletion` returns false when no popup is open,
// so Tab still falls through to the editor's normal indent behaviour.
export function emojiCompletion() {
  return [
    autocompletion({
      override: [emojiSource],
      icons: false,
      activateOnTyping: true,
      closeOnBlur: true,
      maxRenderedOptions: MAX_RESULTS,
    }),
    Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
  ];
}
