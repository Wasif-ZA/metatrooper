import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readRunFile } from '../src/queries.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');

test('readRunFile returns a markdown file inside the run folder and refuses anything else', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-runfile-'));
  const runDir = join(dir, 'runs', 'r1');
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, 'spec.md'), '# Spec\n');
  writeFileSync(join(runDir, 'notes.txt'), 'x');
  writeFileSync(join(dir, 'runs', 'secret.md'), 'outside');
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', ?, 'p', '2026-10-07T00:00:00Z', '2026-10-07T00:00:00Z')").run(dir);
  db.prepare("INSERT INTO pipeline (id, source, path, version, valid, errors) VALUES ('flow', 'builtin', '/f', 1, 1, '[]')").run();
  db.prepare("INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at) VALUES ('r1', 'flow', 'p1', '{}', ?, 'paused', 'manual', 1, 1, 1, '2026-10-07T00:00:00Z')").run(runDir);
  try {
    assert.equal(readRunFile(db, 'r1', 'spec.md'), '# Spec\n');
    assert.equal(readRunFile(db, 'r1', '../secret.md'), null);
    assert.equal(readRunFile(db, 'r1', '..\\secret.md'), null);
    assert.equal(readRunFile(db, 'r1', 'notes.txt'), null);
    assert.equal(readRunFile(db, 'r1', 'missing.md'), null);
    assert.equal(readRunFile(db, 'nope', 'spec.md'), null);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
