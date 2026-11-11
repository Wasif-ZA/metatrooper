import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'night-ui-'));
const previousHome = process.env.METATROOPER_HOME;
process.env.METATROOPER_HOME = join(temp, 'home');
after(() => { rmSync(temp, { recursive: true, force: true }); if (previousHome === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = previousHome; });
const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');
const appSource = readFileSync(join(wb, 'renderer/app.js'), 'utf8');
const fn = (name: string) => appSource.match(new RegExp(`^(?:async )?function ${name}\\([^]*?\\n}\\n`, 'm'))![0];

// Bundle the real Home screen with the same plugin the ax tests use.
await build({
  absWorkingDir: join(wb, 'ui'), tsconfigRaw: {},
  stdin: { contents: "export * from './src/home.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", resolveDir: join(wb, 'ui'), loader: 'jsx' },
  plugins: [{ name: 'installed-ui-modules', setup(b: any) {
    b.onResolve({ filter: /.*/ }, (args: any) => {
      if (args.path.endsWith('.css')) return { path: args.path, namespace: 'empty-css' };
      if (!args.path.startsWith('.')) return { path: pathToFileURL(requireUI.resolve(args.path)).href, external: true };
      return { path: resolve(args.namespace === 'screen' ? dirname(args.importer) : join(wb, 'ui'), args.path), namespace: 'screen' };
    });
    b.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
    b.onLoad({ filter: /.*/, namespace: 'screen' }, (args: any) => ({ contents: readFileSync(args.path, 'utf8'), loader: args.path.endsWith('.jsx') ? 'jsx' : 'js' }));
  } }],
  bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' }, outfile: join(temp, 'home.mjs'),
});
const { React, renderToStaticMarkup, Home } = await import(pathToFileURL(join(temp, 'home.mjs')).href);

const g: any = globalThis;
const calls: any[] = [];
const own = new Set(['Home', 'StartBox', 'Tile', 'AgentCard', 'AgentHead']);

// Expand Home's own components with simple hook slots and record every element for lookups.
function harness(Screen: any) {
  const frames = new Map<string, any[]>();
  let nodes: any[] = [];
  function expand(value: any, path: string): any {
    if (Array.isArray(value)) return value.map((v, i) => expand(v, path + '/' + i));
    if (!React.isValidElement(value)) return value;
    nodes.push(value);
    if (typeof value.type === 'function' && own.has(value.type.name)) {
      const slots = frames.get(path) || []; frames.set(path, slots); let cursor = 0;
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H;
      internals.H = {
        useEffect: () => {},
        useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
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
  const draw = () => { nodes = []; return expand(React.createElement(Screen), 'root'); };
  return {
    draw,
    html: () => renderToStaticMarkup(draw()),
    all: (predicate: any) => nodes.filter(predicate),
    one: (predicate: any) => { const found = nodes.find(predicate); assert.ok(found, 'rendered control exists'); return found; },
  };
}
const label = (text: string) => (n: any) => n.props.label === text;
const hasClass = (c: string) => (n: any) => typeof n.props?.className === 'string' && n.props.className.split(' ').includes(c);
function session(id: string, state: string, extra: any = {}) { return { id, state, project_id: 'p1', engine_id: 'synthetic', title: 'Task ' + id, ...extra }; }
const changeLists: Record<string, string[]> = {};

beforeEach(() => {
  calls.length = 0;
  for (const k of Object.keys(changeLists)) delete changeLists[k];
  Object.assign(g, {
    ui: { view: 'home', projectId: 'p1', pendingHide: new Set(), drafts: {}, snap: { sessions: [], live: [], approvals: [], needs_you: [], engines: [], projects: [{ id: 'p1', name: 'Alpha' }] } },
    api: { uiSettings: async () => ({}), openLogs: () => {} },
    rpc: async (...args: any[]) => { calls.push(['rpc', ...args]); return {}; },
    project: () => g.ui.snap.projects.find((p: any) => p.id === g.ui.projectId),
    waitingAll: () => g.ui.snap.live.filter((s: any) => s.state === 'waiting_for_you'),
    isInfo: () => false, taskOf: (s: any) => s.title, ago: () => '1m ago',
    homeView: { shown: () => g.ui.view === 'home' && Boolean(g.project()), set: (v: string) => { calls.push(['view', v]); g.ui.view = v; } },
    ideView: { open: async (p: string) => { calls.push(['ide.open', p]); } },
    load: () => null, save: () => {}, pick: async () => {},
    changedFiles: (id: string) => changeLists[id] || [],
    STATE_ORDER: ['waiting_for_you', 'working', 'starting', 'done', 'failed', 'exited'], STATE_WORDS: {},
    document: { documentElement: { style: {} }, getElementById: () => ({ hidden: false }) },
  });
});

const rowText = (n: any) => n.props.children.map((c: any) => c.props.children);
const isFileRow = (n: any) => n.type === 'li' && hasClass('ou-irow')(n) && !n.props['data-action'];

function twoAgents() {
  changeLists.a = ['a0.ts', 'a1.ts', 'a2.ts', 'a3.ts', 'a4.ts'];
  changeLists.b = ['b0.ts', 'b1.ts', 'b2.ts', 'b3.ts', 'b4.ts', 'b5.ts'];
  g.ui.snap.sessions = [session('a', 'working', { engine_id: 'claude' }), session('b', 'working', { engine_id: 'codex' })];
}





// The real click dispatcher from app.js, driven with the data attributes the screens render.
function clickWith(el: any, hidden = { hidden: true }) {
  const onClick = new Function('homeView', 'document', `${fn('onClick')}; return onClick;`)(
    g.homeView, { getElementById: (id: string) => (id === 'inbox' ? hidden : { hidden: false }) },
  );
  const target = { closest: (sel: string) => (sel === '[data-action]' ? el : null) };
  return onClick({ target, stopPropagation() {} });
}
const asEl = (props: any) => ({ tagName: 'DIV', dataset: { action: props['data-action'], view: props['data-view'] }, closest: () => null });


test('night-06 action inbox switches to Needs you and leaves the old popover hidden', async () => {
  const popover = { hidden: true };
  await clickWith({ tagName: 'BUTTON', dataset: { action: 'inbox' }, closest: () => null }, popover);
  assert.equal(g.ui.view, 'inbox');
  assert.equal(popover.hidden, true);
});

test('night-06 openNeedsYou with an unknown id opens Needs you and leaves the popover hidden', async () => {
  const popover = { hidden: true };
  const openNeedsYou = new Function('ui', 'document', 'homeView', 'rpc', `${fn('openNeedsYou')}; return openNeedsYou;`)(
    g.ui, { getElementById: (id: string) => (id === 'inbox' ? popover : null) }, g.homeView, g.rpc,
  );
  await openNeedsYou('missing-id');
  assert.equal(popover.hidden, true);
  assert.equal(g.ui.view, 'inbox');
  assert.deepEqual(calls, [['view', 'inbox']]);
});

// Ensure document.body exists before importing CodeMirror modules.
if (!g.document) g.document = {};
if (!g.document.body) g.document.body = { style: {}, appendChild() {} };
if (!g.document.documentElement) g.document.documentElement = { style: {} };

// Bundle palette and ide screens with real sources.
await build({
  absWorkingDir: join(wb, 'ui'), tsconfigRaw: {},
  stdin: { contents: "export * from './src/palette.jsx'; export * from './src/ide.jsx';", resolveDir: join(wb, 'ui'), loader: 'jsx' },
  plugins: [{ name: 'installed-ui-modules', setup(b: any) {
    b.onResolve({ filter: /.*/ }, (args: any) => {
      if (args.path.endsWith('.css')) return { path: args.path, namespace: 'empty-css' };
      if (!args.path.startsWith('.')) return { path: pathToFileURL(requireUI.resolve(args.path)).href, external: true };
      return { path: resolve(args.namespace === 'screen' ? dirname(args.importer) : join(wb, 'ui'), args.path), namespace: 'screen' };
    });
    b.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
    b.onLoad({ filter: /.*/, namespace: 'screen' }, (args: any) => ({ contents: readFileSync(args.path, 'utf8'), loader: args.path.endsWith('.jsx') ? 'jsx' : 'js' }));
  } }],
  bundle: true, platform: 'node', format: 'esm', jsx: 'automatic', loader: { '.css': 'empty' }, outfile: join(temp, 'palette.mjs'),
});
const { Palette, paletteView, paletteStore, confirmStore, ideKeys, openAt } = await import(pathToFileURL(join(temp, 'palette.mjs')).href);

own.add('Palette');

// Slices balanced function declarations from source.
function declaration(name: string) {
  const match = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(').exec(appSource);
  assert.ok(match, 'function ' + name + ' in app.js');
  const bodyStart = appSource.indexOf('{', match.index);
  let depth = 0;
  for (let i = bodyStart; i < appSource.length; i++) {
    if (appSource[i] === '{') depth++;
    else if (appSource[i] === '}') {
      depth--;
      if (depth === 0) return appSource.slice(match.index, i + 1);
    }
  }
  throw new Error('Could not slice ' + name);
}

// Slices balanced arrow functions registered in addEventListener calls.
function sliceArrow(src: string, anchor: string) {
  const idx = src.indexOf(anchor);
  assert.ok(idx >= 0, 'anchor in source');
  const addListenerIdx = src.lastIndexOf('addEventListener', idx);
  assert.ok(addListenerIdx >= 0, 'addEventListener before anchor');
  const start = src.indexOf('(e)', addListenerIdx);
  assert.ok(start >= 0, '(e) found');
  const bodyStart = src.indexOf('{', start);
  let depth = 0;
  for (let i = bodyStart; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('Could not balance arrow function');
}

// Sliced real source evaluators wrapped as function expressions.
const mainSource = readFileSync(join(wb, 'ui/src/main.jsx'), 'utf8');

const getOverlayOpen = (doc: any, global: any, wallObj: any) => {
  const runner = new Function('document', 'globalThis', 'wall', `return (${declaration('overlayOpen')})();`);
  return runner(doc, global, wallObj);
};

const makeMainKeydown = (pv: any, isOverlay: any) => {
  const runner = new Function('paletteView', 'overlayOpen', `return (${sliceArrow(mainSource, "key === 'p'")});`);
  return runner(pv, isOverlay);
};

const makeAppKeydown = (doc: any, global: any, pv: any, closePal: any, openPal: any) => {
  const runner = new Function('document', 'globalThis', 'paletteView', 'closePalette', 'openPalette', 'setMode', 'ui', 'renderPalette', 'runPalette', 'settingsView', 'rpc', 'closePopovers', 'wall',
    `return (${sliceArrow(appSource, "const palette = !document.getElementById('palette').hidden;")});`
  );
  return runner(doc, global, pv, closePal, openPal, () => {}, global.ui, () => {}, () => {}, { close: () => false }, global.rpc, () => false, { sheetOpen: () => false, listOpen: () => false });
};

const makeFocusHandler = (global: any, pv: any, openPal: any) => {
  const runner = new Function('globalThis', 'paletteView', 'openPalette', `return (${sliceArrow(appSource, "globalThis.paletteView) { e.target.blur();")});`);
  return runner(global, pv, openPal);
};

beforeEach(() => {
  paletteStore.set({ open: false });
  confirmStore.set({ item: null });
  if (g.document && !g.document.body) {
    g.document.body = {
      style: {},
      appendChild() {},
      classList: { contains: () => false, add: () => {}, remove: () => {}, toggle: () => {} },
    };
  }
  if (g.document && !g.document.querySelector) g.document.querySelector = () => null;
  if (g.document && !g.document.querySelectorAll) g.document.querySelectorAll = () => [];
  if (g.ui) {
    g.ui.shellKinds = [];
    g.ui.shells = [];
    g.ui.drafts = {};
    g.ui.armed = null;
    g.ui.mode = 'single';
    g.ui.tab = 'diff';
    if (g.ui.snap && !g.ui.snap.core) g.ui.snap.core = { online: true };
    if (g.ui.snap && !g.ui.snap.engines) g.ui.snap.engines = [];
    if (g.ui.snap && !g.ui.snap.sessions) g.ui.snap.sessions = [];
  }
  g.reportPaneBounds = () => {};
  g.openHit = async () => {};
  g.paletteView = paletteView;
  g.shellRows = () => [];
  g.KEYS = [];
  g.api.fsFind = async () => [];
  g.api.fsList = async () => [];
  g.api.fsRead = async () => ({ text: '', mtimeMs: 1 });
  g.api.restartCore = async () => { calls.push(['restartCore']); };
  g.api.stopCore = async () => { calls.push(['stopCore']); };
  g.paletteItems = () => [
    { group: 'Core', confirm: 'restart', name: 'Restart core (loads new core code; open agents stop)', label: 'Restart core (loads new core code; open agents stop)', run: async () => { await g.api.restartCore(); } },
    { group: 'Core', confirm: 'stop', name: 'Stop core (stops every agent)', label: 'Stop core (stops every agent)', run: async () => { await g.api.stopCore(); } },
  ];
});

// Helper to flush asynchronous tasks.
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 10)); };

test('night-07 palette opens with the IDE hidden and lists no file rows', async () => {
  g.ui.view = 'home';
  paletteView.open();
  const h = harness(Palette);
  h.draw();
  const cp = h.one((n: any) => n.props.label === 'Commands');
  assert.equal(cp.props.isOpen, true);
  assert.equal(paletteView.isOpen(), true);
  const items = cp.props.searchSource.bootstrap();
  const fileRows = items.filter((x: any) => x.auxiliaryData?.group === 'Open files' || x.auxiliaryData?.group === 'Changed by agents' || x.auxiliaryData?.group === 'Files');
  assert.equal(fileRows.length, 0);
  assert.ok(items.length > 0);
  paletteView.close();
  await flush();
});

test('night-07 with the IDE shown it lists the open tabs', async () => {
  g.ui.view = 'ide';
  g.ui.projectId = 'p_tabs';
  g.ui.snap.projects = [{ id: 'p_tabs', name: 'Tabs Project' }];
  await openAt('src/index.ts');
  await openAt('src/utils.ts');
  paletteView.open();
  const h = harness(Palette);
  h.draw();
  const cp = h.one((n: any) => n.props.label === 'Commands');
  const items = cp.props.searchSource.bootstrap();
  const openTabs = items.filter((x: any) => x.auxiliaryData?.group === 'Open files');
  assert.deepEqual(openTabs.map((x: any) => x.label), ['src/index.ts', 'src/utils.ts']);
  paletteView.close();
  await flush();
});

test('night-07 ideKeys.paletteOpen() follows paletteView.isOpen()', async () => {
  paletteView.close();
  assert.equal(paletteView.isOpen(), false);
  assert.equal(ideKeys.paletteOpen(), false);
  paletteView.open();
  assert.equal(paletteView.isOpen(), true);
  assert.equal(ideKeys.paletteOpen(), true);
  ideKeys.palette(false);
  assert.equal(paletteView.isOpen(), false);
  assert.equal(ideKeys.paletteOpen(), false);
  ideKeys.palette(true);
  assert.equal(paletteView.isOpen(), true);
  assert.equal(ideKeys.paletteOpen(), true);
  paletteView.close();
  await flush();
});

test('night-07 Ctrl+Shift+P does nothing while Settings is open', async () => {
  paletteView.close();
  g.settingsView = { isOpen: () => true };
  const mockDoc = { getElementById: (id: string) => ({ hidden: true, classList: { contains: () => false } }) };
  const mockWall = { sheetOpen: () => false, listOpen: () => false };
  const isOverlay = () => getOverlayOpen(mockDoc, g, mockWall);
  assert.equal(isOverlay(), true);
  let prevented = false;
  const handler = makeMainKeydown(paletteView, isOverlay);
  handler({ ctrlKey: true, shiftKey: true, altKey: false, key: 'p', preventDefault() { prevented = true; } });
  assert.equal(prevented, false);
  assert.equal(paletteView.isOpen(), false);
  await flush();
});

test('night-08 Restart core and Stop core never call api.restartCore / api.stopCore without the confirm action (first activation only arms; assert zero calls), and do call it exactly once after confirm', async () => {
  const h = harness(Palette);
  h.draw();
  const cp = h.one((n: any) => n.props.label === 'Commands');
  const items = cp.props.searchSource.bootstrap();
  const restartCmd = items.find((x: any) => x.label.includes('Restart core'));
  assert.ok(restartCmd, 'Restart core command exists');
  cp.props.onValueChange(restartCmd.id);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.filter((c: any) => c[0] === 'restartCore').length, 0);
  assert.equal(confirmStore.get().item?.confirm, 'restart');
  h.draw();
  const restartDialog = h.one((n: any) => n.props.actionLabel === 'Restart core');
  assert.ok(restartDialog, 'AlertDialog shown for Restart core');
  await restartDialog.props.onAction();
  assert.equal(calls.filter((c: any) => c[0] === 'restartCore').length, 1);
  assert.equal(confirmStore.get().item, null);

  const stopCmd = items.find((x: any) => x.label.includes('Stop core'));
  assert.ok(stopCmd, 'Stop core command exists');
  cp.props.onValueChange(stopCmd.id);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls.filter((c: any) => c[0] === 'stopCore').length, 0);
  assert.equal(confirmStore.get().item?.confirm, 'stop');
  h.draw();
  const stopDialog = h.one((n: any) => n.props.actionLabel === 'Stop core');
  assert.ok(stopDialog, 'AlertDialog shown for Stop core');
  await stopDialog.props.onAction();
  assert.equal(calls.filter((c: any) => c[0] === 'stopCore').length, 1);
  assert.equal(confirmStore.get().item, null);
  await flush();
});

test('night-08 a session.search error leaves the file and command results intact', async () => {
  g.ui.view = 'ide';
  g.api.fsFind = async () => ['src/searched.ts'];
  g.rpc = async (method: string) => {
    if (method === 'session.search') throw new Error('Search transport failed');
    return {};
  };
  const h = harness(Palette);
  h.draw();
  const cp = h.one((n: any) => n.props.label === 'Commands');
  const results = await cp.props.searchSource.search('search');
  assert.ok(results.some((x: any) => x.id === 'src/searched.ts' && x.auxiliaryData?.group === 'Files'));
  assert.ok(results.some((x: any) => x.auxiliaryData?.group === 'Core' || x.auxiliaryData?.group === 'IDE' || x.auxiliaryData?.group === 'Keys'));
  assert.equal(results.filter((x: any) => x.auxiliaryData?.group === 'Scrollback').length, 0);
  await flush();
});

test('night-08 a query of 200+ characters is passed to session.search as is (exact string), and hits are capped at 20', async () => {
  const longQuery = 'long_query_test_'.repeat(15);
  assert.ok(longQuery.length >= 200);
  let passedQuery = '';
  g.ui.snap.sessions = [{ id: 's1' }];
  g.rpc = async (method: string, params: any) => {
    if (method === 'session.search') {
      passedQuery = params.query;
      return {
        result: {
          hits: Array.from({ length: 30 }, (_, i) => ({
            session_id: 's1',
            line: i + 1,
            text: `Hit text ${i} for ${longQuery}`,
          })),
        },
      };
    }
    return {};
  };
  const h = harness(Palette);
  h.draw();
  const cp = h.one((n: any) => n.props.label === 'Commands');
  const results = await cp.props.searchSource.search(longQuery);
  assert.equal(passedQuery, longQuery);
  const scrollHits = results.filter((x: any) => x.auxiliaryData?.group === 'Scrollback');
  assert.equal(scrollHits.length, 20);
  assert.equal(scrollHits[0].label, `Hit text 0 for ${longQuery}`);
  assert.equal(scrollHits[19].label, `Hit text 19 for ${longQuery}`);
  await flush();
});

test('night-09 with globalThis.paletteView set: Ctrl+K calls paletteView.toggle() and #palette stays hidden', async () => {
  g.paletteView = { toggle: () => calls.push(['paletteView.toggle']), isOpen: () => false };
  const paletteEl = { hidden: true };
  const mockDoc = { getElementById: (id: string) => (id === 'palette' ? paletteEl : { hidden: false }) };
  let prevented = false;
  const handler = makeAppKeydown(mockDoc, g, g.paletteView, () => {}, () => {});
  handler({ ctrlKey: true, shiftKey: false, altKey: false, key: 'k', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(calls, [['paletteView.toggle']]);
  assert.equal(paletteEl.hidden, true);
  await flush();
});

test('night-09 focus on #palette-input blurs it and calls paletteView.open()', async () => {
  g.paletteView = { open: () => calls.push(['paletteView.open']) };
  let blurred = false;
  const handler = makeFocusHandler(g, g.paletteView, () => calls.push(['openPalette']));
  handler({ target: { blur() { blurred = true; } } });
  assert.equal(blurred, true);
  assert.deepEqual(calls, [['paletteView.open']]);
  await flush();
});

test('night-09 overlayOpen() is true while paletteView.isOpen()', async () => {
  const mockDoc = { getElementById: (id: string) => ({ hidden: true, classList: { contains: () => false } }) };
  const mockWall = { sheetOpen: () => false, listOpen: () => false };
  g.settingsView = { isOpen: () => false };
  g.paletteView = { isOpen: () => true };
  assert.equal(getOverlayOpen(mockDoc, g, mockWall), true);
  g.paletteView = { isOpen: () => false };
  assert.equal(getOverlayOpen(mockDoc, g, mockWall), false);
  delete g.paletteView;
  assert.equal(getOverlayOpen(mockDoc, g, mockWall), false);
  await flush();
});

test('night-09 without paletteView: Ctrl+K takes the old path (old palette opens) unchanged', async () => {
  delete g.paletteView;
  let opened = false;
  let closed = false;
  const paletteEl = { hidden: true };
  const mockDoc = { getElementById: (id: string) => (id === 'palette' ? paletteEl : { hidden: false }) };
  const handler = makeAppKeydown(mockDoc, g, undefined, () => { closed = true; }, () => { opened = true; });
  handler({ ctrlKey: true, shiftKey: false, altKey: false, key: 'k', preventDefault() {} });
  assert.equal(opened, true);
  assert.equal(closed, false);
  opened = false;
  closed = false;
  paletteEl.hidden = false;
  handler({ ctrlKey: true, shiftKey: false, altKey: false, key: 'k', preventDefault() {} });
  assert.equal(closed, true);
  assert.equal(opened, false);
  await flush();
});
