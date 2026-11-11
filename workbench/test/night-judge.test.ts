import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'night-judge-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');

// Bundle real screen sources and retain installed React and library controls.
const entry = "export * from './src/settings.jsx'; export * from './src/inbox.jsx'; export * from './src/home.jsx'; export * from './src/addons.jsx'; export { Button } from '@astryxdesign/core/Button'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';";
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
  const source = entry.replace(/'(@astryxdesign\/core\/[^']+)'/g, (_, name) => JSON.stringify(requireUI.resolve(name))).replaceAll("'./src/", "'" + join(wb, 'ui/src/').replaceAll('\\', '/') );
  const entryPath = join(temp, 'entry.jsx');
  writeFileSync(entryPath, source.replace("'react';", JSON.stringify(requireUI.resolve('react')) + ';').replace("'react-dom/server';", JSON.stringify(requireUI.resolve('react-dom/server')) + ';'));
  const binary = join(dirname(requireUI.resolve('esbuild/package.json')), '../@esbuild/win32-x64/esbuild.exe');
  await new Promise<void>((resolveBuild, reject) => {
    const child = spawn(binary, [entryPath, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--loader:.css=empty', '--banner:js=import { createRequire as __nightCreateRequire } from "node:module"; const require = __nightCreateRequire(import.meta.url);', '--outfile=' + join(temp, 'panes.mjs')], { stdio: 'inherit', windowsHide: true });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolveBuild() : reject(new Error('esbuild exited ' + code)));
  });
}
const { React, renderToStaticMarkup, Inbox, inboxStore, Home, Addons, addonsStore, Settings, settingsStore, Button } = await import(pathToFileURL(join(temp, 'panes.mjs')).href);

// Evaluate app components while leaving installed design system controls intact.
function screen(Component: any, props: any = {}) {
  const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
  const previous = internals.H;
  internals.H = {
    useSyncExternalStore: (_: any, get: any) => get(),
    useState: (initial: any) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
  };
  try { return Component(props); } finally { internals.H = previous; }
}
const children = (node: any): any[] => [node?.props?.children].flat(Infinity).filter(n => n != null && typeof n !== 'boolean');
const descendants = (node: any): any[] => [node, ...children(node).flatMap(descendants)];
const hasClass = (node: any, name: string) => node?.props?.className?.split(' ').includes(name) === true;
function oneClass(node: any, name: string) {
  const found = descendants(node).filter(n => hasClass(n, name));
  assert.equal(found.length, 1, 'one ' + name);
  return found[0];
}
const g: any = globalThis;
beforeEach((t) => {
  const ui = { view: 'inbox', projectId: 'p1', drafts: {}, look: { theme: { name: 'neutral' } }, settingsLook: { themes: [] }, snap: { sessions: [], live: [], approvals: [], needs_you: [] as any[], engines: [{ id: 'ready', light: 'green' }], projects: [{ id: 'p1', name: 'Test project' }] } };
  const values = { ui, homeView: { shown: () => true }, project: () => ui.snap.projects[0], waitingAll: () => [],
    needsCount: () => 0, isInfo: () => true, changedFiles: () => [], STATE_ORDER: [], ago: () => '1m ago', load: () => null };
  for (const [key, value] of Object.entries(values)) {
    const previous = Object.getOwnPropertyDescriptor(g, key);
    Object.defineProperty(g, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(g, key, previous) : delete g[key]);
  }
  inboxStore.set({ filter: 'all', selectedId: null });
  addonsStore.set({ rows: [] });
});


const renderer = (name: string) => readFileSync(join(wb, 'renderer', name), 'utf8');
const terminal = renderer('terminal.js');
const labelSource = terminal.match(/^  function label\([^]*?\r?\n  }/m);
assert.ok(labelSource);
const labelTile = new Function('selected', 'escapeAttr', 'deskHtml', labelSource[0] + '; return label;')(null, (v: string) => v, () => '');
function tileNode(): any {
  const node: any = { dataset: {}, style: {}, textContent: '', className: '', hidden: false,
    addEventListener() {}, setAttribute(k: string, v: any) { this[k] = v; }, removeAttribute(k: string) { delete this[k]; },
    getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) };
  node.classList = {
    contains: (c: string) => node.className.split(' ').includes(c),
    toggle(c: string, on: boolean) { const classes = new Set(node.className.split(' ').filter(Boolean)); on ? classes.add(c) : classes.delete(c); node.className = [...classes].join(' '); },
    add(c: string) { this.toggle(c, true); }, remove(c: string) { this.toggle(c, false); },
  };
  const parts = new Map<string, any>();
  node.querySelector = (selector: string) => {
    const key = selector === '.badge' ? '.tile-state' : selector;
    if (!parts.has(key)) parts.set(key, tileNode());
    return parts.get(key);
  };
  return node;
}
function freshWall(width = 1400) {
  const tiles = new Map<string, any>();
  const bounds = new Map<any, any>();
  const stage = { clientWidth: width, clientHeight: 900 };
  const nodes = new Map<string, any>();
  const tween = (target: any, vars: any) => { bounds.set(target, { ...bounds.get(target), ...vars }); return { kill() {} }; };
  const ctx = vm.createContext({
    gsap: { set: tween, to: tween, fromTo: (target: any, _: any, vars: any) => tween(target, vars), delayedCall: tween },
    termView: { tile: (id: string) => { if (!tiles.has(id)) tiles.set(id, tileNode()); return tiles.get(id); } },
    document: { body: Object.assign(tileNode(), { className: 'no-split' }), querySelector: (s: string) => {
      if (s === '#stage') return stage;
      if (s === '#foldMore') return null;
      if (!nodes.has(s)) nodes.set(s, tileNode());
      return nodes.get(s);
    } }, matchMedia: () => ({ matches: true }), addEventListener() {}, setInterval() {}, setTimeout() {}, clearTimeout() {}, innerWidth: width, innerHeight: 900,
  });
  vm.runInContext(renderer('wall.js') + '\nthis.wall = wall;', ctx);
  return { wall: ctx.wall, tiles, bounds };
}
const tileData = (state: string, words: string) => ({ id: 'a', state, words, engine_id: 'codex', task: 'Review changes' });
const relabel = (el: any, state: string, words: string) => labelTile({ el, term: { options: {}, write() {} } }, tileData(state, words));
const cssBody = (css: string, selector: string) => {
  const rule = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(m => m[1].trim() === selector);
  assert.ok(rule, 'CSS rule exists: ' + selector);
  return rule[2];
};

test('20941f80 Wall big tile or pair fills the wall only when no other tiles remain', () => {
  // Full-width tiles leave equal outer margins and shrink when a side tile arrives.
  for (const width of [1000, 1600]) for (const paired of [false, true]) {
    const { wall, tiles, bounds } = freshWall(width);
    const list = [{ id: 'a', state: 'working' }, ...(paired ? [{ id: 'b', state: 'working' }] : [])];
    wall.decide(list, 'a');
    if (paired) wall.pair('b');
    wall.apply('single');
    const left = bounds.get(tiles.get('a')).left;
    const last = bounds.get(tiles.get(paired ? 'b' : 'a'));
    const right = last.left + last.width;
    assert.equal(tiles.get('a').classList.contains('big'), true);
    if (paired) assert.equal(tiles.get('b').classList.contains('big2'), true);
    assert.equal(width - right, left, 'equal outer margins across the full wall');
    wall.decide([...list, { id: 'c', state: 'working' }], 'a'); wall.apply('single');
    const reduced = bounds.get(tiles.get(paired ? 'b' : 'a'));
    assert.ok(reduced.left + reduced.width < right);
    assert.ok(bounds.get(tiles.get('c')).left >= reduced.left + reduced.width);
    wall.decide(list, 'a'); wall.apply('single');
    const restored = bounds.get(tiles.get(paired ? 'b' : 'a'));
    assert.equal(restored.left + restored.width, right);
  }
});

test('e07e7e59 Wall setBadge retains ou-ah-state across two state changes with matching text', () => {
  // Apply real wall updates and terminal labels to the same state element.
  const { wall, tiles } = freshWall();
  for (const [state, words, marker] of [['working', 'Working', 'work'], ['waiting_for_you', 'Needs you', 'wait'], ['done', 'Finished', 'unseen']]) {
    wall.decide([tileData(state, words)], 'a'); wall.apply('single');
    const el = tiles.get('a'); relabel(el, state, words);
    const badge = el.querySelector('.badge');
    assert.equal(badge.classList.contains('ou-ah-state'), true);
    assert.equal(badge.classList.contains(marker), true);
    assert.equal(badge.textContent, words);
  }
});

test('30f98498 Wall state text is unboxed in every state and only waiting has the wait marker', () => {
  // Check plain state text and the waiting marker across every real terminal state.
  const css = renderer('wall.css');
  const plainSelector = '.ph .ou-ah .badge.ou-ah-state, .ph .ou-ah .badge.ou-ah-state:is(.wait,.work,.done,.unseen)';
  const plain = cssBody(css, plainSelector);
  for (const declaration of ['height: auto;', 'padding: 0;', 'border: 0;', 'text-transform: none;']) assert.ok(plain.includes(declaration), declaration);
  const waitingSelector = '.ph .ou-ah[data-state="waiting_for_you"] .badge.ou-ah-state:is(*, .wait, .work, .done, .unseen)';
  assert.match(cssBody(css, waitingSelector), /(?:^|;)\s*color:/);
  const { wall, tiles } = freshWall();
  for (const [state, words] of [['starting', 'Starting'], ['working', 'Working'], ['waiting_for_you', 'Needs you'], ['unknown', 'Unknown'], ['done', 'Finished'], ['idle', 'Idle'], ['exited', 'Exited']]) {
    wall.decide([tileData(state, words)], 'a'); wall.apply('single');
    const el = tiles.get('a'); relabel(el, state, words);
    assert.equal(el.querySelector('.tile-state').textContent, words);
    assert.equal(el.querySelector('.ou-ah').dataset.state, state);
    assert.equal(el.querySelector('.badge').classList.contains('wait'), state === 'waiting_for_you');
    assert.equal(el.querySelector('.badge').classList.contains('ou-ah-state'), true);
  }
});

test('d47bc079 Settings error note has its hint', (t) => {
  // Render the real settings row with its literal copy.
  settingsStore.set({ data: { sessions: {}, ui: { toast_ms: 3000, error_toast_ms: 8000 }, terminal: {}, agent_cursor: {} }, section: 'general' });
  const previousUse = settingsStore.use;
  t.after(() => { settingsStore.use = previousUse; });
  settingsStore.use = () => React.useSyncExternalStore(() => () => {}, settingsStore.get, settingsStore.get);
  const html = renderToStaticMarkup(React.createElement(Settings));
  assert.match(html, /<span class="ou-rowtitle">Keep an error message on screen for<\/span><span class="ou-rowhint">Error notes stay longer so you can read them\.<\/span>/);
});

test('f2d37124 Add-ons result count is quiet metadata inside the capped results column', () => {
  // Pin the count element and cap property without pinning colours or dimensions.
  g.ui.view = 'addons';
  g.ui.snap.engines = [{ id: 'codex', light: 'green' }, { id: 'claude', light: 'red' }];
  addonsStore.set({ rows: [{ id: 'demo', enabled: true, permissions: [] }] });
  const results = oneClass(screen(Addons), 'ou-results');
  const count = oneClass(results, 'ou-addons-count');
  assert.equal(count.type, 'div');
  assert.equal(renderToStaticMarkup(count), '<div class="ou-addons-count">3 result(s)</div>');
  assert.equal(children(results)[0], count);
  const css = readFileSync(join(wb, 'ui/src/ui.css'), 'utf8');
  assert.match(cssBody(css, '.ou-results'), /max-width:\s*(?:[\d.]+(?:px|rem|em|%)|var\([^)]+\))\s*;/);
  assert.ok(cssBody(css, '.ou-addons-count'));
  g.ui.snap.engines = []; addonsStore.set({ rows: [] });
  assert.equal(renderToStaticMarkup(oneClass(screen(Addons), 'ou-addons-count')), '<div class="ou-addons-count">0 result(s)</div>');
});

test('60704072 Needs you has exactly one empty message, in the list, and none in the detail pane', () => {
  const tree = screen(Inbox);
  const emptyStates = descendants(tree).filter(n => n?.props?.title === 'Nothing is waiting on you.');
  assert.equal(emptyStates.length, 1);
  assert.equal(emptyStates[0].props.description, 'Questions from agents and finished work show up here.');
  const list = oneClass(tree, 'ou-inbox-list');
  assert.ok(descendants(list).includes(emptyStates[0]));
  assert.doesNotMatch(renderToStaticMarkup(oneClass(tree, 'ou-ipane')), /Nothing is waiting on you\./);
  assert.equal((renderToStaticMarkup(tree).match(/Nothing is waiting on you\./g) || []).length, 1);
});

test('1720c8e3 Home agent block reads the task, then its own engine mark and state with its model', (t) => {
  // Render the real Home session row and check its three lines in order.
  g.ui.pendingHide = new Set();
  g.ui.snap.sessions = [{ id: 'a', project_id: 'p1', engine_id: 'codex', state: 'working', task: 'Review changes' }];
  for (const [key, value] of Object.entries({ taskOf: (x: any) => x.task })) {
    const previous = Object.getOwnPropertyDescriptor(g, key);
    Object.defineProperty(g, key, { configurable: true, writable: true, value });
    t.after(() => previous ? Object.defineProperty(g, key, previous) : delete g[key]);
  }
  const rows = descendants(screen(Home)).filter(n => n?.type?.name === 'AgentRow');
  assert.equal(rows.length, 1);
  const html = renderToStaticMarkup(rows[0]);
  assert.match(html, /<div class="ou-hm-title">Review changes<\/div>.*?<title>codex<\/title>.*?<span class="ou-hm-tlabel">Running<\/span><span class="ou-hm-tsum ou-hm-info">codex<\/span>/);
});

test('e016fa92 Add-ons Check again renders as ghost and retains check-engines action', () => {
  // Render the unavailable agent action with the real design system button.
  g.ui.view = 'addons';
  g.ui.snap.engines = [{ id: 'codex', light: 'red' }];
  const tree = screen(Addons);
  const buttons = descendants(tree).filter(n => n?.type === Button && n.props.label === 'Check again');
  assert.equal(buttons.length, 1);
  assert.equal(buttons[0].props.variant, 'ghost');
  assert.equal(buttons[0].props['data-action'], 'check-engines');
  const html = renderToStaticMarkup(buttons[0]);
  assert.match(html, /^<button\b[^>]*data-variant="ghost"[^>]*data-action="check-engines"[^>]*>/);
  assert.equal(html.replace(/<[^>]*>/g, ''), 'Check again');
});

test('5cf47ff1 Wall bottom strip spans the wall through its loaded stylesheet', () => {
  // Check the loaded strip rule anchors both edges instead of using one column width.
  const html = renderer('index.html');
  assert.match(html, /<link\b[^>]*rel="stylesheet"[^>]*href="wall\.css"/);
  assert.match(html, /<footer\b[^>]*id="strip"[^>]*class="strip"/);
  const strip = cssBody(renderer('wall.css'), '.strip');
  assert.match(strip, /(?:^|;)\s*position:\s*absolute\s*;/);
  assert.match(strip, /(?:^|;)\s*left:\s*8px\s*;/);
  assert.match(strip, /(?:^|;)\s*right:\s*8px\s*;/);
  assert.doesNotMatch(strip, /(?:^|;)\s*width\s*:/);
});
