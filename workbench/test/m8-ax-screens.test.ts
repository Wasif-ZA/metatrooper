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
  try { await build({
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
  }); } catch (error: any) {
    if (error.code !== 'EPERM' || process.platform !== 'win32') throw error;
    // Compile real sources with inherited handles and the same capture and mount boundaries.
    const helper = join(temp, 'capture.jsx');
    writeFileSync(helper, `import { createElement, Fragment } from ${JSON.stringify(requireUI.resolve('react'))}; export const __fragment = Fragment; export function __element(...args) { const node = createElement(...args); globalThis.__axCapture?.(node); return node; }`);
    const mount = join(temp, 'mount.mjs');
    writeFileSync(mount, 'export const createRoot = globalThis.__axCreateRoot;');
    const entry = join(temp, output + '.jsx');
    const source = contents.replaceAll("'./src/", "'" + join(wb, 'ui/src/').replaceAll('\\', '/')).replace(/'(react(?:-dom\/server)?)'/g, (_, name) => JSON.stringify(requireUI.resolve(name)));
    writeFileSync(entry, source);
    const binary = join(dirname(requireUI.resolve('esbuild/package.json')), '../@esbuild/win32-x64/esbuild.exe');
    await new Promise<void>((resolveBuild, reject) => {
      const child = spawn(binary, [entry, '--bundle', '--platform=node', '--format=esm', '--jsx=transform', '--jsx-factory=__element', '--jsx-fragment=__fragment', '--inject:' + helper, '--alias:react-dom/client=' + mount, '--loader:.css=empty', '--banner:js=import { createRequire as __axRequire } from "node:module"; const require = __axRequire(import.meta.url);', '--outfile=' + join(temp, output)], { stdio: 'inherit', windowsHide: true });
      child.on('error', reject); child.on('exit', code => code === 0 ? resolveBuild() : reject(new Error('esbuild exited ' + code)));
    });
  }
}
await bundle("export * from './src/plugin-install.jsx'; export * from './src/automations.jsx'; export * from './src/settings.jsx'; export * from './src/inbox.jsx'; export * from './src/addons.jsx'; export * from './src/home.jsx'; export * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';", 'screens.mjs');

const screens = await import(pathToFileURL(join(temp, 'screens.mjs')).href);
const { React, renderToStaticMarkup, Settings, settingsStore, Inbox, inboxStore, Addons, addonsStore, drawAddons, Home, homeStore } = screens;
const g: any = globalThis;
const calls: any[] = [];
let data: any;
const own = new Set(['Inbox', 'Glyph', 'NoteActions', 'DetailAsk', 'DetailNotice', 'TerminalPreview', 'Addons', 'Home', 'RailCard', 'AutomationsPage', 'TemplateCards', 'AutomationEditor', 'StartBox', 'Tile', 'AgentCard', 'AgentHead', 'PluginInstall', 'Automations', 'Field', 'Screen', 'CheckCommand']);

// Supply the server snapshot for the synthetic settings store.
settingsStore.use = () => React.useSyncExternalStore(() => () => {}, settingsStore.get, settingsStore.get);

// Expand app components with persistent hook slots and retain real library controls for server rendering.
function harness(Screen: any, runEffects = false) {
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
      const slots = frames.get(path) || []; frames.set(path, slots); let cursor = 0; let rerender = false;
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H;
      internals.H = {
        useEffect: (fn: any) => { if (runEffects) { const i = cursor++; if (!slots[i]) { slots[i] = true; queueMicrotask(fn); } } },
        useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
        useRef: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = { current: initial }; return slots[i]; },
        useLayoutEffect: () => {},
        useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (v: any) => { const next = typeof v === 'function' ? v(slots[i]) : v; if (!Object.is(next, slots[i])) { slots[i] = next; rerender = true; } }]; },
      };
      let output;
      try {
        let renders = 0;
        do {
          assert.ok(renders++ < 25, 'render-phase state updates settle');
          cursor = 0; rerender = false; output = value.type(value.props);
        } while (rerender);
      } finally { internals.H = previous; }
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
  settingsStore.set({ data, section: 'general' }); inboxStore.set({ filter: 'all', selectedId: null, collapsed: [] });
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

test('Settings exposes all nine sections and only writable keys', () => {
  const h = harness(Settings); const html = h.html();
  for (const name of ['General', 'Appearance', 'Reliability', 'Savings', 'Safety', 'Automations', 'Add-ons', 'Notifications', 'Advanced']) assert.ok(html.includes(name), name);
  const source = readFileSync(join(wb, 'ui/src/settings.jsx'), 'utf8');
  const main = readFileSync(join(wb, 'src/main.ts'), 'utf8');
  const pageKeys = vm.runInNewContext(/const PAGE_KEYS = new Set\((\[[^;]+\])\)/.exec(main)![1]);
  const keys = [...source.matchAll(/key: '([a-z_]+\.[a-z_]+)'/g)].map(m => m[1]);
  assert.equal(keys.length, 22);
  for (const key of keys) assert.ok(key === 'sessions.approval' || pageKeys.includes(key), key);
});


test('Settings section navigation selects each literal group of controls', () => {
  const h = harness(Settings);
  for (const [section, row] of [['General', 'Before each tool call'], ['General', 'Font size'], ['Reliability', 'Loop alarm'], ['Savings', 'Shrink shell output'], ['Safety', 'Take-over key'], ['Add-ons', 'Agents and plugins'], ['Notifications', 'Slack, ntfy and webhooks'], ['Advanced', 'Logs folder']]) {
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
  assert.equal(h.all(hasClass('ou-soontag')).length, 6); assert.ok(h.all(hasClass('ou-soontag')).every(n => textContent(n) === 'Not built yet'));
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

test('Inbox renders group heads, approvals, loop, lending and read actions', () => {
  g.ui.view = 'inbox'; g.ui.snap.live = [session('ask', 'waiting_for_you', { project_id: 'p2' })];
  g.ui.snap.approvals = [{ summary: 'Synthetic approval' }];
  g.ui.snap.needs_you = [note('loop', 'other', { ref: 'loop:s-loop' }), note('lend', 'other', { ref: 'lend:p1 https://alpha.example' }), note('done', 'done'), note('failed', 'failed', { read_at: 'read' })];
  const h = harness(Inbox); const html = h.html();
  assert.deepEqual(h.all(hasClass('ou-ny-ghead')).map(textContent), ['Needs your answer4', 'Working0', 'In review0', 'Failed1', 'Done1']);
  assert.ok(html.includes('Synthetic approval'));
  assert.match(html, /data-action="pick" data-id="ask"/);
  assert.deepEqual(h.all(action('inbox-read')).map(n => n.props['data-id']), ['loop', 'lend', 'done']);
  assert.equal(h.one(action('inbox-unread')).props['data-id'], 'failed');
  assert.equal(h.all(action('loop-choose')).length, 0);
  inboxStore.set({ selectedId: 'loop' }); h.draw();
  assert.deepEqual(h.all(action('loop-choose')).map(n => [n.props['data-id'], n.props['data-choice']]), [['s-loop', 'pause'], ['s-loop', 'try-another-way'], ['s-loop', 'not-a-loop']]);
  inboxStore.set({ selectedId: 'lend' }); h.draw();
  assert.equal(h.one(action('lend-set')).props['data-project'], 'p1'); assert.equal(h.one(action('lend-set')).props['data-origin'], 'https://alpha.example');
  assert.equal(h.one((n: any) => action('dismiss')(n) && n.props.label === 'No').props['data-id'], 'lend');
  inboxStore.set({ selectedId: 'ask' }); assert.ok(h.html().includes('Beta'));
  h.one((n: any) => hasClass('ou-ny-ghead')(n) && n.props['data-group'] === 'needs').props.onClick(); h.draw();
  assert.deepEqual(h.all(hasClass('ou-irow')).map(n => n.props['data-id']), ['failed', 'done']); assert.equal(h.all(hasClass('igates')).length, 0);
});

for (const [group, hidden, shown] of [['needs', 'Note question', 'Note done'], ['done', 'Note done', 'Note failed'], ['failed', 'Note failed', 'Note question']] as const) test('Inbox folding ' + group + ' hides only its notes', () => {
  g.ui.view = 'inbox'; g.ui.snap.needs_you = [note('question', 'question'), note('done', 'done'), note('failed', 'failed')];
  const h = harness(Inbox); h.draw(); h.one((n: any) => hasClass('ou-ny-ghead')(n) && n.props['data-group'] === group).props.onClick();
  const html = h.html(); assert.ok(!html.includes(hidden)); assert.ok(html.includes(shown));
});

test('Inbox is empty when hidden and shows one empty message in the list', () => {
  const h = harness(Inbox); assert.equal(h.html(), ''); g.ui.view = 'inbox';
  const html = h.html();
  assert.equal((html.match(/Nothing is waiting on you\./g) || []).length, 1);
  const empty = h.all((n: any) => n.props.title === 'Nothing is waiting on you.');
  assert.equal(empty.length, 1);
  assert.match(renderToStaticMarkup(h.one(hasClass('ou-inbox-list'))), /Nothing is waiting on you\./);
  assert.equal(h.one(hasClass('ou-ipane')).props['data-state'], 'empty');
  assert.equal(h.all(hasClass('ou-ny-ghead')).length, 0);
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
  for (const text of ['Repair binary', 'Missing binary', 'Not ready', 'install fix', 'install detail', 'install fallback', 'v3.2.1', 'v4.0.0', 'from synthetic.plugin', 'Reads fixtures', 'v1.2', 'Read synthetic files', 'No permissions', 'No description', 'v5.0']) assert.ok(html.includes(text), text);
  assert.doesNotMatch(html, /Wrong detail|wrong install/); assert.equal(h.one(label('Check agents again')).props['data-action'], 'check-engines'); assert.match(html, /data-action="check-engines"/);
});

test('Add-ons loads once, clears on leave, reloads and ignores a stale response', async () => {
  g.ui.view = 'addons'; let release: any; let requests = 0;
  g.api.addons = () => { requests++; return requests === 1 ? new Promise(r => release = r) : Promise.resolve([]); };
  const first = drawAddons(); await drawAddons(); assert.equal(requests, 1);
  const h = harness(Addons); assert.match(h.html(), /Loading plugins\./);
  g.ui.view = 'wall'; await drawAddons(); assert.equal(h.html(), '');
  g.ui.view = 'addons'; await drawAddons(); assert.equal(requests, 2); assert.match(h.html(), /No plugins installed\./);
  release([{ id: 'stale', permissions: [], enabled: true }]); await first;
  assert.match(h.html(), /No plugins installed\./); assert.doesNotMatch(h.html(), />stale</);
});




test('Home start box appears only with a non-red engine and ends with the Start arrow', () => {
  g.ui.snap.engines = [{ id: 'bad', light: 'red' }]; const h = harness(Home); h.draw(); assert.equal(h.all(label('Start')).length, 0);
  g.ui.snap.engines.push({ id: 'ready', light: 'yellow' }); h.draw(); assert.equal(h.all(label('Start')).length, 1);
  assert.deepEqual(h.one((n: any) => n.props.label === 'Agent').props.options, [{ value: 'ready', label: 'ready' }]);
  assert.equal(h.one(label('Start')).props.tooltip, 'Start (Ctrl+Enter)');
  const bar = React.Children.toArray(h.one(hasClass('ou-hm-cbar')).props.children) as any[];
  assert.deepEqual([bar[0].props.items.map((i: any) => i.label), bar[bar.length - 1].props.label], [['Attach files', 'Branch and model'], 'Start']);
  assert.equal(h.all((n: any) => n.props.keys === 'Ctrl+Enter').length, 0);
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



test('Home picks the oldest waiting task, else the newest working one; a picked sub-agent shows its parent; an empty pick shows the start state', () => {
  homeStore.set({ open: [], tick: 0 }); delete g.ui.homeSel;
  const kid = session('kid', 'waiting_for_you', { parent_id: 'lead', state_at: '2026-11-10T01:00:00Z' });
  g.ui.snap.sessions = [session('lead', 'working', { state_at: '2026-11-10T03:00:00Z' }), kid, session('late', 'waiting_for_you', { state_at: '2026-11-10T05:00:00Z' }), session('busy', 'working', { state_at: '2026-11-10T06:00:00Z' }), session('old', 'done')];
  g.ui.snap.live = g.ui.snap.sessions.filter((x: any) => x.state !== 'done');
  const h = harness(Home); h.draw();
  const view = () => h.one((n: any) => n.type?.name === 'TaskView').props.x.id;
  assert.equal(view(), 'lead'); assert.equal(g.ui.homeSel, 'lead');
  assert.equal(h.one((n: any) => n.type?.name === 'TaskView').props.openList.includes('lead'), true);
  g.ui.homeSel = 'kid'; h.draw(); assert.equal(view(), 'lead'); assert.ok(h.one((n: any) => n.type?.name === 'TaskView').props.openList.includes('lead'));
  g.ui.homeSel = 'busy'; h.draw(); assert.equal(view(), 'busy');
  g.ui.homeSel = ''; h.draw(); assert.equal(h.all((n: any) => n.type?.name === 'TaskView').length, 0); assert.equal(h.all((n: any) => n.type?.name === 'StartState').length, 1);
  g.ui.snap.live = g.ui.snap.live.filter((x: any) => x.state !== 'waiting_for_you'); delete g.ui.homeSel; h.draw(); assert.equal(view(), 'busy');
  g.ui.view = 'wall'; assert.equal(h.html(), ''); g.ui.view = 'home'; g.ui.projectId = 'missing'; assert.equal(h.html(), '');
});

test('Home task view: breadcrumb, worked line, a collapsed subagents trigger in status colours, the latest line, and waiting-on with Stop; opening lists slim rows with the orchestrator first and steps only after a row is clicked', () => {
  homeStore.set({ open: [], tick: 0 }); g.ui.homeSel = 'lead';
  const steps = { done: 1, total: 2, items: [{ text: 'Plan', done: true }, { text: 'Build', done: false }] };
  g.ui.snap.sessions = [session('lead', 'working', { engine_id: 'claude', model: 'opus-5.5', last_line: 'Okay, splitting the checkout.', steps, started_at: new Date(Date.now() - 65000).toISOString() }),
    session('a', 'done', { parent_id: 'lead' }), session('b', 'working', { parent_id: 'lead', model: 'gpt-5.4', last_line: 'running tests', steps }),
    session('c', 'exited', { parent_id: 'lead', outcome: 'failed', reason: 'tests broke' })];
  const h = harness(Home); h.draw();
  const view = () => renderToStaticMarkup(h.one((n: any) => n.type?.name === 'TaskView'));
  const html = view();
  const at = (t: string) => { const i = html.indexOf(t); assert.ok(i >= 0, t); return i; };
  const order = ['<h1 class="ou-hm-tasktitle">Task lead</h1>', '<span class="ou-hm-crumbproj">Alpha</span>', 'Working for 1m 0', '<span class="ou-hm-tlabel">3 subagents</span>',
    '<span class="ou-hm-c-working">1 working</span>', '<span class="ou-hm-c-done">1 done</span>', '<span class="ou-hm-c-failed">1 failed</span>',
    '<p class="ou-hm-latest">Okay, splitting the checkout.</p>', 'Waiting on 1 subagent', 'Task b', '>Stop</button>'].map(at);
  assert.doesNotMatch(html.slice(0, html.indexOf('ou-hm-subs')), /1\/2 steps/);
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
  assert.doesNotMatch(html, /ou-hm-slimlist|Plan|Build/);
  homeStore.set({ open: ['lead'] }); h.draw();
  const open = view();
  assert.ok(open.includes('<span class="ou-hm-slimsteps">1/2</span>'), 'orchestrator row keeps its step count');
  assert.equal((open.match(/ou-hm-slimsteps"/g) || []).length, 1, 'only the orchestrator row shows a step count');
  assert.deepEqual([...open.matchAll(/<li class="ou-hm-slim( ou-hm-lead)?" data-id="([^"]+)" data-progress="([^"]+)"/g)].map(m => [m[2], m[3]]), [['lead', 'working'], ['a', 'done'], ['b', 'working'], ['c', 'failed']]);
  assert.match(open, /<span class="ou-hm-slimsub"><span class="ou-hm-model">gpt-5.4<\/span><span class="">running tests<\/span><\/span>/);
  assert.match(open, /<span class="ou-hm-bad">tests broke<\/span>/);
  assert.doesNotMatch(open, /Build/);
  homeStore.set({ open: ['lead', 'steps:b'] }); h.draw();
  assert.match(view(), /Plan.*Build/);
});

test('Home start state: a heading, four start actions, then the composer with project and approval chips; no details card', () => {
  homeStore.set({ open: [], tick: 0 }); g.ui.homeSel = ''; g.ui.snap.engines = [{ id: 'ready', light: 'green' }];
  const h = harness(Home); const html = h.html();
  assert.match(html, /<h1 class="ou-hm-hello">Pick up where your agents left off<\/h1>/);
  assert.ok(html.indexOf('ou-hm-hello') < html.indexOf('ou-hm-startlist') && html.indexOf('ou-hm-startlist') < html.indexOf('ou-hm-task'));
  assert.ok(h.all(label('Project')).length === 1 && h.all(label('Approval')).length === 1);
  assert.deepEqual([...html.matchAll(/<span class="ou-hm-starttext"><b>([^<]+)<\/b>/g)].map(m => m[1]), ['Import projects', 'Automations', 'Open the Wall', 'Learn cc']);
  assert.match(html, /data-action="open-folder"/);
  assert.doesNotMatch(html, /ou-hm-card|ou-hm-rail/);
  delete g.ui.homeSel; h.draw(); assert.equal(g.ui.homeSel, '', 'the start page clears the selection so the sidebar highlights nothing');
});

test('Home leaves Needs you notes and approvals to their own screen', () => {
  homeStore.set({ open: [], tick: 0 }); g.ui.homeSel = '';
  g.ui.snap.approvals = [{ id: 'ap' }]; g.ui.snap.needs_you = [note('q', 'question'), note('l', 'other', { ref: 'loop:s1' })];
  const html = harness(Home).html();
  assert.doesNotMatch(html, /data-action="sheet"|data-action="inbox-open"|Needs you/);
});

test('Home details card for the task: workspace, version control with PR and Merge, then lineage; no Needs you inside', () => {
  homeStore.set({ open: [], tick: 0 }); g.ui.homeSel = 'older';
  const older = session('older', 'waiting_for_you', { reason: 'Keep the retry?' });
  g.ui.snap.live = [older]; g.ui.snap.sessions = [older, session('kid', 'working', { parent_id: 'older' })];
  g.ui.snap.git = { older: { branch: 'feat/x', added: 3, deleted: 1, changed: [], commit: 'abc1234', pr: { number: 7, state: 'OPEN', url: '', checks: 'pass' } } };
  const h = harness(Home); h.draw();
  const html = renderToStaticMarkup(h.one((n: any) => n.type?.name === 'RailCard'));
  const at = (t: string) => { const i = html.indexOf(t); assert.ok(i >= 0, t); return i; };
  const order = ['Open on Wall', 'feat/x', 'abc1234', 'ou-hm-add">+3<', 'ou-hm-del">-1<', 'PR #7', 'checks pass · open', 'Merge', 'Lineage · 1 agent', 'Task kid'].map(at);
  assert.deepEqual(order, [...order].sort((x, y) => x - y));
  assert.doesNotMatch(html, /Needs you|Keep the retry/);
  g.ui.snap.projects[0].icon = { kind: 'monogram', text: 'QZ', colour: '#3366ff' }; h.draw();
  assert.match(renderToStaticMarkup(h.one((n: any) => n.type?.name === 'RailCard')), /QZ/, 'the workspace row draws the project icon');
  assert.match(renderToStaticMarkup(h.one((n: any) => n.type?.name === 'TaskView')), /Keep the retry\?/);
  assert.deepEqual(calls, []);
});

test('Automations is its own page: Mine and Ideas tabs, an empty list offers templates, and a template opens the editor page filled in', async () => {
  g.ui.view = 'automations';
  const realInterval = g.setInterval; g.setInterval = () => 0;
  g.rpc = async (...args: any[]) => { calls.push(['rpc', ...args]); return { result: args[0] === 'automation.list' ? { automations: [] } : { labels: [] } }; };
  const h = harness(Home, true); h.draw(); await flush(); h.draw();
  const html = h.html();
  assert.match(html, /<h1 class="ou-ap-title">Automations<\/h1>/);
  assert.deepEqual(h.all((n: any) => n.props?.role === 'tab').map((n: any) => textContent(n.props.children)), ['Mine', 'Ideas']);
  assert.match(html, /Schedule a task/);
  const templates = h.all(hasClass('ou-ap-template'));
  assert.equal(templates.length, 5);
  templates[0].props.onClick(); h.draw();
  const editor = h.one((n: any) => n.type?.name === 'AutomationEditor');
  assert.equal(editor.props.initial.name, 'Nightly test sweep'); assert.equal(editor.props.initial.cron, '0 2 * * *');
  assert.match(renderToStaticMarkup(editor), /<h1 class="ou-ae-heading">New automation<\/h1>/);
  assert.doesNotMatch(renderToStaticMarkup(editor), /role="dialog"/);
  g.ui.view = 'home'; g.setInterval = realInterval;
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
  g.document = { documentElement: { style: {} }, readyState: 'loading', getElementById: el, createElement: () => ({}), body: { style: {}, appendChild: (element: any) => elements.set(element.id, element) }, querySelectorAll: (selector: string) => { assert.equal(selector, '.vseg button'); return segments; }, addEventListener: (event: string, fn: any) => { if (event === 'DOMContentLoaded') ready.push(fn); } };
  const originalSet = g.homeView.set; const originalShown = g.homeView.shown;
  g.__axCreateRoot = (element: any) => ({ render: (tree: any) => mounted.push([element.id, tree.props.children.type.name]) });
  try {
    await bundle("import './src/main.jsx'; export { settingsStore } from './src/settings.jsx'; export { inboxStore } from './src/inbox.jsx'; export { homeStore } from './src/home.jsx';", 'main.mjs');
    const live = await import(pathToFileURL(join(temp, 'main.mjs')).href);
    assert.equal(mounted.length, 0); assert.equal(ready.length, 1); ready[0]();
    assert.deepEqual(mounted, [['settings', 'Settings'], ['needsview', 'Inbox'], ['addons', 'Addons'], ['ide', 'Ide'], ['home', 'Home'], ['cmdk', 'Palette']]);
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
] as const) test('Inbox ' + kind + ' row carries its action and selects its detail pane', () => {
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
  let stopped = 0; let focused = 0;
  row.props.onClick({ stopPropagation: () => stopped++, currentTarget: { focus: () => focused++ }, target: { closest: () => null } });
  assert.deepEqual(calls, []);
  assert.equal(stopped, 1); assert.equal(focused, 1);
  assert.equal(inboxStore.get().selectedId, id);
  h.draw();
  assert.equal(h.one((n: any) => n.type === 'li' && n.props['data-id'] === id).props['aria-selected'], true);
  assert.equal(textContent(h.one(hasClass(kind === 'waiting' ? 'ou-ipane-task' : 'ou-ipane-noticetext'))), rowLabel);
});


const hasClass = (name: string) => (n: any) => typeof n.props.className === 'string' && n.props.className.split(' ').includes(name);
const textContent = (node: any): string => Array.isArray(node) ? node.map(textContent).join('') : React.isValidElement(node) ? textContent(node.props.children) : node == null ? '' : String(node);

test('Settings groups, heading, breadcrumb, navigation icons and take-over Kbd follow the new anatomy', () => {
  settingsStore.set({ section: 'reliability' }); const h = harness(Settings); h.draw();
  assert.deepEqual(h.all((n: any) => n.type === 'h3').map(textContent), ['Finishing', 'Watching', 'Budgets']);
  assert.equal(h.all(hasClass('ou-rows')).length, 3);
  assert.deepEqual(h.all(hasClass('ou-rowtitle')).map(textContent), ['Say done only when a check passed', 'Check command for this project', 'Fix failing checks, up to 3 tries', 'Check after every edit', 'Loop alarm', 'Ask me after', 'Stop the agent after', 'False alarms so far', 'Retry provider errors', 'Ask when a request can mean two things', 'Keep runs going when Ouros closes', 'Token limit per agent', 'Checkpoint every turn']);
  assert.deepEqual(h.all((n: any) => n.type === 'h1').map(textContent), ['Reliability']);
  assert.equal(textContent(h.one(hasClass('ou-crumb'))), 'Settings›Reliability');
  assert.equal(textContent(h.one(hasClass('ou-note'))), 'These run in the background. There is no screen to watch. You hear from them only when a person has to decide.');
  const groups = h.all(hasClass('ou-navgroup'));
  assert.deepEqual(groups.map(textContent), ['App', 'Agents', 'Extend', 'System']);
  assert.deepEqual(groups.map(n => n.props.children[1].map((item: any) => item.props.label)), [['General'], ['Reliability', 'Savings', 'Safety', 'Automations'], ['Add-ons', 'Notifications'], ['Advanced']]);
  const navs = h.all((n: any) => n.props.isSelected !== undefined && n.props.onClick);
  assert.deepEqual(navs.map(n => n.props.label), ['General', 'Reliability', 'Savings', 'Safety', 'Automations', 'Add-ons', 'Notifications', 'Advanced']);
  assert.equal(textContent(h.one(hasClass('ou-snav-title'))), 'Settings'); assert.equal(h.one(hasClass('ou-snav-back')).type, 'button');
  assert.ok(navs.every(n => typeof n.props.icon?.type === 'function')); assert.equal(new Set(navs.map(n => n.props.icon.type)).size, navs.length);
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
    'agent_cursor.mode': 'snappy', 'agent_cursor.idle_fade_ms': 5000, 'agent_cursor.show_in_recordings': false,
    'ui.toast_ms': 3500, 'ui.error_toast_ms': 7000,
  });
  assert.deepEqual(Object.keys(defaults).sort(), Array.from(pageKeys).sort());
});

test('Inbox groups, two-line rows, state rings, unread state and notice order match the contract', () => {
  g.ui.view = 'inbox'; g.ui.snap.live = [session('ask', 'waiting_for_you', { project_id: 'p2', engine_id: 'engine-b', last_line: 'Choose a fixture' })];
  g.ui.snap.needs_you = [note('read-info', 'other', { read_at: 'read' }), note('unread-info', 'other'), note('read-needs', 'question', { read_at: 'read' }), note('unread-done', 'done'), note('unread-failed', 'failed'), note('unread-needs', 'question'), note('read-done', 'done', { read_at: 'read' }), note('read-failed', 'failed', { read_at: 'read' })];
  const h = harness(Inbox); const html = h.html();
  assert.match(html, /<h1 class="ou-ny-title">Needs you<\/h1>/);
  assert.deepEqual(h.all(hasClass('ou-ny-ghead')).map(textContent), ['Needs your answer3', 'Working0', 'In review0', 'Failed2', 'Done4']);
  for (const head of h.all(hasClass('ou-ny-ghead'))) { assert.equal(head.props.role, 'button'); assert.equal(head.props['data-action'], undefined); }
  const rows = h.all(hasClass('ou-irow'));
  assert.deepEqual(rows.map(n => n.props['data-id']), ['ask', 'unread-needs', 'read-needs', 'unread-failed', 'read-failed', 'unread-info', 'unread-done', 'read-info', 'read-done']);
  assert.deepEqual(rows.map(n => hasClass('ou-unread')(n)), [true, true, false, true, false, true, true, false, false]);
  assert.ok(rows.every(n => n.type === 'li' && n.props.role === 'button' && n.props.tabIndex === 0));
  assert.deepEqual(h.all((n: any) => n.type?.name === 'StatusRing').map(n => n.props.status), ['needs', 'needs', 'needs', 'failed', 'failed', 'done', 'done', 'done', 'done']);
  assert.match(html, /aria-label="Needs you"[^]*aria-label="Failed"[^]*aria-label="Finished"/);
  const subs = h.all(hasClass('ou-ny-row-sub')).map(textContent);
  assert.equal(subs[0], 'engine-b asked a question'); assert.deepEqual(subs.slice(1, 4), ['Asked a question', 'Asked a question', 'Failed']);
  assert.equal(h.all(hasClass('ou-ititle')).length, 9);
  assert.deepEqual(h.all(hasClass('ou-ny-row-age')).map(textContent), Array(9).fill('1m ago'));
  inboxStore.set({ selectedId: 'ask' }); h.draw();
  const field = h.one((n: any) => n.props.label === 'Answer' && 'value' in n.props);
  assert.equal(field.props.isDisabled, true); assert.equal(field.props.placeholder, 'Answer from its own project');
  assert.equal(h.one(label('Send')).props.size, 'sm');
  g.ui.snap.live = []; h.draw(); assert.deepEqual(h.all(hasClass('ou-ny-ghead')).map(textContent), ['Needs your answer2', 'Working0', 'In review0', 'Failed2', 'Done4']);
  g.ui.snap.needs_you = []; g.ui.snap.live = [session('ask', 'waiting_for_you')]; h.draw(); assert.equal(textContent(h.all(hasClass('ou-ny-ghead'))[0]), 'Needs your answer1');
  g.ui.snap.live = []; h.draw(); assert.equal(h.all(hasClass('ou-ny-ghead')).length, 0);
});






test('Automation editor presets round-trip to cron', () => {
  for (const cron of ['15 * * * *', '5 8 * * *', '0 9 * * 1-5', '45 17 * * 3']) assert.equal(screens.cronOf(screens.presetOf(cron)), cron, cron);
  assert.equal(screens.presetOf('30 7 1,15 * *').preset, 'custom');
  assert.equal(screens.cronOf({ preset: 'custom', custom: ' 30 7 1,15 * * ' }), '30 7 1,15 * *');
});

for (const [cron, reply, shows] of [
  ['0 9 * * 1-5', { ok: true, runs: ['2026-11-12T09:00:00.000+11:00', '2026-11-13T09:00:00.000+11:00'], words: 'Weekdays at 09:00' }, 'Weekdays at 09:00'],
  ['0 9 * *', { ok: false, error: 'cron needs five fields' }, 'cron needs five fields'],
] as const) test('Automation editor preview comes from cron.next for ' + JSON.stringify(cron), async () => {
  g.ui.snap.engines = [{ id: 'ready', light: 'green' }];
  const seen: any[] = [];
  g.rpc = async (method: string, params: any) => { seen.push([method, params]); return method === 'cron.next' ? { result: reply } : { error: { message: 'cron never matches a date' } }; };
  const initial = { name: 'Sweep', prompt: 'Run the tests.', cron, engine_id: 'ready', project_id: 'p1', icon: '\u{1F9EA}', labels: [{ name: 'tests', colour: '#30a46c' }] };
  const h = harness(function Screen() { return React.createElement(screens.AutomationEditor, { initial, labelNames: [], onClose() {}, onSaved() {} }); }, true);
  h.draw(); await flush(); h.draw();
  assert.deepEqual(seen[0], ['cron.next', { cron, n: 3 }]);
  const html = h.html();
  assert.match(html, new RegExp(shows));
  if (!reply.ok) { assert.equal(h.one(label('Create automation')).props.isDisabled, true); return; }
  assert.match(html, /Next: .*12.*·.*13/);
  await h.one(label('Create automation')).props.onClick(); await flush(); h.draw();
  const set = seen.find((c) => c[0] === 'automation.set');
  assert.equal(set[1].cron, cron); assert.equal(set[1].icon, '\u{1F9EA}'); assert.deepEqual(set[1].labels, ['tests']);
  assert.match(h.html(), /<b class="ou-ae-error" role="alert">cron never matches a date<\/b>/);
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
  assert.deepEqual(h.all((n: any) => n.type === 'h3').map(textContent), ['Kind', 'State']);
  assert.equal(h.one(label('Check agents again')).props['data-action'], 'check-engines');
  assert.match(html, /data-action="check-engines"/);
});

async function keyboardHarness() {
  const listeners: any[] = []; const focused: string[] = []; const clicked: string[] = []; let prevented = 0;
  const row = (id: string, className = 'ou-irow'): any => {
    const r: any = { id, className, contains: (element: any) => element === r || element?.owner === r,
      matches: (selector: string) => { assert.equal(selector, '.ou-irow, .ou-agent, .ou-ide-ahead'); return ['ou-irow', 'ou-agent', 'ou-ide-ahead'].includes(className); },
      closest: () => null, focus() { g.document.activeElement = r; focused.push(id); }, click: () => clicked.push(id) };
    return r;
  };
  const rows = [row('first'), row('middle'), row('last')]; const head = row('header', 'ou-ihead'); const card = row('agent', 'ou-agent'); const ahead = row('ahead', 'ou-ide-ahead');
  g.document = { documentElement: { style: {} }, body: { style: {} }, readyState: 'loading', activeElement: null,
    addEventListener: (name: string, fn: any) => { if (name === 'keydown') listeners.push(fn); },
    getElementById: (id: string) => { assert.equal(id, 'needsview'); return { querySelectorAll: (selector: string) => { assert.equal(selector, '.ou-irow'); return rows; } }; },
  };
  g.__axCreateRoot = () => { throw new Error('screens should wait for DOMContentLoaded'); };
  try {
    const name = 'keyboard-' + keyboardSequence++ + '.mjs'; await bundle("import './src/main.jsx';", name); await import(pathToFileURL(join(temp, name)).href);
  } finally { delete g.__axCreateRoot; }
  assert.equal(listeners.length, 5);
  return { rows, head, card, ahead, focused, clicked, get prevented() { return prevented; },
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
  for (const key of ['Enter', ' ']) { h.press(key, { target: h.rows[0] }); h.press(key, { target: h.card }); h.press(key, { target: h.ahead }); }
  assert.deepEqual(h.clicked, ['first', 'agent', 'ahead', 'first', 'agent', 'ahead']); assert.equal(h.prevented, 6); h.clear();
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

// Protects plugin-install.jsx:17, :25, :27 and :44: preview gates installation and source edits invalidate it.
test('wire-08 install requires a valid preview, sends its exact hash and permissions, and clears on edit', async () => {
  const closed: any[] = []; const Screen = () => React.createElement(screens.PluginInstall, { onClose: (v: any) => closed.push(v) });
  const h = harness(Screen); h.draw();
  assert.equal(h.all(label('Install')).length, 0);
  h.one(label('Plugin folder or git URL')).props.onChange('  C:/plugins/demo  '); h.draw();
  let valid = false;
  const pre = { valid: true, manifest_hash: 'hash-123', screen: { plugin: { id: 'demo', version: '1' }, permissions: [{ permission: 'network', text: 'Network' }, { permission: 'secrets:TOKEN', text: 'Token' }], engines: [], mcp_servers: [], warnings: [] } };
  g.rpc = async (...args: any[]) => { calls.push(args); return args[0] === 'plugin.preview' ? { result: valid ? pre : { valid: false, errors: ['bad manifest'] } } : { error: { message: 'manifest changed' } }; };
  await h.one(label('Check')).props.onClick(); h.draw(); assert.equal(h.all(label('Install')).length, 0);
  valid = true; await h.one(label('Check')).props.onClick(); h.draw();
  const staleInstall = h.one(label('Install')).props.onClick;
  await staleInstall(); h.draw();
  assert.deepEqual(calls.filter(c => c[0] === 'plugin.install'), [['plugin.install', { source: 'C:/plugins/demo', approved_permissions: ['network', 'secrets:TOKEN'], manifest_hash: 'hash-123' }]]);
  assert.deepEqual(closed, [], 'core rejection leaves the dialog open');
  h.one(label('Plugin folder or git URL')).props.onChange('C:/plugins/other'); h.draw();
  assert.equal(h.all(label('Install')).length, 0);
  assert.ok(calls.every(c => ['plugin.preview', 'plugin.install'].includes(c[0])));
  assert.ok(calls.every(c => !Object.hasOwn(c[1], 'secrets')), 'secret values never cross this dialog');
});
// Protects addons.jsx:129-130 removal AlertDialog onAction: confirmation and id-only named core call.
test('wire-08 Remove waits for confirmation and calls only plugin.remove with plugin_id', async () => {
  g.ui.view = 'addons';
  addonsStore.set({ rows: [{ id: 'demo', version: '1', enabled: true, permissions: [], description: 'Demo' }] });
  const h = harness(Addons); h.draw(); calls.length = 0;
  h.one(label('Remove')).props.onClick(); h.draw();
  assert.deepEqual(calls, []);
  const dialog = h.one((n: any) => n.props.actionLabel === 'Remove');
  assert.equal(dialog.props.isOpen, true);
  dialog.props.onOpenChange(false); h.draw(); assert.deepEqual(calls, []);
  h.one(label('Remove')).props.onClick(); h.draw();
  await h.one((n: any) => n.props.actionLabel === 'Remove').props.onAction();
  assert.deepEqual(calls.filter(c => c[0] === 'rpc'), [['rpc', 'plugin.remove', { plugin_id: 'demo' }]]);
});
// Protects automations.jsx:31-34: required fields gate RPC and runner is an argv array.
test('wire-07 automation form gates empty fields and splits runner into arguments', async () => {
  g.ui.snap.engines = [{ id: 'codex', light: 'green' }];
  const h = harness(screens.Automations); h.draw(); calls.length = 0;
  const submit = async () => { h.draw(); await h.one(label('Add automation')).props.onClick(); };
  await submit(); assert.deepEqual(calls, []);
  for (const [field, value] of [['Name', 'Nightly'], ['Runner', 'node  --trace-warnings'], ['Check script', 'scripts/check.mjs']]) {
    h.one((n: any) => n.props.label === field && n.props.onChange).props.onChange(value); await submit(); assert.deepEqual(calls, []);
  }
  h.one((n: any) => n.props.label === 'Prompt' && n.props.onChange).props.onChange('Fix the failing check'); h.draw();
  for (const [field, value] of [['Name', 'Nightly'], ['Runner', 'node  --trace-warnings'], ['Check script', 'scripts/check.mjs'], ['Prompt', 'Fix the failing check']]) {
    h.one((n: any) => n.props.label === field && n.props.onChange).props.onChange('');
    await submit(); assert.deepEqual(calls, [], field + ' must be required');
    h.one((n: any) => n.props.label === field && n.props.onChange).props.onChange(value); h.draw();
  }
  for (const minutes of [0, -1, 1.5]) {
    h.one((n: any) => n.props.label === 'Minutes between runs' && n.props.onChange).props.onChange(minutes);
    await submit(); assert.deepEqual(calls, [], 'invalid interval');
  }
  h.one((n: any) => n.props.label === 'Minutes between runs' && n.props.onChange).props.onChange(30); h.draw();
  g.rpc = async (...args: any[]) => { calls.push(args); return { error: { message: 'script must be inside the project folder' } }; };
  await submit();
  assert.deepEqual(calls, [['automation.set', { project_id: 'p1', name: 'Nightly', every_min: 30, runner: ['node', '--trace-warnings'], script: 'scripts/check.mjs', engine_id: 'codex', prompt: 'Fix the failing check' }]]);
  h.draw(); assert.equal(h.one((n: any) => n.props.label === 'Check script' && n.props.onChange).props.value, 'scripts/check.mjs', 'error preserves the draft');
});

// Protects automations.jsx:34 and app.js:134-136: core validation errors reach the user.
test('wire-07 outside-script error is displayed and does not clear the form', async () => {
  g.ui.snap.engines = [{ id: 'codex', light: 'green' }];
  const h = harness(screens.Automations); h.draw();
  for (const [field, value] of [['Name', 'Nightly'], ['Check script', '../outside.mjs'], ['Prompt', 'Fix']]) {
    h.one((n: any) => n.props.label === field && n.props.onChange).props.onChange(value); h.draw();
  }
  const app = readFileSync(join(wb, 'renderer/app.js'), 'utf8');
  const fn = app.match(/^async function rpcOnce\([^]*?^}/m); assert.ok(fn);
  g.api.call = async (...args: any[]) => { calls.push(['api.call', ...args]); return { kind: 'reply', reply: { error: { code: -32003, message: 'script must be inside the project folder' } } }; };
  g.rpc = new Function('api', 'toast', fn[0] + '; return rpcOnce;')(g.api, g.toast);
  await h.one(label('Add automation')).props.onClick(); h.draw();
  assert.ok(calls.some(c => c[0] === 'toast' && c[1] === 'script must be inside the project folder' && c[2] === true));
  assert.equal(h.one((n: any) => n.props.label === 'Check script' && n.props.onChange).props.value, '../outside.mjs');
});

// Protects home.jsx:52 and :59 branch gate and session.launch payload: empty worktree means no creation call.
test('wire-03 blank worktree branch omits worktree.create and preserves exact launch params', async () => {
  g.ui.snap.engines = [{ id: 'codex', light: 'green' }];
  const h = harness(Home); h.draw(); h.one((n: any) => n.props.items?.some((i: any) => i.label === 'Branch and model')).props.items[1].onClick(); h.draw();
  h.one(label('Branch for a new worktree')).props.onChange('   '); h.draw(); calls.length = 0;
  await h.one(label('Start')).props.onClick();
  assert.deepEqual(calls.filter(c => c[0] === 'rpc'), [['rpc', 'session.launch', { project_id: 'p1', engine_id: 'codex' }]]);
});
// Protects the chat box wiring: model, access level, attach, branch label and project switch reach their real paths.
test('chat box model and access level reach session.launch', async () => {
  g.ui.snap.engines = [{ id: 'codex', light: 'green' }];
  const h = harness(Home); h.draw(); h.one((n: any) => n.props.items?.some((i: any) => i.label === 'Branch and model')).props.items[1].onClick(); h.draw();
  h.one(label('Model')).props.onChange(' gpt-test '); h.one(label('Approval')).props.onChange('edits'); h.one(label('Task for a new agent')).props.onChange('go'); h.draw(); calls.length = 0;
  await h.one(label('Start')).props.onClick();
  assert.deepEqual(calls.filter(c => c[0] === 'rpc')[0], ['rpc', 'session.launch', { project_id: 'p1', engine_id: 'codex', prompt: 'go', model: 'gpt-test', approval: 'edits' }]);
});
test('chat box attach inserts project-relative @paths and the branch label shows the new worktree', () => {
  g.ui.snap.engines = [{ id: 'codex', light: 'green' }]; g.ui.snap.projects[0].path = 'C:\\work\\alpha';
  g.api.filePaths = () => ['C:\\work\\alpha\\src\\a.ts', 'D:\\other\\my notes.md'];
  const h = harness(Home); h.draw(); h.one(label('Task for a new agent')).props.onChange('look at'); h.draw();
  assert.deepEqual(h.one((n: any) => n.props.items?.some((i: any) => i.label === 'Attach files')).props.items.map((i: any) => i.label), ['Attach files', 'Branch and model']);
  h.one((n: any) => n.type === 'input' && n.props['data-attach']).props.onChange({ target: { files: [], value: 'x' } }); h.draw();
  assert.equal(g.ui.drafts['home-task'], 'look at @src/a.ts @"D:/other/my notes.md" ');
  h.one((n: any) => n.props.items?.some((i: any) => i.label === 'Branch and model')).props.items[1].onClick(); h.draw();
  h.one(label('Branch for a new worktree')).props.onChange('fix/x'); h.draw();
  assert.match(h.html(), /fix\/x \(new worktree\)/);
  delete g.ui.snap.projects[0].path;
});
test('chat box project selector switches the real project', () => {
  g.ui.snap.engines = [{ id: 'codex', light: 'green' }]; const switched: string[] = []; g.switchProject = (id: string) => switched.push(id);
  const h = harness(Home); h.draw(); h.one(label('Project')).props.onChange('p2'); h.one(label('Project')).props.onChange('p1');
  assert.deepEqual(switched, ['p2']);
});
// Protects automations.jsx:49 Remove onClick: the renderer sends only the stored automation id.
test('wire-07 Remove sends automation.delete with that id only', async () => {
  g.ui.snap.engines = [{ id: 'codex', light: 'green' }];
  const row = { id: 'a1', name: 'Nightly', every_min: 30, runner: ['node'], script: 'check.mjs', engine_id: 'codex', enabled: true, runs: [] };
  g.rpc = async (...args: any[]) => { calls.push(args); return { result: { automations: [row] } }; };
  const h = harness(screens.Automations, true); h.draw(); await flush(); h.draw(); calls.length = 0;
  await h.one(label('Remove')).props.onClick();
  assert.deepEqual(calls, [['automation.delete', { id: 'a1' }], ['automation.list', { project_id: 'p1' }, true]]);
});

test('Settings Reliability page shows the False alarms so far value', () => {
  data.reliability.false_alarms = 0;
  settingsStore.set({ data, section: 'reliability' });
  const h = harness(Settings);
  assert.match(h.html(), /<span class="ou-value">0<\/span>/);
  data.reliability.false_alarms = 2;
  settingsStore.set({ data: { ...data }, section: 'reliability' });
  assert.match(h.html(), /<span class="ou-value">2<\/span>/);
});

test('Settings check command field shows the saved command and disabled state', () => {
  data.reliability.checks = { p1: 'npm test' };
  g.ui.projectId = 'p1';
  settingsStore.set({ data, section: 'reliability' });
  const h = harness(Settings);
  h.draw();
  const input = h.one(label('Check command for this project'));
  assert.equal(input.props.value, 'npm test');
  assert.equal(input.props.isDisabled, false);
  g.ui.projectId = '';
  h.draw();
  const disabled = h.one(label('Check command for this project'));
  assert.equal(disabled.props.isDisabled, true);
});

test('Settings check command field updates on project switch', () => {
  settingsStore.set({ section: 'reliability' });
  const h = harness(Settings);
  h.draw();
  const checkNode = h.all((n: any) => n.type?.name === 'CheckCommand')[0];
  assert.ok(checkNode, 'CheckCommand element captured');
  const CheckCommand = checkNode.type;
  data.reliability.checks = { p1: 'npm test', p2: 'cargo test' };
  g.ui.projectId = 'p1';
  function Screen() { return React.createElement(CheckCommand, { row: { label: 'Check command for this project' }, data }); }
  const ch = harness(Screen);
  ch.draw();
  assert.equal(ch.one(label('Check command for this project')).props.value, 'npm test');
  g.ui.projectId = 'p2';
  ch.draw();
  assert.equal(ch.one(label('Check command for this project')).props.value, 'cargo test');
});

function declaration(name: string) {
  const appSrc = readFileSync(join(wb, 'renderer/app.js'), 'utf8');
  const match = new RegExp('function\\s+' + name + '\\s*\\(').exec(appSrc);
  assert.ok(match, 'function ' + name + ' in app.js');
  const bodyStart = appSrc.indexOf('{', match.index);
  let depth = 0;
  for (let i = bodyStart; i < appSrc.length; i++) {
    if (appSrc[i] === '{') depth++;
    else if (appSrc[i] === '}') {
      depth--;
      if (depth === 0) return appSrc.slice(match.index, i + 1);
    }
  }
  throw new Error('Could not slice ' + name);
}

test('Inbox keeps a loop note under Needs your answer and its loop-choose action works through real app onClick', async () => {
  g.ui.view = 'inbox';
  g.ui.snap.needs_you = [note('loop', 'other', { ref: 'loop:s-loop' }), note('plain', 'other')];
  const h = harness(Inbox);
  h.draw();
  h.one((n: any) => hasClass('ou-ny-ghead')(n) && n.props['data-group'] === 'done').props.onClick();
  inboxStore.set({ selectedId: 'loop' });
  const html = h.html();
  assert.ok(html.includes('Note loop'));
  assert.ok(!html.includes('Note plain'));
  const btn = h.one(action('loop-choose'));
  const sessionId = btn.props['data-id'];
  const choice = btn.props['data-choice'];
  const rpcCalls: any[] = [];
  const onClick = vm.runInNewContext('(async ' + declaration('onClick') + ')', {
    rpc: async (...args: any[]) => { rpcCalls.push(args); },
  });
  await onClick({
    stopPropagation() {},
    target: { closest: () => ({ tagName: 'BUTTON', dataset: { action: 'loop-choose', id: sessionId, choice }, closest: () => null }) },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls)), [['loop.choose', { session_id: sessionId, choice }]]);
});

test('Add-ons engine readiness states and dot classes', () => {
  // Check readiness through Badge props as well as rendered card classes and text.
  g.ui.view = 'addons';
  g.ui.snap.engines = [
    { id: 'unk', light: 'unknown' },
    { id: 'bad', light: 'red' },
    { id: 'good', light: 'green', version: '1.0.0' },
  ];
  const h = harness(Addons);
  h.draw();
  const cards = h.all(hasClass('ou-acard'));
  const readyBadges = h.all(hasClass('ou-acard-ready'));
  const notReady = h.one(hasClass('ou-notready'));
  assert.deepEqual(readyBadges.map(n => n.props.label), ['Ready', 'Ready']);
  assert.equal(notReady.props.label, 'Not ready');
  assert.notEqual(notReady.type, 'span');
  for (const badge of readyBadges) assert.equal(badge.type, notReady.type);
  const cardUnk = cards.find((c: any) => textContent(c).includes('unk'));
  const cardBad = cards.find((c: any) => textContent(c).includes('bad'));
  const cardGood = cards.find((c: any) => textContent(c).includes('good'));
  assert.ok(cardUnk && cardBad && cardGood);
  const unkMarkup = renderToStaticMarkup(cardUnk);
  const badMarkup = renderToStaticMarkup(cardBad);
  const goodMarkup = renderToStaticMarkup(cardGood);
  assert.ok(unkMarkup.includes('ou-acard-ready') && unkMarkup.includes('Ready'));
  assert.doesNotMatch(unkMarkup, /· v/);
  assert.ok(badMarkup.includes('ou-notready') && badMarkup.includes('Not ready'));
  assert.ok(goodMarkup.includes('ou-acard-ready') && goodMarkup.includes('Ready'));
});

test('Real app isInfo and needsCount filter info notes and count lend notes', () => {
  const appSrc = readFileSync(join(wb, 'renderer/app.js'), 'utf8');
  const consts = ['INFO_KINDS', 'loopOf', 'lendOf', 'isInfo'].map((name) => {
    const m = new RegExp('^const ' + name + ' = [^\\n]+', 'm').exec(appSrc);
    assert.ok(m, 'const ' + name + ' in app.js');
    return m[0];
  });
  const ctx = vm.createContext({ ui: g.ui });
  vm.runInContext([...consts, declaration('waitingAll'), declaration('needsCount'), 'this.isInfo = isInfo; this.needsCount = needsCount;'].join('\n'), ctx);
  g.isInfo = ctx.isInfo;
  g.needsCount = ctx.needsCount;
  g.ui.snap.live = [];
  g.ui.snap.approvals = [];
  g.ui.snap.needs_you = [
    note('gate', 'gate'),
    note('approval', 'approval'),
    note('handoff', 'handoff'),
    note('done', 'done'),
    note('uncommitted', 'uncommitted'),
    note('other', 'other'),
    note('spool', 'spool-too-large'),
    note('read-failed', 'failed', { read_at: '2026-11-10T00:00:00Z' }),
  ];
  assert.equal(g.needsCount(), 0);
  const h = harness(Home);
  assert.doesNotMatch(h.html(), /Waiting on you/);
  g.ui.snap.needs_you = [note('lend-unread', 'other', { ref: 'lend:p1 https://alpha.example' })];
  assert.equal(g.needsCount(), 1);
  g.ui.snap.needs_you = [note('lend-read', 'other', { ref: 'lend:p1 https://alpha.example', read_at: '2026-11-10T00:00:00Z' })];
  assert.equal(g.needsCount(), 0);
});
