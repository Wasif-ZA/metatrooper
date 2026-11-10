import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentOnInput, bracketMatching, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap } from '@codemirror/search';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { tags as t } from '@lezer/highlight';

const outline = '1px solid var(--hairline-strong)';

const ourosTheme = EditorView.theme({
  '&': { height: '100%', background: 'var(--pane)', color: 'var(--body-strong)', font: '13px/20px var(--mono)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '20px' },
  '.cm-content': { caretColor: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '.cm-gutters': { background: 'var(--pane)', color: 'var(--faint)', border: 'none' },
  '.cm-activeLine': { background: 'var(--canvas)' },
  '.cm-activeLineGutter': { background: 'var(--canvas)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { background: 'var(--canvas-soft)' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { background: 'none', outline },
  '.cm-searchMatch, .cm-searchMatch-selected': { background: 'none', outline },
  '.cm-panels': { background: 'var(--canvas)', color: 'var(--body-strong)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--hairline)' },
  '.cm-panel input, .cm-panel button': { borderRadius: '0', border: '1px solid var(--hairline)', background: 'var(--canvas-deep)', color: 'var(--ink)', backgroundImage: 'none' },
}, { dark: true });

const ourosHighlight = HighlightStyle.define([
  { tag: [t.keyword, t.controlKeyword, t.moduleKeyword, t.operatorKeyword, t.definitionKeyword, t.modifier], color: 'var(--syn-keyword)' },
  { tag: [t.string, t.special(t.string), t.regexp, t.monospace], color: 'var(--syn-string)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-number)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.tagName, t.link, t.url], color: 'var(--syn-fn)' },
  { tag: [t.typeName, t.className, t.namespace, t.attributeName, t.propertyName], color: 'var(--syn-type)' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: 'var(--faint)' },
  { tag: [t.punctuation, t.operator, t.bracket, t.separator], color: 'var(--body)' },
  { tag: t.heading, color: 'var(--ink)', fontWeight: '600' },
  { tag: t.strong, fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.invalid, color: 'var(--del)' },
]);

function language(path) {
  const ext = path.split('.').pop().toLowerCase();
  if (['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(ext)) return javascript({ jsx: true, typescript: true });
  if (ext === 'json') return json();
  if (ext === 'md') return markdown();
  if (ext === 'css') return css();
  if (ext === 'html') return html();
  return [];
}

const findKeys = searchKeymap.filter((k) => k.key !== 'Mod-g' && k.key !== 'Shift-Mod-g');

export function editorState(text, path, on) {
  return EditorState.create({
    doc: text,
    extensions: [
      text.includes('\r\n') ? EditorState.lineSeparator.of('\r\n') : [],
      lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(), history(), indentOnInput(), bracketMatching(), closeBrackets(),
      EditorState.tabSize.of(2),
      search({ top: true }),
      language(path),
      syntaxHighlighting(ourosHighlight),
      ourosTheme,
      EditorView.updateListener.of((u) => { if (u.docChanged) on.change(); }),
      keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (on.save(), true) }, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...findKeys, indentWithTab]),
    ],
  });
}

export function openEditor(parent, textOrState, path, on) {
  const state = textOrState instanceof EditorState ? textOrState : editorState(textOrState, path, on);
  return new EditorView({ state, parent });
}
