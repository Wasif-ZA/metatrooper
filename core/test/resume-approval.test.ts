import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, startCore, teardownCore, uiHello, until } from './helpers.ts';

// Pre-build generated files required by core.
before(buildGenerated);

async function setupCase(settingsObj?: Record<string, unknown>) {
  const isolated = isolation();
  if (settingsObj) {
    writeFileSync(join(isolated.home, 'settings.json'), JSON.stringify(settingsObj));
  }
  const recorderPath = join(isolated.home, 'recorder.mjs');
  const recorder = [
    "import { writeFileSync, existsSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "const id = process.env.TROOP_SESSION_ID || 'unknown';",
    `const dir = ${JSON.stringify(isolated.home)};`,
    "writeFileSync(join(dir, `${id}-argv.json`), JSON.stringify(process.argv));",
    "process.on('SIGINT', () => process.exit(0));",
    "process.on('SIGTERM', () => process.exit(0));",
    "const timer = setInterval(() => {",
    "  if (existsSync(join(dir, `${id}-exit`))) {",
    "    clearInterval(timer);",
    "    process.exit(0);",
    "  }",
    "}, 50);",
  ].join('\n');
  writeFileSync(recorderPath, recorder);
  const registry = join(isolated.home, 'engines.json');
  const engine = {
    id: 'fake-engine',
    command: process.execPath,
    args: [recorderPath],
    prompt_arg: 'positional',
    state_source: 'process',
    roles: ['worker'],
    cost_rank: 1,
    usage_source: 'none',
    provider: 'local-cli',
    version_cmd: [process.execPath, '--version'],
    approval_profiles: {
      edits: ['--edits'],
      contained: ['--contained'],
    },
    resume_args: ['--resume', '{native_id}'],
  };
  writeFileSync(registry, JSON.stringify([engine]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  const db = new DatabaseSync(join(isolated.home, 'troop.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  const pipe = await client(isolated.prefix);
  await uiHello(pipe, isolated.home);
  const project = join(isolated.home, 'project');
  mkdirSync(project, { recursive: true });
  const opened = await pipe.request('project.open', { path: project });
  const projectId = opened.result.project_id;
  return {
    isolated,
    core,
    db,
    pipe,
    project,
    projectId,
    async stopSession(sessionId: string) {
      writeFileSync(join(isolated.home, `${sessionId}-exit`), '');
      await pipe.request('session.stop', { session_id: sessionId });
      await until(() => {
        const row = db.prepare('SELECT state FROM session WHERE id = ?').get(sessionId) as { state: string } | undefined;
        return row?.state === 'exited';
      }, 5000);
    },
    async getArgv(sessionId: string) {
      const argvFile = join(isolated.home, `${sessionId}-argv.json`);
      await until(() => existsSync(argvFile), 5000);
      return JSON.parse(readFileSync(argvFile, 'utf8')) as string[];
    },
    async teardown() {
      pipe.close();
      db.close();
      await teardownCore(core, isolated);
    },
  };
}

test('1. A session launched at contained, exited, resumed: approval is contained, argv contains --contained, and row approval column is contained', async () => {
  const c = await setupCase();
  try {
    const launch = await c.pipe.request('session.launch', {
      project_id: c.projectId,
      engine_id: 'fake-engine',
      approval: 'contained',
    });
    const oldId = launch.result?.session_id;
    assert.ok(oldId);
    const oldArgv = await c.getArgv(oldId);
    assert.ok(oldArgv.includes('--contained'));
    await c.stopSession(oldId);

    const resumed = await c.pipe.request('session.resume', { session_id: oldId });
    assert.equal(resumed.result?.approval, 'contained');
    const newId = resumed.result?.session_id;
    assert.ok(newId);
    const newArgv = await c.getArgv(newId);
    assert.ok(newArgv.includes('--contained'));

    const row = c.db.prepare('SELECT approval FROM session WHERE id = ?').get(newId) as { approval: string | null };
    assert.equal(row.approval, 'contained');
  } finally {
    await c.teardown();
  }
});

test('2. A session launched at ask, resumed: approval ask, no --contained or --edits in argv', async () => {
  const c = await setupCase();
  try {
    const launch = await c.pipe.request('session.launch', {
      project_id: c.projectId,
      engine_id: 'fake-engine',
      approval: 'ask',
    });
    const oldId = launch.result?.session_id;
    assert.ok(oldId);
    const oldArgv = await c.getArgv(oldId);
    assert.equal(oldArgv.includes('--contained'), false);
    assert.equal(oldArgv.includes('--edits'), false);
    await c.stopSession(oldId);

    const resumed = await c.pipe.request('session.resume', { session_id: oldId });
    assert.equal(resumed.result?.approval, 'ask');
    const newId = resumed.result?.session_id;
    assert.ok(newId);
    const newArgv = await c.getArgv(newId);
    assert.equal(newArgv.includes('--contained'), false);
    assert.equal(newArgv.includes('--edits'), false);
  } finally {
    await c.teardown();
  }
});

test('3. A session launched at contained whose project folder is then added to settings sessions.ask_paths, resumed: approval contained', async () => {
  // protects= D89: adding ask_paths after launch preserves contained on resume, argv, and storage.
  const c = await setupCase();
  try {
    const launch = await c.pipe.request('session.launch', {
      project_id: c.projectId,
      engine_id: 'fake-engine',
      approval: 'contained',
    });
    const oldId = launch.result?.session_id;
    assert.ok(oldId);
    const oldArgv = await c.getArgv(oldId);
    assert.ok(oldArgv.includes('--contained'));
    await c.stopSession(oldId);

    const settingsPath = join(c.isolated.home, 'settings.json');
    writeFileSync(settingsPath, JSON.stringify({ sessions: { ask_paths: [c.project] } }));
    const future = new Date(Date.now() + 2000);
    utimesSync(settingsPath, future, future);

    const resumed = await c.pipe.request('session.resume', { session_id: oldId });
    assert.equal(resumed.result?.approval, 'contained');
    const newId = resumed.result?.session_id;
    assert.ok(newId);
    const newArgv = await c.getArgv(newId);
    assert.equal(newArgv.includes('--contained'), true);
    assert.equal(newArgv.includes('--edits'), false);

    const row = c.db.prepare('SELECT approval FROM session WHERE id = ?').get(newId) as { approval: string | null };
    assert.equal(row.approval, 'contained');
  } finally {
    await c.teardown();
  }
});

test('4. A pre-upgrade row: set old session row approval column to NULL directly in troop.db before resuming: resumes as ask', async () => {
  const c = await setupCase();
  try {
    const launch = await c.pipe.request('session.launch', {
      project_id: c.projectId,
      engine_id: 'fake-engine',
      approval: 'contained',
    });
    const oldId = launch.result?.session_id;
    assert.ok(oldId);
    await c.getArgv(oldId);
    await c.stopSession(oldId);

    c.db.prepare('UPDATE session SET approval = NULL WHERE id = ?').run(oldId);

    const resumed = await c.pipe.request('session.resume', { session_id: oldId });
    assert.equal(resumed.result?.approval, 'ask');
    const newId = resumed.result?.session_id;
    assert.ok(newId);
    const newArgv = await c.getArgv(newId);
    assert.equal(newArgv.includes('--contained'), false);
    assert.equal(newArgv.includes('--edits'), false);
  } finally {
    await c.teardown();
  }
});

test('5. The stored value is never loosened: with settings sessions.approval = contained, an ask session resumed comes back ask', async () => {
  const c = await setupCase({ sessions: { approval: 'contained' } });
  try {
    const launch = await c.pipe.request('session.launch', {
      project_id: c.projectId,
      engine_id: 'fake-engine',
      approval: 'ask',
    });
    const oldId = launch.result?.session_id;
    assert.ok(oldId);
    const oldArgv = await c.getArgv(oldId);
    assert.equal(oldArgv.includes('--contained'), false);
    assert.equal(oldArgv.includes('--edits'), false);
    await c.stopSession(oldId);

    const resumed = await c.pipe.request('session.resume', { session_id: oldId });
    assert.equal(resumed.result?.approval, 'ask');
    const newId = resumed.result?.session_id;
    assert.ok(newId);
    const newArgv = await c.getArgv(newId);
    assert.equal(newArgv.includes('--contained'), false);
    assert.equal(newArgv.includes('--edits'), false);
  } finally {
    await c.teardown();
  }
});
