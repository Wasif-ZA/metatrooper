import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { crashAction, engineFix } from '../src/queries.ts';

test('h-sum-checkerror: an engine whose check threw gets a fix line', () => {
  assert.match(engineFix({ id: 'codex' }, 'check-error') ?? '', /codex/);
});

test('h-rv-ponytail: a pane that fails setup twice in a row is not rebuilt on the very next sync', () => {
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./fixtures/pane-setup-backoff.ts', import.meta.url))], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), { retried: 4, waited: 4 });
});

test('UI-02-agent-viewport: a pane hidden under an overlay keeps its shown viewport, set before the view shrinks', () => {
  const r = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', fileURLToPath(new URL('./fixtures/pane-park-size.ts', import.meta.url))], { encoding: 'utf8', timeout: 20000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout.trim().split('\n').pop()!), ['override 959x776', 'bounds 1x1']);
});

test('h-d-d1: a crashed main window reloads once, and a second crash within a minute stops instead of looping', () => {
  assert.equal(crashAction('crashed', -Infinity, 1_000_000), 'reload');
  assert.equal(crashAction('oom', 1_000_000, 1_030_000), 'stop');
  assert.equal(crashAction('crashed', 1_000_000, 1_090_000), 'reload');
  assert.equal(crashAction('clean-exit', -Infinity, 1_000_000), 'none');
});

test('UI-02: the native browser pane hides while a toast, sheet, palette, Inbox, menu or usage popover is open, and comes back after', () => {
  const app = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
  const fn = app.match(/^function reportPaneBounds\([^]*?\n}\n/m)![0];
  const overlays = app.split('\n').find((l) => l.startsWith('const PANE_OVERLAYS'))!;
  const shown: unknown[] = [];
  let open: string | null = null;
  const document = {
    getElementById: () => ({ getBoundingClientRect: () => ({ x: 633, y: 64, width: 959, height: 776 }) }),
    querySelector: (sel: string) => (open && sel.split(', ').some((s) => s.startsWith(open!)) ? {} : null),
  };
  const ui = { tab: 'browser', split: true, comment: null, browserMode: 'live', paneId: 'bp_1', lastBounds: null };
  const api = { paneShow: (id: unknown, r: unknown) => { shown.push(r ? id : null); } };
  const report = new Function('document', 'ui', 'api', `${overlays}\n${fn}; return reportPaneBounds;`)(document, ui, api);
  report();
  for (const sel of ['#toasts', '#sheet', '#palette', '#inbox', '#sinks', '#menu', '#usage']) {
    open = sel;
    report();
    open = null;
    report();
  }
  assert.deepEqual(shown, ['bp_1', ...Array(7).fill([null, 'bp_1']).flat()]);
  open = '#toasts';
  Object.assign(ui, { picking: { pane: 'bp_1' }, lastBounds: null });
  shown.length = 0;
  report();
  assert.deepEqual(shown, ['bp_1'], 'the pick hint toast leaves the pane clickable');
});

test('UI-02-sheet-anim: the approval sheet keeps its up class until the close slide ends, so the pane stays hidden under it', async () => {
  const vm = await import('node:vm');
  const node = (): any => ({ dataset: {}, style: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, setAttribute() {}, after() {}, appendChild() {}, remove() {}, querySelector: () => node(), getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }) });
  const cls = new Set<string>();
  const sheet = { ...node(), classList: { add: (c: string) => cls.add(c), remove: (c: string) => cls.delete(c), toggle: (c: string, on: boolean) => (on ? cls.add(c) : cls.delete(c)), contains: (c: string) => cls.has(c) } };
  const done: Array<() => void> = [];
  const tw = (target: unknown, vars: { onComplete?: () => void }) => { if (target === sheet && vars?.onComplete) done.push(vars.onComplete); return { kill() {} }; };
  const ctx = vm.createContext({
    gsap: { to: tw, set: tw, fromTo: tw, delayedCall: tw }, termView: { tile: () => node() }, matchMedia: () => ({ matches: false }),
    document: { body: node(), querySelector: (s: string) => (s === '#sheet' ? sheet : node()), createElement: () => ({ content: { firstChild: node() } }) },
    addEventListener() {}, setInterval() {}, setTimeout() {}, clearTimeout() {}, innerWidth: 1400, innerHeight: 900, reportPaneBounds() {},
  });
  vm.runInContext(`${readFileSync(new URL('../renderer/wall.js', import.meta.url), 'utf8')}\nthis.wall = wall;`, ctx);
  ctx.wall.setSheet(true);
  assert.ok(cls.has('up'));
  ctx.wall.setSheet(false);
  assert.ok(cls.has('up'), 'still up while sliding down');
  done.at(-1)!();
  assert.ok(!cls.has('up'));
  ctx.wall.setSheet(false);
  ctx.wall.setSheet(true);
  done.at(-2)!();
  assert.ok(cls.has('up'), 'a reopen mid-slide keeps it up');
});

test('UI-02-pick-end: a comment pick that ends re-checks the pane, so the hint toast hides it again', async () => {
  const app = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
  const fn = app.match(/^async function startComment\([^]*?\n}\n/m)![0];
  let reported = 0;
  const ui: { paneId: string; picking: unknown } = { paneId: 'bp_1', picking: null };
  const api = { panePick: async () => { throw new Error('cancelled'); } };
  const start = new Function('ui', 'api', 'toast', 'reportPaneBounds', `${fn}; return startComment;`)(ui, api, () => {}, () => { reported++; });
  await start().catch(() => {});
  assert.equal(ui.picking, null);
  assert.equal(reported, 1);
});
