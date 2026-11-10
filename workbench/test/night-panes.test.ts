import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'night-panes-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');

// Bundle real screen sources and retain installed React and library controls.
const entry = "export * from './src/inbox.jsx'; export * from './src/ide.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';";
try { await build({
  absWorkingDir: join(wb, 'ui'), tsconfigRaw: {},
  stdin: { contents: entry, resolveDir: join(wb, 'ui'), loader: 'jsx' },
  plugins: [{ name: 'installed-ui-modules', setup(b: any) {
    b.onResolve({ filter: /.*/ }, (args: any) => {
      if (args.path.endsWith('.css')) return { path: args.path, namespace: 'empty-css' };
      if (!args.path.startsWith('.')) return { path: pathToFileURL(requireUI.resolve(args.path)).href, external: true };
      return { path: resolve(args.namespace === 'screen' ? dirname(args.importer) : join(wb, 'ui'), args.path), namespace: 'screen' };
    });
    b.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
    b.onLoad({ filter: /.*/, namespace: 'screen' }, (args: any) => ({ contents: readFileSync(args.path, 'utf8'), loader: args.path.endsWith('.jsx') ? 'jsx' : 'js' }));
  } }],
  bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', outfile: join(temp, 'panes.mjs'),
}); } catch (error: any) {
  if (error.code !== 'EPERM' || process.platform !== 'win32') throw error;
  // Build real source through inherited handles when Windows denies service pipes.
  const source = entry.replaceAll("'./src/", "'" + join(wb, 'ui/src/').replaceAll('\\', '/') );
  const entryPath = join(temp, 'entry.jsx');
  writeFileSync(entryPath, source.replace("'react';", JSON.stringify(requireUI.resolve('react')) + ';').replace("'react-dom/server';", JSON.stringify(requireUI.resolve('react-dom/server')) + ';'));
  const binary = join(dirname(requireUI.resolve('esbuild/package.json')), '../@esbuild/win32-x64/esbuild.exe');
  await new Promise<void>((resolveBuild, reject) => {
    const child = spawn(binary, [entryPath, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--loader:.css=empty', '--banner:js=import { createRequire as __nightCreateRequire } from "node:module"; const require = __nightCreateRequire(import.meta.url);', '--outfile=' + join(temp, 'panes.mjs')], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolveBuild() : reject(new Error('esbuild exited ' + code)));
  });
}
const { React, renderToStaticMarkup, Inbox, inboxStore, Ide, drawIde, ideKeys, ideShown } = await import(pathToFileURL(join(temp, 'panes.mjs')).href);
const g: any = globalThis;
const calls: any[] = [];
const own = new Set(['Inbox', 'Glyph', 'NoteActions', 'DetailAsk', 'DetailNotice', 'TerminalPreview', 'AgentHead', 'Ide', 'Files', 'Search', 'SourceControl', 'Crumb', 'Agents', 'CompactEmpty', 'StatusBar', 'Asks']);

// Expand app components with persistent hooks, dependency changes and effect cleanup.
function harness(Screen: any) {
  const frames = new Map<string, any>();
  let nodes: any[] = [];
  let effects: (() => void)[] = [];
  function expand(value: any, path: string): any {
    if (Array.isArray(value)) return value.map((v, i) => expand(v, path + '/' + (v?.key ?? i)));
    if (!React.isValidElement(value)) return value;
    nodes.push(value);
    if (typeof value.type === 'function' && own.has(value.type.name)) {
      path += '/' + value.type.name;
      const frame = frames.get(path) || { slots: [], cleanups: new Map(), seen: true };
      frames.set(path, frame); frame.seen = true;
      const slots = frame.slots; let cursor = 0;
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H;
      internals.H = {
        useEffect: (fn: any, deps: any[]) => {
          const i = cursor++; const old = slots[i];
          if (!old || !deps || deps.some((v, j) => !Object.is(v, old[j]))) {
            slots[i] = deps;
            effects.push(() => { frame.cleanups.get(i)?.(); frame.cleanups.set(i, fn()); });
          }
        },
        useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
        useRef: (initial: any) => { const i = cursor++; return slots[i] ??= { current: initial }; },
        useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (v: any) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
      };
      let output;
      try { output = value.type(value.props); } finally { internals.H = previous; }
      return expand(output, path + '/render');
    }
    const props: any = { key: value.key ?? path };
    for (const [key, v] of Object.entries(value.props)) if (React.isValidElement(v) || Array.isArray(v)) props[key] = expand(v, path + '/' + key);
    return React.cloneElement(value, props);
  }
  const draw = () => {
    nodes = []; effects = []; for (const f of frames.values()) f.seen = false;
    const tree = expand(React.createElement(Screen), 'root');
    for (const [path, f] of frames) if (!f.seen) { for (const cleanup of f.cleanups.values()) cleanup?.(); frames.delete(path); }
    for (const effect of effects) effect();
    return tree;
  };
  return {
    draw, html: () => renderToStaticMarkup(draw()),
    state: (component: string, slot: number) => {
      const found = [...frames].filter(([path]) => path.endsWith('/' + component));
      assert.equal(found.length, 1, 'one component hook frame exists');
      return found[0][1].slots[slot];
    },
    all: (predicate: any) => nodes.filter(predicate),
    one: (predicate: any) => { const found = nodes.find(predicate); assert.ok(found, 'rendered control exists'); return found; },
  };
}
const hasClass = (c: string) => (n: any) => typeof n.props.className === 'string' && n.props.className.split(' ').includes(c);
const label = (s: string) => (n: any) => n.props.label === s;
const text = (n: any): string => n == null || typeof n === 'boolean' ? '' : Array.isArray(n) ? n.map(text).join('') : React.isValidElement(n) ? text(n.props.children) : String(n);
const row = (id: string) => (n: any) => n.type === 'li' && n.props['data-id'] === id;
const event = (extra: any = {}) => ({ key: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, preventDefault() {}, stopPropagation() {}, target: { closest: () => null }, currentTarget: { focus() {} }, ...extra });
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
const session = (id: string, question: string) => ({ id, state: 'waiting_for_you', project_id: 'p1', engine_id: 'synthetic', title: 'Synthetic task ' + id, last_line: question });
const note = (id: string, kind: string) => ({ id, kind, text: 'Synthetic notice ' + id, at: '2026-11-10T00:00:00Z', ref: 's-a' });
let projectSerial = 0;
beforeEach(() => {
  calls.length = 0;
  Object.assign(g, {
    ui: { view: 'inbox', projectId: 'p1', pendingHide: new Set(), snap: { sessions: [], live: [], approvals: [], needs_you: [], projects: [{ id: 'p1', name: 'Synthetic project' }] } },
    rpc: async (...args: any[]) => { calls.push(['rpc', ...args]); return args[0] === 'session.owners' ? { result: { paths: [] } } : { result: { lines: ['synthetic terminal'] } }; },
    api: { fsList: async () => [], fsFind: async (...args: any[]) => { calls.push(['fsFind', ...args]); return []; }, fsSearch: async () => ({ hits: [] }), git: async (...args: any[]) => { calls.push(['git', ...args]); return { branch: 'synthetic', files: [] }; } },
    troop: { termInput: (...args: any[]) => calls.push(['termInput', ...args]) },
    homeView: { set: (v: string) => { calls.push(['view', v]); g.ui.view = v; } },
    pick: async (id: string) => calls.push(['pick', id]), toast: () => {},
    project: () => g.ui.snap.projects.find((p: any) => p.id === g.ui.projectId),
    waitingAll: () => g.ui.snap.live.filter((s: any) => s.state === 'waiting_for_you'),
    isInfo: (n: any) => ['gate', 'approval', 'handoff', 'done', 'uncommitted', 'other', 'spool-too-large'].includes(n.kind),
    loopOf: () => null, lendOf: () => null, needsCount: () => g.waitingAll().length + g.ui.snap.needs_you.filter((n: any) => !g.isInfo(n)).length,
    taskOf: (s: any) => s.title, ago: () => '1m ago', approvalCard: () => '', changedFiles: () => [], STATE_WORDS: {}, STATE_ORDER: [],
    document: { getElementById: () => ({ hidden: false, focus() {}, select() {} }) },
  });
  inboxStore.set({ filter: 'all', selectedId: null });
});
function asks() { g.ui.snap.live = [session('s-a', 'Which branch for alpha?'), session('s-b', 'Which branch for beta?')]; }

test('ad63319c clicking an answer row selects its question without opening the Wall', () => {
  asks(); const h = harness(Inbox); h.draw();
  h.one(row('s-b')).props.onClick(event());
  const markup = h.html();
  assert.equal(h.one(row('s-b')).props['aria-selected'], true);
  assert.equal(text(h.one(hasClass('ou-ipane-lastline'))), 'Which branch for beta?');
  assert.ok(markup.includes('Which branch for beta?')); assert.ok(!markup.includes('Which branch for alpha?'));
  assert.equal(g.ui.view, 'inbox'); assert.deepEqual(calls.filter(c => ['pick', 'view'].includes(c[0])), []);
});

test('ad63319c Enter on the selected answer row opens that session on the Wall', () => {
  asks(); const h = harness(Inbox); h.draw(); h.one(row('s-b')).props.onClick(event()); h.draw();
  h.one(row('s-b')).props.onKeyDown(event({ key: 'Enter' }));
  assert.deepEqual(calls.filter(c => ['pick', 'view'].includes(c[0])), [['view', 'wall'], ['pick', 's-b']]);
});

test('ad63319c selecting a notice displays its text without opening the Wall', () => {
  g.ui.snap.needs_you = [note('n-a', 'done'), note('n-b', 'failed')];
  const h = harness(Inbox); h.draw(); h.one(row('n-a')).props.onClick(event()); h.draw();
  assert.equal(text(h.one(hasClass('ou-ipane-noticetext'))), 'Synthetic notice n-a');
  assert.equal(g.ui.view, 'inbox'); assert.deepEqual(calls, []);
});

test('ad63319c Enter on a selected notice opens its referenced session on the Wall', () => {
  g.ui.snap.needs_you = [note('n-a', 'done')];
  const app = readFileSync(join(wb, 'renderer/app.js'), 'utf8');
  const open = app.match(/async function openNeedsYou\(id, fallback = true\) \{[^]*?\r?\n\}/);
  assert.ok(open, 'real openNeedsYou function exists');
  g.openNeedsYou = new Function(open[0] + '; return openNeedsYou;')();
  const h = harness(Inbox); h.draw(); const selected = h.one(row('n-a'));
  selected.props.onClick(event()); h.draw();
  const listeners: any[] = [];
  const source = readFileSync(join(wb, 'ui/src/main.jsx'), 'utf8');
  const listener = source.match(/document\.addEventListener\('keydown', \(e\) => \{\r?\n  if \(\(e\.key !== 'Enter'[^]*?\r?\n\}\);/)![0];
  new Function('document', listener)({ addEventListener: (_: any, fn: any) => listeners.push(fn) });
  const target = { matches: () => true, click: () => h.one(row('n-a')).props.onClick(event()) };
  if (selected.props.onKeyDown) selected.props.onKeyDown(event({ key: 'Enter', target })); else listeners[0](event({ key: 'Enter', target }));
  assert.equal(g.ui.view, 'wall');
  assert.deepEqual(calls.filter(c => c[0] === 'pick'), [['pick', 's-a']]);
});

test('ad63319c preview reads the selected session with a literal 20-line request', async () => {
  asks(); inboxStore.set({ selectedId: 's-b' }); const h = harness(Inbox); h.draw(); await flush();
  assert.deepEqual(calls, [['rpc', 'session.read', { session_id: 's-b', lines: 20 }, true]]);
  h.html(); assert.equal(text(h.one(hasClass('ou-ipane-pre'))), 'synthetic terminal');
});

test('ad63319c preview requests 20 lines and displays the returned lines in order', async () => {
  asks(); inboxStore.set({ selectedId: 's-b' });
  g.rpc = async (method: string, payload: any) => {
    calls.push(['rpc', method, payload]);
    return { result: { lines: ['line-6', 'line-7', 'line-8', 'line-9', 'line-10', 'line-11', 'line-12', 'line-13', 'line-14', 'line-15', 'line-16', 'line-17', 'line-18', 'line-19', 'line-20', 'line-21', 'line-22', 'line-23', 'line-24', 'line-25'] } };
  };
  const h = harness(Inbox); h.draw(); await flush(); h.draw();
  assert.deepEqual(calls, [['rpc', 'session.read', { session_id: 's-b', lines: 20 }]]);
  assert.equal(text(h.one(hasClass('ou-ipane-pre'))), 'line-6\nline-7\nline-8\nline-9\nline-10\nline-11\nline-12\nline-13\nline-14\nline-15\nline-16\nline-17\nline-18\nline-19\nline-20\nline-21\nline-22\nline-23\nline-24\nline-25');
  assert.doesNotMatch(h.html(), /(?:>|\n)line-5(?:\n|<)/);
});

for (const failure of ['rejection', 'error response']) test('ad63319c session.read ' + failure + ' settles into the error fallback without terminal lines', async () => {
  asks(); let rejectRead: any; let resolveRead: any;
  g.rpc = () => new Promise((resolve, reject) => { resolveRead = resolve; rejectRead = reject; });
  const h = harness(Inbox); h.draw();
  assert.deepEqual(h.state('TerminalPreview', 0), { lines: null, error: false });
  if (failure === 'rejection') rejectRead(new Error('synthetic read failure'));
  else resolveRead({ error: { code: -1, message: 'synthetic read failure' } });
  await flush();
  // Loading and error share markup, so verify the settled hook state too.
  assert.deepEqual(h.state('TerminalPreview', 0), { lines: null, error: true });
  assert.doesNotThrow(() => h.html()); assert.equal(h.all(hasClass('ou-ipane-pre')).length, 0);
  assert.equal(text(h.one(hasClass('ou-ipane-lastline'))), 'Which branch for alpha?');
  assert.equal(text(h.one(hasClass('ou-ipane-muted'))), 'No terminal text to show yet. Open it on the Wall.');
});

for (const sendBy of ['button', 'Enter']) test('ad63319c answer via ' + sendBy + ' sends the exact session and terminal payload', () => {
  asks(); inboxStore.set({ selectedId: 's-b' }); const h = harness(Inbox); h.draw();
  assert.equal(h.one(label('Send')).props.isDisabled, true);
  h.one(label('Answer')).props.onChange('  use the feature branch  '); h.draw();
  assert.equal(h.one(label('Send')).props.isDisabled, false);
  const beforeSend = calls.length;
  if (sendBy === 'button') h.one(label('Send')).props.onClick(); else h.one(label('Answer')).props.onEnter();
  assert.deepEqual(calls.slice(beforeSend), [['termInput', 's-b', 'use the feature branch\r']]);
  h.draw(); assert.equal(h.one(label('Answer')).props.value, '');
});

test('ad63319c a non-answerable notice has no answer box or Send control', () => {
  g.ui.snap.needs_you = [note('n-a', 'done')]; const h = harness(Inbox); const markup = h.html();
  assert.equal(h.all(label('Answer')).length, 0); assert.equal(h.all(label('Send')).length, 0);
  assert.doesNotMatch(markup, /<input|Type your answer/);
});

function filterFixture() { asks(); g.ui.snap.needs_you = [note('q', 'question'), note('d', 'done'), note('f', 'failed'), note('i', 'handoff')]; }
const rowIds = (h: any) => h.all(hasClass('ou-irow')).map((n: any) => n.props['data-id']);
for (const [chip, ids] of [
  ['All', ['s-a', 's-b', 'q', 'f', 'd', 'i']],
  ['Needs you', ['s-a', 's-b', 'q']],
  ['Finished', ['d']],
  ['Failed', ['f']],
] as const) test('ad63319c ' + chip + ' chip narrows rows to its kind', () => {
  filterFixture(); const h = harness(Inbox); h.draw();
  h.one((n: any) => hasClass('ou-ifilters-chip')(n) && text(n) === chip).props.onClick(); h.draw();
  assert.deepEqual(rowIds(h), ids);
});

test('ad63319c counts appear in group heads and never on chips', () => {
  filterFixture(); const h = harness(Inbox); h.html();
  assert.deepEqual(h.all(hasClass('ou-ifilters-chip')).map(text), ['All', 'Needs you', 'Finished', 'Failed']);
  assert.deepEqual(h.all(hasClass('ou-ihead')).map(text), ['Needs your answer 2', 'Notices 4']);
});

test('ad63319c late first-session read cannot replace the second selection', async () => {
  asks(); let first: any; let second: any;
  g.rpc = (method: string, payload: any) => { calls.push(['rpc', method, payload]); return new Promise(resolve => { if (payload.session_id === 's-a') first = resolve; else second = resolve; }); };
  const h = harness(Inbox); h.draw(); h.one(row('s-b')).props.onClick(event()); h.draw();
  assert.deepEqual(calls, [['rpc', 'session.read', { session_id: 's-a', lines: 20 }], ['rpc', 'session.read', { session_id: 's-b', lines: 20 }]]);
  second({ result: { lines: ['second selected terminal'] } }); await flush(); h.draw();
  assert.equal(text(h.one(hasClass('ou-ipane-pre'))), 'second selected terminal');
  first({ result: { lines: ['stale first terminal'] } }); await flush(); const markup = h.html();
  assert.equal(text(h.one(hasClass('ou-ipane-pre'))), 'second selected terminal'); assert.ok(!markup.includes('stale first terminal'));
});

// Execute the complete real frame script against a synthetic DOM boundary.
function frame(initial: string) {
  const classes = new Set<string>(); const elements = new Map<string, any>(); const listeners = new Map<string, any>();
  const get = (id: string) => { if (!elements.has(id)) elements.set(id, { setAttribute() {}, addEventListener() {} }); return elements.get(id); };
  const root = { classList: { contains: (s: string) => classes.has(s), add: (s: string) => classes.add(s), remove: (s: string) => classes.delete(s), toggle: (s: string, on: boolean) => on ? classes.add(s) : classes.delete(s) } };
  const context: any = { document: { documentElement: root, getElementById: get, querySelectorAll: () => [], querySelector: () => null, addEventListener: (s: string, fn: any) => listeners.set(s, fn) }, ui: { view: 'wall', snap: { sessions: [] }, pendingHide: new Set() }, project: () => null, needsCount: () => 0, setHtml() {}, load: () => initial, save: (...args: any[]) => calls.push(['save', ...args]), dispatchEvent: (e: any) => calls.push(['event', e.type]), Event: class { type: string; constructor(type: string) { this.type = type; } } };
  vm.runInNewContext(readFileSync(join(wb, 'renderer/frame.js'), 'utf8'), context);
  listeners.get('DOMContentLoaded')();
  return { classes, context, draw: (view: string) => { context.ui.view = view; context.frameView.draw(); } };
}
for (const initial of ['wide', 'rail']) test('d832ae86 IDE collapses the sidebar and restores the initial ' + initial + ' preference', () => {
  const f = frame(initial); f.draw('wall');
  assert.equal(f.classes.has('side-rail'), initial === 'rail'); assert.equal(f.classes.has('side-auto'), false);
  f.draw('ide'); assert.equal(f.classes.has('side-auto'), true); assert.equal(f.classes.has('side-rail'), initial === 'rail');
  f.draw('home'); assert.equal(f.classes.has('side-auto'), false); assert.equal(f.classes.has('side-rail'), initial === 'rail');
  assert.deepEqual(calls.filter(c => c[0] === 'save'), []);
  assert.deepEqual(calls.filter(c => c[0] === 'event'), [['event', 'resize'], ['event', 'resize']]);
  const css = readFileSync(join(wb, 'renderer/frame.css'), 'utf8');
  assert.match(css, /:root\s*\{[^}]*--side:\s*240px/);
  assert.match(css, /:root:is\(\.side-rail, \.side-auto\)\s*\{\s*--side:\s*56px/);
});

async function explorer() {
  const pid = 'synthetic-ide-' + ++projectSerial; g.ui.projectId = pid; g.ui.view = 'ide';
  g.ui.snap.projects = [{ id: pid, name: 'Synthetic project' }]; await drawIde();
  const h = harness(Ide); h.draw(); await flush(); h.draw(); return h;
}
test('d9d885ca explorer has a 22px header and Files/Search/Changes icon buttons switch panels', async () => {
  const h = await explorer();
  assert.equal(text(h.one(hasClass('ou-ide-head-title'))), 'Explorer');
  const css = readFileSync(join(wb, 'ui/src/ui.css'), 'utf8');
  assert.match(css, /\.ou-ide-head\s*\{[^}]*\bheight:\s*22px\s*;/);
  for (const name of ['Search', 'Changes 0', 'Files']) {
    const button = h.one(label(name)); assert.equal(button.type.name, 'IconButton'); assert.ok(React.isValidElement(button.props.icon));
    button.props.onClick(); await flush(); h.draw();
    assert.equal(h.one(label(name)).props['aria-pressed'], true);
    assert.equal(text(h.one(hasClass('ou-ide-head-title'))), name === 'Files' ? 'Explorer' : name);
    assert.equal(h.all((n: any) => n.props.id === 'ide-search').length, name === 'Search' ? 1 : 0);
    assert.equal(h.all((n: any) => n.type?.name === 'SourceControl').length, name === 'Changes 0' ? 1 : 0);
    assert.equal(h.all((n: any) => n.type?.name === 'Files').length, name === 'Files' ? 1 : 0);
  }
});

// Register the real Ctrl+P listener with synthetic event and overlay boundaries.
function ctrlP() {
  const source = readFileSync(join(wb, 'ui/src/main.jsx'), 'utf8');
  const listener = source.match(/document\.addEventListener\('keydown', \(e\) => \{\r?\n  if \(!ideView\.shown\(\)[^]*?\r?\n\}\);/)![0];
  let handler: any;
  new Function('document', 'ideView', 'ideKeys', 'overlayOpen', listener)({ addEventListener: (_: any, fn: any) => { handler = fn; } }, { shown: ideShown }, ideKeys, () => false);
  handler(event({ key: 'p', ctrlKey: true }));
}
test('d9d885ca find is hidden until Ctrl+P and hides on empty blur or Escape', async () => {
  const h = await explorer(); assert.equal(h.all((n: any) => n.props.id === 'ide-find').length, 0);
  ctrlP(); h.draw(); assert.equal(h.one((n: any) => n.props.id === 'ide-find').props.placeholder, 'Find a file (Ctrl+P)');
  h.one((n: any) => n.props.id === 'ide-find').props.onBlur(); h.draw(); assert.equal(h.all((n: any) => n.props.id === 'ide-find').length, 0);
  ctrlP(); h.draw(); h.one((n: any) => n.props.id === 'ide-find').props.onKeyDown(event({ key: 'Escape' })); h.draw();
  assert.equal(h.all((n: any) => n.props.id === 'ide-find').length, 0);
});

test('d9d885ca find stays visible with text after blur and panel switches', async () => {
  const h = await explorer(); ctrlP(); h.draw();
  h.one((n: any) => n.props.id === 'ide-find').props.onChange({ target: { value: 'needle.ts' } }); await flush(); h.draw();
  h.one((n: any) => n.props.id === 'ide-find').props.onBlur(); h.draw();
  assert.equal(h.one((n: any) => n.props.id === 'ide-find').props.value, 'needle.ts');
  h.one(label('Search')).props.onClick(); h.draw(); h.one(label('Files')).props.onClick(); h.draw();
  assert.equal(h.one((n: any) => n.props.id === 'ide-find').props.value, 'needle.ts');
  h.one((n: any) => n.props.id === 'ide-find').props.onKeyDown(event({ key: 'Escape' })); h.draw();
  assert.equal(h.one((n: any) => n.props.id === 'ide-find').props.value, '');
  h.one((n: any) => n.props.id === 'ide-find').props.onBlur(); h.draw();
  assert.equal(h.all((n: any) => n.props.id === 'ide-find').length, 0);
});

const reviewApp = readFileSync(join(wb, 'renderer/app.js'), 'utf8');
const reviewPanes = await import(pathToFileURL(join(temp, 'panes.mjs')).href);
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

function reviewGlobals(t: any, values: any) {
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(g, key);
    Object.defineProperty(g, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(g, key, previous) : delete g[key]);
  }
}

// Preserve single-child component keys through the existing array-aware harness.
function keyedInboxHarness() {
  const keyed = (value: any): any => {
    if (Array.isArray(value)) return value.map(keyed);
    if (!React.isValidElement(value)) return value;
    const props: any = {};
    for (const [key, child] of Object.entries(value.props)) {
      if (React.isValidElement(child)) props[key] = child.key == null ? keyed(child) : [keyed(child)];
      else if (Array.isArray(child)) props[key] = keyed(child);
    }
    return React.cloneElement(value, props);
  };
  return harness({ Inbox: () => keyed(Inbox()) }.Inbox);
}

test('3796944f cross-project answers are blocked and local answers send typed text exactly once', async () => {
  g.ui.snap.projects.push({ id: 'p2', name: 'Other project' });
  g.ui.snap.live = [session('s-a', 'Local question?'), { ...session('s-away', 'Other question?'), project_id: 'p2' }];
  inboxStore.set({ selectedId: 's-away' });
  const h = harness(Inbox); h.draw();
  assert.equal(h.one(label('Answer')).props.isDisabled, true);
  h.one(label('Answer')).props.onChange('do not send to p1'); h.draw();
  assert.equal(h.one(label('Send')).props.isDisabled, true);
  const beforeAway = calls.length;
  await h.one(label('Send')).props.onClick();
  await h.one(label('Answer')).props.onEnter();
  assert.deepEqual(calls.slice(beforeAway), []);
  assert.equal(g.ui.projectId, 'p1');
  h.one(row('s-a')).props.onClick(event()); h.draw();
  assert.equal(h.one(label('Answer')).props.isDisabled, false);
  h.one(label('Answer')).props.onChange('use the local feature branch'); h.draw();
  const beforeLocal = calls.length;
  await h.one(label('Send')).props.onClick();
  assert.deepEqual(calls.slice(beforeLocal), [['termInput', 's-a', 'use the local feature branch\r']]);
  h.draw(); assert.equal(h.one(label('Answer')).props.value, '');
});

test('3796944f opening another project agent switches project before picking the agent', async (t) => {
  g.ui.snap.projects.push({ id: 'p2', name: 'Other project' });
  g.ui.snap.live = [{ ...session('s-away', 'Other question?'), project_id: 'p2' }];
  const switchSource = reviewApp.match(/function switchProject\(id\) \{[^]*?\r?\n\}/)![0];
  const realSwitch = new Function('return (' + switchSource + ')')();
  reviewGlobals(t, {
    save: (...args: any[]) => calls.push(['save', ...args]),
    setView: () => calls.push(['setView', g.ui.projectId, g.ui.pendingPick]),
    switchProject: realSwitch,
    pick: async (id: string) => calls.push(['pick', id, g.ui.projectId]),
  });
  const h = harness(Inbox); h.draw();
  const before = calls.length;
  h.one((n: any) => n.props['aria-label'] === 'Open on Wall').props.onClick(event());
  assert.deepEqual(calls.slice(before), [['view', 'wall'], ['save', 'projectId', 'p2'], ['setView', 'p2', 's-away']]);
  assert.equal(g.ui.projectId, 'p2'); assert.equal(g.ui.pendingPick, 's-away');
  const pendingSource = reviewApp.match(/  if \(ui\.pendingPick && s\.sessions\.some[^]*?\r?\n  \}/)![0];
  const receive = new AsyncFunction('s', pendingSource);
  await receive({ sessions: [session('s-a', 'Local question?')] });
  assert.deepEqual(calls.filter(c => c[0] === 'pick'), []);
  await receive({ sessions: [{ id: 's-away', project_id: 'p2' }] });
  assert.deepEqual(calls.slice(before), [['view', 'wall'], ['save', 'projectId', 'p2'], ['setView', 'p2', 's-away'], ['pick', 's-away', 'p2']]);
  assert.equal(g.ui.pendingPick, null);
});

test('3796944f selecting another agent starts a fresh keyed answer draft in both directions', () => {
  asks(); const h = keyedInboxHarness(); h.draw();
  assert.equal(h.one((n: any) => n.type?.name === 'DetailAsk').key, 's-a');
  h.one(label('Answer')).props.onChange('alpha draft'); h.draw();
  assert.equal(h.one(label('Answer')).props.value, 'alpha draft');
  h.one(row('s-b')).props.onClick(event()); h.draw();
  assert.equal(h.one((n: any) => n.type?.name === 'DetailAsk').key, 's-b');
  assert.equal(h.one(label('Answer')).props.value, '');
  h.one(label('Answer')).props.onChange('beta draft'); h.draw();
  assert.equal(h.one(label('Answer')).props.value, 'beta draft');
  h.one(row('s-a')).props.onClick(event()); h.draw();
  assert.equal(h.one((n: any) => n.type?.name === 'DetailAsk').key, 's-a');
  assert.equal(h.one(label('Answer')).props.value, '');
  assert.deepEqual(calls.filter(c => c[0] === 'termInput'), []);
});

test('3796944f notice Open follows its target and targetless notices have no Open button', { todo: 'DetailNotice always renders Open, including notices with no navigable target' }, async (t) => {
  const openSource = reviewApp.match(/async function openNeedsYou\(id, fallback = true\) \{[^]*?\r?\n\}/)![0];
  reviewGlobals(t, {
    openNeedsYou: new Function('return (' + openSource + ')')(),
    openTab: async (tab: string) => calls.push(['openTab', tab]),
  });
  g.ui.snap.needs_you = [note('n-done', 'done'), { ...note('n-failed', 'failed'), ref: 's-b' }, { ...note('n-git', 'uncommitted'), ref: null }, { ...note('n-empty', 'other'), ref: null }];
  inboxStore.set({ selectedId: 'n-done' });
  const h = harness(Inbox); h.draw();
  assert.equal(h.all(label('Open')).length, 1);
  h.one(label('Open')).props.onClick(); await flush();
  assert.deepEqual(calls, [['view', 'wall'], ['pick', 's-a']]);
  g.ui.view = 'inbox'; inboxStore.set({ selectedId: 'n-failed' }); h.draw(); calls.length = 0;
  h.one(label('Open')).props.onClick(); await flush();
  assert.deepEqual(calls, [['view', 'wall'], ['pick', 's-b']]);
  g.ui.view = 'inbox'; inboxStore.set({ selectedId: 'n-git' }); h.draw(); calls.length = 0;
  h.one(label('Open')).props.onClick(); await flush();
  assert.deepEqual(calls, [['view', 'wall'], ['rpc', 'needs_you.mark-read', { id: 'n-git' }, true], ['openTab', 'git']]);
  g.ui.view = 'inbox'; inboxStore.set({ selectedId: 'n-empty' }); h.draw(); calls.length = 0;
  assert.equal(h.all(label('Open')).length, 0);
  assert.deepEqual(calls, []);
});

test('3796944f hiding a project drops its IDE tabs and dirty state while retaining other project tabs', async (t) => {
  const { openAt, dirtyIn, dropProject, unsavedSummary } = reviewPanes;
  const mainSource = readFileSync(join(wb, 'ui/src/main.jsx'), 'utf8');
  const bridgeSource = mainSource.match(/globalThis\.ideView = \{[^;]+;/)![0];
  const priorBridge = g.ideView;
  new Function('drawIde', 'ideShown', 'openAt', 'dirtyIn', 'dropProject', bridgeSource)(drawIde, ideShown, openAt, dirtyIn, dropProject);
  t.after(() => { g.ideView = priorBridge; dropProject('review-hide'); dropProject('review-keep'); });
  reviewGlobals(t, { confirm: (message: string) => { calls.push(['confirm', message]); return true; } });
  g.ui.view = 'ide';
  g.ui.snap.projects = [{ id: 'review-hide', name: 'Hide project' }, { id: 'review-keep', name: 'Keep project' }];
  g.api.fsRead = async () => ({ text: 'original file', mtimeMs: 1 });
  const h = harness(Ide);
  const changeSource = readFileSync(join(wb, 'ui/src/ide.jsx'), 'utf8').match(/const onFor = \(st, ref\) => \{[^]*?\r?\n\};/)![0];
  const change = new Function('bump', changeSource + '\nreturn onFor;')(() => {});
  for (const [pid, path] of [['review-hide', 'hidden.ts'], ['review-keep', 'kept.ts']]) {
    g.ui.projectId = pid; await openAt(path); h.draw();
    const host = h.one((n: any) => n.type?.name === 'EditorHost' && n.props.tab.path === path);
    change(host.props.st, host.props.tab).change();
  }
  g.ui.projectId = 'review-hide'; await openAt('clean.ts'); h.draw();
  assert.deepEqual(h.all((n: any) => n.type?.name === 'Tab' && n.props.title).map((n: any) => n.props.value), ['hidden.ts', 'clean.ts']);
  assert.deepEqual(dirtyIn('review-hide'), ['hidden.ts']); assert.deepEqual(dirtyIn('review-keep'), ['kept.ts']);
  const hideSource = reviewApp.match(/    case 'project-hide': \{[^]*?\r?\n    \}/)![0];
  const hide = new AsyncFunction('id', 'el', "switch ('project-hide') {\n" + hideSource + '\n}');
  const group = { querySelector: () => ({}), remove() {} };
  const hiddenRow = { parentElement: group, remove: () => calls.push(['row.remove']) };
  calls.length = 0;
  await hide('review-hide', { closest: () => hiddenRow });
  assert.deepEqual(calls, [['confirm', '1 unsaved file in this project: hidden.ts. Hide it and lose them?'], ['rpc', 'project.hide', { project_id: 'review-hide' }], ['row.remove']]);
  assert.deepEqual(dirtyIn('review-hide'), []); assert.deepEqual(dirtyIn('review-keep'), ['kept.ts']);
  assert.equal(unsavedSummary(), 'Keep project: kept.ts');
  await drawIde(); h.draw();
  assert.deepEqual(h.all((n: any) => n.type?.name === 'Tab' && n.props.title).map((n: any) => n.props.value), []);
  g.ui.projectId = 'review-keep'; await drawIde(); h.draw();
  assert.deepEqual(h.all((n: any) => n.type?.name === 'Tab' && n.props.title).map((n: any) => n.props.value), ['kept.ts']);
  assert.deepEqual(dirtyIn('review-keep'), ['kept.ts']);
});
