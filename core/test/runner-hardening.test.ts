import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate } from '../src/store/db.ts';

function tempDir(t): string {
  const dir = mkdtempSync(join(tmpdir(), 'mt-harden-'));
  t.after(() => rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return dir;
}

test('migrate refuses two files with the same id and applies neither', t => {
  const dir = tempDir(t);
  writeFileSync(join(dir, '903-a.sql'), 'CREATE TABLE from_a (id INTEGER);');
  writeFileSync(join(dir, '903-b.sql'), 'CREATE TABLE from_b (id INTEGER);');
  const db = new DatabaseSync(':memory:');
  try {
    assert.throws(() => migrate(db, dir), /903-a\.sql.*903-b\.sql/);
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('from_a', 'from_b')").get(), undefined);
  } finally { db.close(); }
});
