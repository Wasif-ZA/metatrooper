import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { buildGenerated, client, isolation, root, startCore, teardownCore, until } from './helpers.ts';
import { agentsMdArgs, planArgs } from '../src/sessions/launch.ts';
import { BUILT_IN } from '../src/engines/registry.ts';
import { launchSession } from '../src/sessions/launch.ts';
import { killAll } from '../src/terminal/index.ts';

before(buildGenerated);

const recorder = "import{writeFileSync}from'node:fs';writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)));setTimeout(()=>process.exit(0),500);";
const claude = { id: 'claude', command: process.execPath, args: [], prompt_arg: 'positional', state_source: 'process', roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'], agents_md: { unless: ['CLAUDE.md', '.claude/CLAUDE.md'], args: ['--append-system-prompt-file', 'AGENTS.md'] } };
const codex = { ...claude, id: 'codex', agents_md: undefined };
const expectedArgs = ['--append-system-prompt-file', 'AGENTS.md'];

function fixture(files: Record<string, string> = {}) {
  const dir = join(tmpdir(), `m5-19-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir);
  for (const [name, content] of Object.entries(files)) {
    const file = join(dir, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return dir;
}

async function runLaunch(id: string, spec: object, project: string, cwd = project) {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const argvFile = join(isolated.home, `${id}-argv.json`);
  const recorderPath = join(isolated.home, 'recorder.mjs');
  writeFileSync(recorderPath, recorder);
  writeFileSync(registry, JSON.stringify([{ ...spec, args: [recorderPath, argvFile] }]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry, APPROVAL_ARGV_FILE: argvFile };
  return runLaunchWithSetup(isolated, env, id, project, cwd, argvFile, registry, recorderPath);
}

async function runLaunchWithSetup(isolated: ReturnType<typeof isolation>, env: NodeJS.ProcessEnv, id: string, project: string, cwd: string, argvFile: string, registry: string, recorderPath: string) {
  const core = await startCore({ ...isolated, env });
  try {
    const pipe = await client(isolated.prefix);
    try {
      const opened = await pipe.request('project.open', { path: project });
      const launched = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id: id, ...(cwd !== project ? { cwd } : {}) });
      assert.ok(launched.result?.session_id, JSON.stringify(launched));
    } finally { pipe.close(); }
    return await until(() => {
      try { return JSON.parse(readFileSync(argvFile, 'utf8')) as string[]; } catch { return undefined; }
    });
  } finally { await teardownCore(core, isolated); }
}

test('M5-19a launches Claude with AGENTS.md and preserves project files', async () => {
  const project = fixture({ 'AGENTS.md': 'fixture instructions\n' });
  const beforeNames = readdirSync(project).sort();
  const beforeBytes = readFileSync(join(project, 'AGENTS.md'));
  const argv = await runLaunch('claude', claude, project);
  assert.deepEqual(argv.slice(0, 2), expectedArgs);
  assert.deepEqual(readdirSync(project).sort(), beforeNames);
  assert.deepEqual(readFileSync(join(project, 'AGENTS.md')), beforeBytes);
});

test('M5-19b does not add Claude instruction args when CLAUDE.md exists', async () => {
  const project = fixture({ 'AGENTS.md': 'instructions\n', 'CLAUDE.md': 'claude instructions\n' });
  assert.equal((await runLaunch('claude', claude, project)).includes('--append-system-prompt-file'), false);
});

test('does not add Claude instruction args when .claude/CLAUDE.md exists', async () => {
  const project = fixture({ 'AGENTS.md': 'instructions\n', '.claude/CLAUDE.md': 'claude instructions\n' });
  assert.equal((await runLaunch('claude', claude, project)).includes('--append-system-prompt-file'), false);
});

test('built-in Claude suppresses AGENTS.md args when .claude/CLAUDE.md exists', async () => {
  const project = fixture({ 'AGENTS.md': 'instructions\\n', '.claude/CLAUDE.md': 'claude instructions\\n' });
  const builtInClaude = BUILT_IN.find((engine) => engine.id === 'claude');
  assert.ok(builtInClaude);
  assert.deepEqual(agentsMdArgs(builtInClaude, project), []);
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const argvFile = join(isolated.home, 'claude-argv.json');
  const recorderPath = join(isolated.home, 'recorder.mjs');
  writeFileSync(recorderPath, recorder);
  writeFileSync(registry, JSON.stringify([{ ...builtInClaude, command: process.execPath, args: [recorderPath, argvFile] }]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry, APPROVAL_ARGV_FILE: argvFile };
  assert.equal((await runLaunchWithSetup(isolated, env, 'claude', project, project, argvFile, registry, recorderPath)).includes('--append-system-prompt-file'), false);
});

test('does not add Claude instruction args without AGENTS.md', async () => {
  const project = fixture();
  assert.equal((await runLaunch('claude', claude, project)).includes('--append-system-prompt-file'), false);
});

test('does not add instruction args for Codex', async () => {
  const project = fixture({ 'AGENTS.md': 'instructions\n' });
  assert.equal((await runLaunch('codex', codex, project)).includes('--append-system-prompt-file'), false);
});

test('launch argv uses cwd instead of project root', async () => {
  const project = fixture({ 'AGENTS.md': 'root instructions\n' });
  const subfolder = fixture();
  assert.deepEqual(planArgs(claude, undefined, 'ask', agentsMdArgs(claude, subfolder)).argv, [process.execPath]);
  assert.deepEqual(planArgs(claude, undefined, 'ask', agentsMdArgs(claude, project)).argv, [process.execPath, '--append-system-prompt-file', 'AGENTS.md']);
});

test('launch argv detects AGENTS.md in a worktree folder', async () => {
  const project = fixture();
  const worktree = fixture({ 'AGENTS.md': 'worktree instructions\n' });
  assert.deepEqual(planArgs(claude, undefined, 'ask', agentsMdArgs(claude, worktree)).argv, [process.execPath, '--append-system-prompt-file', 'AGENTS.md']);
  assert.deepEqual(planArgs(claude, undefined, 'ask', agentsMdArgs(claude, project)).argv, [process.execPath]);
});

test('core launch chooses AGENTS.md args from session cwd', async () => {
  const rootWithoutAgents = fixture();
  const cwdWithAgents = fixture({ 'AGENTS.md': 'cwd instructions\\n' });
  const rootWithAgents = fixture({ 'AGENTS.md': 'root instructions\\n' });
  const cwdWithoutAgents = fixture();
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const argvFile = join(isolated.home, 'cwd-argv.json');
  const recorderPath = join(isolated.home, 'recorder.mjs');
  writeFileSync(recorderPath, recorder);
  writeFileSync(registry, JSON.stringify([{ ...claude, args: [recorderPath, argvFile] }]));
  const db = new (await import('node:sqlite')).DatabaseSync(':memory:');
  db.exec(readFileSync(join(root, 'contracts/schema.sql'), 'utf8'));
  db.prepare("INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES ('claude', '{}', 3, 'local-cli')").run();
  for (const [index, projectPath] of [rootWithoutAgents, rootWithAgents].entries()) {
    const id = `test-project-${index}`;
    const now = new Date().toISOString();
    db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run(id, projectPath, 'fixture', now, now);
  }
  let projectIndex = 0;
  const launchWithCwd = (projectPath: string, cwd: string) => {
    launchSession(db, { projectId: `test-project-${projectIndex++}`, projectPath, projectName: 'fixture', engine: { ...claude, command: process.execPath, args: [recorderPath, argvFile] }, cwd });
  };
  launchWithCwd(rootWithoutAgents, cwdWithAgents);
  const withCwdAgents = await until(() => {
    try { return JSON.parse(readFileSync(argvFile, 'utf8')) as string[]; } catch { return undefined; }
  });
  assert.ok(withCwdAgents.includes('--append-system-prompt-file'));

  writeFileSync(argvFile, '');
  launchWithCwd(rootWithAgents, cwdWithoutAgents);
  const withoutCwdAgents = await until(() => {
    try { return JSON.parse(readFileSync(argvFile, 'utf8')) as string[]; } catch { return undefined; }
  });
  assert.equal(withoutCwdAgents.includes('--append-system-prompt-file'), false);
  killAll();
  db.close();
});

test('agentsMdArgs returns literal expected arrays for instruction file cases', () => {
  const onlyAgents = fixture({ 'AGENTS.md': 'instructions\n' });
  const both = fixture({ 'AGENTS.md': 'instructions\n', 'CLAUDE.md': 'claude\n' });
  const nested = fixture({ 'AGENTS.md': 'instructions\n', '.claude/CLAUDE.md': 'claude\n' });
  const absent = fixture();
  assert.deepEqual(agentsMdArgs(claude, onlyAgents), ['--append-system-prompt-file', 'AGENTS.md']);
  assert.deepEqual(agentsMdArgs(claude, both), []);
  assert.deepEqual(agentsMdArgs(claude, nested), []);
  assert.deepEqual(agentsMdArgs(claude, absent), []);
  assert.deepEqual(agentsMdArgs(codex, onlyAgents), []);
});
