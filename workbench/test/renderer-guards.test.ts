import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const fn = (name: string) => source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?\\n}\\n`, 'm'))![0];
const line = (start: string) => source.split('\n').find((l) => l.startsWith(start))!;

test('a second Launch click while the first is pending is ignored', async () => {
  let release!: () => void;
  let calls = 0;
  const api = { call: () => { calls++; return new Promise((r) => { release = () => r({ kind: 'reply', reply: { result: { session_id: 's' } } }); }); } };
  const toasts: string[] = [];
  const ui: any = {};
  const rpc = new Function('api', 'ui', 'toast', `${line('const ONE_AT_A_TIME')}\n${fn('rpc')}\n${fn('rpcOnce')}; return rpc;`)(api, ui, (t: string) => toasts.push(t));
  const first = rpc('session.launch', {});
  const second = await rpc('session.launch', {});
  assert.equal(calls, 1);
  assert.ok(second.error);
  release();
  assert.deepEqual(await first, { result: { session_id: 's' } });
  const third = rpc('session.launch', {});
  assert.equal(calls, 2);
  release();
  await third;
});

test('a terminal tile stops sending input once its connection closes', () => {
  const sent: string[] = [];
  let onTerm: (id: string, m: unknown) => void = () => {};
  let onData: (d: string) => void = () => {};
  const node = (): any => ({ dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, querySelector: () => node(), append() {}, isConnected: true });
  const troop = { onTerm: (f: typeof onTerm) => { onTerm = f; }, termInput: (_id: string, d: string) => sent.push(d), termAttach: async () => {}, termDetach: async () => {} };
  class Terminal { written = ''; loadAddon() {} registerLinkProvider() {} open() {} onData(f: typeof onData) { onData = f; } attachCustomKeyEventHandler() {} write(s: string) { this.written += s; } focus() {} }
  const termSource = readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8');
  const ctx = vm.createContext({ window: { troop, Terminal, FitAddon: { FitAddon: class {} } }, document: { getElementById: () => node(), createElement: node }, ResizeObserver: class { observe() {} }, setTimeout() {} });
  vm.runInContext(`${termSource}\nthis.termView = termView;`, ctx);
  ctx.termView.show({ mode: 'single', selected: 's1', sessions: [{ id: 's1', state: 'working', words: '' }] });
  onData('a');
  onTerm('s1', { op: 'closed' });
  onData('b');
  assert.deepEqual(sent, ['a']);
});

test('the Git tab leaves Loading when git throws or no project is picked, and a failed view does not toast', async () => {
  const ui: any = { projectId: 'p', gitBusy: null };
  const api = { git: async () => { throw new Error('spawn git ENOENT'); } };
  const toasts: string[] = [];
  const gitDo = new Function('ui', 'api', 'render', 'toast', `${fn('gitDo')}; return gitDo;`)(ui, api, () => {}, (t: string) => toasts.push(t));
  await gitDo('view');
  assert.equal(ui.gitBusy, null);
  assert.deepEqual(toasts, []);
  assert.equal(ui.git.error, 'spawn git ENOENT');
  ui.projectId = null;
  ui.gitBusy = 'view';
  await gitDo('view');
  assert.equal(ui.gitBusy, null);
});

test('a waiting tile that leaves the wall stops its endless attention pulse', () => {
  const node = (): any => ({ dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, after() {}, appendChild() {}, querySelector: () => node(), getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) });
  const tile = node();
  const endless: Array<{ killed: boolean }> = [];
  const tween = (_t: unknown, v?: { repeat?: number }) => { const tw = { killed: false, kill() { tw.killed = true; } }; if (v?.repeat === -1) endless.push(tw); return tw; };
  const gsap = { to: tween, set: tween, fromTo: (t: unknown, _f: unknown, v: { repeat?: number }) => tween(t, v), delayedCall: tween };
  const ctx = vm.createContext({ gsap, termView: { tile: () => tile }, matchMedia: () => ({ matches: false }), document: { body: node(), querySelector: () => node(), createElement: () => ({ content: { firstChild: node() } }) }, addEventListener() {}, setInterval() {}, innerWidth: 1400, innerHeight: 900 });
  vm.runInContext(`${readFileSync(new URL('../renderer/wall.js', import.meta.url), 'utf8')}\nthis.wall = wall;`, ctx);
  ctx.wall.decide([{ id: 's1', state: 'waiting_for_you' }], null);
  ctx.wall.apply('single');
  assert.equal(endless.length, 1);
  ctx.wall.decide([], null);
  assert.ok(endless.every((t) => t.killed));
});

function shellTile() {
  let onTerm: (id: string, m: unknown) => void = () => {};
  const timers: Array<() => void> = [];
  const attaches: string[] = [];
  const node = (): any => ({ dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, querySelector: () => node(), append() {}, isConnected: true });
  const sent: string[] = [];
  let written = '';
  let onData: (d: string) => void = () => {};
  const troop = { onTerm: (f: typeof onTerm) => { onTerm = f; }, termInput: (_id: string, d: string) => { sent.push(d); }, termAttach: async (id: string) => { attaches.push(id); }, termDetach: async () => {} };
  class Terminal { options = {}; loadAddon() {} registerLinkProvider() {} open() {} onData(f: typeof onData) { onData = f; } attachCustomKeyEventHandler() {} write(s: string) { written += s; } focus() {} }
  const ctx = vm.createContext({ window: { troop, Terminal, FitAddon: { FitAddon: class {} } }, document: { getElementById: () => node(), createElement: node }, ResizeObserver: class { observe() {} }, setTimeout: (f: () => void) => timers.push(f), performance });
  vm.runInContext(`${readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8')}\nthis.termView = termView;`, ctx);
  const exited: string[] = [];
  ctx.termView.show({ mode: 'single', selected: 'sh_1', sessions: [{ id: 'sh_1', state: 'idle', words: 'shell', shell: true }], onExit: (id: string) => exited.push(id) });
  const tick = () => { for (const f of timers.splice(0)) f(); };
  return { send: (m: unknown) => onTerm('sh_1', m), type: (d: string) => onData(d), tick, exited, attaches, sent, written: () => written };
}

test('a normal exit is reported once, with no disconnect note and no re-attach', () => {
  const t = shellTile();
  t.send({ op: 'exit', code: 0 });
  t.send({ op: 'closed' });
  t.tick();
  assert.deepEqual(t.exited, ['sh_1']);
  assert.deepEqual(t.attaches, []);
  assert.ok(!t.written().includes('disconnected'));
});


test('a shell tile whose connection drops but whose shell is alive re-attaches instead of exiting', () => {
  const t = shellTile();
  t.send({ op: 'closed' });
  t.tick();
  assert.deepEqual(t.attaches, ['sh_1']);
  t.send({ op: 'snapshot', data: '' });
  assert.deepEqual(t.exited, []);
});

test('a shell tile is reported exited when the re-attach finds no shell or no core', () => {
  const dead = shellTile();
  dead.send({ op: 'closed' });
  dead.tick();
  dead.send({ op: 'error', code: 'no-session' });
  dead.send({ op: 'closed' });
  assert.deepEqual(dead.exited, ['sh_1']);
  const offline = shellTile();
  offline.send({ op: 'closed' });
  offline.tick();
  offline.send({ op: 'closed' });
  assert.deepEqual(offline.exited, ['sh_1']);
});

test('the browser pane bounds are reported again once the split panel finishes sliding', () => {
  const node = (): any => ({ dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, after() {}, appendChild() {}, remove() {}, querySelector: () => node(), getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) });
  const tiles: Record<string, any> = { s1: node(), s2: node() };
  const done: Array<() => void> = [];
  const tween = (t: unknown, v?: { onComplete?: () => void }) => { if (t === '#split' && v?.onComplete) done.push(v.onComplete); return { kill() {} }; };
  const gsap = { to: tween, set: tween, fromTo: (t: unknown, _f: unknown, v: object) => tween(t, v), delayedCall: tween };
  let reported = 0;
  const ctx = vm.createContext({ gsap, termView: { tile: (id: string) => tiles[id] }, matchMedia: () => ({ matches: false }), document: { body: node(), querySelector: () => node(), createElement: () => ({ content: { firstChild: node() } }) }, addEventListener() {}, setInterval() {}, innerWidth: 1400, innerHeight: 900, reportPaneBounds: () => { reported++; } });
  vm.runInContext(`${readFileSync(new URL('../renderer/wall.js', import.meta.url), 'utf8')}\nthis.wall = wall;`, ctx);
  ctx.wall.decide([{ id: 's1', state: 'working' }, { id: 's2', state: 'working' }], null);
  ctx.wall.apply('single');
  ctx.wall.pair('s2');
  for (const f of done) f();
  assert.ok(reported > 0);
});

test('keys typed while a tile re-attaches are sent after it reconnects, or reported as dropped', () => {
  const live = shellTile();
  live.send({ op: 'closed' });
  live.type('ab');
  live.tick();
  live.type('c');
  assert.deepEqual(live.sent, []);
  live.send({ op: 'snapshot', data: '' });
  assert.equal(live.sent.join(''), 'abc');
  const dead = shellTile();
  dead.send({ op: 'closed' });
  dead.type('x');
  dead.tick();
  dead.send({ op: 'closed' });
  assert.deepEqual(dead.sent, []);
  assert.match(dead.written(), /not sent/);
});
test('switching project drops the old project open file diff and picked comment', () => {
  const ui: any = { projectId: 'p1', handback: {}, hbFile: 'a.txt', hbDiff: 'diff', hbLine: 2, gitFile: true, comment: { pane_id: 'bp1' } };
  const switchProject = new Function('ui', 'save', 'setView', `${fn('switchProject')}; return switchProject;`)(ui, () => {}, () => {});
  switchProject('p2');
  assert.equal(ui.projectId, 'p2');
  assert.deepEqual([ui.handback, ui.hbFile, ui.hbDiff, ui.hbLine, ui.gitFile, ui.comment], [undefined, null, undefined, null, false, null]);
});

test('the command palette opens before the first snapshot arrives', () => {
  const ui: any = { snap: null, shellKinds: [], mode: 'single' };
  const document = { body: { classList: { contains: () => false } } };
  const paletteItems = new Function('ui', 'document', 'load', 'project', 'selectedSession', 'TABS', `${fn('paletteItems')}; return paletteItems;`)(ui, document, () => null, () => null, () => null, []);
  assert.ok(Array.isArray(paletteItems()));
});

test('the Before/After image cache drops screenshots the snapshot no longer lists', () => {
  const shot = (id: string, label: string) => ({ id, pane_id: 'bp1', label, url: '', taken_at: '', w390_path: `${id}-390.png`, w1280_path: `${id}-1280.png` });
  const ui: any = { swap: false, images: { 'old-390.png': 'data:old', 'b-390.png': 'data:b' }, snap: { snapshots: [shot('b', 'before'), shot('a', 'after')] } };
  const renderCompare = new Function('ui', 'esc', 'ago', 'shotSrc', `${fn('renderCompare')}; return renderCompare;`)(ui, String, () => '', (f: string) => ui.images[f] ?? '');
  renderCompare({ id: 'bp1' });
  assert.deepEqual(Object.keys(ui.images), ['b-390.png']);
});
