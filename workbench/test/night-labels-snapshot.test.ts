import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshot } from '../src/queries.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');

// Temporary database fixture helper with session_label table.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-night-labels-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  db.exec(`CREATE TABLE IF NOT EXISTS session_label (
    session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    PRIMARY KEY (session_id, name)
  );`);
  db.exec('PRAGMA foreign_keys = ON');
  return { dir, db, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

// Legacy database fixture helper without session_label table.
function legacyFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-night-labels-legacy-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  db.exec('DROP TABLE IF EXISTS session_label');
  db.exec('PRAGMA foreign_keys = ON');
  return { dir, db, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('snapshot sessions carry labels as a real array sorted by name and empty array when none', () => {
  const f = fixture();
  try {
    const now = '2026-11-10T00:00:00Z';
    // Populate project and engine fixtures.
    f.db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/path/p1', 'p1', ?, ?)").run(now, now);
    f.db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1)").run();

    // Insert labeled and unlabeled test sessions.
    const insertSession = f.db.prepare(
      'INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    insertSession.run('s_labeled', 'p1', 'codex', 'pty', 'idle', now, '2026-11-10T00:00:00Z');
    insertSession.run('s_unlabeled', 'p1', 'codex', 'pty', 'idle', now, '2026-11-10T00:01:00Z');

    // Insert labels in unsorted order.
    const insertLabel = f.db.prepare('INSERT INTO session_label (session_id, name) VALUES (?, ?)');
    insertLabel.run('s_labeled', 'zebra');
    insertLabel.run('s_labeled', 'apple');
    insertLabel.run('s_labeled', 'mango');

    // Query snapshot for project.
    const snap = snapshot(f.db, 'p1');
    const rows = JSON.parse(JSON.stringify(snap.sessions));
    const labeled = rows.find((s: { id: string }) => s.id === 's_labeled');
    const unlabeled = rows.find((s: { id: string }) => s.id === 's_unlabeled');

    // Verify sessions carry sorted array of labels.
    assert.equal(Array.isArray(labeled.labels), true);
    assert.deepEqual(labeled.labels, ['apple', 'mango', 'zebra']);

    // Verify session without labels carries empty array.
    assert.equal(Array.isArray(unlabeled.labels), true);
    assert.deepEqual(unlabeled.labels, []);
  } finally {
    f.close();
  }
});

test('snapshot live rows carry labels as a real array sorted by name and empty array when none', () => {
  const f = fixture();
  try {
    const now = '2026-11-10T00:00:00Z';
    // Populate project and engine fixtures.
    f.db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/path/p1', 'p1', ?, ?)").run(now, now);
    f.db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1)").run();

    // Insert live and non-live sessions.
    const insertSession = f.db.prepare(
      'INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertSession.run('s_live_work', 'p1', 'codex', 'pty', 'working', now, '2026-11-10T00:00:00Z', 0);
    insertSession.run('s_live_wait', 'p1', 'codex', 'pty', 'waiting_for_you', now, '2026-11-10T00:01:00Z', 0);
    insertSession.run('s_live_none', 'p1', 'codex', 'pty', 'working', now, '2026-11-10T00:02:00Z', 0);
    insertSession.run('s_idle', 'p1', 'codex', 'pty', 'idle', now, '2026-11-10T00:03:00Z', 0);
    insertSession.run('s_hidden_work', 'p1', 'codex', 'pty', 'working', now, '2026-11-10T00:04:00Z', 1);

    // Insert labels in unsorted order.
    const insertLabel = f.db.prepare('INSERT INTO session_label (session_id, name) VALUES (?, ?)');
    insertLabel.run('s_live_work', 'tag_b');
    insertLabel.run('s_live_work', 'tag_a');
    insertLabel.run('s_live_wait', 'tag_wait');
    insertLabel.run('s_idle', 'tag_idle');
    insertLabel.run('s_hidden_work', 'tag_hidden');

    // Query snapshot for project.
    const snap = snapshot(f.db, 'p1');
    const liveRows = JSON.parse(JSON.stringify(snap.live));
    const liveWork = liveRows.find((s: { id: string }) => s.id === 's_live_work');
    const liveWait = liveRows.find((s: { id: string }) => s.id === 's_live_wait');
    const liveNone = liveRows.find((s: { id: string }) => s.id === 's_live_none');

    // Verify live rows carry sorted array of labels or empty array.
    assert.equal(Array.isArray(liveWork.labels), true);
    assert.deepEqual(liveWork.labels, ['tag_a', 'tag_b']);
    assert.equal(Array.isArray(liveWait.labels), true);
    assert.deepEqual(liveWait.labels, ['tag_wait']);
    assert.equal(Array.isArray(liveNone.labels), true);
    assert.deepEqual(liveNone.labels, []);

    // Verify idle and hidden sessions are omitted from live list.
    assert.equal(liveRows.some((s: { id: string }) => s.id === 's_idle'), false);
    assert.equal(liveRows.some((s: { id: string }) => s.id === 's_hidden_work'), false);
  } finally {
    f.close();
  }
});

test('older database without session_label table returns empty label arrays without throwing', () => {
  const f = legacyFixture();
  try {
    const now = '2026-11-10T00:00:00Z';
    // Verify session_label table is absent from schema.
    const tableExists = f.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'session_label'").get();
    assert.equal(tableExists, undefined);

    // Populate project and engine fixtures.
    f.db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/path/p1', 'p1', ?, ?)").run(now, now);
    f.db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1)").run();

    // Insert legacy sessions into database.
    const insertSession = f.db.prepare(
      'INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    insertSession.run('s_leg_live', 'p1', 'codex', 'pty', 'working', now, '2026-11-10T00:00:00Z');
    insertSession.run('s_leg_idle', 'p1', 'codex', 'pty', 'idle', now, '2026-11-10T00:01:00Z');

    // Verify snapshot completes without throwing on legacy database.
    let snap: ReturnType<typeof snapshot> | undefined;
    assert.doesNotThrow(() => {
      snap = snapshot(f.db, 'p1');
    });

    const sessions = JSON.parse(JSON.stringify(snap!.sessions));
    const live = JSON.parse(JSON.stringify(snap!.live));

    // Verify legacy database sessions rows carry empty label arrays.
    assert.equal(sessions.length, 2);
    for (const s of sessions) {
      assert.equal(Array.isArray(s.labels), true);
      assert.deepEqual(s.labels, []);
    }

    // Verify legacy database live rows carry empty label arrays.
    const liveSession = live.find((s: { id: string }) => s.id === 's_leg_live');
    assert.ok(liveSession);
    assert.equal(Array.isArray(liveSession.labels), true);
    assert.deepEqual(liveSession.labels, []);
  } finally {
    f.close();
  }
});
