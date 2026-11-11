import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { snapshot } from '../src/queries.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');

function fixture(dropPrompt: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'wb-night-prompt-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  if (dropPrompt) db.exec('ALTER TABLE session DROP COLUMN prompt');
  const now = '2026-11-10T00:00:00Z';
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/path/p1', 'p1', ?, ?)").run(now, now);
  db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('codex', '{}', 1)").run();
  const cols = dropPrompt ? '' : ', prompt';
  const vals = dropPrompt ? '' : ", 'fix the login bug'";
  db.exec(`INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at${cols}) VALUES ('s1', 'p1', 'codex', 'pty', 'working', '${now}', '${now}'${vals})`);
  return { db, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test('snapshot sessions and live rows carry the stored prompt', () => {
  const f = fixture(false);
  try {
    const snap = snapshot(f.db, 'p1');
    assert.equal(snap.sessions.find((s) => s.id === 's1')!.prompt, 'fix the login bug');
    assert.equal(snap.live.find((s) => s.id === 's1')!.prompt, 'fix the login bug');
  } finally {
    f.close();
  }
});

test('an older database without session.prompt gives null prompts', () => {
  const f = fixture(true);
  try {
    const snap = snapshot(f.db, 'p1');
    assert.equal(snap.sessions.find((s) => s.id === 's1')!.prompt, null);
    assert.equal(snap.live.find((s) => s.id === 's1')!.prompt, null);
  } finally {
    f.close();
  }
});
