import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshot } from '../src/queries.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');

// Creates a temporary database initialized with the project schema.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-w6-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  db.exec('PRAGMA foreign_keys = ON');
  return { dir, db, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const iso = (ms: number) => new Date(ms).toISOString();

test('snapshot includes running sessions older than newest 50 sessions and caps exited sessions at 50 without duplicates', () => {
  const f = fixture();
  try {
    const d = f.db;
    const now = Date.now();
    const projectId = 'p1';
    d.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run(projectId, '/proj', 'proj', iso(now), iso(now));
    d.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('claude', '{}', 1)").run();

    // Seeds 60 sessions: s0 exited (oldest), s1 working, and s2 through s59 exited.
    const totalCount = 60;
    const workingId = 's1';
    const olderExitedId = 's0';

    for (let i = 0; i < totalCount; i++) {
      const id = `s${i}`;
      const state = id === workingId ? 'working' : 'exited';
      const startedAt = iso(now - (totalCount - i) * 1000);
      d.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden) VALUES (?, ?, 'claude', 'pty', ?, ?, ?, 0)").run(id, projectId, state, startedAt, startedAt);
    }

    const snap = snapshot(d, projectId, now);
    const sessionIds = snap.sessions.map((s) => s.id);
    const exitedSessions = snap.sessions.filter((s) => s.state === 'exited');

    // Asserts no duplicates in snapshot results.
    assert.equal(new Set(sessionIds).size, sessionIds.length);

    // Asserts working session older than newest 50 is included.
    assert.ok(sessionIds.includes(workingId));
    assert.ok(snap.sessions.some((s) => s.id === workingId && s.state === 'working'));

    // Asserts oldest exited session is excluded while exited sessions are capped at 50.
    assert.ok(!sessionIds.includes(olderExitedId));
    assert.equal(exitedSessions.length, Math.min(totalCount - 1, 50));
    assert.equal(snap.sessions.length, exitedSessions.length + 1);
  } finally {
    f.close();
  }
});
