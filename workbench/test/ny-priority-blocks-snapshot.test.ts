import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshot } from '../src/queries.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');
const legacySchema = schema.replace(/,\n\s*priority[^\n]*/, '').replace(/CREATE TABLE session_block \([\s\S]*?\n\);\nCREATE INDEX session_block_blocker[^\n]*\n/, '');

function fixture(sql: string) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-ny-blocks-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(sql);
  const now = '2026-11-11T00:00:00Z';
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/path/p1', 'p1', ?, ?)").run(now, now);
  db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1)").run();
  const insert = db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p1', 'codex', 'pty', ?, ?, ?)");
  insert.run('a', 'working', now, '2026-11-11T00:00:00Z');
  insert.run('b', 'idle', now, '2026-11-11T00:01:00Z');
  insert.run('x', 'waiting_for_you', now, '2026-11-11T00:02:00Z');
  return { db, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const byId = <T extends { id: string }>(rows: T[], id: string) => rows.find((r) => r.id === id)!;

test('snapshot sessions and live rows carry priority, blocked_by and blocking', () => {
  const f = fixture(schema);
  try {
    f.db.prepare("UPDATE session SET priority = 'urgent' WHERE id = 'x'").run();
    const block = f.db.prepare('INSERT INTO session_block (blocked_id, blocker_id) VALUES (?, ?)');
    block.run('x', 'b');
    block.run('x', 'a');
    block.run('b', 'a');
    const snap = snapshot(f.db, 'p1');
    assert.deepEqual(['a', 'b', 'x'].map((id) => { const s = byId(snap.sessions, id); return [s.priority, s.blocked_by, s.blocking]; }), [
      ['none', [], ['b', 'x']],
      ['none', ['a'], ['x']],
      ['urgent', ['a', 'b'], []],
    ]);
    const live = byId(snap.live, 'x');
    assert.equal(live.priority, 'urgent');
    assert.deepEqual(live.blocked_by, ['a', 'b']);
    assert.deepEqual(byId(snap.live, 'a').blocking, ['b', 'x']);
  } finally { f.close(); }
});

test('an older database without priority or session_block gives none and empty arrays', () => {
  const f = fixture(legacySchema);
  try {
    assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'session_block'").get(), undefined);
    const snap = snapshot(f.db, 'p1');
    for (const s of [...snap.sessions, ...snap.live]) {
      assert.equal(s.priority, 'none');
      assert.deepEqual(s.blocked_by, []);
      assert.deepEqual(s.blocking, []);
    }
    assert.equal(snap.sessions.length, 3);
    assert.equal(snap.live.length, 2);
  } finally { f.close(); }
});
