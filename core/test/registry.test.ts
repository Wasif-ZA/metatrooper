import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { root } from './helpers.ts';
import { bindRole, getEngine, loadEngines, syncEngines } from '../src/engines/registry.ts';

test('M1-02 getEngine returns the engine asked for, not the first built-in', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8'));
  const engines = loadEngines();
  syncEngines(db, engines);
  assert.ok(engines.length > 1);
  for (const e of engines) assert.equal(getEngine(db, e.id)?.id, e.id);
  assert.equal(getEngine(db, 'no-such-engine'), null);
});

test('M1 DST: the latest engine_check wins inside the April fall-back hour', () => {
  for (const [early, late] of [[1, 0], [0, 1]]) {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8'));
    const engines = loadEngines();
    syncEngines(db, engines);
    const id = engines[0].id;
    const check = db.prepare("INSERT INTO engine_check (engine_id, checked_at, installed, auth) VALUES (?, ?, ?, 'ok')");
    check.run(id, '2027-04-04T02:59:00.000+11:00', early);
    check.run(id, '2027-04-04T02:30:00.000+10:00', late);
    assert.equal(bindRole(db, '', id)?.id ?? null, late ? id : null);
  }
});

test('M1 DST: no query sorts or takes MAX of an offset timestamp as text', () => {
  const bad = /ORDER BY\s+(?:[a-z]\.)?(?:[a-z_]*_at|at)\b|(?:MAX|MIN)\(\s*(?:[a-z]\.)?(?:[a-z_]*_at|at)\s*\)/i;
  const hits: string[] = [];
  for (const dir of ['core/src', 'workbench/src']) {
    for (const f of readdirSync(join(root, dir), { recursive: true }) as string[]) {
      if (!f.endsWith('.ts')) continue;
      readFileSync(join(root, dir, f), 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (bad.test(line)) hits.push(`${dir}/${f}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(hits, []);
});
