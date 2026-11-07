import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { BUILT_IN, type EngineSpec } from '../src/engines/registry.ts';
import { RpcError } from '../src/pipe/errors.ts';
import { planArgs } from '../src/sessions/launch.ts';
import { client, isolation, pipePath, root, runNode, startCore, teardownCore } from './helpers.ts';

const cli = join(root, 'core', 'cli.ts');
const noModel: EngineSpec = {
  id: 'no-model', command: process.execPath, version_cmd: [process.execPath, '--version'],
  state_source: 'process', roles: ['worker'], cost_rank: 1,
};
const modelFlags = { claude: '--model', codex: '-m', agy: '--model' };

for (const [id, flag] of Object.entries(modelFlags)) {
  test('planArgs puts the model flag and name after the command for ' + id, () => {
    const engine = BUILT_IN.find((e) => e.id === id);
    assert.ok(engine, 'missing built-in ' + id);
    const { argv } = planArgs(engine, 'test prompt', 'ask', [], 'pty', 'test-model');
    assert.equal(argv[0], engine.command);
    const index = argv.indexOf(flag);
    assert.ok(index > 0, JSON.stringify(argv));
    assert.deepEqual(argv.slice(index, index + 2), [flag, 'test-model']);
    assert.equal(argv.filter((arg) => arg === flag).length, 1);
  });

  test('planArgs adds no model flag when no model is supplied for ' + id, () => {
    const engine = BUILT_IN.find((e) => e.id === id);
    assert.ok(engine, 'missing built-in ' + id);
    const { argv } = planArgs(engine, 'test prompt');
    assert.equal(argv[0], engine.command);
    assert.ok(!argv.includes('--model'), JSON.stringify(argv));
    assert.ok(!argv.includes('-m'), JSON.stringify(argv));
  });
}

test('planArgs rejects a model for an engine without model_arg with RpcError', () => {
  assert.throws(() => planArgs(noModel, undefined, 'ask', [], 'pty', 'test-model'), (error) => {
    assert.ok(error instanceof RpcError);
    assert.match(error.message, /does not take a model argument/);
    return true;
  });
});

test('BUILT_IN contains exactly claude, codex and agy', () => {
  assert.deepEqual(BUILT_IN.map((e) => e.id).sort(), ['agy', 'claude', 'codex']);
});

test('only claude, codex and agy built-ins declare their specified model_arg', () => {
  for (const [id, flag] of Object.entries(modelFlags)) {
    assert.equal(BUILT_IN.find((e) => e.id === id)?.model_arg, flag, id);
  }
  for (const engine of BUILT_IN) {
    if (!Object.hasOwn(modelFlags, engine.id)) assert.equal(engine.model_arg, undefined, engine.id);
  }
});

// Record the CLI's RPC boundary without opening a real worktree or terminal.
async function recordingCli(engines: EngineSpec[] = [noModel]) {
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify(engines));
  const env = { ...iso.env, METATROOPER_ENGINES: registry, TROOP_SESSION_ID: "" };
  const requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (let index; (index = buffer.indexOf('\n')) >= 0;) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        const request = JSON.parse(line);
        requests.push({ method: request.method, params: request.params });
        const result = request.method === 'project.open'
          ? { project_id: 'recorded-project' }
          : request.method === 'session.launch'
            ? { session_id: 'recorded-session', approval: 'ask' }
            : undefined;
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: request.id,
          ...(result ? { result } : { error: { code: -32601, message: 'unexpected RPC' } }),
        }) + '\n');
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(pipePath(iso.prefix), resolve);
    });
  } catch (error) {
    rmSync(iso.home, { recursive: true, force: true });
    throw error;
  }
  return { ...iso, env, requests, async teardown() {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    rmSync(iso.home, { recursive: true, force: true });
  } };
}

test('troop launch rejects --model on an unsupported engine before opening a worktree or window', async () => {
  const h = await recordingCli();
  try {
    const r = await runNode([cli, 'launch', noModel.id, '--project', h.home, '--worktree', 'model-rejected', '--model', 'test-model'], h.env);
    assert.equal(r.code, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /does not take a model argument/);
    assert.deepEqual(h.requests, [], 'validation must precede all project, worktree and session RPCs');
    assert.equal(existsSync(join(h.home, 'troop.db')), false, 'no offline command was queued');
  } finally { await h.teardown(); }
});

for (const flag of [[], ['--model', 'flag-model']]) {
  test('troop launch --jobs rejects an unsupported job model before launching' + (flag.length ? ' with a CLI model too' : ''), async () => {
    const h = await recordingCli();
    try {
      const jobs = join(h.home, 'jobs.json');
      writeFileSync(jobs, JSON.stringify([{ engine: noModel.id, model: 'job-model', worktree: 'job-rejected' }]));
      const r = await runNode([cli, 'launch', '--jobs', jobs, '--project', h.home, ...flag], h.env);
      assert.equal(r.code, 2, r.stdout + r.stderr);
      assert.match(r.stderr, /does not take a model argument/);
      assert.doesNotMatch(r.stderr, /bad jobs file/);
      assert.deepEqual(h.requests, [], 'no job may open a project, worktree or session');
      assert.equal(existsSync(join(h.home, 'troop.db')), false);
    } finally { await h.teardown(); }
  });
}

test('a jobs entry model wins over --model, and an entry without one inherits --model', async () => {
  const engine = { ...noModel, id: 'with-model', model_arg: '--model' };
  const h = await recordingCli([engine]);
  try {
    const jobs = join(h.home, 'jobs.json');
    writeFileSync(jobs, JSON.stringify([
      { engine: engine.id, model: 'job-model' },
      { engine: engine.id },
    ]));
    const r = await runNode([cli, 'launch', '--jobs', jobs, '--project', h.home, '--model', 'flag-model'], h.env);
    assert.equal(r.code, 0, r.stdout + r.stderr);
    assert.deepEqual(h.requests.map((r) => r.method), ['project.open', 'session.launch', 'project.open', 'session.launch']);
    assert.deepEqual(h.requests.filter((r) => r.method === 'session.launch').map((r) => r.params), [
      { project_id: 'recorded-project', engine_id: engine.id, model: 'job-model' },
      { project_id: 'recorded-project', engine_id: engine.id, model: 'flag-model' },
    ]);
  } finally { await h.teardown(); }
});

test('session.launch rejects an unsupported model with validation error -32003 before creating a session row', async () => {
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([noModel]));
  const env = { ...iso.env, METATROOPER_ENGINES: registry };
  let core;
  try {
    core = await startCore({ ...iso, env });
    const project = join(iso.home, 'model-project');
    mkdirSync(project);
    const pipe = await client(iso.prefix);
    try {
      const opened = await pipe.request('project.open', { path: project });
      assert.ok(opened.result?.project_id, JSON.stringify(opened));
      const db = new DatabaseSync(join(iso.home, 'troop.db'), { readOnly: true });
      try {
        const before = db.prepare('SELECT * FROM session').all();
        assert.deepEqual(before, []);
        const reply = await pipe.request('session.launch', {
          project_id: opened.result.project_id, engine_id: noModel.id, model: 'test-model',
        });
        assert.deepEqual(db.prepare('SELECT * FROM session').all(), before, 'rejected launch must not insert a session');
        assert.equal(reply.result, undefined, JSON.stringify(reply));
        assert.match(reply.error?.message ?? '', /does not take a model argument/);
        assert.equal(reply.error?.code, -32003, JSON.stringify(reply));
      } finally { db.close(); }
    } finally { pipe.close(); }
  } finally {
    if (core) await teardownCore(core, iso);
    else rmSync(iso.home, { recursive: true, force: true });
  }
});
