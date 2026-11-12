import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const wb = fileURLToPath(new URL('../', import.meta.url));
const temp = mkdtempSync(join(tmpdir(), 'ny-screen-'));
after(() => rmSync(temp, { recursive: true, force: true }));
const requireUI = createRequire(join(wb, 'ui/package.json'));
const entry = join(temp, 'entry.jsx'), bundle = join(temp, 'screens.mjs');
writeFileSync(entry, `export * from ${JSON.stringify(join(wb, 'ui/src/inbox.jsx').replace(/\\/g, '/'))};\nexport * as React from 'react'; export { renderToStaticMarkup } from 'react-dom/server';`);
const platform = process.platform === 'win32' ? 'win32-' + process.arch : process.platform + '-' + process.arch;
const binary = requireUI.resolve('@esbuild/' + platform + (process.platform === 'win32' ? '/esbuild.exe' : '/bin/esbuild'));
const built = spawnSync(binary, [entry, '--bundle', '--platform=node', '--format=esm', '--jsx=automatic', '--packages=external', '--log-level=error', '--outfile=' + bundle], { stdio: 'inherit', windowsHide: true });
assert.ifError(built.error); assert.equal(built.status, 0, 'screen bundle builds');
writeFileSync(bundle, readFileSync(bundle, 'utf8').replace(/from "([^"\n]+)"/g, (all, specifier) => specifier.startsWith('.') || specifier.startsWith('node:') ? all : 'from ' + JSON.stringify(pathToFileURL(requireUI.resolve(specifier)).href)));
const { React, renderToStaticMarkup, Inbox, inboxStore, motionOn, leaveRow } = await import(pathToFileURL(bundle).href);
const g: any = globalThis;
const calls: any[] = [];
const own = new Set(['Inbox', 'DetailAsk', 'DetailNotice', 'TerminalPreview', 'NoteActions']);

function harness(Screen: any) {
  const frames = new Map<string, any[]>();
  let nodes: any[] = [];
  function expand(value: any, path: string): any {
    if (Array.isArray(value)) return value.map((v, i) => expand(v, path + '/' + (v?.key ?? i)));
    if (!React.isValidElement(value)) return value;
    nodes.push(value);
    if (typeof value.type === 'function' && own.has(value.type.name)) {
      const key = path + '/' + value.type.name + ':' + (value.key ?? '');
      const slots = frames.get(key) || []; frames.set(key, slots);
      let cursor = 0;
      const internals = React.__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;
      const previous = internals.H;
      internals.H = {
        useSyncExternalStore: (_s: any, snapshot: any) => snapshot(),
        useState: (initial: any) => { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], (v: any) => { slots[i] = typeof v === 'function' ? v(slots[i]) : v; }]; },
        useEffect: (fn: any) => { cursor++; if (g.runEffects) fn(); },
      };
      let output;
      try { output = value.type(value.props); } finally { internals.H = previous; }
      return expand(output, key + '/render');
    }
    const props: any = { key: value.key ?? path };
    for (const [k, v] of Object.entries(value.props)) if (React.isValidElement(v) || Array.isArray(v)) props[k] = expand(v, path + '/' + k);
    return React.cloneElement(value, props);
  }
  const draw = () => { nodes = []; return expand(React.createElement(Screen), 'root'); };
  return { draw, html: () => renderToStaticMarkup(draw()), all: (p: any) => nodes.filter(p), one: (p: any) => { const f = nodes.find(p); assert.ok(f, 'rendered control exists'); return f; } };
}
const text = (n: any): string => n == null || typeof n === 'boolean' ? '' : Array.isArray(n) ? n.map(text).join('') : React.isValidElement(n) ? text(n.props.children) : String(n);
const hasClass = (c: string) => (n: any) => typeof n.props.className === 'string' && n.props.className.split(' ').includes(c);
const label = (s: string) => (n: any) => n.props.label === s;
const prop = (h: any, name: string) => h.all(hasClass('ou-ny-prop')).find((n: any) => text(n.props.children[0]) === name);
const settle = () => new Promise((r) => setImmediate(r));
let reply: (method: string) => any = () => ({ result: {} });
const sent = (method: string) => calls.filter((c) => c[0] === method).map((c) => c[1]);

beforeEach(() => {
  calls.length = 0;
  reply = () => ({ result: {} });
  Object.assign(g, {
    ui: { view: 'inbox', projectId: 'p1', snap: { sessions: [], live: [], approvals: [], needs_you: [], automations: [{ id: 'a1', name: 'nightly tests' }], engines: [{ id: 'claude', light: 'green' }, { id: 'codex', light: 'green' }], projects: [{ id: 'p1', name: 'Alpha' }] } },
    rpc: async (method: string, params: any) => { calls.push([method, params]); return reply(method); },
    toast: (...args: any[]) => calls.push(['toast', ...args]),
    waitingAll: () => g.ui.snap.live.filter((s: any) => s.state === 'waiting_for_you'),
    isInfo: () => false, taskOf: (s: any) => s.title, ago: () => '1m ago', openTermLink: () => {},
  });
  g.runEffects = false;
  inboxStore.set({ selectedId: null, collapsed: [], props: true });
});
const s = (id: string, extra: any = {}) => ({ id, project_id: 'p1', engine_id: 'claude', state: 'working', state_at: '2026-11-10T00:00:00Z', title: 'Task ' + id, labels: [], prompt: 'do ' + id, ...extra });

test('an older snapshot row without the new fields still renders every property with a quiet default', () => {
  g.ui.snap.live = [{ id: 'old', project_id: 'p1', engine_id: 'claude', state: 'waiting_for_you', title: 'Old row' }];
  inboxStore.set({ selectedId: 'old' });
  const h = harness(Inbox);
  assert.doesNotThrow(() => h.html());
  assert.deepEqual(h.all(hasClass('ou-ny-prop-label')).map(text), ['Status', 'Priority', 'Labels', 'Assignee', 'Project', 'Parent', 'Blocked by', 'Blocking', 'Sub-tasks', 'Reviewers', 'Approvers', 'Monitor', 'Service', 'Workspace', 'Branch', 'Run ledger']);
  assert.equal(h.one(label('Priority')).props.value, 'none');
  assert.equal(text(prop(h, 'Blocking')), 'BlockingNone');
  assert.equal(h.one(label('Monitor')).props.value, '');
  assert.match(text(h.one(hasClass('ou-ny-chips'))), /No priority/);
});

test('priority writes through session.priority-set, shows at once and is undone with a toast when the core refuses', async () => {
  const row = s('s1', { state: 'waiting_for_you' });
  g.ui.snap.live = [row]; inboxStore.set({ selectedId: 's1' });
  const h = harness(Inbox); h.draw();
  h.one(label('Priority')).props.onChange('high');
  assert.equal(row.priority, 'high');
  await settle();
  assert.deepEqual(sent('session.priority-set'), [{ session_id: 's1', priority: 'high' }]);
  assert.equal(row.priority, 'high');
  reply = (m) => (m === 'session.priority-set' ? { error: { message: 'unknown method' } } : { result: {} });
  h.draw(); h.one(label('Priority')).props.onChange('urgent');
  assert.equal(row.priority, 'urgent');
  await settle();
  assert.equal(row.priority, 'high');
  assert.ok(calls.some((c) => c[0] === 'toast' && c[1] === 'unknown method'));
});

test('rows sort by priority inside their group, and an unfinished blocker marks a row Blocked', () => {
  g.ui.snap.live = [s('low', { priority: 'low' }), s('none'), s('urgent', { priority: 'urgent' }), s('blocked', { priority: 'medium', blocked_by: ['none'] })];
  const h = harness(Inbox); h.draw();
  assert.deepEqual(h.all(hasClass('ou-irow')).map((n: any) => n.props['data-id']), ['urgent', 'blocked', 'low', 'none']);
  const rings = h.all((n: any) => n.type?.name === 'StatusRing').map((n: any) => n.props.status);
  assert.deepEqual(rings, ['working', 'blocked', 'working', 'working']);
  g.ui.snap.sessions = [s('none', { state: 'done' })];
  g.ui.snap.live = g.ui.snap.live.filter((x: any) => x.id !== 'none');
  h.draw();
  assert.deepEqual(h.all((n: any) => n.type?.name === 'StatusRing').map((n: any) => n.props.status), ['working', 'working', 'working']);
});

test('blockers are added with session.block-set and the last one is removed with session.block-clear', async () => {
  const row = s('s1', { blocked_by: [] });
  g.ui.snap.live = [row, s('s2')]; inboxStore.set({ selectedId: 's1' });
  const h = harness(Inbox); h.draw();
  assert.deepEqual(h.one(label('Add blocker')).props.options.map((o: any) => o.value), ['', 's2']);
  h.one(label('Add blocker')).props.onChange('s2'); await settle();
  assert.deepEqual(sent('session.block-set'), [{ session_id: 's1', blocker_ids: ['s2'] }]);
  h.draw();
  h.one((n: any) => n.props['aria-label'] === 'Remove Task s2').props.onClick({ stopPropagation() {} }); await settle();
  assert.deepEqual(sent('session.block-clear'), [{ session_id: 's1' }]);
  assert.deepEqual(row.blocked_by, []);
});

test('reviewers, approvers and the approve and reject buttons drive their contract methods', async () => {
  const row = s('s1', { reviews: [] });
  g.ui.snap.live = [row]; inboxStore.set({ selectedId: 's1' });
  const h = harness(Inbox); h.draw();
  h.one(label('Add reviewer')).props.onChange('codex'); await settle();
  assert.deepEqual(sent('session.reviewers-set'), [{ session_id: 's1', reviewers: ['codex'], approvers: [] }]);
  h.draw();
  h.one((n: any) => n.type === 'button' && text(n) === 'None, add me').props.onClick(); await settle();
  assert.deepEqual(sent('session.reviewers-set')[1], { session_id: 's1', reviewers: ['codex'], approvers: ['you'] });
  h.draw();
  h.one(label('Approve')).props.onClick(); await settle();
  assert.deepEqual(sent('session.approve'), [{ session_id: 's1' }]);
  row.reviews = [{ kind: 'approver', who: 'you', state: 'pending', note: null, review_session_id: null }];
  h.draw(); h.one(label('Reject')).props.onClick(); await settle();
  assert.equal(sent('session.reject')[0].session_id, 's1'); assert.ok(sent('session.reject')[0].note);
  row.reviews = [{ kind: 'reviewer', who: 'codex', state: 'failed', note: 'tests red', review_session_id: 'r1' }];
  assert.match(h.html(), /codex<\/b> failed the review: tests red/);
});

test('monitor picks an automation through session.monitor-set and clears it with null', async () => {
  const row = s('s1');
  g.ui.snap.live = [row]; inboxStore.set({ selectedId: 's1' });
  const h = harness(Inbox); h.draw();
  h.one(label('Monitor')).props.onChange('a1'); await settle();
  assert.deepEqual(row.monitor, { automation_id: 'a1', name: 'nightly tests', last_outcome: null });
  h.draw(); h.one(label('Monitor')).props.onChange(''); await settle();
  assert.deepEqual(sent('session.monitor-set'), [{ session_id: 's1', automation_id: 'a1' }, { session_id: 's1', automation_id: null }]);
});

test('sub-tasks count children by state, filter by search and launch a child with parent_id', async () => {
  g.ui.snap.live = [s('p'), s('c1', { parent_id: 'p', state: 'done', title: 'Write docs' }), s('c2', { parent_id: 'p', title: 'Fix build' }), s('c3', { parent_id: 'p', title: 'Fix lint', blocked_by: ['c2'] })];
  inboxStore.set({ selectedId: 'p' });
  const h = harness(Inbox); h.draw();
  assert.equal(text(h.one(hasClass('ou-ny-sub-summary'))), '1/3 done1 in progress1 blocked');
  assert.deepEqual([h.one((n: any) => n.type?.name === 'Bar').props.done, h.one((n: any) => n.type?.name === 'Bar').props.total], [1, 3]);
  h.one(label('Search sub-tasks')).props.onChange('fix'); h.draw();
  assert.deepEqual(h.all(hasClass('ou-ny-sub-row')).map((n: any) => n.props['data-id']), ['c2', 'c3']);
  h.one(label('New sub-task')).props.onClick(); h.draw();
  const draft = h.all(label('New sub-task')).find((n: any) => 'value' in n.props);
  draft.props.onChange('add a test'); h.draw();
  await h.all(label('New sub-task')).find((n: any) => 'value' in n.props).props.onEnter();
  assert.deepEqual(sent('session.launch'), [{ project_id: 'p1', engine_id: 'claude', prompt: 'add a test', parent_id: 'p' }]);
});

test('monitor choices come from automation.list for the open session project, not the snapshot', async () => {
  delete g.ui.snap.automations; g.runEffects = true;
  const row = s('s1'); g.ui.snap.live = [row]; inboxStore.set({ selectedId: 's1' });
  reply = (m) => (m === 'automation.list' ? { result: { automations: [{ id: 'a9', name: 'lint' }] } } : { result: {} });
  const h = harness(Inbox); h.draw(); await settle(); h.draw();
  assert.ok(sent('automation.list').some((p: any) => p.project_id === 'p1'));
  assert.deepEqual(h.one(label('Monitor')).props.options.map((o: any) => o.label), ['Not watched', 'lint']);
  h.one(label('Monitor')).props.onChange('a9'); await settle();
  assert.deepEqual(sent('session.monitor-set').at(-1), { session_id: 's1', automation_id: 'a9' });
});

test('the Add sub-task pill in Properties opens the launch input and Enter starts a child with parent_id', async () => {
  g.ui.snap.live = [s('p')]; inboxStore.set({ selectedId: 'p' });
  const h = harness(Inbox); h.draw();
  h.one((n: any) => hasClass('ou-ny-addpill')(n) && text(n.props.children) === '+ Add sub-task').props.onClick(); h.draw();
  const draft = () => h.all(label('New sub-task')).find((n: any) => 'value' in n.props);
  draft().props.onChange('split the parser'); h.draw();
  await draft().props.onEnter();
  assert.deepEqual(sent('session.launch'), [{ project_id: 'p1', engine_id: 'claude', prompt: 'split the parser', parent_id: 'p' }]);
});

test('the assignee arrow opens the session on the Wall', () => {
  const viewed: string[] = []; const picked: string[] = [];
  g.homeView = { set: (v: string) => viewed.push(v) }; g.pick = (id: string) => picked.push(id);
  g.ui.snap.live = [s('s1')]; inboxStore.set({ selectedId: 's1' });
  const h = harness(Inbox); h.draw();
  h.one((n: any) => n.props?.['aria-label'] === 'Open claude on the Wall').props.onClick();
  assert.deepEqual([viewed, picked], [['wall'], ['s1']]);
});

test('the properties panel folds away and comes back from the top bar', () => {
  g.ui.snap.live = [s('s1')]; inboxStore.set({ selectedId: 's1' });
  const h = harness(Inbox); h.draw();
  assert.equal(h.one((n: any) => n.type?.name === 'Slide').props.open, true);
  h.one(label('Hide properties')).props.onClick(); h.draw();
  assert.equal(h.one((n: any) => n.type?.name === 'Slide').props.open, false);
  h.one(label('Show properties')).props.onClick(); h.draw();
  assert.equal(inboxStore.get().props, true);
});

test('step buttons move the selection through visible rows only', () => {
  g.ui.snap.live = [s('a', { state: 'waiting_for_you' }), s('b'), s('c')];
  inboxStore.set({ selectedId: 'a', collapsed: [] });
  const h = harness(Inbox); h.draw();
  assert.equal(h.one(label('Previous item')).props.isDisabled, true);
  h.one(label('Next item')).props.onClick(); assert.equal(inboxStore.get().selectedId, 'b');
  h.draw(); h.one(label('Next item')).props.onClick(); assert.equal(inboxStore.get().selectedId, 'c');
  h.draw(); assert.equal(h.one(label('Next item')).props.isDisabled, true);
});

test('without a browser motion is off and leaving a row calls straight through', () => {
  assert.equal(motionOn(), false);
  let done = 0; leaveRow('x', () => done++);
  assert.equal(done, 1);
});

test('motion lives in GSAP behind one reduced-motion switch, with every tween at or under 0.4 s and no bounce', () => {
  const src = readFileSync(join(wb, 'ui/src/inbox.jsx'), 'utf8');
  assert.match(src, /gsap\.matchMedia\(\)\.add\(\{ calm: '\(prefers-reduced-motion: reduce\)'/);
  const durations = [...src.matchAll(/duration: ([\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(durations.length >= 8);
  assert.ok(durations.every((d) => d <= 0.4), String(durations));
  assert.doesNotMatch(src, /bounce|elastic|back\./i);
});
