import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, rectangularSelection, crosshairCursor, highlightSpecialChars } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, history, historyKeymap, indentWithTab, undo, redo } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { syntaxHighlighting, defaultHighlightStyle, HighlightStyle, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { spellcheckExtension } from "./spellcheck.js";

// Override: the stock defaultHighlightStyle underlines anything tagged as a
// heading, and lezer-markdown also tags table-header cells as headings —
// both look ugly in a source editor. Keep bold, drop the underline.
const mtcHighlightOverrides = HighlightStyle.define([
  { tag: t.heading, fontWeight: "bold", textDecoration: "none" },
]);

const themeCompartment = new Compartment();
const lineNumbersCompartment = new Compartment();
const wordWrapCompartment = new Compartment();
const fontSizeCompartment = new Compartment();
const fontFamilyCompartment = new Compartment();
const spellcheckCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

const fontSizeTheme = (size) =>
  EditorView.theme({
    ".cm-content": { fontSize: `${size}px` },
    ".cm-gutters": { fontSize: `${size}px` },
  });

const fontFamilyTheme = (family) =>
  EditorView.theme({
    ".cm-content": { fontFamily: family || "" },
    ".cm-gutters": { fontFamily: family || "" },
  });

// Disable the native browser spellchecker. We do our own via a CodeMirror
// linter (see spellcheck.js) because WKWebView's contenteditable check is
// unreliable for programmatically inserted content (file loads, paste).
const nativeSpellcheckOff = EditorView.contentAttributes.of({ spellcheck: "false" });

// Current global editor configuration. Each tab keeps its own EditorState
// (so undo history, selection and content are isolated), but settings like
// theme or word-wrap are global. We track them here so a freshly created
// or re-activated tab state can be built/reconfigured to match.
const editorConfig = {
  nightMode: false,
  lineNumbers: true,
  wordWrap: true,
  fontSize: 14,
  fontFamily: "",
  spellcheck: true,
};

// Handlers are global (the single view drives the status bar / preview).
let editorHandlers = { onChange: null, onCursorChange: null };

function themeExtension() {
  return editorConfig.nightMode
    ? [syntaxHighlighting(mtcHighlightOverrides), oneDark]
    : [
        syntaxHighlighting(mtcHighlightOverrides),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      ];
}

function buildExtensions() {
  return [
    lineNumbersCompartment.of(editorConfig.lineNumbers ? lineNumbers() : []),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    rectangularSelection(),
    crosshairCursor(),
    bracketMatching(),
    highlightSelectionMatches(),
    wordWrapCompartment.of(editorConfig.wordWrap ? EditorView.lineWrapping : []),
    fontSizeCompartment.of(fontSizeTheme(editorConfig.fontSize)),
    fontFamilyCompartment.of(fontFamilyTheme(editorConfig.fontFamily)),
    nativeSpellcheckOff,
    spellcheckCompartment.of(editorConfig.spellcheck ? spellcheckExtension() : []),
    themeCompartment.of(themeExtension()),
    readOnlyCompartment.of(EditorState.readOnly.of(false)),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    keymap.of([
      indentWithTab,
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      ...foldKeymap,
    ]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged && editorHandlers.onChange) {
        editorHandlers.onChange(update.state.doc.toString());
      }
      if (update.selectionSet && editorHandlers.onCursorChange) {
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos);
        editorHandlers.onCursorChange(line.number, pos - line.from + 1);
      }
    }),
  ];
}

export function createEditor(parent, { onChange, onCursorChange }) {
  editorHandlers = { onChange, onCursorChange };
  const state = EditorState.create({ doc: "", extensions: buildExtensions() });
  const view = new EditorView({ state, parent });
  return view;
}

// Build a fresh document state (for a new tab) using the current settings.
export function createDocState(content = "") {
  return EditorState.create({ doc: content, extensions: buildExtensions() });
}

// Swap the view to another tab's stored state, reconfiguring its compartments
// to the current global settings first (settings may have changed while the
// tab was inactive). setState does not fire the update listener, so this
// doesn't mark the document modified.
export function activateState(view, state) {
  view.setState(state);
  view.dispatch({
    effects: [
      lineNumbersCompartment.reconfigure(editorConfig.lineNumbers ? lineNumbers() : []),
      wordWrapCompartment.reconfigure(editorConfig.wordWrap ? EditorView.lineWrapping : []),
      fontSizeCompartment.reconfigure(fontSizeTheme(editorConfig.fontSize)),
      fontFamilyCompartment.reconfigure(fontFamilyTheme(editorConfig.fontFamily)),
      spellcheckCompartment.reconfigure(editorConfig.spellcheck ? spellcheckExtension() : []),
      themeCompartment.reconfigure(themeExtension()),
    ],
  });
}

export function setContent(view, content) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  });
}

export function getContent(view) {
  return view.state.doc.toString();
}

export function setNightMode(view, enabled) {
  editorConfig.nightMode = enabled;
  view.dispatch({ effects: themeCompartment.reconfigure(themeExtension()) });
}

export function setLineNumbers(view, show) {
  editorConfig.lineNumbers = show;
  view.dispatch({
    effects: lineNumbersCompartment.reconfigure(
      show ? lineNumbers() : []
    ),
  });
}

export function setWordWrap(view, enabled) {
  editorConfig.wordWrap = enabled;
  view.dispatch({
    effects: wordWrapCompartment.reconfigure(
      enabled ? EditorView.lineWrapping : []
    ),
  });
}

export function setFontSize(view, size) {
  editorConfig.fontSize = size || 14;
  view.dispatch({
    effects: fontSizeCompartment.reconfigure(fontSizeTheme(size)),
  });
}

export function setFontFamily(view, family) {
  editorConfig.fontFamily = family || "";
  view.dispatch({
    effects: fontFamilyCompartment.reconfigure(fontFamilyTheme(family)),
  });
}

export function setSpellcheck(view, enabled) {
  editorConfig.spellcheck = enabled;
  view.dispatch({
    effects: spellcheckCompartment.reconfigure(
      enabled ? spellcheckExtension() : []
    ),
  });
}

export function wrapSelection(view, before, after) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to);
  const replacement = before + (selected || "text") + (after || before);
  view.dispatch({
    changes: { from, to, insert: replacement },
    selection: {
      anchor: from + before.length,
      head: from + before.length + (selected ? selected.length : 4),
    },
  });
  view.focus();
}

export function insertAtCursor(view, text) {
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
  });
  view.focus();
}

export function insertAtLineStart(view, prefix) {
  const { from } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  view.dispatch({
    changes: { from: line.from, to: line.from, insert: prefix },
  });
  view.focus();
}

export function editorUndo(view) {
  undo(view);
  view.focus();
}

export function editorRedo(view) {
  redo(view);
  view.focus();
}

export function openFind(view) {
  view.focus();
  openSearchPanel(view);
}

export function getWordCount(view) {
  const text = view.state.doc.toString().trim();
  if (!text) return { words: 0, chars: 0 };
  return {
    words: text.split(/\s+/).length,
    chars: text.length,
  };
}
