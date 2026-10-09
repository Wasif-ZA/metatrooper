import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, startCore, teardownCore } from './helpers.ts';

test('run.clear hides finished runs and leaves running and paused ones', async () => {
  await buildGenerated();
  const isolated = isolation();
  const core = await startCore(isolated);
  const pipe = await client(isolated.prefix);
  try {
    const ids: string[] = [];
    for (const name of ['a', 'b']) {
      const dir = join(isolated.home, name);
      mkdirSync(dir, { recursive: true });
      ids.push((await pipe.request('project.open', { path: dir })).result.project_id);
    }
    const db = new DatabaseSync(join(isolated.home, 'troop.db'));
    db.exec('PRAGMA busy_timeout = 2000; PRAGMA foreign_keys = OFF');
    const add = db.prepare(`INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at)
      VALUES (?, 'p', ?, '{}', '', ?, 'cli', 1, 1, 1, '2026-10-09T00:00:00Z')`);
    for (const [id, project, status] of [['a1', ids[0], 'done'], ['a2', ids[0], 'failed'], ['a3', ids[0], 'running'], ['a4', ids[0], 'paused'], ['b1', ids[1], 'cancelled']]) add.run(id, project, status);
    const hidden = () => (db.prepare('SELECT id FROM run WHERE hidden = 1 ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id);

    assert.equal((await pipe.request('run.clear', { project_id: ids[0] })).result.cleared, 2);
    assert.deepEqual(hidden(), ['a1', 'a2']);
    assert.equal((await pipe.request('run.clear', {})).result.cleared, 1);
    assert.deepEqual(hidden(), ['a1', 'a2', 'b1']);
    db.close();
  } finally {
    pipe.close();
    await teardownCore(core, isolated);
  }
});
