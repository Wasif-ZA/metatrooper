import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { anyOpenSession, snapshot } from '../src/queries.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');

test('FIX-W1: an open agent in another project counts as busy', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-w1-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  try {
    db.exec(schema);
    const now = new Date().toISOString();
    for (const [id, n] of [['pa', '/a'], ['pb', '/b']]) {
      db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run(id, n, id, now, now);
    }
    db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 3)").run();
    const add = (id: string, p: string, state: string) =>
      db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden) VALUES (?, ?, 'claude', 'pty', ?, ?, ?, 0)").run(id, p, state, now, now);
    assert.equal(anyOpenSession(db), false);
    add('s1', 'pa', 'exited');
    add('s2', 'pb', 'working');
    assert.equal(snapshot(db, 'pa').sessions.some((x) => x.state !== 'exited'), false);
    assert.equal(anyOpenSession(db), true);
    db.prepare("UPDATE session SET state = 'exited' WHERE id = 's2'").run();
    assert.equal(anyOpenSession(db), false);
    add('s3', 'pb', 'waiting_for_you');
    assert.equal(anyOpenSession(db), true);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
