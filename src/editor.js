import { EditorView, keymap, lineNumbers, highlightActiveLineGutter, highlightActiveLine, drawSelection, rectangularSelection, crosshairCursor, highlightSpecialChars } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { syntaxHighlighting, defaultHighlightStyle, indentOnInput, bracketMatching, foldGutter, foldKeymap } from "@codemirror/language";

const themeCompartment = new Compartment();
const lineNumbersCompartment = new Compartment();
const wordWrapCompartment = new Compartment();
const fontSizeCompartment = new Compartment();
const fontFamilyCompartment = new Compartment();
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

export function createEditor(parent, { onChange, onCursorChange }) {
  const state = EditorState.create({
    doc: "",
    extensions: [
      lineNumbersCompartment.of(lineNumbers()),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      highlightSpecialChars(),
      history(),
      foldGutter(),
      drawSelection(),
      rectangularSelection(),
      crosshairCursor(),
      indentOnInput(),
      bracketMatching(),
      highlightSelectionMatches(),
      wordWrapCompartment.of(EditorView.lineWrapping),
      fontSizeCompartment.of(fontSizeTheme(14)),
      fontFamilyCompartment.of(fontFamilyTheme("")),
      themeCompartment.of([
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      ]),
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
        if (update.docChanged && onChange) {
          onChange(update.state.doc.toString());
        }
        if (update.selectionSet && onCursorChange) {
          const pos = update.state.selection.main.head;
          const line = update.state.doc.lineAt(pos);
          onCursorChange(line.number, pos - line.from + 1);
        }
      }),
    ],
  });

  const view = new EditorView({ state, parent });
  return view;
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
  view.dispatch({
    effects: themeCompartment.reconfigure(
      enabled
        ? [oneDark]
        : [syntaxHighlighting(defaultHighlightStyle, { fallback: true })]
    ),
  });
}

export function setLineNumbers(view, show) {
  view.dispatch({
    effects: lineNumbersCompartment.reconfigure(
      show ? lineNumbers() : []
    ),
  });
}

export function setWordWrap(view, enabled) {
  view.dispatch({
    effects: wordWrapCompartment.reconfigure(
      enabled ? EditorView.lineWrapping : []
    ),
  });
}

export function setFontSize(view, size) {
  view.dispatch({
    effects: fontSizeCompartment.reconfigure(fontSizeTheme(size)),
  });
}

export function setFontFamily(view, family) {
  view.dispatch({
    effects: fontFamilyCompartment.reconfigure(fontFamilyTheme(family)),
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

export function getWordCount(view) {
  const text = view.state.doc.toString().trim();
  if (!text) return { words: 0, chars: 0 };
  return {
    words: text.split(/\s+/).length,
    chars: text.length,
  };
}
