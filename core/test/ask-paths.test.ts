import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { folderApproval } from '../src/sessions/launch.ts';
import { buildGenerated, client, isolation, root, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

const recorder = "import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)));setTimeout(()=>process.exit(0),500);";

const engine = (id: string, argvFile: string, profile: string[], askNear = false) => ({
  id, command: process.execPath, args: [join(root, 'core/test/approval-argv-recorder.mjs'), argvFile], prompt_arg: 'positional',
  state_source: 'process', roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
  version_cmd: [process.execPath, '--version'], approval_profiles: { contained: profile }, ask_near_paths: askNear,
});

async function runCase(id: string, pathKind: 'contains' | 'inside' | 'ordinary' | 'near', profile: string[], askNear = false) {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const argvFile = join(isolated.home, `${id}-argv.json`);
  const recorderPath = join(isolated.home, 'approval-argv-recorder.mjs');
  writeFileSync(recorderPath, recorder);
  writeFileSync(registry, JSON.stringify([{ ...engine(id, argvFile, profile, askNear), args: [recorderPath, argvFile] }]));
  const askPath = pathKind === 'inside' ? join(isolated.home, 'work', 'client') : join(isolated.home, 'vault', 'work', 'client');
  writeFileSync(join(isolated.home, 'settings.json'), JSON.stringify({ sessions: { ask_paths: [askPath] } }));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry, APPROVAL_ARGV_FILE: argvFile };
  const core = await startCore({ ...isolated, env });
  try {
    let project;
    if (pathKind === 'contains') {
      project = join(isolated.home, 'vault');
      mkdirSync(askPath, { recursive: true });
    } else if (pathKind === 'inside') {
      project = join(askPath, 'repo');
      mkdirSync(project, { recursive: true });
    } else if (pathKind === 'near') {
      project = join(isolated.home, 'vault', 'projects', 'app');
      mkdirSync(askPath, { recursive: true });
      mkdirSync(project, { recursive: true });
    } else {
      project = join(isolated.home, 'ordinary-project');
      mkdirSync(project);
    }
    const pipe = await client(isolated.prefix);
    try {
      const opened = await pipe.request('project.open', { path: project });
      assert.ok(opened.result?.project_id, JSON.stringify(opened));
      const launched = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id: id, approval: 'contained' });
      assert.ok(launched.result?.session_id, JSON.stringify(launched));
      assert.equal(launched.result.approval, 'contained');
    } finally { pipe.close(); }
    return await until(() => {
      try { return JSON.parse(readFileSync(argvFile, 'utf8')) as string[]; } catch { return undefined; }
    });
  } finally { await teardownCore(core, isolated); }
}

test('a tree holding an ask path keeps contained approval for Codex, agy, and Claude', async () => {
  const codex = await runCase('codex-near', 'near', ['--approve-for-me'], true);
  // protects= D89: ask_paths and legacy ask_near_paths do not override contained approval.
  assert.deepEqual(codex, ['--approve-for-me']);
  const agy = await runCase('agy-near', 'near', ['--mode', 'accept-edits', '--sandbox'], true);
  assert.deepEqual(agy, ['--mode', 'accept-edits', '--sandbox']);
  const claude = await runCase('claude-near', 'near', ['--permission-mode', 'auto']);
  assert.deepEqual(claude, ['--permission-mode', 'auto']);
});

test('ordinary project keeps contained flags for Codex, agy, and Claude', async () => {
  assert.deepEqual(await runCase('codex-ordinary', 'ordinary', ['--approve-for-me'], true), ['--approve-for-me']);
  assert.deepEqual(await runCase('agy-ordinary', 'ordinary', ['--mode', 'accept-edits', '--sandbox'], true), ['--mode', 'accept-edits', '--sandbox']);
  assert.deepEqual(await runCase('claude-ordinary-all', 'ordinary', ['--permission-mode', 'auto']), ['--permission-mode', 'auto']);
});

test('folderApproval keeps requested approval or defaults to contained regardless of folder', () => {
  // protects= D89: folderApproval defaults to contained and preserves every explicit approval.
  const rootDir = join(root, 'work', 'client');
  for (const dir of [rootDir, join(rootDir, 'repo', 'src', 'deep'), join(root, 'projects', 'app')]) {
    assert.equal(folderApproval(dir), 'contained');
    for (const approval of ['ask', 'edits', 'contained', 'isolated']) {
      assert.equal(folderApproval(dir, approval), approval);
    }
  }
});

test('a project holding an ask path keeps Claude approval contained', async () => {
  const argv = await runCase('claude-vault', 'contains', ['--permission-mode', 'auto']);
  // protects= D89: a parent of an ask path keeps the requested approval.
  assert.deepEqual(argv, ['--permission-mode', 'auto']);
});

test('a project inside an ask path keeps Codex approval contained', async () => {
  const argv = await runCase('codex-inside', 'inside', ['--approve-for-me']);
  // protects= D89: a descendant of an ask path keeps the requested approval.
  assert.deepEqual(argv, ['--approve-for-me']);
});

test('ordinary project keeps contained approval flags', async () => {
  assert.deepEqual(await runCase('claude-ordinary', 'ordinary', ['--permission-mode', 'auto']), ['--permission-mode', 'auto']);
});
