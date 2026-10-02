import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { root } from './helpers.ts';
import { migrateToV2 } from '../src/store/db.ts';

test('10 migrateToV2 preserves v1 rows while replacing terminal, event, and selection fields', () => {
  const dir = mkdtempSync(join(tmpdir(), 'metatrooper-migration-'));
  const db = new DatabaseSync(join(dir, 'v1.db'));
  try {
    const v1 = execFileSync('git', ['show', 'b256909:contracts/schema.sql'], { cwd: root, encoding: 'utf8' });
    db.exec(v1);
    const at = '2026-10-02T00:00:00.000Z';
    db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', '1')").run();
    db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p1', dir, 'project', at, at);
    db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('e1', '{}', 1, 'local-cli');
    db.prepare(
      "INSERT INTO session (id, project_id, engine_id, host, window_name, herdr_pane, state, state_at, started_at) VALUES ('s1', 'p1', 'e1', 'wt', 'troop-s1', 'w1:p2', 'working', ?, ?)",
    ).run(at, at);
    db.prepare(
      "INSERT INTO comment (id, at, session_id, kind, body, herdr_at) VALUES ('c1', ?, 's1', 'file', 'kept body', ?)",
    ).run(at, at);
    db.prepare(
      "INSERT INTO event (at, source, session_id, kind, payload) VALUES (?, 'herdr', 's1', 'herdr.output', '{}')",
    ).run(at);
    db.prepare(
      "INSERT INTO needs_you (id, at, kind, ref, text) VALUES ('n1', ?, 'other', 's1', 'kept inbox row')",
    ).run(at);

    migrateToV2(db);

    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
    assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get().value, '2');
    assert.deepEqual(db.prepare('SELECT id, host, state FROM session').all().map((row) => ({ ...row })), [
      { id: 's1', host: 'pty', state: 'working' },
    ]);
    assert.equal(db.prepare('SELECT source FROM event WHERE session_id = ?').get('s1').source, 'core');
    assert.equal(db.prepare('SELECT body FROM comment WHERE id = ?').get('c1').body, 'kept body');
    assert.equal(db.prepare('SELECT text FROM needs_you WHERE id = ?').get('n1').text, 'kept inbox row');

    const sessionColumns = db.prepare('PRAGMA table_info(session)').all().map((row) => row.name);
    const commentColumns = db.prepare('PRAGMA table_info(comment)').all().map((row) => row.name);
    assert.equal(sessionColumns.includes('window_name'), false);
    assert.equal(sessionColumns.includes('herdr_pane'), false);
    assert.equal(commentColumns.includes('herdr_at'), false);
    assert.deepEqual(db.prepare('PRAGMA table_info(ui_selection)').all().map((row) => row.name), ['window_id', 'session_id', 'at']);
    assert.deepEqual(db.prepare('SELECT * FROM ui_selection').all(), []);
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
