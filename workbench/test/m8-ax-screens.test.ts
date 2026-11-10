import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm8-ax-'));
const previousHome = process.env.METATROOPER_HOME;
process.env.METATROOPER_HOME = join(temp, 'home');
after(() => { rmSync(temp, { recursive: true, force: true }); if (previousHome === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = previousHome; });
const requireUI = createRequire(join(wb, 'ui/package.json'));
const { build } = requireUI('esbuild');
async function bundle(contents: string, output: string) {
  await build({
    absWorkingDir: join(wb, 'ui'), tsconfigRaw: {},
    stdin: { contents, resolveDir: join(wb, 'ui'), loader: 'jsx' },
    plugins: [{ name: 'installed-ui-modules', setup(b: any) {
      b.onResolve({ filter: /.*/ }, (args: any) => {
        if (args.path.endsWith('.css')) return { path: args.path, namespace: 'empty-css' };
        if (args.path === 'react-dom/client') return { path: args.path, namespace: 'mount-spy' };
        if (!args.path.startsWith('.')) return { path: pathToFileURL(requireUI.resolve(args.path)).href, external: true };
        return { path: resolve(args.namespace === 'screen' ? dirname(args.importer) : join(wb, 'ui'), args.path), namespace: 'screen' };
      });
      b.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
      b.onLoad({ filter: /.*/, namespace: 'mount-spy' }, () => ({ contents: 'export const createRoot = globalThis.__axCreateRoot;', loader: 'js' }));
      b.onLoad({ filter: /.*/, namespace: 'screen' }, (args: any) => ({ contents: `import { createElement as __create, Fragment as __fragment } from 'react'; function __element(...args) { const node = __create(...args); globalThis.__axCapture?.(node); return node; }\n` + readFileSync(args.path, 'utf8'), loader: args.path.endsWith('.jsx') ? 'jsx' : 'js' }));
    } }],
    bundle: true, platform: 'node', format: 'esm', jsx: 'transform', jsxFactory: '__element', jsxFragment: '__fragment',
    loader: { '.css': 'empty' }, outfile: join(temp, output),
  });
}
await bundle("export * from './src/settings.jsx'; export * from './src/inbox.jsx'; export * from './src/addons.jsx'; export * from './src/home.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", 'screens.mjs');

const screens = await import(pathToFileURL(join(temp, 'screens.mjs')).href);
const { React, renderToStaticMarkup, Settings, settingsStore, Inbox, inboxStore, Addons, addonsStore, drawAddons, Home } = screens;
const g: any = globalThis;
const calls: any[] = [];
let data: any;
const own = new Set(['Inbox', 'Glyph', 'NoteActions', 'Addons', 'Home', 'StartBox', 'Tile', 'AgentCard']);

// Supply the server snapshot for the synthetic settings store.
settingsStore.use = () => React.useSyncExternalStore(() => () => {}, settingsStore.get, settingsStore.get);

// Expand app components with persistent hook slots and retain real library controls for server rendering.
function harness(Screen: any) {
  if (Screen === Settings) {
    let nodes: any[] = [];
    const draw = () => {
      nodes = [];
      g.__axCapture = (node: any) => nodes.push(node);
      try { return renderToStaticMarkup(React.createElement(Screen)); }
      finally { delete g.__axCapture; }
    };
    return { draw, html: draw, all: (predicate: any) => nodes.filter(predicate), one: (predicate: any) => {
      const found = nodes.find(predicate); assert.ok(found, 'rendered control exists'); return found;
    } };
  }
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
  let tree: any;
  const draw = () => { nodes = []; tree = expand(React.createElement(Screen), 'root'); return tree; };
  return {
    draw,
    html: () => renderToStaticMarkup(draw()),
    all: (predicate: any) => nodes.filter(predicate),
    one: (predicate: any) => { const found = nodes.find(predicate); assert.ok(found, 'rendered control exists'); return found; },
  };
}
const label = (text: string) => (n: any) => n.props.label === text;
const action = (text: string) => (n: any) => n.props['data-action'] === text;
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(setImmediate); };
function session(id: string, state: string, extra: any = {}) { return { id, state, project_id: 'p1', engine_id: 'synthetic', title: 'Task ' + id, ...extra }; }
function note(id: string, kind: string, extra: any = {}) { return { id, kind, text: 'Note ' + id, at: '2026-11-10T00:00:00Z', ...extra }; }
beforeEach(async () => {
  calls.length = 0;
  data = { sessions: { approval: 'ask', metarouter: false }, terminal: { font_size: 13, scrollback: 10000 }, agent_cursor: { show_caption: true }, reliability: { done_needs_check: true, loop_alarm: true, loop_nudge_at: 3, loop_stop_at: 5, token_limit: 0, false_alarms: 0, checks: { p1: 'npm test' } }, savers: { shrink_shell: false, lean_handoffs: false, small_screenshots: false, cheap_model: false }, desktop: { watch_pause: true, takeover_key: 'Ctrl+Esc' }, browser: { allow_origins: [], lent: { p1: ['https://alpha.example'], p2: ['https://private.example'] } }, worktree: { npm_ci: false, stale_days: 7 } };
  Object.assign(g, {
    ui: { view: 'home', projectId: 'p1', pendingHide: new Set(), drafts: {}, look: { theme: { name: 'neutral', scheme: 'dark' } }, settingsLook: { themes: [] }, snap: { sessions: [], live: [], approvals: [], needs_you: [], engines: [], projects: [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }] } },
    api: { settingsPage: async () => data, setSetting: async (...args: any[]) => { calls.push(['setSetting', ...args]); }, setApproval: async (...args: any[]) => { calls.push(['setApproval', ...args]); }, setCheck: async (...args: any[]) => { calls.push(['setCheck', ...args]); }, uiSettings: async () => ({}), addons: async () => [], openLogs: () => calls.push(['logs']) },
    rpc: async (...args: any[]) => { calls.push(['rpc', ...args]); return { result: { session_id: 'new-session' } }; },
    render: () => calls.push(['render']), toast: (...args: any[]) => calls.push(['toast', ...args]), applyLook: () => {}, setLook: async () => {}, openSinks: () => calls.push(['sinks']),
    project: () => g.ui.snap.projects.find((p: any) => p.id === g.ui.projectId),
    waitingAll: () => g.ui.snap.live.filter((s: any) => s.state === 'waiting_for_you'),
    isInfo: (n: any) => ['gate', 'approval', 'handoff', 'done', 'uncommitted', 'other', 'spool-too-large'].includes(n.kind) && !g.loopOf(n) && !g.lendOf(n),
    loopOf: (n: any) => n.kind === 'other' && n.ref?.startsWith('loop:') ? n.ref.slice(5) : null,
    lendOf: (n: any) => { if (n.kind !== 'other' || !n.ref?.startsWith('lend:')) return null; const [project, origin] = n.ref.slice(5).split(' '); return { project, origin }; },
    taskOf: (s: any) => s.title, ago: () => '1m ago', approvalCard: (a: any) => '<p>' + a.summary + '</p>',
    homeView: { shown: () => g.ui.view === 'home' && Boolean(g.project()), set: (v: string) => { calls.push(['view', v]); g.ui.view = v; } },
    load: () => null, save: (...args: any[]) => calls.push(['save', ...args]), pick: async (id: string) => calls.push(['pick', id]),
    changedFiles: (id: string) => id === 'working' ? ['a', 'b'] : id === 'done' ? ['c'] : [],
    STATE_ORDER: ['waiting_for_you', 'working', 'starting', 'done', 'failed', 'exited'], STATE_WORDS: {},
    document: { documentElement: { style: {} }, getElementById: () => ({ hidden: false }) },
  });
  g.needsCount = () => g.waitingAll().length + g.ui.snap.approvals.length + g.ui.snap.needs_you.filter((n: any) => !n.read_at && !g.isInfo(n)).length;
  settingsStore.set({ data, section: 'general' }); inboxStore.set({ filter: 'all' });
  g.ui.view = 'wall'; await drawAddons(); g.ui.view = 'home';
});

test('index loads the bundle after app and preserves the four screen containers', () => {
  const html = readFileSync(join(wb, 'renderer/index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
  assert.ok(scripts.indexOf('ui.bundle.js') > scripts.indexOf('app.js'));
  assert.ok(scripts.includes('home.js'));
  for (const old of ['settings.js', 'inbox.js', 'addons.js']) assert.ok(!scripts.includes(old));
  assert.match(html, /href="ui.bundle.css"/);
  for (const id of ['settings', 'needsview', 'addons', 'home']) assert.match(html, new RegExp('id="' + id + '"'));
});

test('Settings exposes all eight sections and only writable keys', () => {
  const h = harness(Settings); const html = h.html();
  for (const name of ['General', 'Appearance', 'Reliability', 'Savings', 'Safety', 'Add-ons', 'Notifications', 'Advanced']) assert.ok(html.includes(name), name);
  const source = readFileSync(join(wb, 'ui/src/settings.jsx'), 'utf8');
  const main = readFileSync(join(wb, 'src/main.ts'), 'utf8');
  const pageKeys = vm.runInNewContext(/const PAGE_KEYS = new Set\((\[[^;]+\])\)/.exec(main)![1]);
  const keys = [...source.matchAll(/key: '([a-z_]+\.[a-z_]+)'/g)].map(m => m[1]);
  assert.equal(keys.length, 17);
  for (const key of keys) assert.ok(key === 'sessions.approval' || pageKeys.includes(key), key);
});


test('Settings section navigation selects each literal group of controls', () => {
  const h = harness(Settings);
  for (const [section, row] of [['General', 'Before each tool call'], ['Appearance', 'Font size'], ['Reliability', 'Loop alarm'], ['Savings', 'Shrink shell output'], ['Safety', 'Take-over key'], ['Add-ons', 'Agents and plugins'], ['Notifications', 'Slack, ntfy and webhooks'], ['Advanced', 'Logs folder']]) {
    h.draw(); h.one((n: any) => n.props.label === section && n.props.onClick).props.onClick();
    const html = h.html(); assert.ok(html.includes(row), section);
  }
});

for (const [section, key, text, value] of [
  ['general', 'sessions.metarouter', 'Route shell commands through metarouter', false],
  ['look', 'agent_cursor.show_caption', 'Caption beside the agent cursor', true],
  ['reliability', 'reliability.done_needs_check', 'Say done only when a check passed', true],
  ['reliability', 'reliability.loop_alarm', 'Loop alarm', true],
  ['savings', 'savers.shrink_shell', 'Shrink shell output', false],
  ['savings', 'savers.lean_handoffs', 'Lean handoffs between agents', false],
  ['savings', 'savers.small_screenshots', 'Smaller screenshots', false],
  ['savings', 'savers.cheap_model', 'Cheapest model that fits each step', false],
  ['safety', 'desktop.watch_pause', 'Pause the agent when I touch the desktop', true],
  ['advanced', 'worktree.npm_ci', 'Install dependencies in each new worktree', false],
] as const) test('Settings toggles ' + key, async () => {
  settingsStore.set({ section }); const h = harness(Settings); h.draw();
  const control = h.one((n: any) => n.props.label === text && typeof n.props.onChange === 'function');
  assert.equal(control.props.value, value); assert.equal(control.props.size, 'sm');
  const markup = renderToStaticMarkup(React.createElement(control.type, control.props));
  assert.match(markup, /role="switch"/); assert.equal(/ checked(?:="")?/.test(markup), value);
  await control.props.onChange(!value); await flush();
  assert.deepEqual(calls.filter(c => c[0] === 'setSetting'), [['setSetting', key, !value]]);
});

test('approval uses setApproval and never setSetting', async () => {
  const h = harness(Settings); h.draw(); await h.one((n: any) => n.props.label === 'Before each tool call' && n.props.onChange).props.onChange('contained'); await flush();
  assert.deepEqual(calls, [['setApproval', 'contained']]);
});

for (const [section, text, key, min, max, current] of [
  ['look', 'Font size', 'terminal.font_size', 8, 28, 13],
  ['look', 'Scrollback', 'terminal.scrollback', 1000, 200000, 10000],
  ['reliability', 'Ask me after', 'reliability.loop_nudge_at', 2, 20, 3],
  ['reliability', 'Stop the agent after', 'reliability.loop_stop_at', 3, 50, 5],
  ['reliability', 'Token limit per agent', 'reliability.token_limit', 0, 100000000, 0],
  ['advanced', 'Remove unused worktrees after', 'worktree.stale_days', 1, 90, 7],
] as const) test('integer boundaries for ' + key, async () => {
  settingsStore.set({ section }); const h = harness(Settings); h.draw(); const p = h.one((n: any) => n.props.label === text && n.props.onChange).props;
  assert.equal(p.min, min); assert.equal(p.max, max); assert.equal(p.isIntegerOnly, true);
  for (const invalid of [min - 1, max + 1, min + 0.5, NaN, Infinity, current]) p.onChange(invalid);
  await flush(); assert.equal(calls.filter(c => c[0] === 'setSetting').length, 0);
  p.onChange(min); p.onChange(max); await flush();
  assert.deepEqual(calls.filter(c => c[0] === 'setSetting'), current === min ? [['setSetting', key, max]] : [['setSetting', key, min], ['setSetting', key, max]]);
});

test('Reliability has exactly six unavailable rows with no interactive control', () => {
  settingsStore.set({ section: 'reliability' }); const h = harness(Settings); const html = h.html();
  assert.equal(h.all(label('Not built yet')).length, 6);
  const rows = h.all((n: any) => n.type === 'div' && n.props.className === 'ou-row ou-soon');
  assert.equal(rows.length, 6);
  for (const row of rows) { const markup = renderToStaticMarkup(React.createElement(row.type, row.props)); assert.doesNotMatch(markup, /<(button|input|select|textarea)\b/); }
});

test('lent sites belong only to the current project and Remove revokes that origin', async () => {
  data.browser.lent.p1 = ['https://alpha.example', 'https://beta.example'];
  settingsStore.set({ section: 'safety' }); const h = harness(Settings); const html = h.html();
  assert.match(html, /https:\/\/alpha.example/); assert.doesNotMatch(html, /private.example/);
  assert.equal(h.all(label('Remove')).length, 2);
  for (const button of h.all(label('Remove'))) await button.props.onClick();
  assert.deepEqual(calls, [['rpc', 'lend.set', { project_id: 'p1', origin: 'https://alpha.example', on: false }], ['rpc', 'lend.set', { project_id: 'p1', origin: 'https://beta.example', on: false }]]);
  data.browser.lent.p1 = []; assert.match(h.html(), />None</); assert.equal(h.all(label('Remove')).length, 0);
});

test('Inbox renders literal filter counts, answer, loop, lending and read actions', () => {
  g.ui.view = 'inbox'; g.ui.snap.live = [session('ask', 'waiting_for_you', { project_id: 'p2' })];
  g.ui.snap.approvals = [{ summary: 'Synthetic approval' }];
  g.ui.snap.needs_you = [note('loop', 'other', { ref: 'loop:s-loop' }), note('lend', 'other', { ref: 'lend:p1 https://alpha.example' }), note('done', 'done'), note('failed', 'failed', { read_at: 'read' })];
  const h = harness(Inbox); const html = h.html();
  assert.deepEqual(h.all((n: any) => n.props.value && n.props.label && !n.props.onChange).map(n => n.props.label), ['All · 6', 'Needs you · 4', 'Finished · 1', 'Failed · 1']);
  for (const text of ['Synthetic approval', 'Beta']) assert.ok(html.includes(text), text);
  assert.match(html, /data-action="pick" data-id="ask"/);
  const loops = h.all(action('loop-choose'));
  assert.deepEqual(loops.map(n => [n.props['data-id'], n.props['data-choice']]), [['s-loop', 'pause'], ['s-loop', 'try-another-way'], ['s-loop', 'not-a-loop']]);
  assert.equal(h.one(action('lend-set')).props['data-project'], 'p1'); assert.equal(h.one(action('lend-set')).props['data-origin'], 'https://alpha.example');
  assert.equal(h.one(action('dismiss')).props['data-id'], 'lend');
  assert.deepEqual(h.all(action('inbox-read')).map(n => n.props['data-id']), ['loop', 'lend', 'done']);
  assert.equal(h.one(action('inbox-unread')).props['data-id'], 'failed');
});

for (const [filter, visible, absent] of [['needs', 'Note question', 'Note done'], ['done', 'Note done', 'Note failed'], ['failed', 'Note failed', 'Note question']] as const) test('Inbox filter ' + filter + ' changes visible notes', () => {
  g.ui.view = 'inbox'; g.ui.snap.needs_you = [note('question', 'question'), note('done', 'done'), note('failed', 'failed')];
  const h = harness(Inbox); h.draw(); h.one((n: any) => n.props.label === 'Filter').props.onChange(filter);
  const html = h.html(); assert.ok(html.includes(visible)); assert.ok(!html.includes(absent));
});

test('Inbox is empty when hidden and says Nothing here when empty', () => {
  const h = harness(Inbox); assert.equal(h.html(), ''); g.ui.view = 'inbox'; assert.match(h.html(), /Nothing here\./);
});

test('Add-ons renders readiness fallbacks, installs, provenance and plugin permissions', () => {
  g.ui.view = 'addons'; g.ui.snap.engines = [
    { id: 'fix', light: 'red', fix: 'Repair binary', detail: 'Wrong detail', install: 'install fix' },
    { id: 'detail', light: 'red', detail: 'Missing binary', install: 'install detail' },
    { id: 'fallback', light: 'red', install: 'install fallback' },
    { id: 'green', light: 'green', version: '3.2.1', plugin_id: 'synthetic.plugin', install: 'wrong install' },
    { id: 'yellow', light: 'yellow', version: '4.0.0' },
  ];
  addonsStore.set({ rows: [{ id: 'reader', description: 'Reads fixtures', permissions: ['Read synthetic files'], enabled: true, version: '1.2' }, { id: 'off', description: '', permissions: [], enabled: false, version: '5.0' }] });
  const h = harness(Addons); const html = h.html();
  for (const text of ['Repair binary', 'Missing binary', 'Not ready', 'install fix', 'install detail', 'install fallback', 'Ready · 3.2.1', 'Ready · 4.0.0', 'from synthetic.plugin', 'Reads fixtures', '1.2', 'Read synthetic files', 'Asks for no permissions', 'No description', '5.0 · off']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Wrong detail|wrong install/); assert.equal(h.one(label('Check agents again')).props['data-action'], 'check-engines'); assert.match(html, /data-action="check-engines"/);
});

test('Add-ons loads once, clears on leave, reloads and ignores a stale response', async () => {
  g.ui.view = 'addons'; let release: any; let requests = 0;
  g.api.addons = () => { requests++; return requests === 1 ? new Promise(r => release = r) : Promise.resolve([]); };
  const first = drawAddons(); await drawAddons(); assert.equal(requests, 1);
  const h = harness(Addons); assert.match(h.html(), /Loading\./);
  g.ui.view = 'wall'; await drawAddons(); assert.equal(h.html(), '');
  g.ui.view = 'addons'; await drawAddons(); assert.equal(requests, 2); assert.match(h.html(), /No plugins installed\./);
  release([{ id: 'stale', permissions: [], enabled: true }]); await first;
  assert.match(h.html(), /No plugins installed\./); assert.doesNotMatch(h.html(), />stale</);
});

for (const [hour, greeting] of [[0, 'Good morning'], [11, 'Good morning'], [12, 'Good afternoon'], [17, 'Good afternoon'], [18, 'Good evening'], [23, 'Good evening']] as const) test('Home greeting at hour ' + hour, () => {
  const DateClass = Date; g.Date = class extends DateClass { getHours() { return hour; } };
  try { assert.ok(harness(Home).html().includes(greeting)); } finally { g.Date = DateClass; }
});

test('Home counts cross-project waiting agents in tiles and excludes hidden and exited cards', () => {
  g.ui.snap.sessions = [session('working', 'working'), session('starting', 'starting'), session('done', 'done'), session('hidden', 'working'), session('gone', 'exited')];
  g.ui.pendingHide.add('hidden'); g.ui.snap.live = [session('wait', 'waiting_for_you', { project_id: 'p2' })];
  g.ui.snap.approvals = [{ id: 'ap' }];
  g.ui.snap.needs_you = [note('loop', 'other', { ref: 'loop:s1' }), note('lend', 'other', { ref: 'lend:p1 https://alpha.example' }), note('question', 'question'), note('read', 'question', { read_at: 'read' }), note('info', 'done')];
  const h = harness(Home); const html = h.html();
  assert.match(html, /3 agents in Alpha/);
  const tiles = h.all((n: any) => n.type?.name === 'Tile');
  assert.deepEqual(tiles.map(n => [n.props.label, n.props.n, n.props.sub]), [['Needs you', 5, 'waiting on an answer'], ['Working', 2, 'running now'], ['Finished', 1, 'ready to review'], ['Changed files', 3, 'not handed back yet']]);
  assert.equal(h.all(label('Answer')).length, 0); assert.doesNotMatch(html, /Task wait/);
  assert.equal(h.one(label('Review')).props['data-action'], 'sheet'); assert.match(html, /1 agent action waits for a yes/);
  assert.deepEqual(h.all((n: any) => n.type === 'div' && n.props['data-action'] === 'pick').map(n => n.props['data-id']), ['working', 'starting', 'done']);
  assert.doesNotMatch(html, /Task hidden|Task gone/);
  g.ui.snap.approvals.push({ id: 'ap2' }); assert.match(h.html(), /2 agent actions wait for a yes/);
});

test('Home zero tiles, singular agent, visibility and six recent notes', () => {
  const h = harness(Home); assert.match(h.html(), /No agents running in Alpha/);
  assert.deepEqual(h.all((n: any) => n.type?.name === 'Tile').map(n => [n.props.n, n.props.sub]), [[0, 'nothing waiting'], [0, 'none running'], [0, 'nothing to review'], [0, 'no changes']]);
  g.ui.snap.sessions = [session('only', 'done')]; assert.match(h.html(), /1 agent in Alpha/);
  g.ui.snap.needs_you = [note('q', 'question'), ...Array.from({ length: 8 }, (_, i) => note('r' + i, i % 2 ? 'failed' : 'done', { read_at: 'read' }))];
  h.draw(); assert.deepEqual(h.all((n: any) => n.type === 'li' && n.props['data-action'] === 'inbox-open').map(n => n.props['data-id']), ['q', 'r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
  g.ui.view = 'wall'; assert.equal(h.html(), ''); g.ui.view = 'home'; g.ui.projectId = 'missing'; assert.equal(h.html(), '');
});

test('Home start box appears only with a non-red engine', () => {
  g.ui.snap.engines = [{ id: 'bad', light: 'red' }]; const h = harness(Home); h.draw(); assert.equal(h.all(label('Start')).length, 0);
  g.ui.snap.engines.push({ id: 'ready', light: 'yellow' }); h.draw(); assert.equal(h.all(label('Start')).length, 1);
  assert.deepEqual(h.one((n: any) => n.props.label === 'Agent').props.options, [{ value: 'ready', label: 'ready' }]);
});

for (const [text, prompt] of [['', undefined], ['   ', undefined], ['  fix fixtures  ', 'fix fixtures']] as const) test('Home launch payload for ' + JSON.stringify(text), async () => {
  g.ui.snap.engines = [{ id: 'engine-a', light: 'green' }, { id: 'engine-b', light: 'yellow' }]; const h = harness(Home); h.draw();
  h.one(label('Task for a new agent')).props.onChange(text); h.one(label('Agent')).props.onChange('engine-b'); h.draw(); await h.one(label('Start')).props.onClick();
  assert.deepEqual(calls, [['rpc', 'session.launch', prompt === undefined ? { project_id: 'p1', engine_id: 'engine-b' } : { project_id: 'p1', engine_id: 'engine-b', prompt }], ['save', 'engine', 'engine-b'], ['view', 'wall'], ['pick', 'new-session']]);
  assert.equal(g.ui.drafts['home-task'], undefined);
});

test('Home launch without a result preserves the draft and does nothing else', async () => {
  g.ui.snap.engines = [{ id: 'ready', light: 'green' }]; g.rpc = async (...args: any[]) => { calls.push(['rpc', ...args]); return {}; };
  const h = harness(Home); h.draw(); h.one(label('Task for a new agent')).props.onChange('keep me'); h.draw(); await h.one(label('Start')).props.onClick();
  assert.deepEqual(calls, [['rpc', 'session.launch', { project_id: 'p1', engine_id: 'ready', prompt: 'keep me' }]]); assert.equal(g.ui.drafts['home-task'], 'keep me');
});

test('Home launches the ready fallback when a saved engine is unavailable', async () => {
  g.load = () => 'uninstalled'; g.ui.snap.engines = [{ id: 'ready', light: 'green' }];
  const h = harness(Home); h.draw(); assert.equal(h.one(label('Agent')).props.value, 'ready'); await h.one(label('Start')).props.onClick();
  assert.deepEqual(calls, [['rpc', 'session.launch', { project_id: 'p1', engine_id: 'ready' }], ['save', 'engine', 'ready'], ['view', 'wall'], ['pick', 'new-session']]);
});


test('Home approval row preserves whole-row activation', () => {
  g.ui.snap.approvals = [{ id: 'approve-row' }]; const h = harness(Home); h.draw();
  const row = h.one((n: any) => n.type === 'li' && n.props['data-action'] === 'sheet');
  assert.equal(row.props.className, 'ou-irow ou-unread');
  assert.equal(row.props.role, 'button'); assert.equal(row.props.tabIndex, 0);
  assert.match(renderToStaticMarkup(React.createElement(row.type, row.props)), /1 agent action waits for a yes/);
});

test('screen text is escaped by React', () => {
  const attack = '<img src=x onerror=1>';
  g.ui.snap.projects[0].name = attack; g.ui.snap.sessions = [session('safe', 'working', { title: attack, last_line: attack })];
  const html = harness(Home).html(); assert.match(html, /&lt;img src=x onerror=1&gt;/); assert.doesNotMatch(html, /<img src=x/);
});


test('main mounts screens and preserves global visibility and Home navigation contracts', async () => {
  const elements = new Map<string, any>(); const ready: any[] = []; const mounted: any[] = [];
  const el = (id: string) => { if (!elements.has(id)) elements.set(id, { id, hidden: true, focus: () => calls.push(['focus', id]), replaceChildren: () => calls.push(['clear', id]) }); return elements.get(id); };
  const segments = ['home', 'inbox', 'wall'].map(view => ({ dataset: { view }, pressed: '', setAttribute(name: string, value: string) { assert.equal(name, 'aria-pressed'); this.pressed = value; } }));
  g.document = { documentElement: { style: {} }, readyState: 'loading', getElementById: el, querySelectorAll: (selector: string) => { assert.equal(selector, '.vseg button'); return segments; }, addEventListener: (event: string, fn: any) => { if (event === 'DOMContentLoaded') ready.push(fn); } };
  const originalSet = g.homeView.set; const originalShown = g.homeView.shown;
  g.__axCreateRoot = (element: any) => ({ render: (tree: any) => mounted.push([element.id, tree.props.children.type.name]) });
  try {
    await bundle("import './src/main.jsx'; export { settingsStore } from './src/settings.jsx'; export { inboxStore } from './src/inbox.jsx'; export { homeStore } from './src/home.jsx';", 'main.mjs');
    const live = await import(pathToFileURL(join(temp, 'main.mjs')).href);
    assert.equal(mounted.length, 0); assert.equal(ready.length, 1); ready[0]();
    assert.deepEqual(mounted, [['settings', 'Settings'], ['needsview', 'Inbox'], ['addons', 'Addons'], ['ide', 'Ide'], ['home', 'Home']]);
    assert.ok(calls.some(c => c[0] === 'clear' && c[1] === 'home'));
    assert.deepEqual(Object.keys(g.settingsView).sort(), ['close', 'isOpen', 'open']);
    assert.deepEqual(Object.keys(g.inboxView).sort(), ['draw', 'shown']); assert.deepEqual(Object.keys(g.addonsView).sort(), ['draw', 'shown']);
    await g.settingsView.open('reliability'); assert.equal(g.settingsView.isOpen(), true); assert.equal(live.settingsStore.get().section, 'reliability'); assert.equal(live.settingsStore.get().data, data);
    assert.ok(calls.some(c => c[0] === 'focus' && c[1] === 'settings'));
    assert.equal(g.settingsView.close(), true); assert.equal(g.settingsView.close(), false); assert.equal(g.settingsView.isOpen(), false);
    await g.settingsView.open(); assert.equal(live.settingsStore.get().section, 'reliability');
    g.ui.view = 'inbox'; g.inboxView.draw(); assert.equal(g.inboxView.shown(), true); assert.equal(el('needsview').hidden, false); assert.equal(live.inboxStore.get().tick, 1);
    g.ui.view = 'wall'; g.inboxView.draw(); assert.equal(g.inboxView.shown(), false); assert.equal(el('needsview').hidden, true);
    g.ui.view = 'addons'; await g.addonsView.draw(); assert.equal(g.addonsView.shown(), true); assert.equal(el('addons').hidden, false);
    g.ui.view = 'home'; await g.addonsView.draw(); assert.equal(g.addonsView.shown(), false); assert.equal(el('addons').hidden, true);
    assert.equal(g.homeView.set, originalSet); assert.equal(g.homeView.shown, originalShown);
    g.homeView.draw(); assert.equal(el('home').hidden, false); assert.deepEqual(segments.map(s => s.pressed), ['true', 'false', 'false']); assert.equal(live.homeStore.get().tick, 1);
    g.ui.view = 'wall'; g.homeView.draw(); assert.equal(el('home').hidden, true); assert.deepEqual(segments.map(s => s.pressed), ['false', 'false', 'true']); assert.equal(live.homeStore.get().tick, 2);
  } finally { delete g.__axCreateRoot; }
});

test('renderer bundle is at least as new as every ui/src file', () => {
  const bundle = statSync(join(wb, 'renderer/ui.bundle.js')).mtimeMs;
  function check(dir: string) { for (const entry of readdirSync(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) check(path); else assert.ok(bundle >= statSync(path).mtimeMs, 'Stale ui.bundle.js: ' + path); } }
  check(join(wb, 'ui/src'));
});


for (const [kind, id, rowLabel, rowAction] of [
  ['waiting', 'ask-row', 'Task ask-row', 'pick'],
  ['question', 'question-row', 'Note question-row', 'inbox-open'],
  ['done', 'done-row', 'Note done-row', 'inbox-open'],
  ['failed', 'failed-row', 'Note failed-row', 'inbox-open'],
  ['loop', 'loop-row', 'Note loop-row', 'inbox-open'],
  ['lend', 'lend-row', 'Note lend-row', 'inbox-open'],
] as const) test('Inbox ' + kind + ' row carries its action and opens the wall', () => {
  g.ui.view = 'inbox';
  if (kind === 'waiting') g.ui.snap.live = [session(id, 'waiting_for_you')];
  else g.ui.snap.needs_you = [note(id, kind === 'loop' || kind === 'lend' ? 'other' : kind,
    kind === 'loop' ? { ref: 'loop:s-loop' } : kind === 'lend' ? { ref: 'lend:p1 https://alpha.example' } : {})];
  const h = harness(Inbox); h.draw();
  const row = h.one((n: any) => n.type === 'li' && n.props['data-id'] === id);
  assert.equal(row.props['data-action'], rowAction);
  assert.equal(row.props['data-id'], id);
  const markup = renderToStaticMarkup(React.createElement(row.type, row.props));
  assert.ok(markup.includes(rowLabel));
  const opening = /<li\b[^>]*>/.exec(markup)?.[0];
  assert.ok(opening, 'a list row is rendered');
  assert.ok(opening.includes('data-action="' + rowAction + '"'));
  assert.ok(opening.includes('data-id="' + id + '"'));
  row.props.onClick();
  assert.deepEqual(calls, [['view', 'wall']]);
});

for (const kind of ['question', 'loop', 'lend', 'done', 'failed'] as const) test('Home ' + kind + ' note carries its action on the row', () => {
  g.ui.snap.needs_you = [note('whole-row', kind === 'loop' || kind === 'lend' ? 'other' : kind,
    kind === 'loop' ? { ref: 'loop:s-loop' } : kind === 'lend' ? { ref: 'lend:p1 https://alpha.example' } : { read_at: kind === 'done' || kind === 'failed' ? 'read' : null })];
  const h = harness(Home); h.draw();
  const row = h.one((n: any) => n.type === 'li' && n.props['data-id'] === 'whole-row');
  assert.equal(row.props['data-action'], 'inbox-open');
  assert.equal(row.props['data-id'], 'whole-row');
  const opening = /<li\b[^>]*>/.exec(renderToStaticMarkup(React.createElement(row.type, row.props)))?.[0];
  assert.ok(opening?.includes('data-action="inbox-open"'));
  assert.ok(opening?.includes('data-id="whole-row"'));
});


const hasClass = (name: string) => (n: any) => typeof n.props.className === 'string' && n.props.className.split(' ').includes(name);
const textContent = (node: any): string => Array.isArray(node) ? node.map(textContent).join('') : React.isValidElement(node) ? textContent(node.props.children) : node == null ? '' : String(node);

test('Settings groups, heading, breadcrumb, navigation icons and take-over Kbd follow the new anatomy', () => {
  settingsStore.set({ section: 'reliability' }); const h = harness(Settings); h.draw();
  assert.deepEqual(h.all((n: any) => n.type === 'h3').map(textContent), ['Finishing', 'Watching', 'Budgets', 'Not built yet']);
  assert.equal(h.all(hasClass('ou-rows')).length, 4);
  assert.deepEqual(h.all(hasClass('ou-rowtitle')).map(textContent), ['Say done only when a check passed', 'Check command for this project', 'Loop alarm', 'Ask me after', 'Stop the agent after', 'False alarms so far', 'Token limit per agent', 'Fix failing checks, up to 3 tries', 'Retry provider errors', 'Check after every edit', 'Ask when a request can mean two things', 'Keep runs going when Ouros closes', 'Checkpoint every turn']);
  assert.deepEqual(h.all((n: any) => n.type === 'h1').map(textContent), ['Reliability']);
  assert.equal(textContent(h.one(hasClass('ou-crumb'))), 'Settings/Reliability');
  assert.equal(textContent(h.one(hasClass('ou-note'))), 'These run in the background. There is no screen to watch. You hear from them only when a person has to decide.');
  const groups = h.all(hasClass('ou-navgroup'));
  assert.deepEqual(groups.map(textContent), ['', 'Agents', 'Extend', '']);
  assert.deepEqual(groups.map(n => n.props.children[1].map((item: any) => item.props.label)), [['General', 'Appearance'], ['Reliability', 'Savings', 'Safety'], ['Add-ons', 'Notifications'], ['Advanced']]);
  const navs = h.all((n: any) => n.props.isSelected !== undefined && n.props.onClick);
  assert.deepEqual(navs.map(n => n.props.label), ['General', 'Appearance', 'Reliability', 'Savings', 'Safety', 'Add-ons', 'Notifications', 'Advanced']);
  assert.ok(navs.every(n => n.props.icon?.type === 'svg'));
  assert.deepEqual(navs.filter(n => n.props.isSelected).map(n => n.props.label), ['Reliability']);
  settingsStore.set({ section: 'safety' }); h.draw();
  assert.equal(h.one((n: any) => n.props.keys === 'Ctrl+Esc').type.name, 'Kbd');
});

for (const [section, key, current, defaultValue] of [
  ['general', 'sessions.metarouter', false, true],
  ['savings', 'savers.shrink_shell', true, false],
  ['reliability', 'reliability.loop_nudge_at', 9, 3],
  ['reliability', 'reliability.token_limit', 10000, 0],
  ['general', 'sessions.approval', 'contained', 'ask'],
] as const) test('Reset to default writes the literal default for ' + key, async () => {
  const [sectionKey, name] = key.split('.'); data[sectionKey][name] = current;
  data.defaults = { [key]: defaultValue }; settingsStore.set({ section });
  const h = harness(Settings); h.draw();
  const buttons = h.all(label('Reset to default')); assert.equal(buttons.length, 1);
  await buttons[0].props.onClick(); await flush();
  assert.deepEqual(calls, key === 'sessions.approval' ? [['setApproval', 'ask']] : [['setSetting', key, defaultValue]]);
  data[sectionKey][name] = defaultValue; h.draw(); assert.equal(h.all(label('Reset to default')).length, 0);
  data[sectionKey][name] = current; data.defaults = {}; h.draw(); assert.equal(h.all(label('Reset to default')).length, 0);
  delete data.defaults; h.draw(); assert.equal(h.all(label('Reset to default')).length, 0);
});

test('settingsPage returns every literal PAGE_KEYS default independently of current settings', async () => {
  const { stripTypeScriptTypes } = await import('node:module');
  const { DEFAULTS } = await import('../../core/src/settings.ts');
  const main = readFileSync(join(wb, 'src/main.ts'), 'utf8');
  const pageKeys = vm.runInNewContext(/const PAGE_KEYS = new Set\((\[[^;]+\])\)/.exec(main)![1]);
  const match = /on\('settingsPage', (\(\) => \{[\s\S]*?\n  \})\);/.exec(main); assert.ok(match);
  data.reliability.loop_nudge_at = 19; data.reliability.loop_stop_at = 49; data.reliability.token_limit = 999;
  data.terminal.font_size = 26; data.sessions.metarouter = false; data.ui = { theme: 'synthetic' };
  const handler = vm.runInNewContext(stripTypeScriptTypes('(' + match[1] + ')'), { settings: () => data, db: () => null, PAGE_KEYS: new Set(pageKeys), DEFAULTS });
  const defaults = JSON.parse(JSON.stringify(handler().defaults));
  assert.deepEqual(defaults, {
    'sessions.metarouter': true, 'desktop.watch_pause': true, 'agent_cursor.show_caption': true,
    'savers.shrink_shell': false, 'savers.lean_handoffs': false, 'savers.small_screenshots': false, 'savers.cheap_model': false,
    'worktree.npm_ci': true, 'worktree.stale_days': 7, 'terminal.font_size': 13, 'terminal.scrollback': 10000,
    'reliability.loop_alarm': true, 'reliability.loop_nudge_at': 3, 'reliability.loop_stop_at': 5, 'reliability.token_limit': 0, 'reliability.done_needs_check': true,
  });
  assert.deepEqual(Object.keys(defaults).sort(), Array.from(pageKeys).sort());
});

test('Inbox groups, columns, chips, glyphs, unread state and notice order match the contract', () => {
  g.ui.view = 'inbox'; g.ui.snap.live = [session('ask', 'waiting_for_you', { project_id: 'p2', engine_id: 'engine-b', last_line: 'Choose a fixture' })];
  g.ui.snap.needs_you = [note('read-info', 'other', { read_at: 'read' }), note('unread-info', 'other'), note('read-needs', 'question', { read_at: 'read' }), note('unread-done', 'done'), note('unread-failed', 'failed'), note('unread-needs', 'question'), note('read-done', 'done', { read_at: 'read' }), note('read-failed', 'failed', { read_at: 'read' })];
  const h = harness(Inbox); const html = h.html();
  assert.match(html, /<h1>Needs you<\/h1>/);
  assert.equal(h.one(hasClass('ou-list')).type, 'ul');
  assert.deepEqual(h.all(hasClass('ou-ihead')).map(textContent), ['Needs your answer1', 'Notices8']);
  for (const head of h.all(hasClass('ou-ihead'))) {
    assert.equal(head.type, 'li'); assert.equal(head.props['data-action'], undefined); assert.equal(head.props.tabIndex, undefined);
    assert.match(renderToStaticMarkup(head), /<i>[18]<\/i>/);
  }
  const rows = h.all(hasClass('ou-irow'));
  assert.deepEqual(rows.map(n => n.props['data-id']), ['ask', 'unread-needs', 'unread-failed', 'unread-done', 'unread-info', 'read-needs', 'read-failed', 'read-done', 'read-info']);
  assert.deepEqual(rows.map(n => hasClass('ou-unread')(n)), [true, true, true, true, true, false, false, false, false]);
  assert.ok(rows.every(n => n.type === 'li' && n.props.role === 'button' && n.props.tabIndex === 0));
  assert.deepEqual(h.all((n: any) => n.type === 'svg' && n.props['aria-label']).map(n => n.props['aria-label']), ['Needs you', 'Needs you', 'Failed', 'Finished', 'For your information', 'Needs you', 'Failed', 'Finished', 'For your information']);
  assert.deepEqual(h.all(hasClass('ou-iwho')).map(textContent), ['engine-b', '', '', '', '', '', '', '', '']);
  assert.deepEqual(h.all(hasClass('ou-chip')).map(textContent), ['Choose a fixture', 'question', 'failed', 'done', 'other', 'question', 'failed', 'done', 'other']);
  assert.equal(h.all(hasClass('ou-ititle')).length, 9); assert.equal(h.all(hasClass('ou-imeta')).length, 9);
  assert.deepEqual(h.all(hasClass('ou-itime')).map(textContent), ['1m ago', '1m ago', '1m ago', '1m ago', '1m ago', '1m ago', '1m ago', '1m ago', '1m ago']);
  assert.notEqual(h.one(label('Answer')).props.variant, 'primary');
  g.ui.snap.live = []; h.draw(); assert.deepEqual(h.all(hasClass('ou-ihead')).map(textContent), ['Notices8']);
  g.ui.snap.needs_you = []; g.ui.snap.live = [session('ask', 'waiting_for_you')]; h.draw(); assert.deepEqual(h.all(hasClass('ou-ihead')).map(textContent), ['Needs your answer1']);
  g.ui.snap.live = []; h.draw(); assert.equal(h.all(hasClass('ou-ihead')).length, 0);
});

test('Home puts Answer in the waiting agent card and renders literal card anatomy', () => {
  g.ui.snap.sessions = [session('done', 'done', { last_line: 'All checks passed' }), session('working', 'working', { last_line: 'Editing fixtures' }), session('wait', 'waiting_for_you', { last_line: 'Choose a fixture' })];
  g.ui.snap.live = [session('wait', 'waiting_for_you')]; g.STATE_WORDS = { waiting_for_you: 'Needs you', working: 'Working', done: 'Finished' };
  const h = harness(Home); const html = h.html();
  const cards = h.all(hasClass('ou-agent'));
  assert.deepEqual(cards.map(n => n.props['data-id']), ['wait', 'working', 'done']);
  assert.ok(cards.every(n => n.props.className === 'ou-agent' && n.props['data-action'] === 'pick' && n.props.tabIndex === 0 && n.props.role === 'button'));
  const markup = cards.map(n => renderToStaticMarkup(n));
  assert.match(markup[0], /<header>.*synthetic.*Needs you.*1m ago.*<\/header><p>Task wait<\/p><pre>Choose a fixture<\/pre><footer><span>No changes yet<\/span><button[^>]*data-action="pick" data-id="wait"/);
  assert.match(markup[1], /<pre>Editing fixtures<\/pre><footer><span>2 changed files<\/span>/);
  assert.match(markup[2], /<pre>All checks passed<\/pre><footer><span>1 changed file<\/span>/);
  assert.equal(h.all(label('Answer')).length, 1); assert.notEqual(h.one(label('Answer')).props.variant, 'primary');
  assert.equal(h.all(hasClass('ou-irow')).length, 0); assert.doesNotMatch(html, /Waiting on you|ou-agent-wait/);
  const tiles = h.all(hasClass('ou-tile')); assert.equal(tiles.length, 4);
  assert.deepEqual(tiles.map(n => hasClass('ou-hot')(n)), [true, false, false, false]);
  assert.match(renderToStaticMarkup(tiles[0]), /<b>1<\/b><span class="ou-tilelabel">Needs you<\/span><span class="ou-tilesub">waiting on an answer<\/span>/);
});

test('Home section order and Waiting on you contain only approvals and alerts', () => {
  g.ui.snap.engines = [{ id: 'ready', light: 'green' }]; g.ui.snap.sessions = [session('wait', 'waiting_for_you')]; g.ui.snap.live = [session('wait', 'waiting_for_you')];
  g.ui.snap.approvals = [{ id: 'a' }]; g.ui.snap.needs_you = [note('alert', 'question'), note('recent', 'done')];
  const h = harness(Home); const html = h.html();
  assert.ok(html.indexOf('ou-composer') < html.indexOf('ou-tiles'));
  assert.ok(html.indexOf('ou-tiles') < html.indexOf('<h2>Agents</h2>'));
  assert.ok(html.indexOf('<h2>Agents</h2>') < html.indexOf('<h2>Waiting on you</h2>'));
  assert.ok(html.indexOf('<h2>Waiting on you</h2>') < html.indexOf('<h2>Recent</h2>'));
  assert.equal(h.one(label('Task for a new agent')).props.rows, 1);
  assert.deepEqual(h.all(hasClass('ou-irow')).map(n => [n.props['data-action'], n.props['data-id']]), [['sheet', undefined], ['inbox-open', 'alert'], ['inbox-open', 'recent']]);
  g.ui.snap.approvals = []; g.ui.snap.needs_you = []; const quiet = h.html(); assert.doesNotMatch(quiet, /Waiting on you/);
  g.ui.snap.live = []; g.ui.snap.sessions = []; h.draw(); assert.equal(h.all(hasClass('ou-hot')).length, 0);
});

test('Home Ctrl+Enter launches the current draft and selected engine like Start', async () => {
  g.ui.snap.engines = [{ id: 'engine-a', light: 'green' }, { id: 'engine-b', light: 'yellow' }];
  const h = harness(Home); h.draw(); h.one(label('Task for a new agent')).props.onChange('  keyboard fixture  '); h.one(label('Agent')).props.onChange('engine-b'); h.draw();
  const keydown = h.one(hasClass('ou-composer')).props.onKeyDown;
  let prevented = 0;
  keydown({ key: 'Enter', ctrlKey: false, preventDefault: () => prevented++ }); keydown({ key: 'x', ctrlKey: true, preventDefault: () => prevented++ });
  await flush(); assert.deepEqual(calls, []); assert.equal(prevented, 0);
  keydown({ key: 'Enter', ctrlKey: true, preventDefault: () => prevented++ }); await flush();
  assert.equal(prevented, 1);
  assert.deepEqual(calls, [['rpc', 'session.launch', { project_id: 'p1', engine_id: 'engine-b', prompt: 'keyboard fixture' }], ['save', 'engine', 'engine-b'], ['view', 'wall'], ['pick', 'new-session']]);
  assert.equal(g.ui.drafts['home-task'], undefined);
});

test('Add-ons has a scoped root and plain page and section headings', () => {
  g.ui.view = 'addons'; const h = harness(Addons); const html = h.html();
  assert.equal(h.one(hasClass('ou-addons')).type, 'div'); assert.match(html, /<h1>Add-ons<\/h1>/);
  assert.deepEqual(h.all((n: any) => n.type === 'h2').map(textContent), ['Agents', 'Plugins']);
});

async function keyboardHarness() {
  const listeners: any[] = []; const focused: string[] = []; const clicked: string[] = []; let prevented = 0;
  const row = (id: string, className = 'ou-irow'): any => {
    const r: any = { id, className, contains: (element: any) => element === r || element?.owner === r,
      matches: (selector: string) => { assert.equal(selector, '.ou-irow, .ou-agent'); return ['ou-irow', 'ou-agent'].includes(className); },
      closest: () => null, focus() { g.document.activeElement = r; focused.push(id); }, click: () => clicked.push(id) };
    return r;
  };
  const rows = [row('first'), row('middle'), row('last')]; const head = row('header', 'ou-ihead'); const card = row('agent', 'ou-agent');
  g.document = { documentElement: { style: {} }, readyState: 'loading', activeElement: null,
    addEventListener: (name: string, fn: any) => { if (name === 'keydown') listeners.push(fn); },
    getElementById: (id: string) => { assert.equal(id, 'needsview'); return { querySelectorAll: (selector: string) => { assert.equal(selector, '.ou-irow'); return rows; } }; },
  };
  g.__axCreateRoot = () => { throw new Error('screens should wait for DOMContentLoaded'); };
  try {
    const name = 'keyboard-' + keyboardSequence++ + '.mjs'; await bundle("import './src/main.jsx';", name); await import(pathToFileURL(join(temp, name)).href);
  } finally { delete g.__axCreateRoot; }
  assert.equal(listeners.length, 3);
  return { rows, head, card, focused, clicked, get prevented() { return prevented; },
    clear() { focused.length = 0; clicked.length = 0; prevented = 0; },
    press(key: string, extra: any = {}) { const e = { key, ctrlKey: false, altKey: false, metaKey: false, target: { closest: () => null }, preventDefault: () => prevented++, ...extra }; for (const listener of listeners) listener(e); },
  };
}
let keyboardSequence = 0;

test('Needs you j and k focus rows, wrap and skip group headers', async () => {
  const h = await keyboardHarness(); g.ui.view = 'inbox';
  for (const key of ['j', 'j', 'j', 'j', 'k', 'k', 'k', 'k']) h.press(key);
  assert.deepEqual(h.focused, ['first', 'middle', 'last', 'first', 'last', 'middle', 'first', 'last']); assert.equal(h.prevented, 8);
  g.document.activeElement = { owner: h.rows[1] }; h.press('j'); assert.equal(g.document.activeElement, h.rows[2]);
  g.document.activeElement = { owner: h.rows[1] }; h.press('k'); assert.equal(g.document.activeElement, h.rows[0]);
  g.document.activeElement = h.head; h.press('j'); assert.equal(g.document.activeElement, h.rows[0]);
  g.document.activeElement = null; h.press('k'); assert.equal(g.document.activeElement, h.rows[2]);
});

test('Needs you j and k ignore other views, fields, modified keys and empty lists', async () => {
  const h = await keyboardHarness();
  for (const key of ['j', 'k']) {
    for (const view of ['home', 'wall', 'addons', 'settings']) { g.ui.view = view; h.press(key); }
    g.ui.view = 'inbox'; for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) h.press(key, { [modifier]: true });
    for (const tag of ['input', 'textarea', 'select']) for (const nested of [false, true]) h.press(key, { target: { tagName: nested ? 'SPAN' : tag.toUpperCase(), closest: (selector: string) => { assert.equal(selector, 'input, textarea, select'); return { tagName: tag.toUpperCase() }; } } });
  }
  h.press('x'); h.rows.length = 0; h.press('j'); h.press('k');
  assert.deepEqual(h.focused, []); assert.equal(h.prevented, 0);
});

test('Enter and Space click focused rows and agent cards but ignore group headers and nested controls', async () => {
  const h = await keyboardHarness();
  for (const key of ['Enter', ' ']) { h.press(key, { target: h.rows[0] }); h.press(key, { target: h.card }); }
  assert.deepEqual(h.clicked, ['first', 'agent', 'first', 'agent']); assert.equal(h.prevented, 4); h.clear();
  for (const key of ['Enter', ' ']) {
    h.press(key, { target: h.head });
    for (const tag of ['BUTTON', 'INPUT', 'TEXTAREA', 'SELECT', 'SPAN']) h.press(key, { target: { tagName: tag, matches: () => false, click: () => h.clicked.push(tag), closest: () => null } });
  }
  h.press('x', { target: h.rows[0] }); assert.deepEqual(h.clicked, []); assert.equal(h.prevented, 0);
});

test('Settings search, focus, reset and check-command handlers in a real React root', async t => {
  const output = join(temp, 'settings-root.js');
  await build({ absWorkingDir: join(wb, 'ui'), tsconfigRaw: {}, stdin: { contents: readFileSync(join(wb, 'test/fixtures/m8-ax-settings-root.jsx'), 'utf8'), resolveDir: join(wb, 'test/fixtures'), loader: 'jsx' }, plugins: [{ name: 'browser-fixture-modules', setup(b: any) {
    b.onResolve({ filter: /.*/ }, (args: any) => {
      if (args.path.endsWith('.css')) return { path: args.path, namespace: 'css-stub' };
      const path = args.path.startsWith('.') ? createRequire(args.namespace === 'fixture' ? args.importer : join(wb, 'test/fixtures/entry.js')).resolve(args.path) : requireUI.resolve(args.path);
      return { path, namespace: 'fixture' };
    });
    b.onLoad({ filter: /.*/, namespace: 'css-stub' }, () => ({ contents: '', loader: 'js' }));
    b.onLoad({ filter: /.*/, namespace: 'fixture' }, (args: any) => ({ contents: readFileSync(args.path, 'utf8'), loader: args.path.endsWith('.jsx') ? 'jsx' : 'js' }));
  } }], define: { 'process.env.NODE_ENV': '"development"' }, bundle: true, platform: 'browser', format: 'iife', globalName: 'settingsRootTests', jsx: 'automatic', loader: { '.css': 'empty' }, outfile: output });
  const page = join(temp, 'settings-root.html');
  writeFileSync(page, '<!doctype html><html><body><button id="outside">Outside</button><div id="root"></div></body></html>');
  const entry = join(temp, 'settings-root.cjs');
  writeFileSync(entry, `
    const { app, BrowserWindow } = require('electron');
    const fs = require('node:fs');
    app.setPath('userData', process.env.METATROOPER_HOME);
    app.disableHardwareAcceleration();
    app.whenReady().then(async () => {
      const win = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
      await win.loadFile(${JSON.stringify(page)});
      await win.webContents.executeJavaScript(fs.readFileSync(${JSON.stringify(output)}, 'utf8'));
      const result = await win.webContents.executeJavaScript('settingsRootTests.run(' + ${JSON.stringify(JSON.stringify(data))} + ')');
      process.stdout.write('AX_RESULTS ' + JSON.stringify(result) + '\\n');
      win.destroy(); app.exit(0);
    }).catch(error => { process.stderr.write(String(error.stack)); app.exit(1); });
  `);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(join(wb, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron'), [entry, '--no-sandbox'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Electron settings fixture timed out: ' + stderr)); }, 45000);
    child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
  assert.equal(result.code, 0, result.stderr + result.stdout);
  const match = /^AX_RESULTS (.+)$/m.exec(result.stdout); assert.ok(match, result.stdout + result.stderr);
  const results = JSON.parse(match[1]); assert.equal(results.length, 8);
  for (const item of results) await t.test(item.name, () => assert.equal(item.error, undefined, item.error));
});
