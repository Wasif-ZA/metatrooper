import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('needs-you toasts start from the first snapshot read from the database, and a fallback snapshot changes nothing', async () => {
  const { freshNeeds } = await import('../src/queries.ts');
  const row = (id: string) => ({ id, at: '', kind: 'done', ref: null, text: id, read_at: null });
  const empty = { needs_you: [] as ReturnType<typeof row>[] };
  const db = { needs_you: [row('a'), row('b')] };
  let r = freshNeeds(null, empty as never, false);
  assert.deepEqual([r.seen, r.fresh], [null, []]);
  r = freshNeeds(r.seen, db as never, true);
  assert.deepEqual(r.fresh, []);
  r = freshNeeds(r.seen, empty as never, false);
  r = freshNeeds(r.seen, { needs_you: [row('a'), row('b'), row('c')] } as never, true);
  assert.deepEqual(r.fresh.map((n) => n.id), ['c']);
});

test('a browser pane whose setup fails is dropped, so the next sync builds it again', () => {
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./fixtures/pane-setup-fail.ts', import.meta.url))], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), { afterFail: false, retried: true });
});

test('the per-session git cache keeps a bounded number of sessions, dropping the longest unrefreshed first', async () => {
  const { refreshRowGit, rowGit } = await import('../src/rowgit.ts');
  const gone = path.join(os.tmpdir(), `mt-harden-d-no-such-dir-${process.pid}`);
  for (let i = 0; i < 300; i++) await refreshRowGit([{ id: 'live', cwd: gone }, { id: `s${i}`, cwd: gone }]);
  const ids = Object.keys(rowGit());
  assert.ok(ids.length <= 200, `${ids.length} sessions cached`);
  assert.ok(ids.includes('live') && ids.includes('s299') && !ids.includes('s0'));
});

test('a data-folder watcher that errors (folder deleted or locked) does not throw', async () => {
  const { watchDb } = await import('../src/queries.ts');
  const w = watchDb(mkdtempSync(path.join(os.tmpdir(), 'mt-harden-d-watch-')), 'troop.db', () => {});
  assert.ok(w);
  try { assert.doesNotThrow(() => w.emit('error', new Error('EPERM'))); } finally { w.close(); }
});

test('a browser pane whose database read fails still blanks a rebound page and answers its requests with a block', () => {
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./fixtures/policy-db-error.ts', import.meta.url))], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), { blanked: true, request: { cancel: true } });
});

test('a reloaded or crashed window lets go of every terminal connection it had attached', async () => {
  process.env.METATROOPER_PIPE_PREFIX = `mt-harden-d-${process.pid}`;
  process.env.METATROOPER_HOME = mkdtempSync(path.join(os.tmpdir(), 'mt-harden-d-'));
  const { termPipe } = await import('../../core/src/paths.ts');
  const terminals = await import('../src/terminals.ts');
  const open = new Set<net.Socket>();
  let joined = 0;
  const server = net.createServer((s) => { open.add(s); joined++; s.on('close', () => open.delete(s)); s.on('error', () => {}); s.resume(); });
  await new Promise<void>((r) => server.listen(termPipe(), r));
  try {
    const closed: string[] = [];
    for (const id of ['s1', 's2']) terminals.attachTerm(id, 80, 24, (sid, m) => { if (m.op === 'closed') closed.push(sid); });
    for (let i = 0; i < 100 && joined < 2; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(joined, 2);
    terminals.detachAll();
    for (let i = 0; i < 100 && open.size; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(open.size, 0);
    assert.deepEqual(closed, []);
  } finally {
    for (const s of open) s.destroy();
    await new Promise((r) => server.close(r));
  }
});

test('a tile that leaves the wall stops observing its size and drops its pending refit', () => {
  const observers: Array<{ disconnected: boolean; fire: () => void }> = [];
  const cleared: unknown[] = [];
  let timerId = 0;
  const node = (): any => ({ dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, querySelector: () => node(), append() {}, remove() {}, isConnected: true, offsetWidth: 100, clientHeight: 100 });
  const troop = { onTerm() {}, termInput() {}, termAttach: async () => {}, termDetach: async () => {} };
  class Terminal { options = {}; loadAddon() {} registerLinkProvider() {} open() {} onData() {} attachCustomKeyEventHandler() {} write() {} focus() {} dispose() {} }
  class ResizeObserver { disconnected = false; fire: () => void; constructor(cb: () => void) { this.fire = cb; observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  const ctx = vm.createContext({ window: { troop, Terminal, FitAddon: { FitAddon: class {} } }, document: { getElementById: () => node(), createElement: node }, ResizeObserver, setTimeout: () => ++timerId, clearTimeout: (t: unknown) => cleared.push(t), performance });
  vm.runInContext(`${readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8')}\nthis.termView = termView;`, ctx);
  ctx.termView.show({ mode: 'single', selected: 's1', sessions: [{ id: 's1', state: 'working', words: '' }] });
  assert.equal(observers.length, 1);
  observers[0].fire();
  observers[0].fire();
  const refit = timerId;
  assert.ok(refit > 0, 'the second resize schedules a refit');
  assert.ok(!cleared.includes(refit));
  ctx.termView.show({ mode: 'single', selected: null, sessions: [] });
  assert.equal(observers[0].disconnected, true);
  assert.ok(cleared.includes(refit), 'dropping the tile clears its pending refit');
});
