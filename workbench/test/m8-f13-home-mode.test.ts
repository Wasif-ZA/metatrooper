import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';

// M8-F13a (Home, IDE and Wall keep their state across the switch) and M8-F13d (no ready engine: Add-ons card, no demo).
// F13e does not hold today: Home draws no waiting count or row, so there is nothing to compare with the inbox count.

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm8-f13-'));
after(() => { rmSync(temp, { recursive: true, force: true }); });
const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');
const src = (f: string) => readFileSync(new URL(`../renderer/${f}`, import.meta.url), 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
const g: any = globalThis;

/* Part 1: app.js with the real home.js and a recording wall; a round trip through the title-bar switch. */

function makeEl(id = '', tagName = 'DIV'): any {
  const classes = new Set<string>();
  const el: any = {
    id, tagName, hidden: false, innerHTML: '', textContent: '', value: '', className: '', title: '', dataset: {}, children: [] as any[], parent: null,
    style: { removeProperty() {}, setProperty() {} },
    classList: { [Symbol.iterator]: () => classes.values(), add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c), contains: (c: string) => classes.has(c), toggle: (c: string, f?: boolean) => { const on = f === undefined ? !classes.has(c) : f; if (on) classes.add(c); else classes.delete(c); return on; } },
    append: (...kids: any[]) => { for (const k of kids) if (typeof k === 'object') { k.parent = el; el.children.push(k); } },
    remove() {}, contains: () => false, addEventListener() {}, querySelector: () => null, querySelectorAll: () => [], closest: () => null,
    focus() {}, blur() {}, select() {}, scrollIntoView() {}, setSelectionRange() {},
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0, x: 0, y: 0, width: 0, height: 0 }),
  };
  return el;
}

function boot() {
  const els = new Map<string, any>();
  const d: any = {
    body: makeEl('body'), documentElement: makeEl('html'), activeElement: null, hidden: false, fonts: { load: () => Promise.resolve() },
    getElementById: (id: string) => { if (!els.has(id)) els.set(id, makeEl(id)); return els.get(id); },
    createElement: (tag: string) => makeEl('', tag.toUpperCase()), addEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
  };
  d.activeElement = d.body;
  for (const id of ['palette', 'inbox', 'sinks', 'menu', 'start']) d.getElementById(id).hidden = true;
  const handlers: Record<string, (...a: any[]) => any> = {};
  const api = new Proxy({}, { get: (_t, name: string) => {
    if (name.startsWith('on')) return (f: (...a: any[]) => any) => { handlers[name] = f; };
    if (name === 'call') return async (method: string) => ({ kind: 'ok', reply: { result: method === 'shell.list' ? { shells: [] } : {} } });
    if (name === 'git') return async () => ({ branch: 'main', changes: [], staged: [], log: '', ahead: 0, behind: 0 });
    if (name === 'uiSettings') return async () => ({ theme: {}, ui: { toast_ms: 3500, error_toast_ms: 7000, layout: {} }, terminal: { git_every_ms: 10000, scrollback: 1000, font_size: 13 }, themes: [] });
    return async () => undefined;
  } });
  const stored = new Map<string, string>();
  const wallCalls: string[] = [];
  const wall: any = new Proxy({ listOpen: () => false, sheetOpen: () => false, decide: (s: any[]) => (s[0] ? s[0].id : null), state: () => ({}), big: () => null, isBig: () => false, toggleOpen: () => false },
    { get: (t: any, k: string) => (k in t ? (...a: any[]) => { wallCalls.push(k); return t[k](...a); } : (..._a: any[]) => { wallCalls.push(k); }) });
  const termView: any = new Proxy({ state: () => null }, { get: (t: any, k: string) => (k in t ? t[k] : () => {}) });
  const ctx: any = {
    window: { troop: api, addEventListener() {} }, document: d, location: { search: '' },
    localStorage: { getItem: (k: string) => stored.get(k) ?? null, setItem: (k: string, v: string) => { stored.set(k, v); }, removeItem: (k: string) => { stored.delete(k); } },
    URLSearchParams, URL, wall, termView, settingsView: { open() {}, close: () => false, isOpen: () => false }, CSS: { escape: (s: string) => s },
    matchMedia: () => ({ matches: false }), console, MutationObserver: class { observe() {} }, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 0,
  };
  ctx.global = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(`${src('diff.js')}\n${src('browser-chrome.js')}\n${src('app.js')}\n${src('home.js')}\nthis.t = { ui, onClick, homeView };`, ctx);
  const t = ctx.t;
  t.homeView.draw = () => {};
  const click = async (view: string) => {
    const btn: any = { tagName: 'BUTTON', dataset: { action: 'view', view }, closest: () => null };
    await t.onClick({ target: { closest: (s: string) => (s === '[data-action]' ? btn : null) }, stopPropagation() {} });
    await flush();
  };
  return { t, stored, wallCalls, click, snap: async (s: any) => { await handlers.onSnapshot(s); await flush(); } };
}

const snapOf = () => ({
  core: { online: true, pid: 1, heartbeat_age_ms: 0 }, projects: [{ id: 'p1', name: 'p', path: '/p' }],
  sessions: [{ id: 's1', project_id: 'p1', state: 'working', engine_id: 'claude', title: 'T1' }, { id: 's2', project_id: 'p1', state: 'waiting_for_you', engine_id: 'claude', title: 'T2' }],
  live: [], approvals: [], needs_you: [], engines: [], limits: [], panes: [], snapshots: [], git: {}, dev_servers: [], watcher_off: [], selected: null,
});

test('M8-F13a the title-bar switch goes Home, IDE, Wall, Home and each press sets and saves that view', async () => {
  // protects=the three-way switch reaches every place and remembers it for the next start
  // fails_when=a button does not set ui.view, or the view is not saved
  const w = boot();
  await w.snap(snapOf());
  w.t.ui.projectId = 'p1';
  const seen: string[] = [];
  for (const v of ['home', 'ide', 'wall', 'home']) { await w.click(v); seen.push(`${w.t.ui.view}/${w.stored.get('troop.view')}`); }
  assert.deepEqual(seen, ['home/home', 'ide/ide', 'wall/wall', 'home/home']);
});

test('M8-F13a a round trip Home, IDE, Wall, Home keeps the Home draft, the project, the wall mode and the selection, and never touches the wall layout', async () => {
  // protects=the switch changes the place and nothing else: the draft, project, wall mode and picked tile survive, and the wall is not re-laid out
  // fails_when=the switch clears ui.drafts, resets the project, mode or selection, or calls the wall promote, pair, unpair or maximize
  const w = boot();
  await w.snap(snapOf());
  const u = w.t.ui;
  u.projectId = 'p1'; u.mode = 'grid'; u.localSel = 's2'; u.drafts['home-task'] = 'rename the header'; u.drafts['home-engine'] = 'claude';
  const before = { projectId: u.projectId, mode: u.mode, localSel: u.localSel, snapSessions: u.snap.sessions };
  w.wallCalls.length = 0;
  for (const v of ['ide', 'wall', 'home']) await w.click(v);
  assert.equal(u.view, 'home');
  assert.equal(u.drafts['home-task'], 'rename the header');
  assert.equal(u.drafts['home-engine'], 'claude');
  assert.deepEqual({ projectId: u.projectId, mode: u.mode, localSel: u.localSel, snapSessions: u.snap.sessions }, before);
  const moved = w.wallCalls.filter((c) => ['promote', 'pair', 'unpair', 'maximize', 'restore', 'toggleOpen', 'setList', 'setSheet'].includes(c));
  assert.deepEqual(moved, [], 'no layout call during the round trip');
});

/* Part 2: the real ide.jsx and home.jsx, bundled. */

const calls: any[] = [];
const elements = new Map<string, any>();
const docListeners: Record<string, Function[]> = {};
const getEl = (id: string) => {
  if (!elements.has(id)) elements.set(id, { id, hidden: true, focus() {}, select() {}, replaceChildren() {}, matches: () => false, closest: () => null, querySelectorAll: () => [], contains: () => false, setAttribute() {}, getAttribute: () => null, removeAttribute() {}, style: {}, classList: { add() {}, remove() {}, contains: () => false, toggle: () => false } });
  return elements.get(id);
};
g.requestAnimationFrame = (fn: any) => setTimeout(fn, 0);
g.cancelAnimationFrame = (id: any) => clearTimeout(id);
g.document = { documentElement: { style: {} }, body: { style: {} }, readyState: 'loading', getElementById: getEl, querySelectorAll: () => [], addEventListener: (e: string, f: any) => { (docListeners[e] ||= []).push(f); }, removeEventListener() {} };
g.window = g;
g.addEventListener = (e: string, f: any) => { (docListeners[e] ||= []).push(f); };
g.removeEventListener = () => {};

function initGlobals() {
  const homeDraw = g.homeView?.draw;
  g.ui = {
    view: 'ide', projectId: 'p1', look: { theme: { scheme: 'dark' } }, settingsLook: { themes: [] }, drafts: {}, pendingHide: new Set(),
    snap: { sessions: [], live: [], approvals: [], needs_you: [], engines: [], projects: [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }] },
  };
  Object.assign(g, {
    project: () => g.ui.snap.projects.find((p: any) => p.id === g.ui.projectId),
    api: {
      fsList: async () => [], fsRead: async (...a: any[]) => { calls.push(['fsRead', ...a]); return { text: 'initial', mtimeMs: 100 }; }, fsWrite: async () => ({ ok: true, mtimeMs: 200 }), fsCreate: async () => ({ ok: true }),
      fsSearch: async () => ({ hits: [] }), fsFind: async () => [], git: async () => ({ files: [] }), sessionDiffFile: async () => '', openInVsCode: async () => ({ ok: true }), fsOpenOutside: async () => ({ ok: true }),
      settingsPage: async () => ({}), setSetting: async () => {}, setApproval: async () => {}, setCheck: async () => {}, uiSettings: async () => ({}), addons: async () => [], openLogs() {},
    },
    toast: () => {}, changedFiles: () => [], taskOf: (x: any) => x?.title || x?.id || '', STATE_ORDER: ['waiting_for_you', 'working', 'starting', 'done', 'failed', 'exited'], STATE_WORDS: {},
    paletteItems: () => [], overlayOpen: () => false, diffLines: () => [],
    homeView: { shown: () => g.ui.view === 'home' && Boolean(g.project()), draw: homeDraw || (() => {}), set: (v: string) => { calls.push(['view', v]); g.ui.view = v; } },
    settingsView: { shown: () => false, draw() {}, open: async () => {}, close: () => false, isOpen: () => false }, frameView: { shown: () => false, draw() {}, close: () => false, open() {} },
    inboxView: { shown: () => false, draw() {} }, addonsView: { shown: () => false, draw: async () => {} }, ideView: { shown: () => false, draw: async () => {} },
    render() {}, waitingAll: () => [], isInfo: () => false, loopOf: () => null, lendOf: () => null, needsCount: () => 0, approvalCard: () => '', ago: () => '', load: () => null, save() {}, pick: async () => {},
    rpc: async (method: string, params: any) => { calls.push(['rpc', method, params]); return { result: method === 'session.owners' ? { paths: [] } : {} }; },
    openSinks() {}, applyLook() {}, setLook: async () => {}, __axCreateRoot: () => ({ render() {} }),
  });
}
initGlobals();

await build({
  absWorkingDir: join(wb, 'ui'), tsconfigRaw: {},
  stdin: { contents: "import './src/main.jsx'; export * from './src/ide.jsx'; export * from './src/home.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", resolveDir: join(wb, 'ui'), loader: 'jsx' },
  plugins: [{ name: 'installed-ui-modules', setup(b: any) {
    b.onResolve({ filter: /.*/ }, (args: any) => {
      if (args.path.endsWith('.css')) return { path: args.path, namespace: 'empty-css' };
      if (args.path === 'react-dom/client') return { path: args.path, namespace: 'mount-spy' };
      if (!args.path.startsWith('.')) return { path: pathToFileURL(requireUI.resolve(args.path)).href, external: true };
      return { path: resolve(args.namespace === 'screen' ? dirname(args.importer) : join(wb, 'ui'), args.path), namespace: 'screen' };
    });
    b.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
    b.onLoad({ filter: /.*/, namespace: 'mount-spy' }, () => ({ contents: 'export const createRoot = globalThis.__axCreateRoot;', loader: 'js' }));
    b.onLoad({ filter: /.*/, namespace: 'screen' }, (args: any) => {
      let code = readFileSync(args.path, 'utf8');
      if (args.path.endsWith('ide.jsx')) code += '\nexport { states as __states, openFile as __openFile, tabOf as __tabOf }; export const __getCur = () => cur; export const __resetCur = () => { cur = null; };\n';
      return { contents: `import { createElement as __create, Fragment as __fragment } from 'react'; function __element(...args) { const node = __create(...args); globalThis.__axCapture?.(node); return node; }\n` + code, loader: args.path.endsWith('.jsx') ? 'jsx' : 'js' };
    });
  } }],
  bundle: true, platform: 'node', format: 'esm', jsx: 'transform', jsxFactory: '__element', jsxFragment: '__fragment', loader: { '.css': 'empty' }, outfile: join(temp, 'f13.mjs'),
});
const m = await import(pathToFileURL(join(temp, 'f13.mjs')).href);
const { React, renderToStaticMarkup, Home, homeStore, drawIde, unsavedSummary, __states, __openFile, __tabOf, __getCur, __resetCur } = m;
homeStore.use = () => React.useSyncExternalStore(() => () => {}, homeStore.get, homeStore.get);

beforeEach(() => { calls.length = 0; elements.clear(); __states.clear(); __resetCur(); initGlobals(); });

test('M8-F13a the IDE keeps its tabs, the dirty edit and the project state through Wall and Home and back, without re-reading the file', async () => {
  // protects=the IDE state object (tabs, active tab, unsaved edit) outlives a visit to the Wall and Home
  // fails_when=drawing the IDE while another view is shown drops or rebuilds the state, closes a tab, or reloads a file
  await drawIde();
  const cur = __getCur();
  await __openFile(cur, 'src/a.ts');
  await __openFile(cur, 'src/b.ts');
  __tabOf(cur, 'src/a.ts').dirty = true;
  const tabs = cur.tabs, active = cur.active, reads = calls.filter((c) => c[0] === 'fsRead').length;
  for (const v of ['wall', 'home', 'wall', 'home']) { g.ui.view = v; await drawIde(); }
  g.ui.view = 'ide';
  await drawIde();
  assert.equal(__getCur(), cur, 'the same state object');
  assert.equal(__states.get('p1'), cur);
  assert.equal(cur.tabs, tabs);
  assert.deepEqual(cur.tabs.map((t: any) => t.path), ['src/a.ts', 'src/b.ts']);
  assert.equal(cur.active, active);
  assert.equal(__tabOf(cur, 'src/a.ts').dirty, true);
  assert.equal(unsavedSummary(), 'Alpha: a.ts');
  assert.equal(calls.filter((c) => c[0] === 'fsRead').length, reads, 'no file read again');
});

function render(Screen: any) {
  const nodes: any[] = [];
  g.__axCapture = (n: any) => nodes.push(n);
  try { return { html: renderToStaticMarkup(React.createElement(Screen)), nodes }; } finally { delete g.__axCapture; }
}
const label = (text: string) => (n: any) => n.props?.label === text;

for (const [name, engines] of [['no engines at all', []], ['only a red engine', [{ id: 'claude', light: 'red' }]]] as const) {
  test(`M8-F13d Home with ${name} shows the Add-ons card, no starters, no composer and no canned result`, async () => {
    // protects=a missing engine leads to Add-ons and the check button, and never to a demo reply or a task that looks started
    // fails_when=the starters or the Start box show with no ready engine, a demo task appears, or the Add-ons button does not open Add-ons
    g.ui.view = 'home'; g.ui.homeSel = ''; g.ui.snap.engines = engines; g.ui.snap.has_sessions = false;
    const { html, nodes } = render(Home);
    assert.match(html, /No agent is ready\. Check Add-ons\./);
    assert.doesNotMatch(html, /Explain this project|Fix a bug|Build a page/);
    assert.equal(nodes.filter(label('Start')).length, 0);
    assert.equal(nodes.filter((n) => n.type?.name === 'TaskView').length, 0, 'no task shown');
    assert.doesNotMatch(html, /demo|sample|example result/i);
    nodes.find(label('Add-ons')).props.onClick();
    assert.deepEqual(calls.filter((c) => c[0] === 'view'), [['view', 'addons']]);
    await nodes.find(label('Check again')).props.onClick();
    assert.ok(calls.some((c) => c[0] === 'rpc' && c[1] === 'engines.check'));
    assert.equal(calls.some((c) => c[0] === 'rpc' && c[1] === 'session.launch'), false, 'nothing launched');
  });
}

test('M8-F13d Home with a ready engine shows the starters and the Start box instead of the Add-ons card', () => {
  // protects=the card appears only when no engine is ready, so the two states are told apart
  // fails_when=the empty state shows beside a ready engine, or the starters are missing
  g.ui.view = 'home'; g.ui.homeSel = ''; g.ui.snap.engines = [{ id: 'claude', light: 'green' }]; g.ui.snap.has_sessions = false;
  const { html, nodes } = render(Home);
  assert.doesNotMatch(html, /No agent is ready/);
  assert.match(html, /Explain this project/);
  assert.equal(nodes.filter(label('Start')).length, 1);
});
