import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

const builtin = join(root, 'pipelines', 'two-engine-review.json');
const { bucketFindings } = await import(pathToFileURL(join(root, 'pipelines', 'two-engine-review', 'bucket.mjs')).href);

/** Listening TCP sockets owned by rootPid or any descendant, as 'pid:port' lines (Windows only). */
async function listenersUnder(rootPid: number): Promise<string> {
  const ps = `$all = Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId; $set = @{ ${rootPid} = 1 }
do { $n = $set.Count; foreach ($p in $all) { if ($set.ContainsKey([int]$p.ParentProcessId)) { $set[[int]$p.ProcessId] = 1 } } } while ($set.Count -ne $n)
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $set.ContainsKey([int]$_.OwningProcess) } | ForEach-Object { "$($_.OwningProcess):$($_.LocalPort)" }`;
  const { stdout } = await promisify(execFile)('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
  return stdout.trim();
}

const f = (file: string, a: number, b: number) => ({ file, line_start: a, line_end: b, severity: 'high', title: 't', body: 'b' });

test('M1-26 buckets match on file and 3-line widened overlap and pick no winner', () => {
  const b = bucketFindings(
    { verdict: 'reject', findings: [f('a.js', 10, 12), f('b.js', 1, 1), f('c.js', 5, 5)] },
    { verdict: 'reject', findings: [f('a.js', 16, 20), f('b.js', 9, 9), f('d.js', 1, 2)] },
  );
  assert.equal(b.both.length, 1);
  assert.equal(b.both[0].codex.file, 'a.js');
  assert.deepEqual(b.codex_only.map((x: any) => x.codex.file), ['b.js', 'c.js']);
  assert.deepEqual(b.gemini_only.map((x: any) => x.gemini.file), ['b.js', 'd.js']);
  assert.equal(b.disagree.length, 0);
  const d = bucketFindings({ verdict: 'reject', findings: [f('a.js', 3, 3)] }, { verdict: 'approve', findings: [f('a.js', 3, 3)] });
  assert.equal(d.disagree.length, 1);
  assert.equal(d.both.length, 0);
});

test('M1-26 two-engine-review returns both verdicts and four buckets for a planted bug (fake engines)', async () => {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify(['fake-a', 'fake-b'].map((id) => ({
    id, command: process.execPath, args: [join(root, 'core/test/fake-engine.js')], prompt_arg: 'positional',
    state_source: 'hooks', roles: ['worker', 'review', 'verify'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
    version_cmd: [process.execPath, '--version'],
  }))));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  try {
    const project = join(isolated.home, 'planted');
    mkdirSync(project, { recursive: true });
    await promisify(execFile)('git', ['init', '-q', project]);
    await promisify(execFile)('git', ['-C', project, '-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '--allow-empty', '-m', 'base']);
    const pipelines = join(project, '.troop', 'pipelines');
    mkdirSync(pipelines, { recursive: true });
    cpSync(join(root, 'pipelines', 'two-engine-review'), join(pipelines, 'two-engine-review'), { recursive: true });
    const def = JSON.parse(readFileSync(builtin, 'utf8'));
    const codexStep = def.steps.find((s: { id: string }) => s.id === 'codex-review');
    const geminiStep = def.steps.find((s: { id: string }) => s.id === 'gemini-review');
    const bug = f('src/app.js', 40, 42);
    const directive = (verdict: string, findings: unknown[]) => `FAKE ${JSON.stringify({ outputs: { verdict, findings: JSON.stringify(findings) } })}\n`;
    codexStep.engine = 'fake-b'; codexStep.prompt = directive('reject', [bug, f('src/x.js', 1, 1)]) + codexStep.prompt;
    geminiStep.engine = 'fake-a'; geminiStep.prompt = directive('reject', [f('src/app.js', 43, 44), f('src/y.js', 9, 9)]) + geminiStep.prompt;
    def.requires = [];
    writeFileSync(join(pipelines, 'two-engine-review.json'), JSON.stringify(def));
    const pipe = await client(isolated.prefix);
    let runId: string;
    try {
      const opened = await pipe.request('project.open', { path: project });
      const started = await pipe.request('run.start', { pipeline_id: 'two-engine-review', project_id: opened.result.project_id, inputs: {} }, { timeout: 5000 });
      assert.ok(started.result?.run_id, JSON.stringify(started));
      runId = started.result.run_id;
    } finally { pipe.close(); }
    const store = new DatabaseSync(join(isolated.home, 'troop.db'));
    let finished = false;
    const samples: string[] = [];
    const sampler = process.platform === 'win32' ? (async () => { do samples.push(await listenersUnder(core.pid!)); while (!finished); })() : Promise.resolve();
    try {
      const status = await until(() => {
        const r = store.prepare('SELECT status FROM run WHERE id = ?').get(runId) as { status: string };
        return ['done', 'failed'].includes(r.status) ? r.status : null;
      }, 60000);
      finished = true;
      await sampler;
      assert.equal(status, 'done');
      if (process.platform === 'win32') assert.deepEqual(samples.filter(Boolean), [], 'M1-09 the core and its children own no listening port during the run');
      const ran = (step: string) => store.prepare(
        'SELECT r.engine_id AS step_engine, s.engine_id AS session_engine FROM run_step r JOIN session s ON s.id = r.session_id WHERE r.run_id = ? AND r.step_id = ?',
      ).get(runId, step) as { step_engine: string; session_engine: string };
      assert.deepEqual({ ...ran(codexStep.id) }, { step_engine: 'fake-b', session_engine: 'fake-b' });
      assert.deepEqual({ ...ran(geminiStep.id) }, { step_engine: 'fake-a', session_engine: 'fake-a' });
      const row = store.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'bucket'").get(runId) as { outputs: string };
      assert.deepEqual(JSON.parse(row.outputs), {
        codex_verdict: 'reject', gemini_verdict: 'reject', both: 1, codex_only: 1, gemini_only: 1, disagree: 0, outside_change: 0, buckets_path: 'review-buckets.json',
      });
    } finally { finished = true; store.close(); }
  } finally { await teardownCore(core, isolated); }
});

test('M1-26 the built-in two-engine-review pipeline file is valid', async () => {
  const isolated = isolation();
  const core = await startCore(isolated);
  try {
    const pipe = await client(isolated.prefix);
    try {
      const res = await pipe.request('pipeline.validate', { json: JSON.parse(readFileSync(builtin, 'utf8')) });
      assert.equal(res.result.valid, true, JSON.stringify(res));
    } finally { pipe.close(); }
  } finally { await teardownCore(core, isolated); }
});
