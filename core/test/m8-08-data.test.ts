import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { schemaFile } from '../src/paths.ts';
import { getSurface, setSurfaceData, showSurface } from '../src/surfaces.ts';
import { expand } from '../../workbench/ui/src/kit/check.js';

function harness(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'm8-data-'));
  const home = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = dir;
  const db = new DatabaseSync(join(dir, 'fixture.db'));
  t.after(() => {
    db.close();
    if (home === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = home;
    rmSync(dir, { recursive: true, force: true });
  });
  db.exec(readFileSync(schemaFile, 'utf8'));
  db.exec(readFileSync(new URL('../src/store/migrations/021-ui-surface.sql', import.meta.url), 'utf8'));
  db.exec('PRAGMA foreign_keys = ON');
  const at = '2026-11-14T00:00:00.000Z';
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('project', dir, 'Synthetic', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('fake', '{}', 1, 'local-cli');
  for (const id of ['session-a', 'session-b']) db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, 'project', 'fake', 'pty', 'idle', at, at);
  const show = (spec: any) => showSurface(db, { session_id: 'session-a', surface: 'screen', zone: 'tab', spec });
  const set = (path: any, value: any, session_id = 'session-a', surface = 'screen') => setSurfaceData(db, { session_id, surface, path, value });
  const view = () => { const s: any = getSurface(db, 'screen'); return { s, out: expand(s.spec, 'tab', s.data) }; };
  return { show, set, view };
}

test('ui.data changes a meter value and leaves the stored parts unchanged', async t => {
  const h = harness(t);
  const spec = { type: 'page', children: [{ type: 'meter', label: 'Tokens', value: { bind: '/tokens' }, max: 200000 }] };
  h.show(spec);
  assert.equal(h.view().out.root.children[0].type, 'spinner');
  const first = h.set('/tokens', 51200);
  assert.ok(first.seq > 0);
  const { s, out } = h.view();
  assert.deepEqual(s.spec, spec);
  assert.equal(s.seq, first.seq);
  assert.deepEqual(out.root.children[0], { type: 'meter', label: 'Tokens', value: 51200, max: 200000 });
  const second = h.set('/tokens', 60000);
  assert.ok(second.seq > first.seq);
  const again = h.view();
  assert.deepEqual(again.s.spec, spec);
  assert.equal(again.out.root.children[0].value, 60000);
});

test('only the drawing session sets data, and bad paths are refused', async t => {
  const h = harness(t);
  h.show({ type: 'page', children: [{ type: 'text', text: 'x' }] });
  assert.throws(() => h.set('/tokens', 1, 'session-b'), { code: -32003 });
  assert.throws(() => h.set('/tokens', 1, 'session-a', 'nope'), { code: -32002 });
  assert.throws(() => h.set('tokens', 1), { code: -32602 });
  assert.throws(() => h.set('/a/b/c/d/e/f/g/h/i', 1), { code: -32602 });
  assert.throws(() => h.set('/__proto__', 1), { code: -32602 });
  assert.throws(() => h.set('/big', 'x'.repeat(70 * 1024)), { code: -32602 });
  assert.deepEqual(h.view().s.data, {});
});

test('nested paths create objects and a flat spec with a missing child draws a spinner', async t => {
  const h = harness(t);
  h.show({ type: 'page', children: [{ type: 'text', text: { bind: '/run/cost' } }] });
  h.set('/run/cost', '$1.20');
  const { s, out } = h.view();
  assert.deepEqual(s.data, { run: { cost: '$1.20' } });
  assert.deepEqual(out.root.children[0], { type: 'text', text: '$1.20' });
  const flat = expand({ root: 'r', parts: { r: { type: 'page', children: ['later'] } } });
  assert.equal(flat.root.children[0].type, 'spinner');
  assert.deepEqual(flat.fellBack, []);
});
