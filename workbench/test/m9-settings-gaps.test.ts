import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import vm from 'node:vm';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'm9-settings-gaps-'));
after(() => { rmSync(temp, { recursive: true, force: true }); });

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
const { React, renderToStaticMarkup, Settings, settingsStore, Inbox, inboxStore, Addons, addonsStore, Home } = screens;

const g: any = globalThis;
const calls: any[] = [];
let data: any;

const own = new Set(['Settings', 'Group', 'Row', 'Control', 'CheckCommand', 'Inbox', 'Glyph', 'NoteActions', 'Addons', 'Home', 'StartBox', 'Tile', 'AgentCard']);
const frames = new Map<string, any[]>();
let nodes: any[] = [];

function expand(value: any, path: string): any {
  if (Array.isArray(value)) return value.map((v, i) => expand(v, path + '/' + i));
  if (!React.isValidElement(value)) return value;
  nodes.push(value);
  if (typeof value.type === 'function' && own.has(value.type.name)) {
    const key = value.key != null ? String(value.key) : '';
    const frameKey = path + (key ? ':' + key : '');
    const slots = frames.get(frameKey) || [];
    frames.set(frameKey, slots);
    let cursor = 0;
    const internals = (React as any).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
    const previous = internals.H;
    internals.H = {
      useSyncExternalStore: (_subscribe: any, snapshot: any) => snapshot(),
      useState: (initial: any) => {
        const i = cursor++;
        if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
        return [slots[i], (v: any) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }];
      },
      useRef: (initial: any) => {
        const i = cursor++;
        if (!(i in slots)) slots[i] = { current: initial };
        return slots[i];
      },
      useEffect: () => {},
    };
    let output;
    try { output = value.type(value.props); } finally { internals.H = previous; }
    return expand(output, frameKey + '/render');
  }
  const props: any = { key: value.key ?? path };
  for (const [key, v] of Object.entries(value.props)) if (React.isValidElement(v) || Array.isArray(v)) props[key] = expand(v, path + '/' + key);
  return React.cloneElement(value, props);
}

function harness(Screen: any) {
  const draw = () => { nodes = []; return expand(React.createElement(Screen), 'root'); };
  return {
    draw,
    html: () => renderToStaticMarkup(draw()),
    all: (predicate: any) => nodes.filter(predicate),
    one: (predicate: any) => { const found = nodes.find(predicate); assert.ok(found, 'rendered control exists'); return found; },
  };
}

settingsStore.use = () => React.useSyncExternalStore(() => () => {}, settingsStore.get, settingsStore.get);

beforeEach(() => {
  calls.length = 0;
  frames.clear();
  data = {
    sessions: { approval: 'ask', metarouter: false },
    terminal: { font_size: 13, scrollback: 10000 },
    agent_cursor: { show_caption: true },
    reliability: {
      done_needs_check: true,
      loop_alarm: true,
      loop_nudge_at: 3,
      loop_stop_at: 5,
      token_limit: 0,
      false_alarms: 0,
      checks: { p1: 'npm test p1', p2: 'npm test p2' },
    },
    savers: { shrink_shell: false, lean_handoffs: false, small_screenshots: false, cheap_model: false },
    desktop: { watch_pause: true, takeover_key: 'Ctrl+Esc' },
    browser: { allow_origins: [], lent: { p1: ['https://alpha.example'], p2: ['https://private.example'] } },
    worktree: { npm_ci: false, stale_days: 7 },
  };
  Object.assign(g, {
    ui: {
      view: 'home',
      projectId: 'p1',
      pendingHide: new Set(),
      drafts: {},
      look: { theme: { name: 'neutral', scheme: 'dark' } },
      settingsLook: { themes: [] },
      snap: {
        sessions: [],
        live: [],
        approvals: [],
        needs_you: [],
        engines: [],
        projects: [{ id: 'p1', name: 'Alpha' }, { id: 'p2', name: 'Beta' }],
      },
    },
    api: {
      settingsPage: async () => data,
      setSetting: async (...args: any[]) => { calls.push(['setSetting', ...args]); },
      setApproval: async (...args: any[]) => { calls.push(['setApproval', ...args]); },
      setCheck: async (...args: any[]) => { calls.push(['setCheck', ...args]); return { ok: true }; },
      uiSettings: async () => ({}),
      addons: async () => [],
      openLogs: () => calls.push(['logs']),
    },
    rpc: async (...args: any[]) => { calls.push(['rpc', ...args]); return { result: { ok: true } }; },
    render: () => calls.push(['render']),
    toast: (...args: any[]) => calls.push(['toast', ...args]),
    applyLook: () => {},
    setLook: async () => {},
    openSinks: () => calls.push(['sinks']),
    project: () => g.ui.snap.projects.find((p: any) => p.id === g.ui.projectId),
    waitingAll: () => g.ui.snap.live.filter((s: any) => s.state === 'waiting_for_you'),
    isInfo: (n: any) => ['gate', 'approval', 'handoff', 'done', 'uncommitted', 'other', 'spool-too-large'].includes(n.kind) && !g.loopOf(n) && !g.lendOf(n),
    loopOf: (n: any) => n.kind === 'other' && n.ref?.startsWith('loop:') ? n.ref.slice(5) : null,
    lendOf: (n: any) => { if (n.kind !== 'other' || !n.ref?.startsWith('lend:')) return null; const [project, origin] = n.ref.slice(5).split(' '); return { project, origin }; },
    taskOf: (s: any) => s.title,
    ago: () => '1m ago',
    approvalCard: (a: any) => '<p>' + a.summary + '</p>',
    homeView: { shown: () => g.ui.view === 'home' && Boolean(g.project()), set: (v: string) => { calls.push(['view', v]); g.ui.view = v; } },
    load: () => null,
    save: (...args: any[]) => calls.push(['save', ...args]),
    pick: async (id: string) => calls.push(['pick', id]),
    document: { documentElement: { style: {} }, getElementById: () => ({ hidden: false }) },
  });
  g.needsCount = () => g.waitingAll().length + g.ui.snap.approvals.length + g.ui.snap.needs_you.filter((n: any) => !n.read_at && !g.isInfo(n)).length;
  settingsStore.set({ data, section: 'reliability' });
  inboxStore.set({ filter: 'all' });
});

test('G2: Check command shows saved command, retains state across project switch, nothing saved to B, disabled without project', async () => {
  g.ui.projectId = 'p1';
  settingsStore.set({ data, section: 'reliability' });
  const h = harness(Settings);
  h.draw();

  const inputA = h.one((n: any) => n.props.placeholder === 'npm test');
  assert.equal(inputA.props.value, 'npm test p1');
  assert.equal(inputA.props.isDisabled, false);

  inputA.props.onChange('npm run build-a');

  g.ui.projectId = 'p2';
  h.draw();

  const inputB = h.one((n: any) => n.props.placeholder === 'npm test');
  assert.equal(inputB.props.value, 'npm test p2');

  const span = h.one((n: any) => typeof n.props.onBlur === 'function');
  await span.props.onBlur();
  await inputB.props.onEnter();

  const checkSaves = calls.filter(c => c[0] === 'setCheck');
  assert.deepEqual(checkSaves, []);

  g.ui.projectId = '';
  h.draw();
  const inputEmpty = h.one((n: any) => n.props.placeholder === 'npm test');
  assert.equal(inputEmpty.props.isDisabled, true);
});

test('G1: Reliability page shows the False alarms so far value from data.reliability.false_alarms', () => {
  data.reliability.false_alarms = 0;
  settingsStore.set({ data, section: 'reliability' });
  const h = harness(Settings);
  let html = h.html();
  assert.match(html, /False alarms so far[\s\S]*?<span class="ou-value">0<\/span>/);

  data.reliability.false_alarms = 2;
  settingsStore.set({ data, section: 'reliability' });
  html = h.html();
  assert.match(html, /False alarms so far[\s\S]*?<span class="ou-value">2<\/span>/);
});

test('G3: Inbox needs filter keeps loop note and hides ordinary other note, and onClick sends loop.choose', async () => {
  g.ui.view = 'inbox';
  inboxStore.set({ filter: 'needs' });
  g.ui.snap.needs_you = [
    { id: 'loop-1', kind: 'other', ref: 'loop:sess-1', text: 'Loop detected on session' },
    { id: 'other-1', kind: 'other', text: 'Ordinary informational other note' },
  ];
  const h = harness(Inbox);
  const html = h.html();
  assert.ok(html.includes('Loop detected on session'));
  assert.ok(!html.includes('Ordinary informational other note'));

  const appText = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
  const start = appText.indexOf('function onClick(');
  assert.notEqual(start, -1);
  const end = appText.indexOf('\n}', start);
  assert.notEqual(end, -1);
  const onClickSource = appText.slice(start, end + 2);

  const rpcCalls: any[] = [];
  const onClick = vm.runInNewContext('(async ' + onClickSource + ')', {
    rpc: async (...args: any[]) => { rpcCalls.push(args); return { result: { ok: true } }; },
    toast: () => {},
    render: () => {},
    ui: { projectId: 'p1', view: 'inbox' },
    document: { getElementById: () => ({ hidden: false }) },
    hideMenu: () => {},
  });

  await onClick({
    stopPropagation() {},
    target: {
      closest: () => ({
        tagName: 'BUTTON',
        dataset: { action: 'loop-choose', id: 'sess-1', choice: 'pause' },
        closest: () => null,
      }),
    },
  });
  assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls)), [['loop.choose', { session_id: 'sess-1', choice: 'pause' }]]);
});

test('G5: Engine with light unknown and no version renders Ready and neutral dot, red error, green success', () => {
  g.ui.view = 'addons';
  g.ui.snap.engines = [
    { id: 'eng-unk', light: 'unknown' },
    { id: 'eng-red', light: 'red' },
    { id: 'eng-grn', light: 'green' },
  ];
  addonsStore.set({ rows: [] });
  const h = harness(Addons);
  const html = h.html();

  const rowFor = (id: string) => {
    const fromHtml = (html.match(/<article[\s\S]*?<\/article>/g) || []).find(r => r.includes(`<b>${id}</b>`));
    if (fromHtml) return fromHtml;
    const node = h.all((n: any) => n.type === 'article' && n.key === `agent:${id}`)[0];
    assert.ok(node, `row for ${id} rendered`);
    return renderToStaticMarkup(node);
  };

  const rowUnk = rowFor('eng-unk');
  assert.match(rowUnk, /Ready/);
  assert.doesNotMatch(rowUnk, /Not ready/);

  const rowRed = rowFor('eng-red');
  assert.match(rowRed, /Not ready/);

  const rowGrn = rowFor('eng-grn');
  assert.match(rowGrn, /Ready/);
  assert.doesNotMatch(rowGrn, /Not ready/);
});

test('G6: Real app.js isInfo and needsCount exclude informational kinds and read notes, handle lend and ordinary notes', () => {
  const appText = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
  const helpers = appText.slice(appText.indexOf('const INFO_KINDS'), appText.indexOf('const NEEDS_COUNTS')).replace(/\bconst\b/g, 'var');

  const decl = (name: string) => {
    const s = appText.indexOf('function ' + name + '(');
    assert.notEqual(s, -1, name + ' exists in app.js');
    const e = appText.indexOf('\n}', s);
    assert.notEqual(e, -1);
    return appText.slice(s, e + 2);
  };

  const ctx: any = {
    ui: {
      snap: {
        projects: [{ id: 'p1', name: 'Alpha' }],
        live: [],
        approvals: [],
        needs_you: [],
      },
    },
  };
  vm.runInNewContext(helpers + '\n' + decl('needsCount') + '\n' + decl('waitingAll') + '\nglobalThis.isInfo = isInfo;', ctx);
  if (typeof ctx.isInfo !== 'function') ctx.isInfo = vm.runInNewContext(helpers + '\nisInfo;', ctx);

  for (const kind of ['gate', 'approval', 'handoff', 'done', 'uncommitted', 'spool-too-large', 'other']) {
    assert.equal(ctx.isInfo({ kind }), true, kind + ' is an info kind');
  }

  assert.equal(ctx.isInfo({ kind: 'other', ref: 'loop:s1' }), false);
  assert.equal(ctx.isInfo({ kind: 'other', ref: 'lend:p1 https://alpha.example' }), false);
  assert.equal(ctx.isInfo({ kind: 'question' }), false);
  assert.equal(ctx.isInfo({ kind: 'failed' }), false);

  ctx.ui.snap.needs_you = [
    { id: '1', kind: 'gate', read_at: null },
    { id: '2', kind: 'approval', read_at: null },
    { id: '3', kind: 'handoff', read_at: null },
    { id: '4', kind: 'done', read_at: null },
    { id: '5', kind: 'uncommitted', read_at: null },
    { id: '6', kind: 'other', read_at: null },
    { id: '7', kind: 'spool-too-large', read_at: null },
    { id: '8', kind: 'failed', read_at: '2026-11-10T00:00:00Z' },
  ];
  assert.equal(ctx.needsCount(), 0);

  g.ui.view = 'home';
  g.ui.projectId = 'p1';
  g.ui.snap.needs_you = ctx.ui.snap.needs_you;
  g.needsCount = () => ctx.needsCount();

  const h = harness(Home);
  const html = h.html();
  const tile = h.all((n: any) => n.type?.name === 'Tile').find((n: any) => n.props.label === 'Needs you');
  assert.ok(tile, 'Needs you tile rendered');
  assert.equal(tile.props.n, 0);
  assert.equal(tile.props.sub, 'nothing waiting');
  assert.doesNotMatch(html, /Waiting on you|waiting on an answer/);

  ctx.ui.snap.needs_you.push({ id: 'lend-1', kind: 'other', ref: 'lend:p1 https://shop.example', read_at: null });
  assert.equal(ctx.needsCount(), 1);

  ctx.ui.snap.needs_you[ctx.ui.snap.needs_you.length - 1].read_at = '2026-11-10T00:00:00Z';
  assert.equal(ctx.needsCount(), 0);

  ctx.ui.snap.needs_you.push({ id: 'other-1', kind: 'other', ref: 'plain-ref', read_at: null });
  assert.equal(ctx.needsCount(), 0);
});
