import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { client, isolation, runNode, startCore, teardownCore } from './helpers.ts';

test('troop wait longer than 30 s gets the core\'s reply, not \'core offline\'', async () => {
  const h = isolation();
  delete h.env.TROOP_SESSION_ID;
  let core: Awaited<ReturnType<typeof startCore>> | undefined;
  let db: DatabaseSync | undefined;
  let timer: NodeJS.Timeout | undefined;
  try {
    const registry = join(h.home, 'engines.json');
    writeFileSync(registry, JSON.stringify([{
      id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks',
      roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
      version_cmd: [process.execPath, '--version'],
    }]));
    h.env.METATROOPER_ENGINES = registry;
    core = await startCore(h);
    const pipe = await client(h.prefix);
    const dir = join(h.home, 'project');
    mkdirSync(dir);
    const opened = await pipe.request('project.open', { path: dir });
    pipe.close();
    assert.ok(opened.result?.project_id, JSON.stringify(opened));
    db = new DatabaseSync(join(h.home, 'troop.db'));
    db.exec('PRAGMA busy_timeout = 5000');
    const id = 'ses_' + randomUUID();
    const at = new Date().toISOString();
    db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, opened.result.project_id, 'fake', 'external', 'working', at, at);
    // The core's wait polls the row every 200 ms, so a write from here ends it.
    timer = setTimeout(() => db!.prepare("UPDATE session SET state = 'done' WHERE id = ?").run(id), 35_000);
    const started = performance.now();
    const result = await runNode(['core/cli.ts', 'wait', id, '--timeout', '60', '--json'], h.env) as { code: number; stdout: string; stderr: string };
    assert.ok(performance.now() - started >= 34_000, 'early: ' + result.stdout + result.stderr);
    assert.ok(!/core offline/.test(result.stdout + result.stderr), result.stdout + result.stderr);
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.equal(JSON.parse(result.stdout).state, 'done');
  } finally {
    clearTimeout(timer);
    db?.close();
    if (core) await teardownCore(core, h);
    else rmSync(h.home, { recursive: true, force: true });
  }
});
