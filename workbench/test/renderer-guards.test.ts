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
  const ctx = vm.createContext({ window: { troop, Terminal, FitAddon: { FitAddon: class {} } }, document: { getElementById: () => node(), createElement: node }, ResizeObserver: class { observe() {} } });
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
