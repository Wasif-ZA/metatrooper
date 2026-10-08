import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, startCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

function db(home: string) {
  const connection = new DatabaseSync(join(home, 'troop.db'));
  connection.exec('PRAGMA busy_timeout = 2000');
  return connection;
}

test('M4-07 F4 session launch uses the latest engine check across the Sydney DST fall-back hour', async () => {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{
    id: 'fake', command: process.execPath, args: [join(root, 'core/test/fake-engine.js')], prompt_arg: 'positional',
    state_source: 'hooks', roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
    version_cmd: [process.execPath, '--version'],
  }]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  const store = db(isolated.home);
  try {
    const project = join(isolated.home, 'dst-order');
    mkdirSync(project, { recursive: true });
    const pipe = await client(isolated.prefix);
    try {
      const opened = await pipe.request('project.open', { path: project });
      assert.ok(opened.result?.project_id, JSON.stringify(opened));
      await until(() => store.prepare("SELECT 1 FROM engine WHERE id = 'fake'").get());
      store.prepare('DELETE FROM engine_check WHERE engine_id = ?').run('fake');
      store.prepare('INSERT INTO engine_check (engine_id, checked_at, installed, version, auth, detail) VALUES (?, ?, ?, ?, ?, ?)')
        .run('fake', '2030-04-07T02:30:00.000+11:00', 1, 'old', 'ok', null);
      store.prepare('INSERT INTO engine_check (engine_id, checked_at, installed, version, auth, detail) VALUES (?, ?, ?, ?, ?, ?)')
        .run('fake', '2030-04-07T02:10:00.000+10:00', 0, null, 'missing', null);
      const launched = await pipe.request('session.launch', {
        project_id: opened.result.project_id,
        engine_id: 'fake',
        prompt: 'should not launch',
      });
      assert.equal(launched.error?.code, -32020, JSON.stringify(launched));
      assert.match(launched.error?.message ?? '', /fake is not installed/);
    } finally { pipe.close(); }
  } finally {
    store.close();
    await teardownCore(core, isolated);
  }
});
