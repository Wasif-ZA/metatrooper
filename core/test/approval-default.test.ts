import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGenerated, client, isolation, root, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

const recorder = "import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)));setTimeout(()=>process.exit(0),500);";

const engine = (id: string, argvFile: string, approval_profiles?: Record<string, string[]>) => ({
  id, command: process.execPath, args: [join(root, 'core/test/approval-argv-recorder.mjs'), argvFile], prompt_arg: 'positional',
  state_source: 'process', roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
  version_cmd: [process.execPath, '--version'], ...(approval_profiles ? { approval_profiles } : {}),
});

async function runCase(id: string, engineSpec: object, settings?: object) {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const argvFile = join(isolated.home, `${id}-argv.json`);
  const recorderPath = join(isolated.home, 'approval-argv-recorder.mjs');
  writeFileSync(recorderPath, recorder);
  const spec = { ...(engineSpec as object), args: [recorderPath, argvFile] };
  writeFileSync(registry, JSON.stringify([spec]));
  if (settings) writeFileSync(join(isolated.home, 'settings.json'), JSON.stringify(settings));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry, APPROVAL_ARGV_FILE: argvFile };
  const core = await startCore({ ...isolated, env });
  try {
    const project = join(isolated.home, 'ordinary-project');
    mkdirSync(project);
    const pipe = await client(isolated.prefix);
    try {
      const opened = await pipe.request('project.open', { path: project });
      const launched = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id: id });
      assert.ok(launched.result?.session_id, JSON.stringify(launched));
    } finally { pipe.close(); }
    return await until(() => {
      try { return JSON.parse(readFileSync(argvFile, 'utf8')) as string[]; } catch { return undefined; }
    });
  } finally { await teardownCore(core, isolated); }
}

test('an existing settings file without approval keeps Claude on contained approval argv', async () => {
  assert.deepEqual(await runCase('claude', engine('claude', '', { contained: ['--permission-mode', 'auto'] }), { ui: { theme: 'dither' } }), ['--permission-mode', 'auto']);
});

test('sessions.approval contained gives Codex contained approval argv', async () => {
  assert.deepEqual(await runCase('codex', engine('codex', '', { contained: ['--approve-for-me'] }), { sessions: { approval: 'contained' } }), ['--approve-for-me']);
});

test('sessions.approval ask adds no approval argv', async () => {
  assert.deepEqual(await runCase('ask-engine', engine('ask-engine', '', { contained: ['--fake-contained'] }), { sessions: { approval: 'ask' } }), []);
});

test('engine without contained profile falls back to ask instead of failing', async () => {
  assert.deepEqual(await runCase('unsupported', engine('unsupported', '')), []);
});
