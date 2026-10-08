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

const { parseFrontMatter } = await import('../src/pipelines/template.ts');

test('front matter: a trailing # comment is dropped and a | block keeps its text', () => {
  const fm = parseFrontMatter('---\nstatus: done  # ok\npassed: true # all green\nref: PR #204\nsummary: |\n  line one\n\n  line two\nnote: >\n  folded\n  text\n---\nbody');
  assert.deepEqual(fm, { status: 'done', passed: true, ref: 'PR #204', summary: 'line one\n\nline two', note: 'folded text' });
});

const priv =(r: InstanceType<typeof Runner>) => r as any;

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

test('resuming with a raised budget gives a sub-pipeline run only the raise, not the parent\'s whole cap', () => {
  for (const id of ['rb', 'rbc']) {
    const dir = path.join(home, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pipeline.json'), JSON.stringify({ schema: 1, id: 'pl', title: 'pl', steps: [] }));
    insertRun(id, 0, { parent: id === 'rbc' ? 'rb' : undefined, status: 'paused', dir });
  }
  db.prepare("UPDATE run SET max_tokens = 400, paused_why = 'budget' WHERE id = 'rbc'").run();
  new Runner(db).resume('rb', { max_tokens: 1500 });
  const caps = db.prepare("SELECT id, max_tokens, max_minutes FROM run WHERE id IN ('rb', 'rbc') ORDER BY id").all().map((r) => ({ ...r }));
  assert.deepEqual(caps, [{ id: 'rb', max_tokens: 1500, max_minutes: 120 }, { id: 'rbc', max_tokens: 900, max_minutes: 120 }]);
});

const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
syncEngines(db, BUILT_IN);

function agentRun(id: string, sessionState = 'working', stateAt = iso(0)) {
  const dir = path.join(home, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'pipeline.json'), JSON.stringify({ schema: 1, id: 'pl', title: 'pl', steps: [{ id: 'a', kind: 'agent', prompt: 'x' }] }));
  insertRun(id, 0, { dir });
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, run_id, step_id, state, state_at, started_at) VALUES (?, 'p', 'claude', 'pty', ?, 'a', ?, ?, 'x')").run(`s-${id}`, id, sessionState, stateAt);
  db.prepare("INSERT INTO run_step (run_id, step_id, iteration, fanout_index, status, session_id, started_at) VALUES (?, 'a', 0, 0, 'running', ?, ?)").run(id, `s-${id}`, iso(0));
  const run = db.prepare('SELECT * FROM run WHERE id = ?').get(id);
  const row = db.prepare('SELECT * FROM run_step WHERE run_id = ?').get(id);
  const args = { stepId: 'a', row, template: 'x', outputs: [], engine: () => null, outPath: path.join(dir, 'a.md'), cwd: dir, timeoutMinutes: 30, index: 0 };
  return { dir, run, args };
}

test('H4 the agent session is stopped when its step fails, and Resume stops a session it would orphan', async () => {
  const { dir, run, args } = agentRun('h4');
  fs.writeFileSync(path.join(dir, 'a.md'), '---\nstatus: failed\n---\n');
  const runner = priv(new Runner(db));
  const killed: string[] = [];
  runner.killSession = (id: string) => killed.push(id);
  const r = await runner.runAgent(run, {}, args);
  assert.equal(r.ok, false);
  assert.deepEqual(killed, ['s-h4']);
  db.prepare("UPDATE run SET status = 'failed' WHERE id = 'h4'").run();
  runner.drive = async () => {};
  runner.resume('h4');
  assert.deepEqual(killed, ['s-h4', 's-h4']);
});

const pipelinesDir =path.join(home, '.troop', 'pipelines');
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

test('a loop step that finishes while the run is paused still checks until, so resume runs the next round', async () => {
  codePipeline('loop-pause', 'export async function run() { await new Promise((r) => setTimeout(r, 500)); return { passed: false }; }',
    { loop: { steps: ['work'], until: 'steps.work.passed', max: 3 } });
  const runner = new Runner(db);
  const id = runner.start({ pipeline_id: 'loop-pause', project_id: 'p' });
  await until(() => db.prepare("SELECT 1 FROM run_step WHERE run_id = ? AND status = 'running'").get(id));
  db.prepare("UPDATE run SET status = 'paused', paused_why = 'budget' WHERE id = ?").run(id);
  await until(() => db.prepare("SELECT 1 FROM run_step WHERE run_id = ? AND status = 'done'").get(id));
  await until(() => !priv(runner).active.has(id));
  assert.ok(db.prepare("SELECT 1 FROM run_step WHERE run_id = ? AND step_id = 'work' AND iteration = 1 AND status = 'pending'").get(id));
});

const { execFileSync } = await import('node:child_process');
const gp = path.join(home, 'gp');
fs.mkdirSync(gp);
const g = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' }).trim();
g(gp, 'init', '-q');
fs.writeFileSync(path.join(gp, 'a.txt'), 'a\n');
g(gp, 'add', 'a.txt');
g(gp, 'commit', '-q', '-m', 'init');
db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('gp', ?, 'gp', 'x', 'x')").run(gp);
const wtRoot = path.join(process.env.METATROOPER_HOME as string, 'worktrees', 'gp');
const branchExists = (b: string) => g(gp, 'branch', '--list', b) !== '';
const gitRun = (id: string) => {
  db.prepare(`INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at)
    VALUES (?, 'pl', 'gp', '{}', ?, 'running', 'manual', 1000, 10, 120, ?)`).run(id, home, iso(0));
  return db.prepare('SELECT * FROM run WHERE id = ?').get(id);
};

test('F14 placeIndex replaces a leftover folder that is not a worktree and reuses a surviving branch', async () => {
  const run = gitRun('RWA');
  const dir = path.join(wtRoot, 'rwa-build-0');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'junk.txt'), 'x');
  g(gp, 'branch', 'troop/rwa-build-0');
  const place = await priv(new Runner(db)).placeIndex(run, { id: 'build', worktree: true }, 0);
  assert.equal(place.branch, 'troop/rwa-build-0');
  assert.ok(g(gp, 'worktree', 'list', '--porcelain').toLowerCase().includes(place.cwd.toLowerCase()));
  assert.ok(!fs.existsSync(path.join(dir, 'junk.txt')));
  assert.ok(fs.existsSync(path.join(dir, 'a.txt')));
});

test('F14 a done run removes clean worktrees and branches without commits; committed branches and dirty worktrees stay', async () => {
  const run = gitRun('RWB');
  const runner = priv(new Runner(db));
  const dirs = [];
  for (const i of [0, 1, 2]) dirs.push((await runner.placeIndex(run, { id: 'build', worktree: true }, i)).cwd);
  fs.writeFileSync(path.join(dirs[1], 'b.txt'), 'b\n');
  g(dirs[1], 'add', 'b.txt');
  g(dirs[1], 'commit', '-q', '-m', 'work');
  fs.writeFileSync(path.join(dirs[2], 'a.txt'), 'changed\n');
  runner.end(run, 'done');
  assert.deepEqual(dirs.map((d) => fs.existsSync(d)), [false, false, true]);
  assert.deepEqual([0, 1, 2].map((i) => branchExists(`troop/rwb-build-${i}`)), [false, true, true]);
});

test('each index of a fan-out pipeline step gets its own sub-pipeline run', async () => {
  codePipeline('fan-child', 'export async function run() { await new Promise((r) => setTimeout(r, 300)); return { ok: true }; }');
  fs.writeFileSync(path.join(pipelinesDir, 'fan-parent.json'), JSON.stringify({
    schema: 1, id: 'fan-parent', title: 'fan-parent', steps: [{ id: 'each', title: 'each', kind: 'pipeline', uses: 'pipeline:fan-child', fanout: 2 }],
  }));
  const id = new Runner(db).start({ pipeline_id: 'fan-parent', project_id: 'p' });
  await until(() => ['done', 'failed'].includes(runOf(id).status));
  assert.equal(runOf(id).status, 'done');
  assert.equal((db.prepare('SELECT count(*) AS n FROM run WHERE parent_run = ?').get(id) as { n: number }).n, 2);
});
