import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { catalogueProposals, showSurface } from '../src/surfaces.ts';
import { schemaFile } from '../src/paths.ts';

function harness(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'm8-proposals-'));
  const db = new DatabaseSync(join(dir, 'fixture.db'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec(readFileSync(schemaFile, 'utf8'));
  db.exec(readFileSync(new URL('../src/store/migrations/021-ui-surface.sql', import.meta.url), 'utf8'));
  db.exec('PRAGMA foreign_keys = ON');
  const at = '2026-11-14T00:00:00.000Z';
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('project', dir, 'Synthetic', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('fake', '{}', 1, 'local-cli');
  db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('session-a', 'project', 'fake', 'pty', 'idle', at, at);
  const draw = (surface: string, child: any) => showSurface(db, { session_id: 'session-a', surface, spec: { type: 'page', children: [{ type: 'text', text: 'hi' }, child] } } as any);
  return { db, draw };
}

test('three surfaces falling back on the same unknown part make one proposal listing them', t => {
  const { db, draw } = harness(t);
  draw('s1', { type: 'gauge', value: 3 });
  draw('s2', { type: 'gauge', value: 3, label: 'cpu' });
  assert.deepEqual(catalogueProposals(db), []);
  draw('s3', { type: 'gauge', value: 3 });
  assert.deepEqual(catalogueProposals(db), [{ part: 'gauge', props: ['label', 'value'], surfaces: ['s1', 's2', 's3'] }]);
});

test('a redraw of the same surface does not count twice', t => {
  const { db, draw } = harness(t);
  draw('s1', { type: 'gauge', value: 3 });
  draw('s1', { type: 'gauge', value: 4 });
  draw('s2', { type: 'gauge', value: 3 });
  assert.deepEqual(catalogueProposals(db), []);
});

test('an unknown part nested inside a table cell or columns still counts', t => {
  const { db, draw } = harness(t);
  draw('s1', { type: 'table', columns: ['a'], rows: [[{ type: 'gauge', value: 1 }]] });
  draw('s2', { type: 'columns', children: [[{ type: 'gauge', value: 2 }], [{ type: 'text', text: 'x' }]] });
  draw('s3', { type: 'gauge', value: 3 });
  assert.deepEqual(catalogueProposals(db), [{ part: 'gauge', props: ['value'], surfaces: ['s1', 's2', 's3'] }]);
});
