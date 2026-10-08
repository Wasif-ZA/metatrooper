import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, startCore, teardownCore, until } from './helpers.ts';
import { resolveCommand } from '../src/hook/resolve.ts';

before(buildGenerated);
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe' });
const npmCommand = resolveCommand('npm');
const npmAvailable = npmCommand !== null && spawnSync(npmCommand[0], [...npmCommand.slice(1), '--version'], { windowsHide: true, encoding: 'utf8' }).status === 0;

async function runCase(disableNpmCi: boolean) {
  const iso = isolation();
  const project = join(iso.home, 'project');
  mkdirSync(project, { recursive: true });
  mkdirSync(join(project, 'local-dep'));
  writeFileSync(join(project, 'local-dep', 'package.json'), JSON.stringify({ name: 'local-dep', version: '1.0.0' }));
  writeFileSync(join(project, 'package.json'), JSON.stringify({ name: 'worktree-fixture', version: '1.0.0', private: true, dependencies: { 'local-dep': 'file:./local-dep' } }));
  execFileSync(npmCommand![0], [...npmCommand!.slice(1), 'install', '--package-lock-only', '--offline', '--no-audit', '--no-fund'], { cwd: project, stdio: 'pipe' });
  git(project, 'init', '-q', '-b', 'main');
  git(project, 'config', 'user.email', 'fixture@example.com');
  git(project, 'config', 'user.name', 'fixture');
  git(project, 'add', '-A');
  git(project, 'commit', '-qm', 'fixture');

  const settingsPath = join(iso.home, 'settings.json');
  writeFileSync(settingsPath, JSON.stringify({ worktree: { npm_ci: !disableNpmCi } }));
  const pipelineDir = join(project, '.troop', 'pipelines');
  mkdirSync(pipelineDir, { recursive: true });
  writeFileSync(join(pipelineDir, 'npm-worktree.json'), JSON.stringify({
    schema: 1, id: 'npm-worktree', title: 'npm worktree fixture', inputs: {},
    steps: [{ id: 'build', kind: 'agent', engine: 'fake', worktree: true, prompt: `FAKE ${JSON.stringify({ outputs: { summary: 'done' } })}\\n` }],
  }));
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{ id: 'fake', command: process.execPath, args: [join(root, 'core/test/fake-engine.js')], prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'] }]));
  const env = { ...iso.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...iso, env });
  const store = new DatabaseSync(join(iso.home, 'troop.db'));
  let pipe: Awaited<ReturnType<typeof client>> | undefined;
  try {
    pipe = await client(iso.prefix);
    await pipe.request('ui.hello', { cwd: iso.home, version: 'test' });
    const opened = await pipe.request('project.open', { path: project });
    assert.ok(npmCommand, 'npm command was resolved before the test ran');
    const before = spawnSync(npmCommand[0], [...npmCommand.slice(1), 'ls', '--all', '--json'], { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).stdout;
    const started = await pipe.request('run.start', { pipeline_id: 'npm-worktree', project_id: opened.result.project_id, inputs: {} }, { timeout: 5000 });
    assert.ok(started.result?.run_id, JSON.stringify(started));
    const runId = started.result.run_id as string;
    const status = await until(() => {
      const row = store.prepare('SELECT status FROM run WHERE id = ?').get(runId) as { status: string };
      return ['done', 'failed'].includes(row.status) ? row.status : null;
    }, 60000);
    assert.equal(status, 'done');
    const row = store.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'build'").get(runId) as { outputs: string };
    const outputs = JSON.parse(row.outputs);
    const worktree = outputs.worktree as string;
    if (disableNpmCi) assert.equal(existsSync(join(worktree, 'node_modules')), false);
    else {
      assert.ok(existsSync(join(worktree, 'node_modules')));
      assert.equal(lstatSync(join(worktree, 'node_modules')).isSymbolicLink(), false);
    }
    const after = spawnSync(npmCommand[0], [...npmCommand.slice(1), 'ls', '--all', '--json'], { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).stdout;
    assert.equal(after, before);
  } finally {
    pipe?.close();
    store.close();
    await teardownCore(core, iso);
  }
}

test('M4-24 npm ci installs in a worktree and leaves main checkout npm ls unchanged', { skip: !npmAvailable && 'npm is not on PATH' }, async () => runCase(false));
test('M4-24 worktree.npm_ci=false skips npm ci', { skip: !npmAvailable && 'npm is not on PATH' }, async () => runCase(true));
