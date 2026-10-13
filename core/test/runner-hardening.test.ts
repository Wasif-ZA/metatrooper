import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrate, openCoreDb } from '../src/store/db.ts';
import { CommandRunner, type MethodSpec } from '../src/pipe/commands.ts';
import { isolation, withEnv } from './helpers.ts';

function coreDb(t): DatabaseSync {
  const isolated = isolation();
  const db = withEnv({ METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix }, openCoreDb);
  t.after(() => {
    db.close();
    rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return db;
}

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

test('a queued command whose params do not parse fails alone and the rows behind it still run', async t => {
  const db = coreDb(t);
  const ran: unknown[] = [];
  const methods = new Map<string, MethodSpec>([['fixture.do', { handler: (p) => { ran.push(p); return {}; } }]]);
  const insert = db.prepare("INSERT INTO command (id, at, origin, method, params, status) VALUES (?, '2026-10-14T00:00:00+11:00', 'cli', 'fixture.do', ?, 'queued')");
  insert.run('bad', '{');
  insert.run('good', '{"n":1}');
  await new CommandRunner(db, methods).drainQueued();
  assert.deepEqual(ran, [{ n: 1 }]);
  const status = (id: string) => (db.prepare('SELECT status FROM command WHERE id = ?').get(id) as { status: string }).status;
  assert.equal(status('bad'), 'error');
  assert.equal(status('good'), 'ok');
});
