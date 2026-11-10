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

test('night-05 Home Changed files lists each path with its agent, at most 8 rows', () => {
  twoAgents();
  const h = harness(Home); h.draw();
  assert.deepEqual(h.all(isFileRow).map(rowText), [['a0.ts', 'claude'], ['a1.ts', 'claude'], ['a2.ts', 'claude'], ['a3.ts', 'claude'], ['a4.ts', 'claude'], ['b0.ts', 'codex'], ['b1.ts', 'codex'], ['b2.ts', 'codex']]);
  assert.match(h.html(), /<h2>Changed files<\/h2>/);
});

test('night-05 Home with no changed file says No agent has changed a file yet.', () => {
  g.ui.snap.sessions = [session('a', 'working')];
  const h = harness(Home); const html = h.html();
  assert.match(html, /<p class="ou-empty">No agent has changed a file yet\.<\/p>/);
  assert.equal(h.all(isFileRow).length, 0);
});

test('night-05 clicking a Changed files row opens the IDE view, then that file', async () => {
  twoAgents();
  const h = harness(Home); h.draw();
  const row = h.all(isFileRow).find((n: any) => rowText(n)[0] === 'b1.ts');
  await row.props.onClick();
  assert.deepEqual(calls, [['view', 'ide'], ['ide.open', 'b1.ts']]);
  assert.equal(row.props.role, 'button'); assert.equal(row.props.tabIndex, 0);
});

test('night-05 Home html puts Agents before the tiles and Changed files after them', () => {
  twoAgents();
  const html = harness(Home).html();
  const at = (s: string) => html.indexOf(s);
  assert.ok(at('<h2>Agents</h2>') >= 0);
  assert.ok(at('<h2>Agents</h2>') < at('ou-tiles'));
  assert.ok(at('ou-tiles') < at('<h2>Changed files</h2>'));
  assert.ok(at('ou-cards') < at('ou-tiles'));
});

// The real click dispatcher from app.js, driven with the data attributes the screens render.
function clickWith(el: any, hidden = { hidden: true }) {
  const onClick = new Function('homeView', 'document', `${fn('onClick')}; return onClick;`)(
    g.homeView, { getElementById: (id: string) => (id === 'inbox' ? hidden : { hidden: false }) },
  );
  const target = { closest: (sel: string) => (sel === '[data-action]' ? el : null) };
  return onClick({ target, stopPropagation() {} });
}
const asEl = (props: any) => ({ tagName: 'DIV', dataset: { action: props['data-action'], view: props['data-view'] }, closest: () => null });

test('night-06 Home approval row and Review button open Needs you', async () => {
  g.ui.snap.approvals = [{ id: 'ap' }];
  const h = harness(Home); h.draw();
  const row = h.one((n: any) => n.type === 'li' && n.props.className === 'ou-irow ou-unread');
  const review = h.one(label('Review'));
  for (const props of [row.props, review.props]) {
    assert.equal(props['data-action'], 'view'); assert.equal(props['data-view'], 'inbox');
  }
  g.ui.view = 'home'; await clickWith(asEl(row.props));
  assert.equal(g.ui.view, 'inbox');
  g.ui.view = 'home'; await clickWith(asEl(review.props));
  assert.equal(g.ui.view, 'inbox');
});

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
