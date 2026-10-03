import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { client, isolation, root, startCore, teardownCore, until } from './helpers.ts';

const { run: runDiff } = await import(pathToFileURL(join(root, 'pipelines/two-engine-review/diff.mjs')).href);
const { findingsInText } = await import(pathToFileURL(join(root, 'pipelines/two-engine-review/bucket.mjs')).href);
const fixture = (_cwd: string, id: string, step: any) => ({
  schema: 1, id, title: id, lane: 'coding',
  steps: [{ id: 'work', title: 'work', kind: 'agent', engine: 'fake-review', prompt: 'do it', ...step }],
});

test('trusts the project folder for an agent engine before launch', async () => {
  const isolated = isolation();
  const project = join(isolated.home, 'project');
  const config = join(isolated.home, '.codex', 'config.toml');
  mkdirSync(join(isolated.home, '.codex'), { recursive: true });
  writeFileSync(config, '[projects]\n');
  mkdirSync(project);
  mkdirSync(join(project, '.troop', 'pipelines'), { recursive: true });
  writeFileSync(join(project, '.troop', 'pipelines', 'trust-check.json'), JSON.stringify(fixture(project, 'trust-check', {})));
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{ id: 'fake-review', command: process.execPath, args: [join(root, 'core/test/fake-engine.js')], prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 1, usage_source: 'none', version_cmd: [process.execPath, '--version'], trust: { kind: 'toml-table', file: '~/.codex/config.toml', at: ['projects'], set: { trust_level: 'trusted' }, path_style: 'windows-lower' } }]));
  const core = await startCore({ ...isolated, env: { ...isolated.env, METATROOPER_ENGINES: registry } });
  try {
    const pipe = await client(isolated.prefix);
    let runId: string;
    try {
      const opened = await pipe.request('project.open', { path: project });
      const started = await pipe.request('run.start', { pipeline_id: 'trust-check', project_id: opened.result.project_id });
      assert.ok(started.result, JSON.stringify(started));
      runId = started.result.run_id;
    } finally { pipe.close(); }
    await until(() => {
      const db = new DatabaseSync(join(isolated.home, 'troop.db'));
      try { const row = db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any; return row?.status === 'done' || row?.status === 'failed' ? row.status : null; }
      finally { db.close(); }
    }, 30000);
    const expected = project.split('/').join('\\').toLowerCase();
    assert.ok(readFileSync(config, 'utf8').includes(`[projects.'${expected}']`));
  } finally { await teardownCore(core, isolated); }
});

test('step approval profile adds its argv and schema rejects unknown profiles', async () => {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const recorder = join(isolated.home, 'record-argv.cjs');
  writeFileSync(recorder, `const fs=require('node:fs');fs.appendFileSync(process.env.ARGV_RECORD,JSON.stringify(process.argv.slice(2))+'\\n');require(${JSON.stringify(join(root, 'core/test/fake-engine.js'))});\n`);
  writeFileSync(registry, JSON.stringify([{ id: 'fake-review', command: process.execPath, args: [recorder], prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 1, usage_source: 'none', version_cmd: [process.execPath, '--version'], approval_profiles: { edits: ['--fake-edits'] } }]));
  const project = join(isolated.home, 'project');
  mkdirSync(join(project, '.troop', 'pipelines'), { recursive: true });
  writeFileSync(join(project, '.troop', 'pipelines', 'approval-check.json'), JSON.stringify(fixture(project, 'approval-check', { approval: 'edits' })));
  writeFileSync(join(project, '.troop', 'pipelines', 'default-check.json'), JSON.stringify(fixture(project, 'default-check', {})));
  const core = await startCore({ ...isolated, env: { ...isolated.env, METATROOPER_ENGINES: registry, ARGV_RECORD: join(isolated.home, 'argv.jsonl') } });
  try {
    const pipe = await client(isolated.prefix);
    try {
      const opened = await pipe.request('project.open', { path: project });
      const started = await pipe.request('run.start', { pipeline_id: 'approval-check', project_id: opened.result.project_id });
      assert.ok(started.result, JSON.stringify(started));
      const waitForRun = async (runId: string) => until(() => {
        const db = new DatabaseSync(join(isolated.home, 'troop.db'));
        try { const row = db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any; return row?.status === 'done' || row?.status === 'failed' ? row.status : null; }
        finally { db.close(); }
      }, 30000);
      await waitForRun(started.result.run_id);
      const defaultStarted = await pipe.request('run.start', { pipeline_id: 'default-check', project_id: opened.result.project_id });
      assert.ok(defaultStarted.result, JSON.stringify(defaultStarted));
      await waitForRun(defaultStarted.result.run_id);
      const argv = readFileSync(join(isolated.home, 'argv.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[]);
      assert.equal(argv.length, 2);
      assert.ok(argv[0].includes('--fake-edits'));
      assert.ok(!argv[1].includes('--fake-edits'));
      const invalid = fixture(join(isolated.home, 'project'), 'bad-approval', { approval: 'yolo' });
      const result = await pipe.request('pipeline.validate', { json: invalid });
      assert.equal(result.result.valid, false);
      assert.match(JSON.stringify(result.result.errors), /approval|yolo/);
    } finally { pipe.close(); }
  } finally { await teardownCore(core, isolated); }
});

test('diff code step writes the working-tree diff and rejects option-like ranges before writing', async () => {
  const projectPath = join(isolation().home, 'git');
  mkdirSync(projectPath, { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: projectPath });
  writeFileSync(join(projectPath, 'sample.txt'), 'base\n');
  execFileSync('git', ['add', 'sample.txt'], { cwd: projectPath });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'base'], { cwd: projectPath });
  writeFileSync(join(projectPath, 'sample.txt'), 'base\nworking change\n');
  const runDir = join(projectPath, 'run');
  mkdirSync(runDir);
  const ctx: any = { inputs: { range: 'HEAD' }, projectPath, runDir, async writeFile(name: string, value: string) { writeFileSync(join(runDir, name), value); } };
  const result = await runDiff(ctx);
  assert.equal(result.diff_file, join(runDir, 'review.diff').split('\\').join('/'));
  assert.equal(readFileSync(join(runDir, 'review.diff'), 'utf8'), execFileSync('git', ['diff', 'HEAD'], { cwd: projectPath, encoding: 'utf8' }));
  assert.equal(result.lines, readFileSync(join(runDir, 'review.diff'), 'utf8').split('\n').length);
  const badDir = join(projectPath, 'bad-run');
  mkdirSync(badDir);
  await assert.rejects(runDiff({ ...ctx, inputs: { range: '--output=x' }, runDir: badDir }), /range must be a revision/);
  assert.equal(existsSync(join(badDir, 'review.diff')), false);
});

test('findings parser recovers Codex body JSON and agy front-matter arrays with bracketed text', () => {
  const data = [{ file: 'x.js', line_start: 2, line_end: 2, title: 'xs[0] is wrong' }];
  assert.deepEqual(findingsInText(`---\nfindings: 1\n---\n${JSON.stringify(data)}`), data);
  assert.deepEqual(findingsInText(`---\nfindings:\n  - file: x.js\n---\n${JSON.stringify(data)}`), data);
  assert.deepEqual(findingsInText(`---\nfindings: [\n  {"file":"x.js","line_start":2,"line_end":2,"title":"xs[0] is wrong"}\n]\n---\nbody`), data);
  const frontMatter = [{ file: 'front.js', line_start: 1, line_end: 1, title: 'preferred' }];
  assert.deepEqual(findingsInText(`---\nfindings: ${JSON.stringify(frontMatter)}\n---\n${JSON.stringify(data)}`), frontMatter);
});
