import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-runner-fixes-'));
process.env.METATROOPER_HOME = path.join(home, 'mt');
const { openCoreDb } = await import('../src/store/db.ts');
const { Runner } = await import('../src/pipelines/runner.ts');
const db = openCoreDb();
db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
db.prepare("INSERT INTO pipeline (id, source, path, version, valid) VALUES ('pl', 'project', 'x', 1, 1)").run();

const priv = (r: InstanceType<typeof Runner>) => r as any;

test('F12 a blank optional input gets its default', () => {
  const pipe = { inputs: { base_branch: { type: 'text', required: false, default: 'main' }, note: { type: 'text', required: false } } };
  assert.deepEqual(priv(new Runner(db)).inputsFor(pipe, { base_branch: '', note: '' }), { base_branch: 'main' });
});
