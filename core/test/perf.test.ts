import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const env = { ...isolated.env, METATROOPER_ENGINES: registry, TROOP_LAUNCHER: 'spawn' };
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
    db.close();
    assert.ok(p95(readMs) < 1, `read p95 ${p95(readMs).toFixed(3)} ms`);
  } finally { pipe.close(); await teardownCore(core, isolated); }
});
