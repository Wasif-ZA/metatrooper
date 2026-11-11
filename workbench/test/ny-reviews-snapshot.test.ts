import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshot } from '../src/queries.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');
const AT = '2026-11-11T00:00:00Z';

function fixture(legacy: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-ny-reviews-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  if (legacy) db.exec('DROP TABLE session_review');
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(AT, AT);
  db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1)").run();
  const add = db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p1', 'codex', 'pty', ?, ?, ?)");
  add.run('s1', 'working', AT, AT);
  add.run('s2', 'working', AT, '2026-11-11T00:01:00Z');
  return { db, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('snapshot session and live rows carry reviews as objects with the five contract keys', () => {
  const f = fixture(false);
  try {
    const add = f.db.prepare('INSERT INTO session_review (session_id, kind, who, state, note, review_session_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    add.run('s1', 'approver', 'you', 'pending', null, null, AT);
    add.run('s1', 'reviewer', 'codex', 'failed', 'no tests', 's2', AT);
    const snap = JSON.parse(JSON.stringify(snapshot(f.db, 'p1')));
    const want = [
      { kind: 'reviewer', who: 'codex', state: 'failed', note: 'no tests', review_session_id: 's2' },
      { kind: 'approver', who: 'you', state: 'pending', note: null, review_session_id: null },
    ];
    for (const list of [snap.sessions, snap.live]) {
      assert.deepEqual(list.find((s: { id: string }) => s.id === 's1').reviews, want);
      assert.deepEqual(list.find((s: { id: string }) => s.id === 's2').reviews, []);
    }
  } finally { f.close(); }
});

test('an older database without session_review gives empty reviews', () => {
  const f = fixture(true);
  try {
    const snap = snapshot(f.db, 'p1');
    assert.deepEqual(snap.sessions.map((s) => s.reviews), [[], []]);
    assert.deepEqual(snap.live.map((s) => s.reviews), [[], []]);
  } finally { f.close(); }
});
