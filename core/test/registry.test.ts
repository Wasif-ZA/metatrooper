import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { root } from './helpers.ts';
import { getEngine, loadEngines, syncEngines } from '../src/engines/registry.ts';

test('M1-02 getEngine returns the engine asked for, not the first built-in', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8'));
  const engines = loadEngines();
  syncEngines(db, engines);
  assert.ok(engines.length > 1);
  for (const e of engines) assert.equal(getEngine(db, e.id)?.id, e.id);
  assert.equal(getEngine(db, 'no-such-engine'), null);
});
