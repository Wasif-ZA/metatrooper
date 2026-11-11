import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshot } from '../src/queries.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');
const now = '2026-11-10T00:00:00Z';

function fixture(dropMonitor: boolean) {
  const db = new DatabaseSync(':memory:');
  db.exec(schema);
  if (dropMonitor) db.exec('DROP TABLE session_monitor');
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/path/p1', 'p1', ?, ?)").run(now, now);
  db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1)").run();
  for (const id of ['s1', 's2', 's3']) {
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p1', 'codex', 'pty', 'working', ?, ?)").run(id, now, now);
  }
  const auto = db.prepare("INSERT INTO automation (id, project_id, name, every_min, runner, script, script_sha256, engine_id, prompt, next_due, created_at) VALUES (?, 'p1', ?, 1, '[]', 'c.sh', 'x', 'codex', 'p', ?, ?)");
  auto.run('a1', 'Build passes', now, now);
  auto.run('a2', 'Lint clean', now, now);
  const run = db.prepare("INSERT INTO automation_run (id, automation_id, due_at, at, outcome) VALUES (?, ?, ?, ?, ?)");
  run.run('r1', 'a1', now, '2026-11-10T00:01:00Z', 'skip');
  run.run('r2', 'a1', now, '2026-11-10T00:02:00Z', 'failed');
  run.run('r3', 'a1', now, '2026-11-10T00:03:00Z', 'missed');
  if (!dropMonitor) {
    db.prepare("INSERT INTO session_monitor (session_id, automation_id) VALUES ('s1', 'a1'), ('s2', 'a2')").run();
  }
  return db;
}

test('snapshot sessions and live rows carry the linked monitor with its last outcome', () => {
  const db = fixture(false);
  try {
    const snap = snapshot(db, 'p1');
    for (const rows of [snap.sessions, snap.live]) {
      const by = (id: string) => rows.find((s) => s.id === id)!.monitor;
      assert.deepEqual(by('s1'), { automation_id: 'a1', name: 'Build passes', last_outcome: 'fail' });
      assert.deepEqual(by('s2'), { automation_id: 'a2', name: 'Lint clean', last_outcome: null });
      assert.equal(by('s3'), null);
    }
  } finally {
    db.close();
  }
});

test('a passing latest run reads ok, and a later missed slot does not change it', () => {
  const db = fixture(false);
  try {
    db.prepare("INSERT INTO automation_run (id, automation_id, due_at, at, outcome) VALUES ('r4', 'a1', ?, '2026-11-10T00:04:00Z', 'skip'), ('r5', 'a1', ?, '2026-11-10T00:05:00Z', 'missed')").run(now, now);
    assert.equal(snapshot(db, 'p1').sessions.find((s) => s.id === 's1')!.monitor!.last_outcome, 'ok');
  } finally {
    db.close();
  }
});

test('an older database without session_monitor gives null monitors', () => {
  const db = fixture(true);
  try {
    const snap = snapshot(db, 'p1');
    assert.equal(snap.sessions.find((s) => s.id === 's1')!.monitor, null);
    assert.equal(snap.live.find((s) => s.id === 's1')!.monitor, null);
  } finally {
    db.close();
  }
});
