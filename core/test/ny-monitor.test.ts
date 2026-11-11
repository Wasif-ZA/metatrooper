import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { automationTick, deliverMonitor, realDeps, type AutomationDeps, type CheckResult } from '../src/automations.ts';
import { buildMethods } from '../src/methods.ts';
import { schemaFile } from '../src/paths.ts';

const ctx = { ui: true, origin: 'test' };
const at = '2030-01-01T00:00:00.000Z';

async function fixture(t: TestContext, result: CheckResult, sessions: Array<[string, string]> = [['s1', 'working']]) {
  const dir = mkdtempSync(join(tmpdir(), 'ny-monitor-'));
  const db = new DatabaseSync(':memory:');
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec(readFileSync(schemaFile, 'utf8'));
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', dir, 'test', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('codex', '{}', 1, 'local-cli');
  for (const [id, state] of sessions) {
    db.prepare('INSERT INTO session (id, project_id, engine_id, host, cwd, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, 'p1', 'codex', 'pty', '/work/' + id, state, at, at);
  }
  writeFileSync(join(dir, 'check.txt'), 'check');
  const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'k' });
  const { id } = await methods.get('automation.set')!.handler({
    project_id: 'p1', name: 'Build passes', every_min: 1, runner: ['fake-runner'], script: 'check.txt', engine_id: 'codex', prompt: 'Fix the build', timeout_ms: 1000,
  }, ctx) as { id: string };
  let now = Date.parse(at);
  db.prepare('UPDATE automation SET next_due = ? WHERE id = ?').run(at, id);
  const sent: Array<[string, string]> = [];
  const followUps: unknown[] = [];
  const launches: unknown[] = [];
  let sendError = '';
  const deps: AutomationDeps = {
    now: () => now,
    readFile: readFileSync,
    runCheck: async () => result,
    launch: (a) => { launches.push(a); return { session_id: 'woken' }; },
    send: (sid, text) => { if (sendError && sid === 's1') throw new Error(sendError); sent.push([sid, text]); },
    followUp: (a) => { followUps.push(a); return { session_id: 'child' }; },
  };
  const link = (sid: string) => methods.get('session.monitor-set')!.handler({ session_id: sid, automation_id: id }, ctx);
  return {
    db, id, methods, deps, sent, followUps, launches, link,
    failSend: (msg: string) => { sendError = msg; },
    tick: async () => {
      db.prepare('UPDATE automation SET next_due = ? WHERE id = ?').run(new Date(now).toISOString(), id);
      await automationTick(db, deps);
      now += 60_000;
    },
    notices: () => db.prepare("SELECT ref, text FROM needs_you WHERE kind = 'other'").all().map((r) => ({ ...r })) as Array<{ ref: string; text: string }>,
  };
}

test('a failed check of a linked automation is sent into the live session', async t => {
  const f = await fixture(t, { code: 2 });
  await f.link('s1');
  await f.tick();
  assert.deepEqual(f.sent, [['s1', 'Check "Build passes" failed: check exited 2']]);
  assert.deepEqual(f.followUps, []);
});

test('the check output reaches the session on one line', async t => {
  const f = await fixture(t, { code: 2, output: 'FAIL login.test.ts\n  expected 200, got 500\n' });
  await f.link('s1');
  await f.tick();
  assert.deepEqual(f.sent, [['s1', 'Check "Build passes" failed: check exited 2. Output: FAIL login.test.ts expected 200, got 500']]);
});

test('realDeps keeps what the check prints to stdout and stderr', async () => {
  const r = await realDeps(() => ({ session_id: 'x' })).runCheck([process.execPath, '-e', 'console.log("out line"); console.error("err line"); process.exit(2)'], process.cwd(), 10_000);
  assert.equal(r.code, 2);
  assert.match(r.output!, /out line/);
  assert.match(r.output!, /err line/);
});

test('exit 1 still wakes the automation agent and also reaches the linked session', async t => {
  const f = await fixture(t, { code: 1 });
  await f.link('s1');
  await f.tick();
  assert.equal(f.launches.length, 1);
  assert.deepEqual(f.sent, [['s1', 'Check "Build passes" failed: check exited 1']]);
});

test('a passing check sends nothing', async t => {
  const f = await fixture(t, { code: 0 });
  await f.link('s1');
  await f.tick();
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.followUps, []);
});

test('an unlinked session hears nothing', async t => {
  const f = await fixture(t, { code: 2 });
  await f.tick();
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.followUps, []);
});

test('an exited session gets one follow-up child with the same engine and cwd', async t => {
  const f = await fixture(t, { code: 2 }, [['s1', 'exited']]);
  await f.link('s1');
  await f.tick();
  assert.deepEqual(f.sent, []);
  assert.deepEqual(f.followUps, [{
    project_id: 'p1', engine_id: 'codex', cwd: '/work/s1', parent_id: 's1',
    prompt: 'Check "Build passes" failed: check exited 2. This check watches session s1, which has ended. Find the cause and fix it.',
  }]);
});

test('the same failed run never launches twice; the next failed run launches again', async t => {
  const f = await fixture(t, { code: 2 }, [['s1', 'exited']]);
  await f.link('s1');
  await f.tick();
  const runId = (f.db.prepare('SELECT id FROM automation_run').get() as { id: string }).id;
  await deliverMonitor(f.db, f.deps, { id: f.id, name: 'Build passes' }, runId, 'check exited 2');
  assert.equal(f.followUps.length, 1);
  await f.tick();
  assert.equal(f.followUps.length, 2);
});

test('a refused send becomes a notice and does not stop the other linked sessions', async t => {
  const f = await fixture(t, { code: 2 }, [['s1', 'waiting_for_you'], ['s2', 'working']]);
  await f.link('s1');
  await f.link('s2');
  f.failSend('the session is waiting on a person');
  await f.tick();
  assert.deepEqual(f.sent, [['s2', 'Check "Build passes" failed: check exited 2']]);
  assert.deepEqual(f.notices(), [{ ref: 's1', text: 'Check "Build passes" failed but could not reach session s1: the session is waiting on a person' }]);
});

test('detail is flattened to one line and capped at 4000 characters', async t => {
  const f = await fixture(t, { code: 0 });
  await f.link('s1');
  await deliverMonitor(f.db, f.deps, { id: f.id, name: 'Build passes' }, 'r1', 'line one\r\nline two\tend');
  await deliverMonitor(f.db, f.deps, { id: f.id, name: 'Build passes' }, 'r2', 'x'.repeat(5000));
  assert.equal(f.sent[0]![1], 'Check "Build passes" failed: line one line two end');
  assert.equal(f.sent[1]![1].length, 4000);
});

test('session.monitor-set needs the UI, checks ids, and null unlinks', async t => {
  const f = await fixture(t, { code: 2 });
  const set = f.methods.get('session.monitor-set')!;
  assert.equal(set.needsUi, true);
  assert.deepEqual(await f.link('s1'), { ok: true });
  assert.deepEqual(f.db.prepare('SELECT session_id, automation_id FROM session_monitor').all().map((r) => ({ ...r })), [{ session_id: 's1', automation_id: f.id }]);
  assert.throws(() => set.handler({ session_id: 's1', automation_id: 'nope' }, ctx), /automation not found/);
  assert.throws(() => set.handler({ session_id: 'nope', automation_id: f.id }, ctx), /session not found/);
  assert.throws(() => set.handler({ session_id: 's1', automation_id: 7 }, ctx), /string or null/);
  assert.deepEqual(await set.handler({ session_id: 's1', automation_id: null }, ctx), { ok: true });
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM session_monitor').get()!.n, 0);
  await f.tick();
  assert.deepEqual(f.sent, []);
});

test('automation.delete removes the links to it', async t => {
  const f = await fixture(t, { code: 2 });
  await f.link('s1');
  await f.methods.get('automation.delete')!.handler({ id: f.id }, ctx);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM session_monitor').get()!.n, 0);
});
