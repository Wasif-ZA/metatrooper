import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { buildGenerated } from './helpers.ts';

before(buildGenerated);

// Sets up an isolated test core database with registered engines.
async function memoryDb() {
  const home = mkdtempSync(join(os.tmpdir(), 'troop-m605-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  Object.assign(process.env, { HOME: home, USERPROFILE: home, METATROOPER_HOME: join(home, 'mt') });
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { appendEvent } = await import('../src/events/append.ts');
  const { processEvents } = await import('../src/events/processor.ts');
  const db = openCoreDb();
  syncEngines(db, BUILT_IN);
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s', 'p', 'claude', 'pty', 'starting', 'x', ?)").run(new Date().toISOString());
  const state = () => (db.prepare("SELECT state FROM session WHERE id = 's'").get() as { state: string }).state;
  const send = (kind: string, payload: Record<string, unknown> = {}) => {
    appendEvent(kind, 's', { session_id: 'conv', cwd: home, ...payload }, db);
    processEvents(db);
    return state();
  };
  const done = () => {
    db.close();
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  };
  return { home, db, send, state, done };
}

test('core.activity quiet does not move codex to done, codex.turn moves codex to done, and agy goes done on quiet', async () => {
  const t = await memoryDb();
  try {
    // Tests Codex session behavior with core.activity quiet and codex.turn.
    t.db.prepare("UPDATE session SET engine_id = 'codex', native_id = 'conv', state = 'working' WHERE id = 's'").run();
    assert.equal(t.send('core.activity', { state: 'quiet' }), 'working');
    assert.equal(t.send('codex.turn', { 'thread-id': 'conv' }), 'done');

    // Tests agy session behavior with core.activity quiet.
    t.db.prepare("UPDATE session SET engine_id = 'agy', native_id = 'conv', state = 'working' WHERE id = 's'").run();
    assert.equal(t.send('core.activity', { state: 'quiet' }), 'done');
  } finally {
    t.done();
  }
});
