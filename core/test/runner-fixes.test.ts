import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-runner-fixes-'));
process.env.METATROOPER_HOME = path.join(home, 'mt');
const { openCoreDb } = await import('../src/store/db.ts');
const { Runner } = await import('../src/pipelines/runner.ts');
const db = openCoreDb();
db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
db.prepare("INSERT INTO pipeline (id, source, path, version, valid) VALUES ('pl', 'project', 'x', 1, 1)").run();

const priv = (r: InstanceType<typeof Runner>) => r as any;

test('F12 a blank optional input gets its default', () => {
  const pipe = { inputs: { base_branch: { type: 'text', required: false, default: 'main' }, note: { type: 'text', required: false } } };
  assert.deepEqual(priv(new Runner(db)).inputsFor(pipe, { base_branch: '', note: '' }), { base_branch: 'main' });
});

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();
const H = 3_600_000;

function insertRun(id: string, startedMsAgo: number, extra: { parent?: string; status?: string; dir?: string } = {}) {
  db.prepare(`INSERT INTO run (id, pipeline_id, parent_run, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at)
    VALUES (?, 'pl', ?, 'p', '{}', ?, ?, 'manual', 1000, 10, 120, ?)`).run(id, extra.parent ?? null, extra.dir ?? home, extra.status ?? 'running', iso(startedMsAgo));
}

function insertGateWait(runId: string, fromMsAgo: number, toMsAgo: number | null) {
  const gate = `g-${runId}-${fromMsAgo}`;
  db.prepare("INSERT INTO gate (id, run_id, step_id, kind, summary, status) VALUES (?, ?, 'approve', 'approve', 's', 'approved')").run(gate, runId);
  db.prepare("INSERT INTO needs_you (id, at, kind, ref, text, resolved_at) VALUES (?, ?, 'gate', ?, 's', ?)").run(`n-${gate}`, iso(fromMsAgo), gate, toMsAgo === null ? null : iso(toMsAgo));
}

test('F7 the minutes budget leaves out time waiting at a gate, its own or a sub-pipeline run\'s, counted once', () => {
  insertRun('m1', 3 * H);
  insertRun('m1c', 2.5 * H, { parent: 'm1' });
  insertGateWait('m1', 2.5 * H, 1.5 * H);
  insertGateWait('m1c', 2 * H, 0.75 * H);
  const runner = priv(new Runner(db));
  const run = db.prepare("SELECT * FROM run WHERE id = 'm1'").get();
  assert.equal(runner.budgetReason(run), null);
  assert.ok(Math.abs(runner.minutesUsed(run) - 75) < 1, String(runner.minutesUsed(run)));
});

const pipelinesDir = path.join(home, '.troop', 'pipelines');
fs.mkdirSync(pipelinesDir, { recursive: true });

function codePipeline(id: string, module: string, step: Record<string, unknown> = {}) {
  fs.writeFileSync(path.join(pipelinesDir, `${id}.mjs`), module);
  fs.writeFileSync(path.join(pipelinesDir, `${id}.json`), JSON.stringify({ schema: 1, id, title: id, steps: [{ id: 'work', title: 'work', kind: 'code', code: `${id}.mjs`, ...step }] }));
}

async function until<T>(fn: () => T, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 50));
  }
}

const runOf = (id: string) => db.prepare('SELECT status, paused_why FROM run WHERE id = ?').get(id) as { status: string; paused_why: string | null };

test('F7 a step that fails while the run is paused for budget leaves it paused, not failed', async () => {
  codePipeline('f7-pause', 'export async function run() { await new Promise((r) => setTimeout(r, 500)); throw new Error("boom"); }');
  const runner = new Runner(db);
  const id = runner.start({ pipeline_id: 'f7-pause', project_id: 'p' });
  await until(() => db.prepare("SELECT 1 FROM run_step WHERE run_id = ? AND status = 'running'").get(id));
  db.prepare("UPDATE run SET status = 'paused', paused_why = 'budget' WHERE id = ?").run(id);
  await until(() => db.prepare("SELECT 1 FROM run_step WHERE run_id = ? AND status = 'failed'").get(id));
  await until(() => !priv(runner).active.has(id));
  assert.deepEqual({ ...runOf(id) }, { status: 'paused', paused_why: 'budget' });
});
