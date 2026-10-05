import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, startCore, teardownCore, until } from './helpers.ts';

function db(home: string) {
  const connection = new DatabaseSync(join(home, 'troop.db'));
  connection.exec('PRAGMA busy_timeout = 2000');
  return connection;
}

async function harness() {
  await buildGenerated();
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{
    id: 'fake', command: process.execPath, args: [join(root, 'core/test/fake-engine.js')],
    prompt_arg: 'positional', state_source: 'hooks', roles: ['worker', 'verify', 'publish'],
    cost_rank: 1, usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'],
  }]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  const pipe = await client(isolated.prefix);
  const project = join(isolated.home, 'project');
  mkdirSync(project, { recursive: true });
  try {
    const opened = await pipe.request('project.open', { path: project });
    assert.ok(opened.result?.project_id);
    const pipelineId = 'cancel-fixture';
    mkdirSync(join(project, '.troop', 'pipelines'), { recursive: true });
    writeFileSync(join(project, '.troop', 'pipelines', `${pipelineId}.json`), JSON.stringify({
      schema: 1, id: pipelineId, title: 'Cancel fixture',
      steps: [{ id: 'agent', kind: 'agent', role: 'worker', engine: 'fake', prompt: 'FAKE {"delay_ms":120000}' }],
    }));
    return {
      ...isolated, core, pipe, projectId: opened.result.project_id as string, pipelineId,
      async close() { pipe.close(); await teardownCore(core, isolated); },
    };
  } catch (error) {
    pipe.close();
    await teardownCore(core, isolated);
    throw error;
  }
}

async function startRun(h: Awaited<ReturnType<typeof harness>>) {
  const started = await h.pipe.request('run.start', { pipeline_id: h.pipelineId, project_id: h.projectId }, { timeout: 5000 });
  assert.ok(started.result?.run_id);
  return started.result.run_id as string;
}

async function cancel(h: Awaited<ReturnType<typeof harness>>, runId: string) {
  await h.pipe.request('run.cancel', { run_id: runId }, { timeout: 5000 });
}

test('run.cancel stops the running agent session and marks the run cancelled', async () => {
  const h = await harness();
  const store = db(h.home);
  try {
    const runId = await startRun(h);
    const session = await until(() => store.prepare("SELECT id FROM session WHERE run_id = ? AND step_id = 'agent'").get(runId) as { id: string } | undefined, 10000);
    await cancel(h, runId);
    await until(() => store.prepare('SELECT status FROM run WHERE id = ?').get(runId)?.status === 'cancelled', 5000);
    await until(() => store.prepare('SELECT state FROM session WHERE id = ?').get(session.id)?.state === 'exited', 10000);
    assert.equal(store.prepare('SELECT status FROM run WHERE id = ?').get(runId)?.status, 'cancelled');
    assert.equal(store.prepare('SELECT state FROM session WHERE id = ?').get(session.id)?.state, 'exited');
  } finally { store.close(); await h.close(); }
});

test('run.cancel leaves a user launched session alive', async () => {
  const h = await harness();
  const store = db(h.home);
  try {
    const launched = await h.pipe.request('session.launch', { project_id: h.projectId, engine_id: 'fake', prompt: 'user session' }, { timeout: 5000 });
    assert.ok(launched.result?.session_id);
    const sessionId = launched.result.session_id as string;
    const runId = await startRun(h);
    await until(() => store.prepare("SELECT id FROM session WHERE run_id = ? AND step_id = 'agent'").get(runId), 10000);
    await cancel(h, runId);
    await until(() => store.prepare('SELECT status FROM run WHERE id = ?').get(runId)?.status === 'cancelled', 5000);
    assert.equal(store.prepare('SELECT run_id FROM session WHERE id = ?').get(sessionId)?.run_id, null);
    assert.notEqual(store.prepare('SELECT state FROM session WHERE id = ?').get(sessionId)?.state, 'exited');
  } finally { store.close(); await h.close(); }
});

test('run.cancel rejects a waiting gate with the run cancelled note', async () => {
  const h = await harness();
  const store = db(h.home);
  try {
    const gatePipelineId = 'cancel-gate-fixture';
    // Add a gate fixture in the same opened project.
    const project = store.prepare('SELECT path FROM project WHERE id = ?').get(h.projectId) as { path: string };
    writeFileSync(join(project.path, '.troop', 'pipelines', `${gatePipelineId}.json`), JSON.stringify({
      schema: 1, id: gatePipelineId, title: 'Cancel gate fixture', steps: [{ id: 'approve', kind: 'gate', gate: 'approve' }],
    }));
    const started = await h.pipe.request('run.start', { pipeline_id: gatePipelineId, project_id: h.projectId }, { timeout: 5000 });
    assert.ok(started.result?.run_id);
    const runId = started.result.run_id as string;
    const gate = await until(() => store.prepare("SELECT id FROM gate WHERE run_id = ? AND status = 'waiting'").get(runId) as { id: string } | undefined, 10000);
    await cancel(h, runId);
    const rejected = await until(() => store.prepare('SELECT status, note FROM gate WHERE id = ?').get(gate.id) as { status: string; note: string | null } | undefined, 5000);
    assert.equal(rejected.status, 'rejected');
    assert.equal(rejected.note, 'run cancelled');
  } finally { store.close(); await h.close(); }
});
