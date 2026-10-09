import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = (name: string) => readFileSync(new URL(`../renderer/layouts/${name}`, import.meta.url), 'utf8');
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function context() {
  const store = new Map<string, string>();
  const el = { innerHTML: '', id: '', className: '', addEventListener() {}, querySelectorAll: () => [] };
  const ctx: any = {
    runLayouts: {},
    reviewView: { esc },
    localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) },
    document: { createElement: () => el, body: { appendChild() {} }, addEventListener() {} },
    setTimeout: () => 0,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('rules.js'), ctx);
  vm.runInContext(`${read('hand-back.js')}\nthis.handBack = handBack;`, ctx);
  vm.runInContext(`${read('agent-split.js')}\nthis.agentRail = agentRail;`, ctx);
  vm.runInContext(`${read('bar.js')}\nthis.runBars = runBars;`, ctx);
  return { ctx, el };
}

const h = { esc, label: (s: any) => s.status, glyph: () => '', who: (s: any) => s.engine || s.kind, took: () => '', sums: () => null, files: () => '', eventLine: () => '', gateCard: () => '', fmt: () => '0s' };

function model(sessions: any[], extra: any = {}) {
  return {
    run: { id: 'r1' }, sessions, log: [], elapsed: 0, tokens: 0, usd: 0, done: 0,
    meta: { steps: { build: { worktree: true }, verify: {} } },
    list: [{ id: 'build', title: 'Build', kind: 'agent', status: 'running' }, { id: 'verify', title: 'Verify', kind: 'agent', status: 'pending' }],
    ...extra,
  };
}

test('worktree rail lists only worktree agent sessions, oldest first, and marks the selected one', () => {
  const { ctx } = context();
  const sessions = [
    { id: 's2', step_id: 'build', engine_id: 'codex', state: 'working', cwd: 'C:\\wt\\build-2', started_at: '2026-10-09T01:00:02Z', last_line: 'writing tests' },
    { id: 's1', step_id: 'build', engine_id: 'claude', state: 'waiting_for_you', cwd: '/wt/build-1', started_at: '2026-10-09T01:00:01Z', last_line: '' },
    { id: 's3', step_id: 'verify', engine_id: 'claude', state: 'working', cwd: '/repo', started_at: '2026-10-09T01:00:03Z' },
  ];
  const m = model(sessions);
  assert.deepEqual(ctx.agentRail.sessions(m).map((x: any) => x.id), ['s1', 's2']);
  const html = ctx.agentRail.html(m, h, 's2');
  assert.match(html, /data-id="s1"[\s\S]*data-id="s2"/);
  assert.match(html, /class="ri on st-working" data-rs="rail" data-id="s2"/);
  assert.match(html, /codex  ·  build-2/);
  assert.doesNotMatch(html, /s3/);
  assert.match(ctx.agentRail.html(model([]), h, null), /No worktree agents/);
});

test('agent-split shows the rail when picked by hand or when the watched step fanned out, else not', () => {
  const { ctx } = context();
  const one = [{ id: 's1', step_id: 'build', engine_id: 'claude', state: 'working', started_at: '1' }];
  const two = [...one, { id: 's2', step_id: 'build', engine_id: 'codex', state: 'working', started_at: '2' }];
  const watch = { id: 'build' };
  assert.equal(ctx.agentRail.shown(model(one, { watch }), false), false);
  assert.equal(ctx.agentRail.shown(model(one, { watch }), true), true);
  assert.equal(ctx.agentRail.shown(model(two, { watch }), false), true);
  const m: any = model(one, { watch: { ...watch, title: 'Build', session: one[0] }, rail: true });
  assert.match(ctx.runLayouts['agent-split'].render(m, h), /class="railwrap"><aside class="rail"/);
  m.rail = false;
  assert.doesNotMatch(ctx.runLayouts['agent-split'].render(m, h), /railwrap/);
});

test('a finished loop run stays orange on its bar until every hand-back item is ticked', async () => {
  const { ctx, el } = context();
  const run = { id: 'r1', pipeline_id: 'spec-build-review-handback', status: 'done', started_at: '2026-10-09T01:00:00Z', ended_at: new Date(Date.now() + 1000).toISOString() };
  const items = [{ n: 1, kind: 'push', text: 'git push' }, { n: 2, kind: 'review', text: 'read a.ts' }, { n: 3, kind: 'decide', text: 'pick a name' }];
  const snap = { runs: [run], pipelines: [{ id: run.pipeline_id, title: 'Loop', background: true }], sessions: [] };
  let detailCalls = 0;
  const host = {
    snap: () => snap,
    stepsOf: () => ({ run, at: 8, list: [{ id: 'handback', status: 'done' }] }),
    api: { runDetail: async () => { detailCalls++; return { outputs: { handback: { items } } }; } },
    isOpen: () => false, cancelButton: () => '', openRun() {}, render() {},
  };
  ctx.runBars.init(host);
  ctx.runBars.render();
  await new Promise((r) => setImmediate(r));
  ctx.runBars.render();
  assert.equal(detailCalls, 1);
  assert.match(el.innerHTML, /class="rbar hot halo end"/);
  assert.match(el.innerHTML, /3 of 3 hand-back items wait for you/);
  ctx.handBack.toggle('r1', 1);
  ctx.handBack.toggle('r1', 3);
  ctx.runBars.render();
  assert.match(el.innerHTML, /1 of 3 hand-back items wait for you/);
  ctx.handBack.toggle('r1', 2);
  ctx.runBars.render();
  assert.match(el.innerHTML, /class="rbar end"/);
  assert.match(el.innerHTML, /nothing needs you/);
});

test('run screen keys pick a slot, so key 4 on the loop is the rail and lights only its own button', () => {
  const src = readFileSync(new URL('../renderer/layouts/run.js', import.meta.url), 'utf8');
  assert.match(src, /manual\(rules\.ruleOf\(m\.run\.pipeline_id\)\.five\[Number\(e\.key\) - 1\], Number\(e\.key\) - 1\)/);
  assert.match(src, /i === S\.slot : k === S\.cur && five\.indexOf\(k\) === i/);
  assert.match(src, /agentRail\.shown\(m, S\.manual === 'agent-split' && S\.slot != null && five\.indexOf\('agent-split'\) !== S\.slot\)/);
});
