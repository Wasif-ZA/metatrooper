import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

const builtin = join(root, 'pipelines', 'two-engine-review.json');
const { bucketFindings } = await import(join(root, 'pipelines', 'two-engine-review', 'bucket.mjs'));

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
  writeFileSync(registry, JSON.stringify([{
    id: 'fake', command: process.execPath, args: [join(root, 'core/test/fake-engine.js')], prompt_arg: 'positional',
    state_source: 'hooks', roles: ['worker', 'review', 'verify'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
    version_cmd: [process.execPath, '--version'],
  }]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry, TROOP_LAUNCHER: 'spawn' };
  const core = await startCore({ ...isolated, env });
  try {
    const project = join(isolated.home, 'planted');
    mkdirSync(project, { recursive: true });
    const pipelines = join(project, '.troop', 'pipelines');
    mkdirSync(pipelines, { recursive: true });
    cpSync(join(root, 'pipelines', 'two-engine-review'), join(pipelines, 'two-engine-review'), { recursive: true });
    const def = JSON.parse(readFileSync(builtin, 'utf8'));
    const bug = f('src/app.js', 40, 42);
    const directive = (verdict: string, findings: unknown[]) => `FAKE ${JSON.stringify({ outputs: { verdict, findings: JSON.stringify(findings) } })}\n`;
    def.steps[0].engine = 'fake'; def.steps[0].prompt = directive('reject', [bug, f('src/x.js', 1, 1)]) + def.steps[0].prompt;
    def.steps[1].engine = 'fake'; def.steps[1].prompt = directive('reject', [f('src/app.js', 43, 44), f('src/y.js', 9, 9)]) + def.steps[1].prompt;
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
    try {
      const status = await until(() => {
        const r = store.prepare('SELECT status FROM run WHERE id = ?').get(runId) as { status: string };
        return ['done', 'failed'].includes(r.status) ? r.status : null;
      }, 60000);
      assert.equal(status, 'done');
      const row = store.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'bucket'").get(runId) as { outputs: string };
      assert.deepEqual(JSON.parse(row.outputs), {
        codex_verdict: 'reject', gemini_verdict: 'reject', both: 1, codex_only: 1, gemini_only: 1, disagree: 0, buckets_path: 'review-buckets.json',
      });
    } finally { store.close(); }
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
