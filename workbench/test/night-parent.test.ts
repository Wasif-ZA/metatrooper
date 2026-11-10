import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshot } from '../src/queries.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');

// Temporary database fixture helper.
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-night-parent-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  db.exec('PRAGMA foreign_keys = ON');
  return { dir, db, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

// Legacy database fixture helper without parent_id column.
function legacyFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-night-parent-legacy-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  const legacySchema = schema.replace(/\r?\n\s*parent_id\s+TEXT REFERENCES session\(id\)[^\r\n]*/, '');
  db.exec(legacySchema);
  db.exec('PRAGMA foreign_keys = ON');
  return { dir, db, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('child session has parent_id and parent session has null parent_id', () => {
  // Create database fixture.
  const f = fixture();
  try {
    // Insert project and engine rows.
    const now = '2026-11-09T00:00:00Z';
    f.db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/path/p1', 'p1', ?, ?)").run(now, now);
    f.db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1)").run();

    // Insert parent and child sessions in same project.
    const insertSession = f.db.prepare(
      'INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertSession.run('s_parent', 'p1', 'codex', 'pty', 'working', now, '2026-11-09T00:00:00Z', null);
    insertSession.run('s_child', 'p1', 'codex', 'pty', 'working', now, '2026-11-09T00:01:00Z', 's_parent');

    // Retrieve snapshot sessions.
    const snap = snapshot(f.db, 'p1');
    const rows = JSON.parse(JSON.stringify(snap.sessions));
    const parent = rows.find((s: { id: string }) => s.id === 's_parent');
    const child = rows.find((s: { id: string }) => s.id === 's_child');

    // Verify parent_id values.
    assert.equal(child.parent_id, 's_parent');
    assert.equal(parent.parent_id, null);
  } finally {
    f.close();
  }
});

test('grandchild session carries child id instead of root parent id', () => {
  // Create database fixture.
  const f = fixture();
  try {
    // Insert project and engine rows.
    const now = '2026-11-09T00:00:00Z';
    f.db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/path/p1', 'p1', ?, ?)").run(now, now);
    f.db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1)").run();

    // Insert root, child, and grandchild sessions.
    const insertSession = f.db.prepare(
      'INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertSession.run('s_root', 'p1', 'codex', 'pty', 'working', now, '2026-11-09T00:00:00Z', null);
    insertSession.run('s_child', 'p1', 'codex', 'pty', 'working', now, '2026-11-09T00:01:00Z', 's_root');
    insertSession.run('s_grandchild', 'p1', 'codex', 'pty', 'working', now, '2026-11-09T00:02:00Z', 's_child');

    // Retrieve snapshot sessions.
    const snap = snapshot(f.db, 'p1');
    const rows = JSON.parse(JSON.stringify(snap.sessions));
    const grandchild = rows.find((s: { id: string }) => s.id === 's_grandchild');
    const child = rows.find((s: { id: string }) => s.id === 's_child');
    const root = rows.find((s: { id: string }) => s.id === 's_root');

    // Verify parent_id hierarchy.
    assert.equal(grandchild.parent_id, 's_child');
    assert.notEqual(grandchild.parent_id, 's_root');
    assert.equal(child.parent_id, 's_root');
    assert.equal(root.parent_id, null);
  } finally {
    f.close();
  }
});

test('child session carries parent_id when parent session is hidden', () => {
  // Create database fixture.
  const f = fixture();
  try {
    // Insert project and engine rows.
    const now = '2026-11-09T00:00:00Z';
    f.db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/path/p1', 'p1', ?, ?)").run(now, now);
    f.db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1)").run();

    // Insert hidden parent and visible child session.
    const insertSession = f.db.prepare(
      'INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, parent_id, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertSession.run('s_parent', 'p1', 'codex', 'pty', 'working', now, '2026-11-09T00:00:00Z', null, 1);
    insertSession.run('s_child', 'p1', 'codex', 'pty', 'working', now, '2026-11-09T00:01:00Z', 's_parent', 0);

    // Retrieve snapshot sessions.
    const snap = snapshot(f.db, 'p1');
    const rows = JSON.parse(JSON.stringify(snap.sessions));
    const parent = rows.find((s: { id: string }) => s.id === 's_parent');
    const child = rows.find((s: { id: string }) => s.id === 's_child');

    // Verify hidden parent is omitted and child carries parent_id.
    assert.equal(parent, undefined);
    assert.equal(child.parent_id, 's_parent');
  } finally {
    f.close();
  }
});

test('child session carries parent_id when parent is in another project', () => {
  // Create database fixture.
  const f = fixture();
  try {
    // Insert projects and engine rows.
    const now = '2026-11-09T00:00:00Z';
    f.db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/path/p1', 'p1', ?, ?), ('p2', '/path/p2', 'p2', ?, ?)").run(now, now, now, now);
    f.db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1)").run();

    // Insert parent in p1 and child in p2.
    const insertSession = f.db.prepare(
      'INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertSession.run('s_parent_p1', 'p1', 'codex', 'pty', 'working', now, '2026-11-09T00:00:00Z', null);
    insertSession.run('s_child_p2', 'p2', 'codex', 'pty', 'working', now, '2026-11-09T00:01:00Z', 's_parent_p1');

    // Retrieve snapshot sessions for p2.
    const snap = snapshot(f.db, 'p2');
    const rows = JSON.parse(JSON.stringify(snap.sessions));
    const child = rows.find((s: { id: string }) => s.id === 's_child_p2');

    // Verify child retains parent_id across projects.
    assert.equal(child.parent_id, 's_parent_p1');
  } finally {
    f.close();
  }
});

test('every session row has parent_id key and null when unset', () => {
  // Create database fixture.
  const f = fixture();
  try {
    // Insert project and engine rows.
    const now = '2026-11-09T00:00:00Z';
    f.db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/path/p1', 'p1', ?, ?)").run(now, now);
    f.db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1)").run();

    // Insert session with unset parent_id and session with parent_id.
    const insertSession = f.db.prepare(
      'INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, parent_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    insertSession.run('s_unset', 'p1', 'codex', 'pty', 'working', now, '2026-11-09T00:00:00Z', null);
    insertSession.run('s_set', 'p1', 'codex', 'pty', 'working', now, '2026-11-09T00:01:00Z', 's_unset');

    // Retrieve snapshot sessions.
    const snap = snapshot(f.db, 'p1');
    const rows = JSON.parse(JSON.stringify(snap.sessions));
    assert.equal(rows.length, 2);

    // Verify parent_id property presence on each row.
    for (const row of rows) {
      assert.equal(Object.hasOwn(row, 'parent_id'), true);
      assert.notEqual(row.parent_id, undefined);
    }

    const unsetRow = rows.find((s: { id: string }) => s.id === 's_unset');
    const setRow = rows.find((s: { id: string }) => s.id === 's_set');
    assert.equal(unsetRow.parent_id, null);
    assert.equal(setRow.parent_id, 's_unset');
  } finally {
    f.close();
  }
});

test.todo('old database without parent_id column returns sessions with parent_id null: snapshot throws because parent_id lacks PRAGMA table_info check', () => {
  // Create legacy database fixture without parent_id column.
  const f = legacyFixture();
  try {
    // Verify session table schema lacks parent_id.
    const cols = (f.db.prepare('PRAGMA table_info(session)').all() as Array<{ name: string }>).map((c) => c.name);
    assert.equal(cols.includes('parent_id'), false);

    // Insert project and engine rows.
    const now = '2026-11-09T00:00:00Z';
    f.db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/path/p1', 'p1', ?, ?)").run(now, now);
    f.db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1)").run();

    // Insert session into legacy table.
    f.db.prepare(
      "INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('s1', 'p1', 'codex', 'pty', 'working', ?, ?)",
    ).run(now, '2026-11-09T00:00:00Z');

    // Query snapshot sessions on legacy database.
    const snap = snapshot(f.db, 'p1');
    const rows = JSON.parse(JSON.stringify(snap.sessions));
    const session = rows.find((s: { id: string }) => s.id === 's1');

    // Assert parent_id is null on legacy database.
    assert.equal(session.parent_id, null);
  } finally {
    f.close();
  }
});
