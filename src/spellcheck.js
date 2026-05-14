import nspell from "nspell";
import affText from "../node_modules/dictionary-en-us/index.aff";
import dicText from "../node_modules/dictionary-en-us/index.dic";
import { linter, forEachDiagnostic } from "@codemirror/lint";
import { syntaxTree } from "@codemirror/language";
import { ViewPlugin } from "@codemirror/view";

let spellPromise = null;

function loadSpeller() {
  if (!spellPromise) {
    spellPromise = new Promise((resolve) => {
      // nspell parsing is synchronous but ~50ms for the en-US dict;
      // defer past the editor mount so the UI paints first.
      setTimeout(() => {
        try {
          resolve(nspell({ aff: affText, dic: dicText }));
        } catch (err) {
          console.error("spellcheck: failed to init nspell", err);
          resolve(null);
        }
      }, 0);
    });
  }
  return spellPromise;
}

// Lezer-markdown node names whose contents should NOT be spell-checked.
const SKIP_NODES = new Set([
  "CodeBlock",
  "FencedCode",
  "CodeText",
  "InlineCode",
  "URL",
  "Autolink",
  "HTMLBlock",
  "HTMLTag",
  "ProcessingInstructionBlock",
  "CommentBlock",
  "LinkMark",
  "CodeMark",
  "EmphasisMark",
  "HeaderMark",
  "QuoteMark",
  "ListMark",
  "LinkTitle",
  "LinkLabel",
]);

// Tokenize a chunk of text into [from, to, word] tuples relative to `offset`.
// We allow ASCII letters plus an internal apostrophe (don't, it's). Anything
// else terminates a token.
function tokenize(text, offset) {
  const tokens = [];
  const re = /[A-Za-z]+(?:'[A-Za-z]+)*/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    tokens.push([offset + m.index, offset + m.index + m[0].length, m[0]]);
  }
  return tokens;
}

// Skip tokens that are almost certainly not natural-language English words:
// all-caps acronyms, camelCase / PascalCase identifiers, single letters.
function shouldSkip(word) {
  if (word.length < 2) return true;
  if (word === word.toUpperCase()) return true; // ADT, CEO, NASA
  // Internal uppercase after the first char suggests an identifier (camelCase,
  // PascalCase, JSDoc-style). Real English words have at most a leading cap.
  const body = word.slice(1);
  if (/[A-Z]/.test(body)) return true;
  return false;
}

// Walk the syntax tree to collect spans of plain prose: text positions that
// are NOT inside any node in SKIP_NODES. Returns an array of [from, to].
function proseRanges(state) {
  const ranges = [];
  const skipStack = [];
  const docEnd = state.doc.length;
  let cursor = 0;

  syntaxTree(state).iterate({
    enter(node) {
      if (SKIP_NODES.has(node.name)) {
        // Flush prose up to the start of this skip node.
        if (cursor < node.from) ranges.push([cursor, node.from]);
        skipStack.push(node.to);
        cursor = node.to;
        return false; // don't descend
      }
    },
    leave(node) {
      if (skipStack.length && skipStack[skipStack.length - 1] === node.to) {
        skipStack.pop();
      }
    },
  });

  if (cursor < docEnd) ranges.push([cursor, docEnd]);
  return ranges;
}

// Right-click on a misspelling: show a floating menu of nspell suggestions.
// Click outside / Escape / scroll dismisses. Click a suggestion replaces the
// word. Right-clicking anywhere else falls through to the native context menu.
const suggestionMenu = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.view = view;
      this.menu = null;
      this.onContextMenu = this.onContextMenu.bind(this);
      this.close = this.close.bind(this);
      view.contentDOM.addEventListener("contextmenu", this.onContextMenu);
    }

    async onContextMenu(event) {
      const view = this.view;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos == null) return;

      let hit = null;
      forEachDiagnostic(view.state, (d, from, to) => {
        if (!hit && pos >= from && pos <= to) hit = { from, to };
      });
      if (!hit) return; // not on a misspelling; let native menu show

      event.preventDefault();
      this.close();

      const word = view.state.sliceDoc(hit.from, hit.to);
      const speller = await loadSpeller();
      const suggestions = speller ? speller.suggest(word).slice(0, 8) : [];
      this.open(event.clientX, event.clientY, suggestions, hit);
    }

    open(x, y, suggestions, range) {
      const menu = document.createElement("ul");
      menu.className = "mtc-spell-menu";
      menu.setAttribute("role", "menu");

      if (suggestions.length === 0) {
        const li = document.createElement("li");
        li.className = "mtc-spell-empty";
        li.textContent = "No suggestions";
        menu.appendChild(li);
      } else {
        for (const s of suggestions) {
          const li = document.createElement("li");
          li.setAttribute("role", "menuitem");
          li.tabIndex = 0;
          li.textContent = s;
          li.addEventListener("click", () => this.replace(range, s));
          li.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              this.replace(range, s);
            }
          });
          menu.appendChild(li);
        }
      }

      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      document.body.appendChild(menu);
      this.menu = menu;

      // Clamp to viewport now that we know the menu's measured size.
      const r = menu.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      if (r.right > vw) menu.style.left = `${Math.max(0, vw - r.width - 4)}px`;
      if (r.bottom > vh) menu.style.top = `${Math.max(0, vh - r.height - 4)}px`;

      const first = menu.querySelector('[role="menuitem"]');
      if (first) first.focus();

      document.addEventListener("mousedown", this.onDocMouseDown, true);
      document.addEventListener("keydown", this.onDocKey, true);
      this.view.scrollDOM.addEventListener("scroll", this.close, { once: true });
    }

    replace(range, replacement) {
      this.view.dispatch({
        changes: { from: range.from, to: range.to, insert: replacement },
        selection: { anchor: range.from + replacement.length },
      });
      this.close();
      this.view.focus();
    }

    onDocMouseDown = (e) => {
      if (this.menu && !this.menu.contains(e.target)) this.close();
    };

    onDocKey = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        this.close();
      }
    };

    close() {
      if (!this.menu) return;
      this.menu.remove();
      this.menu = null;
      document.removeEventListener("mousedown", this.onDocMouseDown, true);
      document.removeEventListener("keydown", this.onDocKey, true);
    }

    destroy() {
      this.view.contentDOM.removeEventListener("contextmenu", this.onContextMenu);
      this.close();
    }
  }
);

// Returns the extension to install when spell-check is enabled. The first
// invocation awaits dictionary load (~50ms parse on top of bundle download);
// subsequent invocations are synchronous against the cached speller.
export function spellcheckExtension() {
  return [
    suggestionMenu,
    linter(
    async (view) => {
      const speller = await loadSpeller();
      if (!speller) return [];
      const state = view.state;
      const diags = [];
      for (const [from, to] of proseRanges(state)) {
        const slice = state.sliceDoc(from, to);
        for (const [tf, tt, word] of tokenize(slice, from)) {
          if (shouldSkip(word)) continue;
          if (!speller.correct(word)) {
            diags.push({
              from: tf,
              to: tt,
              severity: "error",
              message: "",
            });
          }
        }
      }
      return diags;
    },
    {
      delay: 300,
      tooltipFilter: () => [],
    }
  ),
  ];
}

