import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { client, fakeGh, isolation, root, startCore, teardownCore, uiHello, until } from './helpers.ts';

const win = process.platform === 'win32';
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' });
const fake = (d: object) => `FAKE ${JSON.stringify(d)}\n`;

/** A core with a fake engine, fake gh on PATH, and the fixture repo pushed to a local bare origin. */
async function setup(pipelineId: string) {
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{
    id: 'fake', command: process.execPath, args: [join(root, 'core/test/fake-engine.js')], prompt_arg: 'positional',
    state_source: 'hooks', roles: ['plan', 'worker', 'review', 'verify', 'visual-check', 'research'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
    version_cmd: [process.execPath, '--version'],
  }]));
  const bin = join(iso.home, 'fake-bin');
  mkdirSync(bin);
  const ghLog = fakeGh(bin);

  const project = join(iso.home, 'project');
  cpSync(join(root, 'tests', 'fixtures', pipelineId), project, { recursive: true });
  git(project, 'init', '-q', '-b', 'main');
  git(project, 'config', 'user.email', 'fixture@example.com');
  git(project, 'config', 'user.name', 'fixture');
  git(project, 'add', '-A');
  git(project, 'commit', '-qm', 'fixture');
  const origin = join(iso.home, 'origin.git');
  execFileSync('git', ['init', '-q', '--bare', origin]);
  git(project, 'remote', 'add', 'origin', origin);
  git(project, 'push', '-q', 'origin', 'main');

  const env = { ...iso.env, METATROOPER_ENGINES: registry, PATH: `${bin}${delimiter}${process.env.PATH}` };
  const core = await startCore({ ...iso, env });
  const db = new DatabaseSync(join(iso.home, 'troop.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  return { iso, core, db, project, origin, ghLog };
}

function pipelineWith(id: string, directives: Record<string, object>): object {
  const def = JSON.parse(readFileSync(join(root, 'pipelines', `${id}.json`), 'utf8'));
  for (const s of def.steps) {
    if (s.kind === 'agent') s.engine = 'fake';
    if (directives[s.id]) s.prompt = fake(directives[s.id]) + s.prompt;
  }
  return def;
}

async function waitingGate(db: DatabaseSync, runId: string, stepId: string) {
  return until(() => {
    const run = db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as { status: string };
    if (run.status === 'failed' || run.status === 'done') throw new Error(`run ${run.status} before gate ${stepId}`);
    return db.prepare("SELECT id, guards_step, action_hash, summary FROM gate WHERE run_id = ? AND step_id = ? AND status = 'waiting'").get(runId, stepId) as
      | { id: string; guards_step: string | null; action_hash: string | null; summary: string }
      | undefined;
  }, 60_000);
}

test('M2-01 spec-to-pr runs on its fixture, stops at the gate before open-pr, and opens the PR only after approval', async () => {
  const t = await setup('spec-to-pr');
  try {
    const def = pipelineWith('spec-to-pr', {
      spec: { outputs: { title: 'Add greet' } },
      build: { files: { 'greet.js': 'export const greet = (n) => `Hello, ${n}!`;\n' }, commit: 'Add greet', outputs: { summary: 'Adds greet(name).' } },
    });
    mkdirSync(join(t.project, '.troop', 'pipelines'), { recursive: true });
    writeFileSync(join(t.project, '.troop', 'pipelines', 'spec-to-pr.json'), JSON.stringify(def));
    const pipe = await client(t.iso.prefix);
    try {
      await uiHello(pipe, t.iso.home);
      const projectId = (await pipe.request('project.open', { path: t.project })).result.project_id;
      const started = await pipe.request('run.start', { pipeline_id: 'spec-to-pr', project_id: projectId, inputs: { idea: readFileSync(join(t.project, 'idea.md'), 'utf8'), repo: 'fake/repo' } }, { timeout: 5000 });
      assert.ok(started.result?.run_id, JSON.stringify(started));
      const runId = started.result.run_id as string;

      const specGate = await waitingGate(t.db, runId, 'approve-spec');
      assert.deepEqual((await pipe.request('gate.resolve', { gate_id: specGate.id, decision: 'approve', action_hash: specGate.action_hash ?? undefined }, { timeout: 5000 })).result, {});

      const prGate = await waitingGate(t.db, runId, 'approve-pr');
      assert.equal(prGate.guards_step, 'open-pr');
      assert.match(prGate.action_hash ?? '', /^[0-9a-f]{64}$/);
      const openPr = t.db.prepare("SELECT status FROM run_step WHERE run_id = ? AND step_id = 'open-pr'").get(runId) as { status: string } | undefined;
      assert.ok(!openPr || openPr.status === 'pending', JSON.stringify(openPr));
      assert.equal(existsSync(t.ghLog), false, 'gh ran before approval');
      const build = JSON.parse((t.db.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'build'").get(runId) as { outputs: string }).outputs);
      assert.match(build.branch, /^troop\//);
      const verify = JSON.parse((t.db.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'verify'").get(runId) as { outputs: string }).outputs);
      assert.equal(verify.passed, true, verify.output_tail);

      assert.deepEqual((await pipe.request('gate.resolve', { gate_id: prGate.id, decision: 'approve', action_hash: prGate.action_hash }, { timeout: 5000 })).result, {});
      const status = await until(() => {
        const r = t.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as { status: string };
        return ['done', 'failed'].includes(r.status) ? r.status : null;
      }, 60_000);
      const log = readFileSync(join(t.db.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId).run_dir as string, 'log.jsonl'), 'utf8');
      assert.equal(status, 'done', log.slice(-1500));
      const calls = readFileSync(t.ghLog, 'utf8').trim().split(/\r?\n/);
      assert.equal(calls.length, 1);
      assert.match(calls[0], /^pr create --repo fake\/repo --head troop\/\S+ --base main --title "?Add greet"? --body-file /);
      assert.equal(git(t.origin, 'branch', '--list', build.branch).trim(), build.branch);
      assert.ok(git(t.origin, 'show', `${build.branch}:greet.js`).includes('Hello'));
      const pr = JSON.parse((t.db.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'open-pr'").get(runId) as { outputs: string }).outputs);
      assert.equal(pr.url, 'https://github.com/fake/repo/pull/7');
    } finally { pipe.close(); }
  } finally {
    t.db.close();
    await teardownCore(t.core, t.iso);
  }
});
