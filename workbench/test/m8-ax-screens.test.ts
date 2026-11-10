import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';

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
      b.onLoad({ filter: /.*/, namespace: 'screen' }, (args: any) => ({ contents: readFileSync(args.path, 'utf8'), loader: args.path.endsWith('.jsx') ? 'jsx' : 'js' }));
    } }],
    bundle: true, platform: 'node', format: 'esm', jsx: 'automatic',
    loader: { '.css': 'empty' }, outfile: join(temp, output),
  });
}
await bundle("export * from './src/settings.jsx'; export * from './src/inbox.jsx'; export * from './src/addons.jsx'; export * from './src/home.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", 'screens.mjs');

const screens = await import(pathToFileURL(join(temp, 'screens.mjs')).href);
const { React, renderToStaticMarkup, Settings, settingsStore, Inbox, inboxStore, Addons, addonsStore, drawAddons, Home } = screens;
const g: any = globalThis;
const calls: any[] = [];
let data: any;
const own = new Set(['Settings', 'Control', 'CheckCommand', 'Inbox', 'NoteActions', 'Addons', 'Home', 'StartBox', 'Tile']);

// Expand app components with persistent hook slots and retain real library controls for server rendering.
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
    document: { getElementById: () => ({ hidden: false }) },
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
  for (const [section, row] of [['General', 'Before each tool call'], ['Appearance', 'Terminal font size'], ['Reliability', 'Loop alarm'], ['Savings', 'Shrink shell output'], ['Safety', 'Take-over key'], ['Add-ons', 'Agents and plugins'], ['Notifications', 'Slack, ntfy and webhooks'], ['Advanced', 'Logs folder']]) {
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
  assert.equal(control.props.value, value);
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
  ['look', 'Terminal font size', 'terminal.font_size', 8, 28, 13],
  ['look', 'Terminal scrollback', 'terminal.scrollback', 1000, 200000, 10000],
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
  const rows = h.all((n: any) => n.props.row?.soon);
  assert.equal(rows.length, 6);
  for (const row of rows) { const markup = renderToStaticMarkup(React.createElement(row.type, row.props)); assert.doesNotMatch(markup, /<(button|input|select|textarea)\b/); }
});

for (const event of ['enter', 'blur']) test('check command saves changed text on ' + event + ' and ignores unchanged text', async () => {
  settingsStore.set({ section: 'reliability' }); const h = harness(Settings); h.draw();
  const input = () => h.one((n: any) => n.props.label === 'Check command for this project' && n.props.onChange);
  const commit = async () => event === 'enter' ? input().props.onEnter() : h.one((n: any) => n.type === 'span' && n.props.onBlur).props.onBlur();
  await commit(); assert.deepEqual(calls, []);
  input().props.onChange('node --test'); h.draw(); await commit();
  assert.deepEqual(calls, [['setCheck', 'p1', 'node --test']]);
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

test('Home shows literal tiles, cross-project waiting actions and excludes hidden and exited agents', () => {
  g.ui.snap.sessions = [session('working', 'working'), session('starting', 'starting'), session('done', 'done'), session('hidden', 'working'), session('gone', 'exited')];
  g.ui.pendingHide.add('hidden'); g.ui.snap.live = [session('wait', 'waiting_for_you', { project_id: 'p2' })];
  g.ui.snap.approvals = [{ id: 'ap' }];
  g.ui.snap.needs_you = [note('loop', 'other', { ref: 'loop:s1' }), note('lend', 'other', { ref: 'lend:p1 https://alpha.example' }), note('question', 'question'), note('read', 'question', { read_at: 'read' }), note('info', 'done')];
  const h = harness(Home); const html = h.html();
  assert.match(html, /3 agents in Alpha/);
  const tiles = h.all((n: any) => n.type?.name === 'Tile');
  assert.deepEqual(tiles.map(n => [n.props.label, n.props.n, n.props.sub]), [['Needs you', 5, 'waiting on an answer'], ['Working', 2, 'running now'], ['Finished', 1, 'ready to review'], ['Changed files', 3, 'not handed back yet']]);
  assert.equal(h.one((n: any) => n.props.label === 'Answer').props['data-id'], 'wait'); assert.ok(html.includes('Beta'));
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
  h.draw(); assert.deepEqual(h.all((n: any) => n.props.label === 'Open' && n.props['data-action'] === 'inbox-open').map(n => n.props['data-id']), ['q', 'r0', 'r1', 'r2', 'r3', 'r4', 'r5']);
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


for (const [name, setup, rowLabel, expected] of [
  ['waiting', () => { g.ui.snap.live = [session('wait-row', 'waiting_for_you')]; }, 'Task wait-row', { 'data-action': 'pick', 'data-id': 'wait-row' }],
  ['approval', () => { g.ui.snap.approvals = [{ id: 'approve-row' }]; }, '1 agent action waits for a yes', { 'data-action': 'sheet' }],
] as const) test('Home ' + name + ' row preserves whole-row activation', () => {
  setup(); const h = harness(Home); h.draw();
  const row = h.one((n: any) => n.props.label === rowLabel && n.props.endContent);
  for (const [key, value] of Object.entries(expected)) assert.equal(row.props[key], value);
  const opening = /<li\b[^>]*>/.exec(renderToStaticMarkup(React.createElement(row.type, row.props)))?.[0];
  assert.ok(opening, 'a list row is rendered');
  for (const [key, value] of Object.entries(expected)) assert.ok(opening.includes(key + '="' + value + '"'));
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
  g.document = { readyState: 'loading', getElementById: el, querySelectorAll: (selector: string) => { assert.equal(selector, '.vseg button'); return segments; }, addEventListener: (event: string, fn: any) => { if (event === 'DOMContentLoaded') ready.push(fn); } };
  const originalSet = g.homeView.set; const originalShown = g.homeView.shown;
  g.__axCreateRoot = (element: any) => ({ render: (tree: any) => mounted.push([element.id, tree.props.children.type.name]) });
  try {
    await bundle("import './src/main.jsx'; export { settingsStore } from './src/settings.jsx'; export { inboxStore } from './src/inbox.jsx'; export { homeStore } from './src/home.jsx';", 'main.mjs');
    const live = await import(pathToFileURL(join(temp, 'main.mjs')).href);
    assert.equal(mounted.length, 0); assert.equal(ready.length, 1); ready[0]();
    assert.deepEqual(mounted, [['settings', 'Settings'], ['needsview', 'Inbox'], ['addons', 'Addons'], ['home', 'Home']]);
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
  const row = h.one((n: any) => n.props.label === rowLabel && n.props.endContent);
  assert.equal(row.props['data-action'], rowAction);
  assert.equal(row.props['data-id'], id);
  const markup = renderToStaticMarkup(React.createElement(row.type, row.props));
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
  const row = h.one((n: any) => n.props.label === 'Note whole-row' && n.props.endContent);
  assert.equal(row.props['data-action'], 'inbox-open');
  assert.equal(row.props['data-id'], 'whole-row');
  const opening = /<li\b[^>]*>/.exec(renderToStaticMarkup(React.createElement(row.type, row.props)))?.[0];
  assert.ok(opening?.includes('data-action="inbox-open"'));
  assert.ok(opening?.includes('data-id="whole-row"'));
});

test('Needs you j and k focus first controls, wrap, and ignore editing and modified keys', async () => {
  const listeners = new Map<string, any>();
  const focused: string[] = [];
  let prevented = 0;
  const rows: any[] = [];
  const control = (id: string, row: any) => ({
    closest: (selector: string) => { assert.equal(selector, 'li'); return row; },
    focus() { g.document.activeElement = this; focused.push(id); },
  });
  for (const id of ['first', 'middle', 'last']) {
    const row: any = { contains: (element: any) => element === row.first || element === row.second };
    row.first = control(id, row); row.second = control(id + '-second', row);
    row.querySelector = (selector: string) => { assert.equal(selector, 'button, [tabindex], a'); return row.first; };
    rows.push(row);
  }
  g.document = {
    readyState: 'loading', activeElement: null,
    addEventListener: (name: string, fn: any) => listeners.set(name, fn),
    getElementById: (id: string) => { assert.equal(id, 'needsview'); return { querySelectorAll: (selector: string) => { assert.equal(selector, 'li'); return rows; } }; },
  };
  g.__axCreateRoot = () => { throw new Error('screens should wait for DOMContentLoaded'); };
  try {
    await bundle("import './src/main.jsx';", 'keyboard.mjs');
    await import(pathToFileURL(join(temp, 'keyboard.mjs')).href);
    assert.equal(typeof listeners.get('keydown'), 'function');
    const press = (key: string, extra: any = {}) => listeners.get('keydown')({
      key, ctrlKey: false, altKey: false, metaKey: false,
      target: { closest: (selector: string) => { assert.equal(selector, 'input, textarea, select'); return null; } },
      preventDefault: () => { prevented++; }, ...extra,
    });
    g.ui.view = 'inbox';
    for (const key of ['j', 'j', 'j', 'j', 'k', 'k', 'k', 'k']) press(key);
    assert.deepEqual(focused, ['first', 'middle', 'last', 'first', 'last', 'middle', 'first', 'last']);
    assert.equal(prevented, 8);
    g.document.activeElement = rows[1].second; press('j');
    assert.equal(g.document.activeElement, rows[2].first);
    g.document.activeElement = rows[1].second; press('k');
    assert.equal(g.document.activeElement, rows[0].first);
    g.document.activeElement = null; press('k');
    assert.equal(g.document.activeElement, rows[2].first);
    focused.length = 0; prevented = 0;
    for (const key of ['j', 'k']) {
      for (const view of ['home', 'wall', 'addons', 'settings']) { g.ui.view = view; press(key); }
      g.ui.view = 'inbox';
      for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) press(key, { [modifier]: true });
      for (const tag of ['input', 'textarea', 'select']) {
        const editor = { tagName: tag.toUpperCase() };
        for (const nested of [false, true]) press(key, { target: {
          tagName: nested ? 'SPAN' : editor.tagName,
          closest: (selector: string) => { assert.equal(selector, 'input, textarea, select'); return editor; },
        } });
      }
    }
    press('x');
    assert.deepEqual(focused, []); assert.equal(prevented, 0);
    rows.length = 0; press('j'); press('k');
    assert.deepEqual(focused, []); assert.equal(prevented, 0);
  } finally { delete g.__axCreateRoot; }
});
