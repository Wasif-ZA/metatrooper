import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { automationTick, LATE_MS, type AutomationDeps, type CheckResult } from '../src/automations.ts';
import { buildMethods } from '../src/methods.ts';
import { schemaFile } from '../src/paths.ts';

type Run = { id: string; due_at: string; at: string; outcome: string; exit_code: number | null; detail: string | null; session_id: string | null };
type Listed = { id: string; next_due: string; runs: Run[] };
const ctx = { ui: true, origin: 'test' };

async function fixture(t: TestContext, result: CheckResult = { code: 0 }) {
  const dir = mkdtempSync(join(tmpdir(), 'm8-f22-'));
  const db = new DatabaseSync(':memory:');
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec(readFileSync(schemaFile, 'utf8'));
  let now = Date.parse('2030-01-01T00:00:00.000Z');
  const iso = new Date(now).toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)')
    .run('p1', dir, 'test', iso, iso);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)')
    .run('codex', '{}', 1, 'local-cli');
  const script = join(dir, 'check.txt');
  writeFileSync(script, 'original check content');
  const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'k' });
  const { id } = await methods.get('automation.set')!.handler({
    project_id: 'p1', name: 'Test automation', every_min: 1, runner: ['fake-runner'],
    script: 'check.txt', engine_id: 'codex', prompt: 'Check the project', timeout_ms: 1000,
  }, ctx) as { id: string };
  const due = (at: number) => db.prepare('UPDATE automation SET next_due = ? WHERE id = ?')
    .run(new Date(at).toISOString(), id);
  due(now);
  let checks = 0;
  let launches = 0;
  const deps: AutomationDeps = {
    now: () => now,
    readFile: readFileSync,
    runCheck: async (argv, cwd, timeoutMs) => {
      checks++;
      assert.deepEqual(argv, ['fake-runner', script]);
      assert.equal(cwd, dir);
      assert.equal(timeoutMs, 1000);
      return result;
    },
    launch: async a => {
      launches++;
      assert.deepEqual(a, { project_id: 'p1', engine_id: 'codex', prompt: 'Check the project', approval: 'ask' });
      return { session_id: 's1' };
    },
  };
  return {
    db, id, script, methods, due, deps,
    tick: () => automationTick(db, deps),
    counts: () => ({ checks, launches }),
    now: () => now,
    setNow: (at: number) => { now = at; },
    runs: () => db.prepare('SELECT * FROM automation_run WHERE automation_id = ?').all(id) as Run[],
    notices: () => db.prepare('SELECT * FROM needs_you WHERE ref = ?').all(id),
    nextDue: () => Date.parse((db.prepare('SELECT next_due FROM automation WHERE id = ?').get(id) as { next_due: string }).next_due),
    list: async () => (await methods.get('automation.list')!.handler({ project_id: 'p1' }, ctx) as { automations: Listed[] }).automations,
  };
}

// protects=M8-F22a fails_when=exit_0_launches_or_hides_history no_claim=real_script_execution
test('exit 0 skips without launching and appears in automation.list', async t => {
  const f = await fixture(t);
  await f.tick();
  assert.deepEqual(f.counts(), { checks: 1, launches: 0 });
  const runs = f.runs();
  assert.equal(runs.length, 1);
  assert.equal(runs[0].outcome, 'skip');
  assert.equal(runs[0].exit_code, 0);
  assert.equal(runs[0].session_id, null);
  assert.equal(f.notices().length, 0);
  const listed = await f.list();
  assert.equal(listed.length, 1);
  assert.equal(listed[0].id, f.id);
  assert.equal(listed[0].runs.length, 1);
  assert.equal(listed[0].runs[0].id, runs[0].id);
  assert.equal(listed[0].runs[0].outcome, 'skip');
});

// protects=M8-F22b fails_when=wake_repeats_at_the_same_time no_claim=real_session_launch
test('exit 1 wakes once and advances next_due beyond the same clock time', async t => {
  const f = await fixture(t, { code: 1 });
  await f.tick();
  assert.deepEqual(f.counts(), { checks: 1, launches: 1 });
  assert.equal(f.runs().length, 1);
  assert.equal(f.runs()[0].outcome, 'woke');
  assert.equal(f.runs()[0].exit_code, 1);
  assert.equal(f.runs()[0].session_id, 's1');
  assert.equal(f.nextDue(), f.now() + 60_000);
  await f.tick();
  assert.deepEqual(f.counts(), { checks: 1, launches: 1 });
  assert.equal(f.runs().length, 1);
});

for (const [label, result, detail] of [
  ['exit 2', { code: 2 }, 'check exited 2'],
  ['timeout', { code: null, timedOut: true }, 'check timed out after 1000 ms'],
  ['startup error', { code: null, error: 'fake failure' }, 'check failed to start: fake failure'],
] as const) {
  // protects=M8-F22c fails_when=failed_check_launches_or_loses_failure no_claim=real_process_timeout_or_error
  test(label + ' records failed without launching', async t => {
    const f = await fixture(t, result);
    await f.tick();
    assert.deepEqual(f.counts(), { checks: 1, launches: 0 });
    assert.equal(f.runs().length, 1);
    assert.equal(f.runs()[0].outcome, 'failed');
    assert.equal(f.runs()[0].exit_code, result.code);
    assert.equal(f.runs()[0].detail, detail);
    assert.equal(f.runs()[0].session_id, null);
    assert.equal(f.nextDue(), f.now() + 60_000);
  });
}

// protects=M8-F22d fails_when=late_slots_catch_up_or_no_notice no_claim=OS_sleep_detection
test('overdue automation records one missed run and notice without executing', async t => {
  const f = await fixture(t);
  const due = f.now() - LATE_MS - 600_001;
  f.due(due);
  await f.tick();
  assert.deepEqual(f.counts(), { checks: 0, launches: 0 });
  assert.equal(f.runs().length, 1);
  assert.equal(f.runs()[0].outcome, 'missed');
  assert.equal(f.runs()[0].due_at, new Date(due).toISOString());
  assert.equal(f.runs()[0].detail, 'missed while the core was off');
  const notices = f.notices();
  assert.equal(notices.length, 1);
  assert.equal(notices[0].kind, 'missed-schedule');
  assert.equal(notices[0].ref, f.id);
  assert.match(String(notices[0].text), /Test automation/);
  assert.equal(f.nextDue(), due + (Math.floor((f.now() - due) / 60_000) + 1) * 60_000);
  assert.ok(f.nextDue() > f.now());
  await f.tick();
  assert.equal(f.runs().length, 1);
  assert.equal(f.notices().length, 1);
  assert.deepEqual(f.counts(), { checks: 0, launches: 0 });
});

// protects=M8-F22f fails_when=modified_script_runs_without_reapproval no_claim=filesystem_race_protection
test('script changed after automation.set fails before check or launch and writes a notice', async t => {
  const f = await fixture(t);
  writeFileSync(f.script, 'changed check content');
  await f.tick();
  assert.deepEqual(f.counts(), { checks: 0, launches: 0 });
  assert.equal(f.runs().length, 1);
  assert.equal(f.runs()[0].outcome, 'failed');
  assert.equal(f.runs()[0].detail, 'check script changed since it was saved; save the automation again in the workbench to approve it');
  assert.equal(f.notices().length, 1);
  assert.equal(f.notices()[0].kind, 'other');
  assert.equal(f.notices()[0].ref, f.id);
  assert.equal(f.nextDue(), f.now() + 60_000);
});

// protects=M8-F22f fails_when=agent_mutation_is_not_UI_gated no_claim=pipe_layer_enforcement
test('set, enable and delete require UI while list does not', async t => {
  const f = await fixture(t);
  for (const name of ['automation.set', 'automation.enable', 'automation.delete']) {
    assert.equal(f.methods.get(name)!.needsUi, true, name);
  }
  assert.notEqual(f.methods.get('automation.list')!.needsUi, true);
});

// protects=disabled_automation fails_when=disabled_row_runs no_claim=re_enable_semantics
test('automation.enable enabled:false prevents tick work', async t => {
  const f = await fixture(t, { code: 1 });
  await f.methods.get('automation.enable')!.handler({ id: f.id, enabled: false }, ctx);
  const before = f.nextDue();
  await f.tick();
  assert.deepEqual(f.counts(), { checks: 0, launches: 0 });
  assert.equal(f.runs().length, 0);
  assert.equal(f.notices().length, 0);
  assert.equal(f.nextDue(), before);
});

// protects=bounded_run_history fails_when=list_keeps_oldest_or_more_than_eight no_claim=history_retention
test('automation.list returns only the eight newest runs in descending time order', async t => {
  const f = await fixture(t);
  const insert = f.db.prepare('INSERT INTO automation_run (id, automation_id, due_at, at, outcome) VALUES (?, ?, ?, ?, ?)');
  for (const n of [3, 9, 1, 6, 0, 8, 4, 2, 7, 5]) {
    const at = new Date(f.now() + n * 60_000).toISOString();
    insert.run('r' + n, f.id, at, at, 'skip');
  }
  const [listed] = await f.list();
  assert.equal(listed.runs.length, 8);
  assert.deepEqual(listed.runs.map(r => r.id), ['r9', 'r8', 'r7', 'r6', 'r5', 'r4', 'r3', 'r2']);
  assert.deepEqual(listed.runs.map(r => r.at), Array.from({ length: 8 }, (_, i) => new Date(f.now() + (9 - i) * 60_000).toISOString()));
});
