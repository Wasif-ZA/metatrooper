process.env.TZ = 'Australia/Sydney';
import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { cronNext, cronWords, parseCron } from '../src/time.ts';
import { automationTick, type AutomationDeps } from '../src/automations.ts';
import { ensureLabels, labelColour } from '../src/labels.ts';
import { buildMethods } from '../src/methods.ts';
import { schemaFile } from '../src/paths.ts';

const ctx = { ui: true, origin: 'test' };
const next = (expr: string, from: string) => cronNext(expr, new Date(from))?.toISOString() ?? null;

test('the test runs in Sydney time', () => {
  assert.equal(new Date('2026-01-15T00:00:00Z').getTimezoneOffset(), -660);
  assert.equal(new Date('2026-07-15T00:00:00Z').getTimezoneOffset(), -600);
});

test('cron next on the Sydney DST days, weekdays, steps, Sunday as 7 and day-or-weekday', () => {
  // 2026-10-04 02:00 does not exist: the 2am run moves to 03:00 AEDT, once
  assert.equal(next('0 2 * * *', '2026-10-03T12:00:00+10:00'), '2026-10-03T16:00:00.000Z');
  assert.equal(next('0 2 * * *', '2026-10-03T16:00:00.000Z'), '2026-10-04T15:00:00.000Z');
  // 2026-04-05 02:30 happens twice: the run fires on the first and skips the repeat
  assert.equal(next('30 2 * * *', '2026-04-04T12:00:00+11:00'), '2026-04-04T15:30:00.000Z');
  assert.equal(next('30 2 * * *', '2026-04-04T15:30:00.000Z'), '2026-04-05T16:30:00.000Z');
  assert.equal(next('0 10 * * 1-5', '2026-11-13T11:00:00+11:00'), '2026-11-15T23:00:00.000Z');
  assert.equal(next('0 10 * * 1-5', '2026-11-16T09:59:00+11:00'), '2026-11-15T23:00:00.000Z');
  assert.equal(next('*/15 * * * *', '2026-11-11T16:44:30+11:00'), '2026-11-11T05:45:00.000Z');
  assert.equal(next('*/15 * * * *', '2026-11-11T16:45:00+11:00'), '2026-11-11T06:00:00.000Z');
  assert.equal(next('10/20 * * * *', '2026-11-11T16:44:30+11:00'), '2026-11-11T05:50:00.000Z');
  assert.equal(next('0 8 * * 7', '2026-11-16T00:00:00+11:00'), '2026-11-21T21:00:00.000Z');
  assert.equal(next('0 9 13 * 5', '2026-11-01T00:00:00+11:00'), '2026-11-05T22:00:00.000Z');
  assert.equal(next('5,10-12/2 3 * * *', '2026-11-11T03:06:00+11:00'), '2026-11-10T16:10:00.000Z');
  assert.equal(next('0 0 31 2 *', '2026-11-11T00:00:00+11:00'), null);
});

test('cron rejects bad expressions and says common schedules in words', () => {
  for (const bad of ['* * *', '61 * * * *', '* 24 * * *', '* * 0 * *', '* * * 13 *', '* * * * 8', '5-1 * * * *', '*/0 * * * *', 'a * * * *']) assert.throws(() => parseCron(bad), bad);
  assert.equal(cronWords('0 10 * * 1-5'), 'Weekdays at 10:00');
  assert.equal(cronWords('0 2 * * *'), 'Daily at 02:00');
  assert.equal(cronWords('*/15 * * * *'), 'Every 15 minutes');
  assert.equal(cronWords('30 9 * * 1'), 'Mondays at 09:30');
  assert.equal(cronWords('0 9 13 * 5'), '0 9 13 * 5');
});

async function fixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'home-auto-'));
  const db = new DatabaseSync(':memory:');
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec(readFileSync(schemaFile, 'utf8'));
  const iso = '2026-11-11T00:00:00.000Z';
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', dir, 'test', iso, iso);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('codex', JSON.stringify({ approval_profiles: { edits: [] } }), 1, 'local-cli');
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s1', 'p1', 'codex', 'pty', 'working', ?, ?)").run(iso, iso);
  writeFileSync(join(dir, 'check.txt'), 'check');
  let now = Date.parse('2026-11-12T23:00:30.000Z');
  const calls = { checks: 0, launches: 0 };
  const launched: any[] = [];
  let code = 1;
  const deps: AutomationDeps = {
    now: () => now,
    readFile: readFileSync,
    runCheck: async () => { calls.checks++; return { code }; },
    launch: async (a) => { calls.launches++; launched.push(a); return { session_id: `w${calls.launches}` }; },
  };
  const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'k', automationDeps: deps });
  const call = async (name: string, p: Record<string, unknown>) => methods.get(name)!.handler(p, ctx) as Promise<any>;
  const base = { project_id: 'p1', name: 'Nightly', engine_id: 'codex', prompt: 'Triage' };
  return { db, dir, deps, calls, launched, call, base, setNow: (ms: number) => { now = ms; }, setCode: (c: number) => { code = c; },
    row: (id: string) => db.prepare('SELECT * FROM automation WHERE id = ?').get(id) as Record<string, any> };
}

test('automation.set keeps the old shape, adds icon, cron and labels, and a script-free automation needs no runner', async t => {
  const f = await fixture(t);
  const old = await f.call('automation.set', { ...f.base, every_min: 30, runner: ['node'], script: 'check.txt' });
  assert.equal(f.row(old.id).cron, null);
  assert.equal(f.row(old.id).runner, '["node"]');
  const { id, next_due } = await f.call('automation.set', { ...f.base, cron: '0 10 * * 1-5', icon: '🌙', runner: [], script: '', labels: ['ops', 'nightly'] });
  const r = f.row(id);
  assert.equal(r.cron, '0 10 * * 1-5');
  assert.equal(r.icon, '🌙');
  assert.equal(r.script, '');
  assert.equal(r.every_min, 60);
  assert.equal(r.next_due, next_due);
  assert.equal(new Date(next_due).getHours(), 10);
  const listed = (await f.call('automation.list', { project_id: 'p1' })).automations.find((a: any) => a.id === id);
  assert.deepEqual(listed.labels.map((l: any) => ({ ...l })), [{ name: 'nightly', colour: labelColour('nightly') }, { name: 'ops', colour: labelColour('ops') }]);
  assert.equal(listed.words, 'Weekdays at 10:00');
  assert.equal(listed.icon, '🌙');
  await f.call('automation.set', { ...f.base, id, cron: '*/15 * * * *', icon: '🌙' });
  assert.equal(f.row(id).cron, '*/15 * * * *');
  assert.equal(Date.parse(f.row(id).next_due) - Date.now() <= 15 * 60_000, true);
  assert.equal((await f.call('automation.list', {})).automations.find((a: any) => a.id === id).labels.length, 2);
  for (const bad of [{ cron: '0 0 31 2 *' }, { cron: '99 * * * *' }, { script: 'check.txt', runner: [] }, { script: '../x', runner: ['node'], every_min: 5 }]) {
    await assert.rejects(f.call('automation.set', { ...f.base, every_min: 5, ...bad }), (e: any) => e.code === -32003, JSON.stringify(bad));
  }
  await assert.rejects(f.call('automation.set', { ...f.base, id: 'missing', every_min: 5 }), (e: any) => e.code === -32002);
});

test('the scheduler uses cron over every_min and launches a script-free automation without a check', async t => {
  const f = await fixture(t);
  const { id } = await f.call('automation.set', { ...f.base, every_min: 1, cron: '0 10 * * 1-5' });
  f.db.prepare('UPDATE automation SET next_due = ? WHERE id = ?').run('2026-11-13T10:00:00.000+11:00', id);
  await automationTick(f.db, f.deps);
  assert.deepEqual(f.calls, { checks: 0, launches: 1 });
  assert.equal(new Date(f.row(id).next_due).toISOString(), '2026-11-15T23:00:00.000Z');
  const run = f.db.prepare('SELECT * FROM automation_run WHERE automation_id = ?').get(id) as any;
  assert.equal(run.outcome, 'woke');
  assert.equal(run.session_id, 'w1');
  await automationTick(f.db, f.deps);
  assert.deepEqual(f.calls, { checks: 0, launches: 1 });
});

test('the due check compares instants, not offset strings', async t => {
  const f = await fixture(t);
  const { id } = await f.call('automation.set', { ...f.base, every_min: 60 });
  f.setNow(Date.parse('2026-04-04T15:30:00.000Z'));
  f.db.prepare('UPDATE automation SET next_due = ? WHERE id = ?').run('2026-04-05T02:10:00.000+10:00', id);
  await automationTick(f.db, f.deps);
  assert.equal(f.calls.launches, 0);
});

test('automation approval is stored, listed and given to the woken agent, ask by default', async t => {
  const f = await fixture(t);
  const plain = await f.call('automation.set', { ...f.base, every_min: 30 });
  const edits = await f.call('automation.set', { ...f.base, every_min: 30, approval: 'edits' });
  assert.equal(f.row(plain.id).approval, null);
  assert.equal(f.row(edits.id).approval, 'edits');
  assert.equal((await f.call('automation.list', { project_id: 'p1' })).automations.find((a: any) => a.id === edits.id).approval, 'edits');
  await f.call('automation.run', { id: plain.id });
  await f.call('automation.run', { id: edits.id });
  assert.deepEqual(f.launched.map((a: any) => a.approval), ['ask', 'edits']);
  await assert.rejects(f.call('automation.set', { ...f.base, every_min: 30, approval: 'isolated' }), (e: any) => e.code === -32003);
});

test('automation.run runs now, records a run and leaves the schedule alone', async t => {
  const f = await fixture(t);
  const { id } = await f.call('automation.set', { ...f.base, every_min: 30, runner: ['node'], script: 'check.txt' });
  const due = f.row(id).next_due;
  f.setCode(0);
  assert.deepEqual(await f.call('automation.run', { id }).then((r: any) => [r.outcome, r.session_id]), ['skip', null]);
  f.setCode(1);
  const r = await f.call('automation.run', { id });
  assert.equal(r.outcome, 'woke');
  assert.equal(r.session_id, 'w1');
  assert.equal(f.row(id).next_due, due);
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM automation_run WHERE automation_id = ?').get(id) as any).n, 2);
  assert.ok(f.db.prepare('SELECT 1 FROM automation_run WHERE id = ?').get(r.run_id));
  await assert.rejects(f.call('automation.run', { id: 'missing' }), (e: any) => e.code === -32002);
});

test('labels: one global set with colours shared by sessions and automations', async t => {
  const f = await fixture(t);
  await f.call('session.labels-set', { session_id: 's1', labels: ['ops', 'bug'] });
  assert.equal((f.db.prepare("SELECT colour FROM label WHERE name = 'bug'").get() as any).colour, labelColour('bug'));
  const { id } = await f.call('automation.set', { ...f.base, every_min: 5 });
  const set = await f.call('automation.labels-set', { id, names: [' ops ', 'nightly', 'ops'] });
  assert.deepEqual(set.labels.map((l: any) => l.name), ['nightly', 'ops']);
  assert.deepEqual(await f.call('label.set', { name: 'ops', colour: '#ABCDEF' }), { name: 'ops', colour: '#abcdef' });
  const listed = (await f.call('label.list', {})).labels;
  assert.deepEqual({ ...listed[0] }, { name: 'ops', colour: '#abcdef', count: 2 });
  assert.deepEqual(listed.map((l: any) => l.name).sort(), ['bug', 'nightly', 'ops']);
  for (const bad of [{ name: 'x', colour: 'red' }, { name: 'x', colour: '#12345' }, { name: '', colour: '#123456' }, { name: 'y'.repeat(33), colour: '#123456' }]) {
    await assert.rejects(f.call('label.set', bad), (e: any) => e.code === -32602, JSON.stringify(bad));
  }
  await assert.rejects(f.call('automation.labels-set', { id, names: 'ops' }), (e: any) => e.code === -32602);
  await assert.rejects(f.call('automation.labels-set', { id: 'missing', names: [] }), (e: any) => e.code === -32002);
  await f.call('automation.delete', { id });
  assert.equal((f.db.prepare('SELECT COUNT(*) AS n FROM automation_label').get() as any).n, 0);
});

test('ensureLabels backfills session labels once and keeps a chosen colour', t => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  db.exec('CREATE TABLE session_label (session_id TEXT, name TEXT); CREATE TABLE automation_label (automation_id TEXT, name TEXT); CREATE TABLE label (name TEXT PRIMARY KEY, colour TEXT NOT NULL);');
  db.exec("INSERT INTO session_label VALUES ('s1', 'bug'), ('s2', 'bug'), ('s2', 'ui'); INSERT INTO label VALUES ('ui', '#000000');");
  ensureLabels(db);
  assert.deepEqual(db.prepare('SELECT name, colour FROM label ORDER BY name').all().map((r) => ({ ...r })), [{ name: 'bug', colour: labelColour('bug') }, { name: 'ui', colour: '#000000' }]);
  assert.match(labelColour('anything'), /^#[0-9a-f]{6}$/);
});

test('cron.next previews runs with the scheduler matcher and reports bad input', async t => {
  const f = await fixture(t);
  const r = await f.call('cron.next', { cron: '0 10 * * 1-5', n: 5 });
  assert.equal(r.ok, true);
  assert.equal(r.words, 'Weekdays at 10:00');
  assert.equal(r.runs.length, 5);
  for (const at of r.runs) {
    const d = new Date(at);
    assert.equal(d.getHours(), 10);
    assert.ok(d.getDay() >= 1 && d.getDay() <= 5);
    assert.match(at, /[+-]\d\d:\d\d$/);
  }
  assert.ok(r.runs.every((at: string, i: number) => i === 0 || Date.parse(at) > Date.parse(r.runs[i - 1])));
  assert.equal((await f.call('cron.next', { cron: 'nope' })).ok, false);
  assert.equal((await f.call('cron.next', { cron: '0 0 31 2 *' })).ok, false);
  assert.equal((await f.call('cron.next', { cron: '* * * * *', n: 6 })).ok, false);
  assert.equal((await f.call('cron.next', { cron: '* * * * *' })).runs.length, 3);
});

test('opening an older troop.db adds icon and cron and gives existing session labels a colour', async t => {
  const home = mkdtempSync(join(tmpdir(), 'home-auto-db-'));
  const prev = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = home;
  t.after(() => { if (prev === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prev; rmSync(home, { recursive: true, force: true }); });
  const { openCoreDb } = await import('../src/store/db.ts');
  let db = openCoreDb();
  const file = (db.prepare('PRAGMA database_list').get() as { file: string }).file;
  db.close();
  const raw = new DatabaseSync(file);
  raw.exec('ALTER TABLE automation DROP COLUMN icon; ALTER TABLE automation DROP COLUMN cron; DELETE FROM label;');
  raw.exec("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/x', 'x', 'a', 'a'); INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1);");
  raw.exec("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s1', 'p1', 'codex', 'pty', 'working', 'a', 'a'); INSERT INTO session_label VALUES ('s1', 'ops');");
  raw.close();
  db = openCoreDb();
  try {
    const cols = (db.prepare('PRAGMA table_info(automation)').all() as Array<{ name: string }>).map((c) => c.name);
    assert.ok(cols.includes('icon') && cols.includes('cron'));
    assert.deepEqual({ ...(db.prepare('SELECT name, colour FROM label').get() as object) }, { name: 'ops', colour: labelColour('ops') });
  } finally { db.close(); }
});
