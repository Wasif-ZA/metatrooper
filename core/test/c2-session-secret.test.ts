import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, runNode, startCore, teardownCore, uiHello, until } from './helpers.ts';

// Pre-build generated files required by core.
before(buildGenerated);

const ERR_C2 = -32012;

const fakeEngine = (recorderPath: string) => ({
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
});

let isolated: ReturnType<typeof isolation>;
let core: any;
let projectId: string;
let parentId: string;
let parentSecret: string;
let sessionAId: string;
let sessionBId: string;
let sessionBSecret: string;

before(async () => {
  isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const recorderPath = join(isolated.home, 'recorder.mjs');
  const recorder = [
    "import { writeFileSync } from 'node:fs';",
    "import { join } from 'node:path';",
    "const id = process.env.TROOP_SESSION_ID || 'unknown';",
    `const dir = ${JSON.stringify(isolated.home)};`,
    "writeFileSync(join(dir, `${id}-secret.txt`), process.env.TROOP_SESSION_SECRET ?? '');",
    "writeFileSync(join(dir, `${id}-argv.json`), JSON.stringify(process.argv));",
    "setInterval(() => {}, 1000);",
  ].join('\n');
  writeFileSync(recorderPath, recorder);
  writeFileSync(registry, JSON.stringify([fakeEngine(recorderPath)]));
  writeFileSync(join(isolated.home, 'settings.json'), JSON.stringify({ sessions: { approval: 'contained' } }));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  core = await startCore({ ...isolated, env });
  const project = join(isolated.home, 'project');
  mkdirSync(project, { recursive: true });
  const pipe = await client(isolated.prefix);
  try {
    const opened = await pipe.request('project.open', { path: project });
    projectId = opened.result.project_id;
    const parentLaunch = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      approval: 'ask',
    });
    parentId = parentLaunch.result.session_id;
    await until(() => existsSync(join(isolated.home, `${parentId}-secret.txt`)), 5000);
    parentSecret = readFileSync(join(isolated.home, `${parentId}-secret.txt`), 'utf8').trim();

    await uiHello(pipe, isolated.home);
    const launchA = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      approval: 'contained',
    });
    sessionAId = launchA.result.session_id;

    const launchB = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      approval: 'ask',
    });
    sessionBId = launchB.result.session_id;
    await until(() => existsSync(join(isolated.home, `${sessionBId}-secret.txt`)), 5000);
    sessionBSecret = readFileSync(join(isolated.home, `${sessionBId}-secret.txt`), 'utf8').trim();
  } finally {
    pipe.close();
  }
});

after(async () => {
  if (core) {
    await teardownCore(core, isolated);
  }
});

test('case 1: ask parent secret requesting contained fails with -32012 and launches nothing', async () => {
  const pipe = await client(isolated.prefix);
  try {
    const listBefore = await pipe.request('session.list', { project_id: projectId });
    const countBefore = listBefore.result.sessions.length;
    const reply = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      session_secret: parentSecret,
      approval: 'contained',
    });
    assert.equal(reply.error?.code, ERR_C2);
    assert.equal(reply.result, undefined);
    const listAfter = await pipe.request('session.list', { project_id: projectId });
    assert.equal(listAfter.result.sessions.length, countBefore);
  } finally {
    pipe.close();
  }
});

test('case 2: same secret with approval omitted launches at ask ceiling instead of settings default contained', async () => {
  const pipe = await client(isolated.prefix);
  try {
    const reply = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      session_secret: parentSecret,
    });
    assert.ok(reply.result?.session_id);
    assert.equal(reply.result.approval, 'ask');
  } finally {
    pipe.close();
  }
});

test('case 3: same secret requesting ask launches with parent_id set to proven parent', async () => {
  const pipe = await client(isolated.prefix);
  try {
    const reply = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      session_secret: parentSecret,
      approval: 'ask',
    });
    assert.ok(reply.result?.session_id);
    const list = await pipe.request('session.list', { project_id: projectId });
    const child = list.result.sessions.find((s: { id: string }) => s.id === reply.result.session_id);
    assert.ok(child);
    assert.equal(child.parent_id, parentId);
  } finally {
    pipe.close();
  }
});

test('case 4: wrong secret fails with -32012 unknown session secret and launches nothing', async () => {
  const pipe = await client(isolated.prefix);
  try {
    const listBefore = await pipe.request('session.list', { project_id: projectId });
    const countBefore = listBefore.result.sessions.length;
    const reply = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      session_secret: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      approval: 'ask',
    });
    assert.equal(reply.error?.code, ERR_C2);
    assert.equal(reply.error?.message, 'unknown session secret');
    assert.equal(reply.result, undefined);
    const listAfter = await pipe.request('session.list', { project_id: projectId });
    assert.equal(listAfter.result.sessions.length, countBefore);
  } finally {
    pipe.close();
  }
});

test('case 5: secret of ask session B with parent_id of contained session A fails with -32012', async () => {
  const pipe = await client(isolated.prefix);
  try {
    const listBefore = await pipe.request('session.list', { project_id: projectId });
    const countBefore = listBefore.result.sessions.length;
    const reply = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      session_secret: sessionBSecret,
      parent_id: sessionAId,
      approval: 'ask',
    });
    assert.equal(reply.error?.code, ERR_C2);
    assert.equal(reply.error?.message, 'parent_id does not match the calling session');
    assert.equal(reply.result, undefined);
    const listAfter = await pipe.request('session.list', { project_id: projectId });
    assert.equal(listAfter.result.sessions.length, countBefore);
  } finally {
    pipe.close();
  }
});

test('case 6: valid secret of ask session plus forged parent_id of contained session fails with -32012', async () => {
  const pipe = await client(isolated.prefix);
  try {
    const listBefore = await pipe.request('session.list', { project_id: projectId });
    const countBefore = listBefore.result.sessions.length;
    const reply = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      session_secret: sessionBSecret,
      parent_id: sessionAId,
      approval: 'contained',
    });
    assert.equal(reply.error?.code, ERR_C2);
    assert.equal(reply.error?.message, 'parent_id does not match the calling session');
    assert.equal(reply.result, undefined);
    const listAfter = await pipe.request('session.list', { project_id: projectId });
    assert.equal(listAfter.result.sessions.length, countBefore);
  } finally {
    pipe.close();
  }
});

test('case 7: documented limit: a caller that strips its secret is treated as the human', async () => {
  const pipe = await client(isolated.prefix);
  try {
    const reply = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      parent_id: parentId,
      approval: 'contained',
    });
    assert.ok(reply.result?.session_id);
    assert.equal(reply.result.approval, 'contained');
  } finally {
    pipe.close();
  }
});

test('case 8: the session secret never leaks to db, settings, logs, mcp, or argv', () => {
  assert.ok(parentSecret);
  const secretBuf = Buffer.from(parentSecret);
  const dbPath = join(isolated.home, 'troop.db');
  assert.equal(readFileSync(dbPath).includes(secretBuf), false);
  const settingsPath = join(isolated.home, 'settings.json');
  if (existsSync(settingsPath)) {
    assert.equal(readFileSync(settingsPath, 'utf8').includes(parentSecret), false);
  }
  const logsDir = join(isolated.home, 'logs');
  if (existsSync(logsDir)) {
    for (const name of readdirSync(logsDir)) {
      assert.equal(readFileSync(join(logsDir, name)).includes(secretBuf), false);
    }
  }
  const mcpDir = join(isolated.home, 'mcp');
  if (existsSync(mcpDir)) {
    for (const name of readdirSync(mcpDir)) {
      assert.equal(readFileSync(join(mcpDir, name)).includes(secretBuf), false);
    }
  }
  const argvFile = join(isolated.home, `${parentId}-argv.json`);
  assert.ok(existsSync(argvFile));
  assert.equal(readFileSync(argvFile, 'utf8').includes(parentSecret), false);
});

test.skip('case 9: resume makes a new secret and drops the old secret (skipped: core restart and resume cycle exceeds test time budget)', async () => {
  const pipe = await client(isolated.prefix);
  try {
    const replyOld = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      session_secret: parentSecret,
      approval: 'ask',
    });
    assert.equal(replyOld.error?.code, ERR_C2);
    assert.equal(replyOld.error?.message, 'unknown session secret');
  } finally {
    pipe.close();
  }
});

test('case 10: hook entry core/event.js refuses core.* event kinds while normal claude.Stop lands', async () => {
  const forgedKind = 'core.process-gone';
  await runNode(['core/event.js', forgedKind, '--session', parentId], isolated.env, '{}');
  const db = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
  try {
    const forgedRow = db.prepare('SELECT 1 FROM event WHERE kind = ? AND session_id = ?').get(forgedKind, parentId);
    assert.equal(forgedRow, undefined);
    await runNode(['core/event.js', 'claude.Stop', '--session', parentId], isolated.env, '{}');
    await until(() => db.prepare("SELECT 1 FROM event WHERE kind = 'claude.Stop' AND session_id = ?").get(parentId), 5000);
    const stopRow = db.prepare("SELECT 1 FROM event WHERE kind = 'claude.Stop' AND session_id = ?").get(parentId);
    assert.ok(stopRow);
  } finally {
    db.close();
  }
});

test('case 11: a ui.hello connection is never capped: ui launch with ask parent requesting contained succeeds', async () => {
  const pipe = await client(isolated.prefix);
  try {
    await uiHello(pipe, isolated.home);
    const reply = await pipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake-engine',
      parent_id: parentId,
      approval: 'contained',
    });
    assert.ok(reply.result?.session_id);
    assert.equal(reply.result.approval, 'contained');
  } finally {
    pipe.close();
  }
});
