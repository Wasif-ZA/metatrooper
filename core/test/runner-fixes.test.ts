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

test('H21 the minutes budget leaves out time the run stood paused for budget or failed', () => {
  insertRun('m2', 3 * H);
  db.prepare("INSERT INTO needs_you (id, at, kind, ref, text, resolved_at) VALUES ('n-m2a', ?, 'budget', 'm2', 's', ?)").run(iso(2.5 * H), iso(2 * H));
  db.prepare("INSERT INTO needs_you (id, at, kind, ref, text, resolved_at) VALUES ('n-m2b', ?, 'run-failed', 'm2', 's', ?)").run(iso(1.5 * H), iso(0.5 * H));
  const runner = priv(new Runner(db));
  const run = db.prepare("SELECT * FROM run WHERE id = 'm2'").get();
  assert.ok(Math.abs(runner.minutesUsed(run) - 90) < 1, String(runner.minutesUsed(run)));
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

test('H18 an agent step whose session settled minutes ago without writing its result fails before the timeout', async () => {
  const { run, args } = agentRun('h18', 'done', iso(3 * 60_000));
  const runner = priv(new Runner(db));
  runner.killSession = () => {};
  const r = await runner.runAgent(run, {}, { ...args, timeoutMinutes: 0.05 });
  assert.equal(r.ok, false);
  assert.match(r.error, /stopped without writing/);
});

test('H9 an agent that runs the run over its budget is stopped and the run pauses for budget', async () => {
  const { run, args } = agentRun('h9');
  db.prepare("INSERT INTO usage (at, session_id, run_id, engine_id, provider, tokens_in, source, dedupe_key) VALUES ('x', 's-h9', 'h9', 'claude', 'local-cli', 5000, 'transcript', 'h9')").run();
  const runner = priv(new Runner(db));
  const killed: string[] = [];
  runner.killSession = (id: string) => killed.push(id);
  const r = await runner.runAgent(run, { title: 'pl' }, { ...args, timeoutMinutes: 0.05 });
  assert.deepEqual(r, { paused: 'budget' });
  assert.deepEqual(killed, ['s-h9']);
  assert.deepEqual({ ...runOf('h9') }, { status: 'paused', paused_why: 'budget' });
});

test('H5 a fan-out step launches no further indexes once one has failed', async () => {
  const { run } = agentRun('h5');
  const runner = priv(new Runner(db));
  const launched: number[] = [];
  runner.execIndex = async (_run: unknown, _pipe: unknown, _step: unknown, row: { fanout_index: number }) => {
    launched.push(row.fanout_index);
    return { ok: false, error: 'boom' };
  };
  runner.fail = () => 'failed';
  const step = { id: 'fan', kind: 'agent', prompt: 'x', fanout: 3 };
  await runner.execStep(run, { title: 'pl', budget: { max_parallel: 1 }, steps: [step] }, step, 0);
  assert.deepEqual(launched, [0]);
});

test('H7 fail() and end() leave no live step rows, building variants, open panes or stale child notices', () => {
  const { run } = agentRun('h7');
  insertRun('h7c', 0, { parent: 'h7', status: 'failed' });
  db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES ('n-h7c', 'x', 'run-failed', 'h7c', 'child failed')").run();
  db.prepare("INSERT INTO variant (run_id, idx, worktree, branch, dev_port, status) VALUES ('h7', 0, '', '', 0, 'building')").run();
  db.prepare("INSERT INTO browser_pane (id, project_id, run_id, variant, open) VALUES ('bp-h7', 'p', 'h7', 0, 1)").run();
  db.prepare("INSERT INTO run_step (run_id, step_id, iteration, fanout_index, status) VALUES ('h7', 'b', 0, 0, 'pending')").run();
  const runner = priv(new Runner(db));
  runner.killSession = () => {};
  runner.fail(run, 'step a failed');
  const steps = () => db.prepare("SELECT step_id, status FROM run_step WHERE run_id = 'h7' ORDER BY step_id").all().map((r) => ({ ...r }));
  assert.deepEqual(steps(), [{ step_id: 'a', status: 'failed' }, { step_id: 'b', status: 'pending' }]);
  assert.equal((db.prepare("SELECT status FROM variant WHERE run_id = 'h7'").get() as { status: string }).status, 'discarded');
  assert.equal((db.prepare("SELECT open FROM browser_pane WHERE id = 'bp-h7'").get() as { open: number }).open, 0);
  assert.ok((db.prepare("SELECT resolved_at FROM needs_you WHERE id = 'n-h7c'").get() as { resolved_at: string | null }).resolved_at);
  assert.equal((db.prepare("SELECT count(*) AS n FROM needs_you WHERE ref = 'h7' AND resolved_at IS NULL").get() as { n: number }).n, 1);
  runner.end(run, 'cancelled');
  assert.deepEqual(steps(), [{ step_id: 'a', status: 'failed' }, { step_id: 'b', status: 'skipped' }]);
  assert.equal((db.prepare("SELECT count(*) AS n FROM needs_you WHERE ref = 'h7' AND resolved_at IS NULL").get() as { n: number }).n, 0);
});

test('H13 a sub-pipeline child that already finished is reused, and Resume resumes a child that tripped its breaker', async () => {
  for (const id of ['h13', 'h13c', 'h13b']) {
    const dir = path.join(home, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pipeline.json'), JSON.stringify({ schema: 1, id: 'pl', title: 'pl', steps: [{ id: 'last', kind: 'code', code: 'x.mjs' }] }));
    insertRun(id, 0, { dir, parent: id === 'h13' ? undefined : 'h13', status: id === 'h13' ? 'running' : id === 'h13c' ? 'done' : 'failed' });
  }
  db.prepare("INSERT INTO run_step (run_id, step_id, iteration, fanout_index, status, outputs) VALUES ('h13c', 'last', 0, 0, 'done', '{\"answer\":42}')").run();
  const runner = priv(new Runner(db));
  runner.start = () => { throw new Error('started a new child'); };
  const parent = db.prepare("SELECT * FROM run WHERE id = 'h13'").get();
  const r = await runner.pipelineIndex(parent, { id: 'sub', kind: 'pipeline', uses: 'pipeline:pl' }, { step_id: 'sub', iteration: 0, fanout_index: 0, status: 'running', output_path: path.join(home, 'h13', 'sub', 'h13c') });
  assert.deepEqual(r, { ok: true, outputs: { answer: 42 } });
  db.prepare("UPDATE run SET status = 'failed' WHERE id = 'h13'").run();
  db.prepare("UPDATE run SET paused_why = 'breaker' WHERE id = 'h13b'").run();
  runner.drive = async () => {};
  runner.resume('h13');
  assert.equal(runOf('h13b').status, 'running');
});

test('H12 Cancel kills a running plugin action process', async () => {
  const pdir = path.join(home, 'hangplug');
  fs.mkdirSync(pdir, { recursive: true });
  fs.writeFileSync(path.join(pdir, 'hang.js'), 'setInterval(() => {}, 1000);');
  const manifest = { schema: 1, id: 'hangplug', version: '1.0.0', name: 'Hang', permissions: [], actions: [{ id: 'hang', run: ['./hang.js'], timeout_seconds: 60 }] };
  db.prepare("INSERT INTO plugin (id, version, path, manifest, source, permissions, installed_at) VALUES ('hangplug', '1.0.0', ?, ?, 'native', '[]', 'x')").run(pdir, JSON.stringify(manifest));
  const dir = path.join(home, 'h12');
  fs.mkdirSync(dir, { recursive: true });
  insertRun('h12', 0, { dir });
  db.prepare("INSERT INTO run_step (run_id, step_id, iteration, fanout_index, status) VALUES ('h12', 'act', 0, 0, 'running')").run();
  const runner = priv(new Runner(db));
  const run = db.prepare("SELECT * FROM run WHERE id = 'h12'").get();
  const row = db.prepare("SELECT * FROM run_step WHERE run_id = 'h12'").get();
  const started = Date.now();
  const pending = runner.actionIndex(run, { id: 'act', kind: 'action', uses: 'plugin:hangplug/hang' }, row, false);
  await until(() => runner.children.has('h12/act/0'));
  runner.cancel('h12');
  const r = await pending;
  assert.equal(r.ok, false);
  assert.ok(Date.now() - started < 10_000);
  assert.equal(runner.children.size, 0);
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
