import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, startCore, teardownCore } from './helpers.ts';

before(buildGenerated);

function p95(samples: number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)];
}

test('M1-06 window reads p95 < 1 ms and pipe commands p95 < 20 ms with 3 live sessions', async () => {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{
    id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks',
    roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
    version_cmd: [process.execPath, '--version']
  }]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  const pipe = await client(isolated.prefix);
  try {
    const project = join(isolated.home, 'perf-project');
    mkdirSync(project, { recursive: true });
    const opened = await pipe.request('project.open', { path: project });
    for (let i = 0; i < 3; i++) {
      const launched = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id: 'fake', prompt: join(root, 'core/test/fake-engine.js') });
      assert.ok(launched.result?.session_id, JSON.stringify(launched));
    }
    // a running pipeline: a code step that keeps the run in 'running' while we measure
    const pdir = join(project, '.troop', 'pipelines');
    mkdirSync(pdir, { recursive: true });
    writeFileSync(join(pdir, 'slow.mjs'), 'export async function run() { await new Promise((r) => setTimeout(r, 15000)); return {}; }\n');
    writeFileSync(join(pdir, 'perf-pipe.json'), JSON.stringify({ schema: 1, id: 'perf-pipe', title: 'Perf', steps: [{ id: 'slow', kind: 'code', code: 'slow.mjs' }] }));
    const started = await pipe.request('run.start', { pipeline_id: 'perf-pipe', project_id: opened.result.project_id }, { timeout: 5000 });
    assert.ok(started.result?.run_id, JSON.stringify(started));
    const runDb = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
    const t0 = Date.now();
    while (runDb.prepare('SELECT status FROM run WHERE id = ?').get(started.result.run_id)?.status !== 'running') {
      assert.ok(Date.now() - t0 < 5000, 'run never started');
      await new Promise((res) => setTimeout(res, 20));
    }
    runDb.close();
    // pipe commands
    const pipeMs: number[] = [];
    for (let i = 0; i < 100; i++) {
      const t = performance.now();
      const r = await pipe.request('core.ping');
      pipeMs.push(performance.now() - t);
      assert.equal(r.result?.ok, true);
    }
    assert.ok(p95(pipeMs) < 20, `pipe p95 ${p95(pipeMs).toFixed(2)} ms`);
    // window reads: read-only handle, the query the workbench polls
    const db = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
    const stmt = db.prepare("SELECT * FROM session WHERE state != 'exited'");
    stmt.all(); // warm
    const readMs: number[] = [];
    for (let i = 0; i < 500; i++) {
      const t = performance.now();
      const rows = stmt.all();
      readMs.push(performance.now() - t);
      assert.ok(rows.length >= 3);
    }
    // hook event: time from the event writer exiting to the session row changing (what the UI polls)
    const sid = db.prepare("SELECT id FROM session WHERE state != 'exited' LIMIT 1").get().id;
    const hookMs: number[] = [];
    for (let i = 0; i < 5; i++) {
      const kind = i % 2 === 0 ? 'PostToolUse' : 'Stop';
      const want = i % 2 === 0 ? 'working' : 'done';
      const r = spawnSync(process.execPath, ['core/event.js', `claude.${kind}`], { cwd: root, env: { ...env, TROOP_SESSION_ID: sid }, input: JSON.stringify({ session_id: 'n1', cwd: isolated.home, tool_name: 'Read', tool_input: { file_path: '/x' } }) });
      assert.equal(r.status, 0);
      const t = performance.now();
      while (db.prepare('SELECT state FROM session WHERE id = ?').get(sid).state !== want) {
        assert.ok(performance.now() - t < 2000, 'state never changed');
        await new Promise((res) => setTimeout(res, 1));
      }
      hookMs.push(performance.now() - t);
    }
    assert.ok(Math.max(...hookMs) < 100, `hook->row max ${Math.max(...hookMs).toFixed(1)} ms`);
    db.close();
    const runCheck = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
    assert.equal(runCheck.prepare('SELECT status FROM run WHERE id = ?').get(started.result.run_id).status, 'running', 'pipeline should still be running during measurements');
    runCheck.close();
    assert.ok(p95(readMs) < 1, `read p95 ${p95(readMs).toFixed(3)} ms`);
  } finally { pipe.close(); await teardownCore(core, isolated); }
});
