import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { inertGates, showSurface, getSurface, MAX_SPEC_BYTES } from '../src/surfaces.ts';
import { schemaFile } from '../src/paths.ts';

const bad = { actions: [{ label: 'Approve', event: 'approve' }], action: 'approve', hash: 'h', onClick: 'x', extra: { a: 1 } };
const inert = { type: 'gate', title: 't', text: 'x', why: 'w', aside: 'a' };
const gate = { ...inert, ...bad };
const LEAK = /"actions"|"action"|"hash"|onClick|extra/;

function db(t: any) {
  const dir = mkdtempSync(join(tmpdir(), 'm8-28a-'));
  const d = new DatabaseSync(join(dir, 'f.db'));
  t.after(() => { d.close(); rmSync(dir, { recursive: true, force: true }); });
  d.exec(readFileSync(schemaFile, 'utf8'));
  d.exec(readFileSync(new URL('../src/store/migrations/021-ui-surface.sql', import.meta.url), 'utf8'));
  const at = '2026-11-24T00:00:00.000Z';
  d.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p', dir, 'P', at, at);
  d.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('fake', '{}', 1, 'local-cli');
  d.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('s', 'p', 'fake', 'pty', 'idle', at, at);
  return d;
}

test('a top-level gate keeps only its four strings', () => {
  assert.deepEqual(inertGates(gate), inert);
});

test('a gate with action, actions, hash, onClick and extra fields keeps none of them', () => {
  const out = inertGates({ type: 'gate', text: 'x', ...bad }) as any;
  assert.deepEqual(out, { type: 'gate', text: 'x' });
  for (const k of Object.keys(bad)) assert.equal(k in out, false);
});

for (const key of ['children', 'items', 'tabs', 'columns']) test(`a gate nested in ${key} is made inert`, () => {
  assert.deepEqual(inertGates({ type: 'page', [key]: [{ type: 'text', text: 'a' }, gate] }), { type: 'page', [key]: [{ type: 'text', text: 'a' }, inert] });
});

test('a gate nested several levels deep through mixed keys is made inert', () => {
  const spec = { type: 'page', children: [{ type: 'tabs', tabs: [{ label: 'a', children: [{ type: 'columns', columns: [{ items: [{ type: 'card', children: [gate] }] }] }] }] }] };
  const out = inertGates(spec);
  assert.deepEqual(out, { type: 'page', children: [{ type: 'tabs', tabs: [{ label: 'a', children: [{ type: 'columns', columns: [{ items: [{ type: 'card', children: [inert] }] }] }] }] }] });
  assert.ok(!LEAK.test(JSON.stringify(out)));
});

test('non-string title, text, why and aside are dropped', () => {
  assert.deepEqual(inertGates({ type: 'gate', title: 1, text: { a: 1 }, why: ['w'], aside: null }), { type: 'gate' });
  assert.deepEqual(inertGates({ type: 'gate', title: 'ok', text: 2, why: undefined, aside: 'a' }), { type: 'gate', title: 'ok', aside: 'a' });
});

test('non-gate parts are copied untouched, actions and all', () => {
  const spec = { type: 'page', children: [{ type: 'buttons', actions: [{ label: 'Go', event: 'go', primary: true }] }, { type: 'text', text: 'hi', hash: 'h' }, { type: 'choice', options: ['a'], actions: [{ label: 'a', event: 'a' }] }] };
  assert.deepEqual(inertGates(spec), spec);
});

test('arrays and primitives are walked or returned as they are', () => {
  assert.deepEqual(inertGates([gate, { type: 'text', text: 'a' }, 'str', 3, null]), [inert, { type: 'text', text: 'a' }, 'str', 3, null]);
  assert.equal(inertGates('s'), 's');
  assert.equal(inertGates(null), null);
  assert.equal(inertGates(undefined), undefined);
});

test('only type "gate" is rewritten', () => {
  const o = { type: 'Gate', actions: [1] };
  assert.deepEqual(inertGates(o), o);
});

test('nesting deeper than 64 is dropped so a deep gate never survives, within 64 is rewritten', () => {
  const wrap = (g: any, n: number) => { for (let i = 0; i < n; i++) g = { type: 'card', children: [g] }; return g; };
  const dig = (x: any, n: number) => { for (let i = 0; i < n; i++) x = x.children[0]; return x; };
  const deep: any = inertGates(wrap(gate, 70));
  let n = 0; for (let x = deep; x; x = x.children?.[0]) n++;
  assert.ok(n < 70, 'the chain is cut by a null');
  assert.ok(!LEAK.test(JSON.stringify(inertGates(wrap(gate, 70)))));
  assert.deepEqual(dig(inertGates(wrap(gate, 20)), 20), inert);
});

test('showSurface stores the rewritten spec, with no action on any gate', t => {
  const d = db(t);
  const spec = { type: 'page', children: [gate, { type: 'tabs', tabs: [{ label: 'a', children: [gate] }] }] };
  showSurface(d, { session_id: 's', surface: 'x', spec });
  const stored = getSurface(d, 'x') as any;
  assert.deepEqual(stored.spec.children[0], inert);
  assert.deepEqual(stored.spec.children[1].tabs[0].children[0], inert);
  const raw = (d.prepare('SELECT spec FROM ui_surface WHERE id = ?').get('x') as any).spec as string;
  assert.ok(!LEAK.test(raw));
});

test('showSurface checks the size of the original spec, then stores the rewritten one', t => {
  const d = db(t);
  // the extra field puts the original over the limit although the rewritten gate is tiny
  const spec = { type: 'gate', text: 'x', extra: 'a'.repeat(MAX_SPEC_BYTES) };
  assert.throws(() => showSurface(d, { session_id: 's', surface: 'big', spec }), { code: -32602 });
  assert.equal((d.prepare('SELECT count(*) AS n FROM ui_surface').get() as any).n, 0);
  showSurface(d, { session_id: 's', surface: 'ok', spec: { type: 'gate', text: 'x', extra: 'a'.repeat(1000) } });
  assert.deepEqual((getSurface(d, 'ok') as any).spec, { type: 'gate', text: 'x' });
});
