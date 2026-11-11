const PY = ['py', 'pyw', 'pyi'];
const LANG = {
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript', ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  json: 'json', md: 'markdown', css: 'css', html: 'html', py: 'python', pyw: 'python', pyi: 'python',
};
const WORKERS = { json: 'json', css: 'css', html: 'html', typescript: 'ts', javascript: 'ts' };
const SEVERITY = { 8: 'error', 4: 'warning', 2: 'info', 1: 'hint' };

const ext = (path) => path.split('.').pop().toLowerCase();
const langOf = (path) => LANG[ext(path)] || 'plaintext';

let monaco = null;
let loading = null;
const waiting = [];
let seq = 0;

// A tab's text: plain until Monaco loads, then a model that keeps undo across remounts.
class Doc {
  constructor(text, path, on) { this.text = text.replace(/\r\n?/g, '\n'); this.path = path; this.on = on; this.model = null; this.view = null; }
  sliceDoc() { return this.model ? this.model.getValue() : this.text; }
  dispose() { this.model?.dispose(); this.model = null; }
}

export const editorState = (text, path, on) => new Doc(text, path, on);

let preloaded = false;
// Once per session, after the Editor screen's next frame, when the renderer is idle.
export function preloadMonaco() {
  if (preloaded || loading || typeof requestIdleCallback !== 'function') return;
  preloaded = true;
  requestAnimationFrame(() => requestIdleCallback(() => { if (!loading) loadMonaco().catch(() => {}); }));
}

export function loadMonaco() {
  return loading ||= new Promise((resolve, reject) => {
    // getWorker, not getWorkerUrl: the URL path wraps workers in blob: URLs, which the page CSP refuses
    globalThis.MonacoEnvironment = { getWorker: (_, label) => new Worker(`monaco/${WORKERS[label] || 'editor'}.worker.js`, { name: label }) };
    const link = Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'monaco/monaco.css' });
    const script = Object.assign(document.createElement('script'), { src: 'monaco/monaco.js' });
    script.onload = () => { resolve(setup(globalThis.ccMonaco)); for (const f of waiting.splice(0)) f(monaco); };
    script.onerror = () => { loading = null; reject(new Error('The editor did not load.')); };
    document.head.append(link, script);
  });
}

function setup(m) {
  monaco = m;
  for (const d of [m.typescript.typescriptDefaults, m.typescript.javascriptDefaults]) {
    d.setDiagnosticsOptions({ noSemanticValidation: true });
    d.setCompilerOptions({ ...d.getCompilerOptions(), jsx: m.typescript.JsxEmit.Preserve, allowJs: true, allowNonTsExtensions: true });
  }
  theme();
  let queued = false;
  const again = () => { if (!queued) { queued = true; requestAnimationFrame(() => { queued = false; theme(); }); } };
  new MutationObserver(again).observe(document.documentElement, { attributes: true });
  return m;
}

function theme() {
  const probe = document.createElement('span');
  (document.getElementById('ide') || document.body).append(probe);
  const ctx = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }).getContext('2d', { willReadFrequently: true });
  const hex = (name) => {
    probe.style.color = `var(${name})`;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = getComputedStyle(probe).color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return '#' + (a === 255 ? [r, g, b] : [r, g, b, a]).map((x) => x.toString(16).padStart(2, '0')).join('');
  };
  const c = Object.fromEntries(['pane', 'body', 'body-strong', 'faint', 'mute', 'canvas', 'canvas-soft', 'canvas-deep', 'ink', 'hairline', 'hairline-strong',
    'syn-keyword', 'syn-string', 'syn-number', 'syn-fn', 'syn-type', 'del', 'add-bg', 'del-bg'].map((k) => [k, hex(`--${k}`)]));
  probe.remove();
  const fg = (k) => c[k].slice(1, 7);
  const dark = parseInt(fg('pane').slice(0, 2), 16) + parseInt(fg('pane').slice(2, 4), 16) + parseInt(fg('pane').slice(4, 6), 16) < 384;
  monaco.editor.defineTheme('cc', {
    base: dark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: !dark ? [] : [
      { token: 'keyword', foreground: '569cd6' },
      { token: 'keyword.control', foreground: 'c586c0' },
      { token: 'string', foreground: 'ce9178' },
      { token: 'number', foreground: 'b5cea8' },
      { token: 'comment', foreground: '6a9955' },
      { token: 'function', foreground: 'dcdcaa' },
      { token: 'type', foreground: '4ec9b0' },
      { token: 'variable', foreground: '9cdcfe' },
      { token: 'property', foreground: '9cdcfe' },
      { token: 'identifier', foreground: '9cdcfe' },
      { token: 'type.identifier', foreground: '4ec9b0' },
      { token: 'delimiter', foreground: 'd4d4d4' },
    ],
    colors: {
      'editor.background': c.pane, 'editor.foreground': dark ? c['body-strong'] : c.ink, 'editorGutter.background': c.pane,
      'editorLineNumber.foreground': c.faint, 'editorLineNumber.activeForeground': c['body-strong'],
      'editor.lineHighlightBackground': c.canvas, 'editor.lineHighlightBorder': c.canvas,
      'editorCursor.foreground': c.ink, 'editor.selectionBackground': c['canvas-soft'], 'editor.inactiveSelectionBackground': c['canvas-soft'],
      'editorRuler.foreground': c.hairline, 'editorIndentGuide.background1': c.hairline, 'editorWhitespace.foreground': c.hairline,
      'editorBracketMatch.background': '#00000000', 'editorBracketMatch.border': c['hairline-strong'],
      'editor.findMatchBackground': '#00000000', 'editor.findMatchBorder': c['hairline-strong'], 'editor.findMatchHighlightBorder': c.hairline,
      'editorWidget.background': c.canvas, 'editorWidget.border': c.hairline, 'editorHoverWidget.background': c.canvas, 'editorHoverWidget.border': c.hairline,
      'input.background': c['canvas-deep'], 'input.foreground': c.ink, 'input.border': c.hairline, 'focusBorder': c['hairline-strong'],
      'diffEditor.insertedLineBackground': '#9bb95533', 'diffEditor.removedLineBackground': '#ff000033',
      'diffEditor.insertedTextBackground': '#9ccc2c66', 'diffEditor.removedTextBackground': '#ff000066',
      'editorBracketHighlight.foreground1': c.body, 'editorBracketHighlight.foreground2': c.body, 'editorBracketHighlight.foreground3': c.body, 'diffEditor.diagonalFill': c.hairline, 'diffEditorGutter.insertedLineBackground': '#9bb95533', 'diffEditorGutter.removedLineBackground': '#ff000033',
      ...(dark ? {
        'scrollbarSlider.background': '#79797933', 'scrollbarSlider.hoverBackground': '#64646459', 'scrollbarSlider.activeBackground': '#bfbfbf66',
        'editorOverviewRuler.border': '#00000000', 'diffEditorOverview.insertedForeground': '#9bb95580', 'diffEditorOverview.removedForeground': '#ff000080',
      } : {}),
    },
  });
  monaco.editor.setTheme('cc');
}

const options = (path) => ({
  theme: 'cc', automaticLayout: true, bracketPairColorization: { enabled: false }, rulers: [], minimap: { enabled: false }, scrollBeyondLastLine: false, fixedOverflowWidgets: true,
  fontFamily: "Consolas, 'Cascadia Mono', 'Courier New', monospace", fontSize: 14, lineHeight: 19, letterSpacing: 0,
  wordWrap: ['md', 'markdown', 'mdx', 'txt'].includes(ext(path)) ? 'on' : 'off',
});

function attach(doc) {
  if (doc.model) return doc.model;
  doc.model = monaco.editor.createModel(doc.text, langOf(doc.path), monaco.Uri.from({ scheme: 'file', path: `/${++seq}/${doc.path}` }));
  doc.model.setEOL(monaco.editor.EndOfLineSequence.LF);
  const tabs = doc.text.split('\n', 200).some((l) => l.startsWith('\t'));
  doc.model.updateOptions({ tabSize: tabs || PY.includes(ext(doc.path)) ? 4 : 2, insertSpaces: !tabs });
  doc.model.onDidChangeContent(() => doc.on.change());
  return doc.model;
}

// Ctrl+K and Ctrl+G belong to the app; hand them past the editor
function appKeys(parent) {
  parent.addEventListener('keydown', (e) => {
    if (!e.ctrlKey || e.shiftKey || e.altKey || !/^[kg]$/i.test(e.key)) return;
    e.stopPropagation();
    e.preventDefault();
    parent.parentElement?.dispatchEvent(new KeyboardEvent('keydown', { key: e.key, code: e.code, ctrlKey: true, bubbles: true }));
  }, true);
}

export function openEditor(parent, textOrState, path, on) {
  let doc = textOrState instanceof Doc ? textOrState : editorState(textOrState, path, on);
  let ed = null, dead = false, line = null, focus = false;
  const show = (n) => { ed.setPosition({ lineNumber: n, column: 1 }); ed.revealLineInCenter(n); ed.focus(); };
  appKeys(parent);
  loadMonaco().then((m) => {
    if (dead) return;
    ed = m.editor.create(parent, { ...options(path), model: attach(doc) });
    if (doc.view) ed.restoreViewState(doc.view);
    ed.onDidChangeCursorPosition((e) => on.selection?.({ line: e.position.lineNumber, col: e.position.column }));
    // addAction, not addCommand: a command keybinding is global and fires for the last editor that added it
    ed.addAction({ id: 'cc.save', label: 'Save', keybindings: [m.KeyMod.CtrlCmd | m.KeyCode.KeyS], run: () => on.save() });
    ed.addAction({ id: 'cc.wrap', label: 'Toggle word wrap', keybindings: [m.KeyMod.Alt | m.KeyCode.KeyZ], run: () => ed.updateOptions({ wordWrap: ed.getRawOptions().wordWrap === 'on' ? 'off' : 'on' }) });
    if (line) show(line); else if (focus) ed.focus();
  }, () => {});
  return {
    get state() { return doc; },
    setState(next) {
      if (next === doc) return;
      const old = doc;
      doc = next;
      if (ed) ed.setModel(attach(doc));
      old.dispose();
    },
    focus() { if (ed) ed.focus(); else focus = true; },
    goto(n) { if (ed) show(n); else line = n; },
    pos() { const p = ed?.getPosition(); return p ? { line: p.lineNumber, col: p.column } : { line: 1, col: 1 }; },
    destroy() { dead = true; if (ed) { doc.view = ed.saveViewState(); ed.dispose(); } },
  };
}

// A placed view zone stays only while its key, height, side and line all still match.
export const sameZone = (key, z, x) => x.key === key && x.height === z.height && x.side === z.side && x.line === z.line;

// hooks.onLine({ side, line, excerpt }) fires on a glyph-margin click; hooks.onMove fires when lines shift on screen.
export function openDiff(parent, sides, path, hooks = {}) {
  let ed = null, dead = false, models = [];
  const zones = new Map();
  const sideOf = (side) => (side === 'old' ? ed.getOriginalEditor() : ed.getModifiedEditor());
  appKeys(parent);
  loadMonaco().then((m) => {
    if (dead) return;
    models = [m.editor.createModel(sides.original, langOf(path)), m.editor.createModel(sides.modified, langOf(path))];
    ed = m.editor.createDiffEditor(parent, { ...options(path), readOnly: true, originalEditable: false, useInlineViewWhenSpaceIsLimited: true, renderSideBySideInlineBreakpoint: 900, renderOverviewRuler: true, glyphMargin: Boolean(hooks.onLine), renderMarginRevertIcon: false, renderIndicators: true, lineDecorationsWidth: 18, automaticLayout: true });
    ed.setModel({ original: models[0], modified: models[1] });
    ed.getOriginalEditor().updateOptions({ scrollbar: { vertical: 'hidden', verticalScrollbarSize: 0 } });
    for (const side of ['old', 'new']) {
      const e = sideOf(side);
      const plus = e.createDecorationsCollection();
      if (hooks.onLine) {
        e.onMouseMove((ev) => { const n = ev.target.position?.lineNumber; plus.set(n ? [{ range: new m.Range(n, 1, n, 1), options: { glyphMarginClassName: 'cc-line-plus' } }] : []); });
        e.onMouseLeave(() => plus.clear());
        e.onMouseDown((ev) => {
          const n = ev.target.position?.lineNumber;
          if (n && ev.target.type === m.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) hooks.onLine({ side, line: n, excerpt: e.getModel().getLineContent(n) });
        });
      }
      e.onDidScrollChange(() => hooks.onMove?.());
      e.onDidLayoutChange(() => hooks.onMove?.());
    }
    ed.onDidUpdateDiff(() => hooks.onMove?.());
    hooks.onMove?.();
  }, () => {});
  return {
    // Reserves blank space under lines; returns key -> spacer node so the caller can lay its own UI over it.
    zones(list) {
      if (!ed) return new Map();
      for (const [key, z] of zones) {
        if (list.some((x) => sameZone(key, z, x))) continue;
        z.editor.changeViewZones((a) => a.removeZone(z.id));
        zones.delete(key);
      }
      for (const x of list) {
        if (zones.has(x.key)) continue;
        const editor = sideOf(x.side);
        const node = document.createElement('div');
        let id;
        editor.changeViewZones((a) => { id = a.addZone({ afterLineNumber: x.line, heightInPx: x.height, domNode: node }); });
        zones.set(x.key, { id, editor, node, height: x.height, side: x.side, line: x.line });
      }
      return new Map([...zones].map(([k, z]) => [k, z.node]));
    },
    dispose() { dead = true; ed?.dispose(); for (const x of models) x.dispose(); },
  };
}

// Markers for open file tabs, for the Problems panel; empty until Monaco has loaded.
export function problems() {
  if (!monaco) return [];
  return monaco.editor.getModelMarkers({}).filter((x) => x.resource.scheme === 'file').map((x) => ({
    path: x.resource.path.replace(/^\/\d+\//, ''), line: x.startLineNumber, col: x.startColumn,
    severity: SEVERITY[x.severity] || 'info', message: x.message, source: x.source || x.owner,
  }));
}

export function onProblems(fn) {
  let off = null, dead = false;
  const sub = (m) => { if (!dead) off = m.editor.onDidChangeMarkers(() => fn(problems())); };
  if (monaco) sub(monaco); else waiting.push(sub);
  return () => { dead = true; off?.dispose(); };
}

// `base` with a one-file unified patch applied, or null when a context or removed line does not match.
export function applyPatch(base, patch) {
  const lines = base.replace(/\r\n?/g, '\n').split('\n');
  let nl = lines.at(-1) === '';
  if (nl) lines.pop();
  const out = [];
  let i = 0, prev = '', oldNoNl = false, newNoNl = false;
  for (const raw of patch.split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/.exec(raw);
    if (m) {
      const at = Number(m[1]) - (m[2] === '0' ? 0 : 1);
      if (at < i || at > lines.length) return null;
      out.push(...lines.slice(i, at));
      i = at;
      prev = '@';
      continue;
    }
    if (!prev) continue;
    const l = raw.replace(/\r$/, '');
    if (l[0] === '\\') { if (prev === '-') oldNoNl = true; else if (prev === '+' || prev === ' ') newNoNl = true; continue; }
    if (!/^[ +-]/.test(l)) continue;
    const s = l.slice(1);
    if (l[0] !== '+' && lines[i++] !== s) return null;
    if (l[0] !== '-') out.push(s);
    prev = l[0];
  }
  if (!prev) return null;
  out.push(...lines.slice(i));
  if (newNoNl) nl = false;
  else if (oldNoNl) nl = true;
  return out.join('\n') + (nl && out.length ? '\n' : '');
}

// Both sides of a one-file unified patch; `text` (the new side) fills the unchanged gaps when it matches.
export function patchSides(patch, text) {
  const hunks = [];
  for (const raw of patch.split('\n')) {
    const m = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(raw);
    if (m) hunks.push({ at: Number(m[1]) - (m[2] === '0' ? 0 : 1), lines: [] });
    else if (hunks.length && /^[ +-]/.test(raw)) hunks.at(-1).lines.push(raw.replace(/\r$/, ''));
  }
  if (!hunks.length) return null;
  const build = (fill) => {
    const old = [], mod = [];
    let i = 0;
    for (const h of hunks) {
      if (fill) {
        if (h.at < i || h.at > fill.length) return null;
        for (; i < h.at; i++) { old.push(fill[i]); mod.push(fill[i]); }
      }
      for (const l of h.lines) {
        const s = l.slice(1);
        if (l[0] !== '+') old.push(s);
        if (l[0] !== '-') { mod.push(s); if (fill && fill[i++] !== s) return null; }
      }
    }
    if (fill) { old.push(...fill.slice(i)); mod.push(...fill.slice(i)); }
    return { original: old.join('\n'), modified: mod.join('\n') };
  };
  return (typeof text === 'string' && build(text.replace(/\r\n?/g, '\n').split('\n'))) || build(null);
}
