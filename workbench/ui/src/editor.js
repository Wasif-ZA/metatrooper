import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection, layer, RectangleMarker } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { indentOnInput, bracketMatching, syntaxHighlighting, HighlightStyle, indentUnit } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { search, searchKeymap } from '@codemirror/search';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { python } from '@codemirror/lang-python';
import { tags as t } from '@lezer/highlight';

const RULERS = [80, 100, 120];
const PY = ['py', 'pyw', 'pyi'];

const outline = '1px solid var(--hairline-strong)';

const ourosTheme = EditorView.theme({
  '&': { height: '100%', background: 'var(--pane)', color: 'var(--body-strong)', font: '13px/20px var(--mono)' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '20px' },
  '.cm-content': { caretColor: 'var(--ink)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink)' },
  '.cm-gutters': { background: 'var(--pane)', color: 'var(--faint)', border: 'none', minWidth: '46px' },
  '.cm-lineNumbers': { minWidth: '46px' },
  '.cm-lineNumbers .cm-gutterElement': { textAlign: 'right', paddingRight: '16px', paddingLeft: '8px', boxSizing: 'border-box', opacity: '0.6' },
  '.cm-activeLine': { background: 'var(--canvas)' },
  '.cm-activeLineGutter': { background: 'var(--canvas)', opacity: '1', color: 'var(--body-strong)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': { background: 'var(--canvas-soft)' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': { background: 'none', outline },
  '.cm-searchMatch, .cm-searchMatch-selected': { background: 'none', outline },
  '.cm-panels': { background: 'var(--canvas)', color: 'var(--body-strong)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--hairline)' },
  '.cm-panel input, .cm-panel button': { borderRadius: '0', border: '1px solid var(--hairline)', background: 'var(--canvas-deep)', color: 'var(--ink)', backgroundImage: 'none' },
  '.cm-ruler': { background: 'var(--hairline)', pointerEvents: 'none' },
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
  if (PY.includes(ext)) return python();
  return [];
}

const ext = (path) => path.split('.').pop().toLowerCase();
const wrap = new Compartment();
const wrapped = (state) => wrap.get(state) === EditorView.lineWrapping;

const rulers = layer({
  above: false,
  class: 'cm-rulers',
  update: (u) => u.geometryChanged || u.viewportChanged || u.transactions.some((tr) => tr.reconfigured),
  markers(view) {
    if (wrapped(view.state)) return [];
    const start = view.coordsAtPos(view.viewport.from);
    if (!start) return [];
    const textLeft = start.left - (view.scrollDOM.getBoundingClientRect().left - view.scrollDOM.scrollLeft * view.scaleX);
    const height = Math.max(view.contentHeight, view.scrollDOM.clientHeight) * view.scaleY;
    return RULERS.map((n) => new RectangleMarker('cm-ruler', textLeft + n * view.defaultCharacterWidth * view.scaleX, 0, view.scaleX, height));
  },
});

const toggleWrap = (view) => (view.dispatch({ effects: wrap.reconfigure(wrapped(view.state) ? [] : EditorView.lineWrapping) }), true);

const findKeys = searchKeymap.filter((k) => k.key !== 'Mod-g' && k.key !== 'Shift-Mod-g');

export function editorState(text, path, on) {
  const tabs = text.split('\n', 200).some((l) => l.startsWith('\t'));
  const py = PY.includes(ext(path));
  return EditorState.create({
    doc: text,
    extensions: [
      text.includes('\r\n') ? EditorState.lineSeparator.of('\r\n') : [],
      lineNumbers(), highlightActiveLine(), highlightActiveLineGutter(), drawSelection(), history(), indentOnInput(), bracketMatching(), closeBrackets(),
      EditorState.tabSize.of(tabs || py ? 4 : 2),
      indentUnit.of(tabs ? '\t' : py ? '    ' : '  '),
      wrap.of(['md', 'markdown', 'mdx', 'txt'].includes(ext(path)) ? EditorView.lineWrapping : []),
      rulers,
      search({ top: true }),
      language(path),
      syntaxHighlighting(ourosHighlight),
      ourosTheme,
      EditorView.updateListener.of((u) => {
        if (u.docChanged) on.change();
        if ((u.selectionSet || u.docChanged) && on.selection) {
          const head = u.state.selection.main.head;
          const line = u.state.doc.lineAt(head);
          on.selection({ line: line.number, col: head - line.from + 1 });
        }
      }),
      keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (on.save(), true) }, { key: 'Alt-z', preventDefault: true, run: toggleWrap }, ...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...findKeys, indentWithTab]),
    ],
  });
}

export function openEditor(parent, textOrState, path, on) {
  const state = textOrState instanceof EditorState ? textOrState : editorState(textOrState, path, on);
  return new EditorView({ state, parent });
}
