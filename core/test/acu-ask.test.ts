import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGenerated, client, isolation, root, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

const recorder = "import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)));setTimeout(()=>process.exit(0),500);";

const engine = (id: string, argvFile: string, profile: string[]) => ({
  id, command: process.execPath, args: [join(root, 'core/test/approval-argv-recorder.mjs'), argvFile], prompt_arg: 'positional',
  state_source: 'process', roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
  version_cmd: [process.execPath, '--version'], approval_profiles: { contained: profile },
});

async function runCase(id: string, pathKind: 'contains-acu' | 'inside-acu' | 'ordinary', profile: string[]) {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const argvFile = join(isolated.home, `${id}-argv.json`);
  const recorderPath = join(isolated.home, 'approval-argv-recorder.mjs');
  writeFileSync(recorderPath, recorder);
  writeFileSync(registry, JSON.stringify([{ ...engine(id, argvFile, profile), args: [recorderPath, argvFile] }]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry, APPROVAL_ARGV_FILE: argvFile };
  const core = await startCore({ ...isolated, env });
  try {
    let project;
    if (pathKind === 'contains-acu') {
      project = join(isolated.home, 'vault');
      mkdirSync(join(project, 'work', 'ACU'), { recursive: true });
    } else if (pathKind === 'inside-acu') {
      project = join(isolated.home, 'work', 'ACU', 'repo');
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
      if (pathKind !== 'ordinary') assert.equal(launched.result.approval, 'ask');
    } finally { pipe.close(); }
    return await until(() => {
      try { return JSON.parse(readFileSync(argvFile, 'utf8')) as string[]; } catch { return undefined; }
    });
  } finally { await teardownCore(core, isolated); }
}

test('ACU-containing project forces Claude approval to ask', async () => {
  const argv = await runCase('claude-vault', 'contains-acu', ['--permission-mode', 'auto']);
  assert.equal(argv.includes('--permission-mode'), false);
});

test('project inside ACU forces Codex approval to ask', async () => {
  const argv = await runCase('codex-acu', 'inside-acu', ['--approve-for-me']);
  assert.equal(argv.includes('--approve-for-me'), false);
});

test('ordinary project keeps contained approval flags', async () => {
  assert.deepEqual(await runCase('claude-ordinary', 'ordinary', ['--permission-mode', 'auto']), ['--permission-mode', 'auto']);
});
