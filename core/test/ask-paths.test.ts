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
      if (pathKind !== 'ordinary' && pathKind !== 'near') assert.equal(launched.result.approval, 'ask');
    } finally { pipe.close(); }
    return await until(() => {
      try { return JSON.parse(readFileSync(argvFile, 'utf8')) as string[]; } catch { return undefined; }
    });
  } finally { await teardownCore(core, isolated); }
}

test('a tree holding an ask path asks for Codex and agy while Claude keeps contained approval', async () => {
  const codex = await runCase('codex-near', 'near', ['--approve-for-me'], true);
  assert.equal(codex.includes('--approve-for-me'), false);
  const agy = await runCase('agy-near', 'near', ['--mode', 'accept-edits', '--sandbox'], true);
  assert.equal(agy.includes('accept-edits'), false);
  assert.equal(agy.includes('--sandbox'), false);
  const claude = await runCase('claude-near', 'near', ['--permission-mode', 'auto']);
  assert.deepEqual(claude, ['--permission-mode', 'auto']);
});

test('ordinary project keeps contained flags for Codex, agy, and Claude', async () => {
  assert.deepEqual(await runCase('codex-ordinary', 'ordinary', ['--approve-for-me'], true), ['--approve-for-me']);
  assert.deepEqual(await runCase('agy-ordinary', 'ordinary', ['--mode', 'accept-edits', '--sandbox'], true), ['--mode', 'accept-edits', '--sandbox']);
  assert.deepEqual(await runCase('claude-ordinary-all', 'ordinary', ['--permission-mode', 'auto']), ['--permission-mode', 'auto']);
});

test('folderApproval reads the ask_paths it is given', () => {
  const rootDir = join(root, 'work', 'client');
  const codex = { ask_near_paths: true } as Parameters<typeof folderApproval>[2];
  assert.equal(folderApproval(join(rootDir, 'repo', 'src', 'deep'), 'contained', codex, [rootDir]), 'ask');
  assert.equal(folderApproval(join(rootDir, 'repo'), 'contained', {}, [rootDir]), 'ask');
  assert.equal(folderApproval(join(rootDir, 'repo'), 'contained', {}, []), 'contained');
  assert.equal(folderApproval(join(root, 'projects', 'app'), 'contained', {}, [rootDir]), 'contained');
});

test('a project holding an ask path forces Claude approval to ask', async () => {
  const argv = await runCase('claude-vault', 'contains', ['--permission-mode', 'auto']);
  assert.equal(argv.includes('--permission-mode'), false);
});

test('a project inside an ask path forces Codex approval to ask', async () => {
  const argv = await runCase('codex-inside', 'inside', ['--approve-for-me']);
  assert.equal(argv.includes('--approve-for-me'), false);
});

test('ordinary project keeps contained approval flags', async () => {
  assert.deepEqual(await runCase('claude-ordinary', 'ordinary', ['--permission-mode', 'auto']), ['--permission-mode', 'auto']);
});
