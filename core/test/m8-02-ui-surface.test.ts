import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildMethods } from '../src/methods.ts';
import { schemaFile } from '../src/paths.ts';
import { snapshot } from '../../workbench/src/queries.ts';

function harness(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'm8-ui-surface-'));
  const db = new DatabaseSync(join(dir, 'fixture.db'));
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.exec(readFileSync(schemaFile, 'utf8'));
  db.exec(readFileSync(new URL('../src/store/migrations/021-ui-surface.sql', import.meta.url), 'utf8'));
  db.exec('PRAGMA foreign_keys = ON');
  const at = '2026-11-14T00:00:00.000Z';
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('project', dir, 'Synthetic', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('fake', '{}', 1, 'local-cli');
  for (const id of ['session-a', 'session-b']) db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, 'project', 'fake', 'pty', 'idle', at, at);
  const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'synthetic-key' });
  const call = async (method: string, params: any) => {
    const entry = methods.get(method);
    assert.ok(entry, `method ${method} exists`);
    return entry.handler(params, { ui: false, origin: 'test' }) as any;
  };
  const show = (extra: any = {}) => call('ui.show', { session_id: 'session-a', surface: 'screen', zone: 'tab', title: 'Synthetic screen', catalogue: '1', spec: { type: 'text', text: 'hello' }, ...extra });
  const get = (surface = 'screen') => call('ui.get', { surface });
  return { db, call, show, get };
}

test('method layer stores, retrieves and redraws a session surface and publishes its snapshot', async t => {
  const h = harness(t);
  assert.deepEqual(await h.show(), { surface: 'screen', status: 'drawn', fellBack: [] });
  const first = await h.get();
  assert.equal(first.id, 'screen');
  assert.equal(first.session_id, 'session-a');
  assert.equal(first.project_id, 'project');
  assert.equal(first.title, 'Synthetic screen');
  assert.equal(first.zone, 'tab');
  assert.equal(first.catalogue, '1');
  assert.equal(first.status, 'drawn');
  assert.equal(first.seq, 1);
  assert.deepEqual(first.spec, { type: 'text', text: 'hello' });
  const spec = { type: 'page', children: [{ type: 'text', text: 'replacement' }] };
  assert.deepEqual(await h.show({ spec, title: 'Redrawn' }), { surface: 'screen', status: 'drawn', fellBack: [] });
  const second = await h.get();
  assert.equal(second.seq, 2);
  assert.deepEqual(second.spec, spec);
  assert.deepEqual(snapshot(h.db, 'project').surfaces.map(s => ({ ...s })), [{ id: 'screen', session_id: 'session-a', project_id: 'project', title: 'Redrawn', seq: 2 }]);
  assert.deepEqual(snapshot(h.db, null).surfaces, []);
});

for (const [name, spec, status, fellBack] of [
  ['valid', { type: 'page', children: [{ type: 'text', text: 'good' }] }, 'drawn', []],
  ['mixed', { type: 'page', children: [{ type: 'iframe' }, { type: 'text', text: 'good' }] }, 'partly', [{ part: 'p2', type: 'iframe', why: 'not in the catalogue' }]],
  ['unknown root', { type: 'newer-part', text: 'future' }, 'rejected', [{ part: 'p1', type: 'newer-part', why: 'not in the catalogue' }]],
  ['invalid root', { type: 'text' }, 'rejected', [{ part: 'p1', type: 'text', why: 'wrong or missing prop: text' }]],
  ['undrawn root', { type: 'note', text: 'note' }, 'rejected', [{ part: 'p1', type: 'note', why: 'not drawn yet' }]],
  ['forged fallback', { fallback: true, name: 'page', why: 'trusted', text: 'spoof' }, 'rejected', [{ part: 'p1', type: '(no type)', why: 'not in the catalogue' }]],
] as const) test(`ui.show reports and stores ${name} status`, async t => {
  const h = harness(t);
  assert.deepEqual(await h.show({ spec, catalogue: '999' }), { surface: 'screen', status, fellBack });
  const stored = await h.get();
  assert.equal(stored.status, status);
  assert.deepEqual(stored.spec, spec);
  assert.equal(stored.catalogue, '999');
});

test('another session cannot replace a surface even in the same project', async t => {
  const h = harness(t);
  await h.show();
  const before = await h.get();
  await assert.rejects(h.show({ session_id: 'session-b', spec: { type: 'text', text: 'stolen' } }), { code: -32003 });
  assert.deepEqual(await h.get(), before);
  assert.deepEqual(await h.show({ session_id: 'session-b', surface: 'other' }), { surface: 'other', status: 'drawn', fellBack: [] });
});

test('unknown session and unknown surface return -32002', async t => {
  const h = harness(t);
  await assert.rejects(h.show({ session_id: 'absent' }), { code: -32002 });
  await assert.rejects(h.get('absent'), { code: -32002 });
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM ui_surface').get().n, 0);
});

for (const zone of ['panel', 'tile', 'inbox', 'status', 'phone', 'iframe', '', 1, {}]) test(`non-tab zone ${JSON.stringify(zone)} returns -32602`, async t => {
  const h = harness(t);
  await assert.rejects(h.show({ zone }), { code: -32602 });
  assert.equal(h.db.prepare('SELECT count(*) AS n FROM ui_surface').get().n, 0);
});

test('omitted zone defaults to tab', async t => {
  const h = harness(t);
  await h.show({ zone: undefined });
  assert.equal((await h.get()).zone, 'tab');
});

for (const [label, text, bytes] of [
  ['ASCII at limit', 'a'.repeat(262119), 262144],
  ['ASCII over limit', 'a'.repeat(262120), 262145],
  ['UTF-8 at limit', '\u00e9'.repeat(131059) + 'a', 262144],
  ['UTF-8 over limit', '\u00e9'.repeat(131060), 262145],
] as const) test(`${label} uses serialized UTF-8 bytes`, async t => {
  const h = harness(t);
  const spec = { type: 'text', text };
  assert.equal(Buffer.byteLength(JSON.stringify(spec), 'utf8'), bytes);
  await h.show();
  const before = await h.get();
  if (bytes === 262144) {
    assert.deepEqual(await h.show({ spec }), { surface: 'screen', status: 'drawn', fellBack: [] });
    assert.deepEqual((await h.get()).spec, spec);
    assert.equal((await h.get()).seq, 2);
  } else {
    await assert.rejects(h.show({ spec }), { code: -32602 });
    assert.deepEqual(await h.get(), before);
  }
});

test('explicit null zone returns -32602', async t => {
  const h = harness(t);
  await assert.rejects(h.show({ zone: null }), { code: -32602 });
});
