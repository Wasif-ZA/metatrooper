import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildMethods } from '../src/methods.ts';
import { schemaFile } from '../src/paths.ts';
import { proposeTemplates, keepTemplate, lineUp } from '../src/templates.ts';

test("ui.show draws a use part from the person's templates folder", async t => {
  const dir = mkdtempSync(join(tmpdir(), 'm8-06-templates-'));
  const prior = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = dir;
  const db = new DatabaseSync(join(dir, 'fixture.db'));
  t.after(() => {
    db.close();
    if (prior === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prior;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const tpl = join(dir, 'templates');
  mkdirSync(tpl);
  const summary = { type: 'page', children: [{ type: 'text', text: 'Run {{name}}' }, { type: 'log', lines: '{{lines}}' }] };
  writeFileSync(join(tpl, 'run-summary.json'), JSON.stringify(summary));
  writeFileSync(join(tpl, 'wrapped.json'), JSON.stringify({ spec: { type: 'text', text: 'w' } }));
  writeFileSync(join(tpl, 'notes.txt'), JSON.stringify({ type: 'text', text: 'no' }));
  writeFileSync(join(tpl, 'bad name.json'), JSON.stringify({ type: 'text', text: 'no' }));
  writeFileSync(join(tpl, 'big.json'), JSON.stringify({ type: 'text', text: 'x'.repeat(256 * 1024 + 1) }));
  writeFileSync(join(dir, 'x.json'), JSON.stringify({ type: 'text', text: 'outside' }));

  db.exec(readFileSync(schemaFile, 'utf8'));
  db.exec(readFileSync(new URL('../src/store/migrations/021-ui-surface.sql', import.meta.url), 'utf8'));
  db.exec('PRAGMA foreign_keys = ON');
  const at = '2026-11-14T00:00:00.000Z';
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('project', dir, 'Synthetic', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('fake', '{}', 1, 'local-cli');
  db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('session-a', 'project', 'fake', 'pty', 'idle', at, at);
  const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'synthetic-key' });
  const call = async (method: string, params: any) => methods.get(method)!.handler(params, { ui: false, origin: 'test' }) as any;

  const spec = { type: 'page', children: [{ type: 'use', template: 'run-summary', data: { name: 'r1', lines: ['a', 'b'] } }] };
  const res = await call('ui.show', { session_id: 'session-a', surface: 'screen', zone: 'tab', title: 'S', catalogue: '1', spec });
  assert.deepEqual(res, { surface: 'screen', status: 'drawn', fellBack: [] });

  const got = await call('ui.get', { surface: 'screen' });
  assert.deepEqual(got.templates['run-summary'], summary);
  assert.deepEqual(got.templates.wrapped, { type: 'text', text: 'w' });
  assert.deepEqual(Object.keys(got.templates).sort(), ['run-summary', 'wrapped']);
});

async function setup(t: any, sessions: number) {
  const dir = mkdtempSync(join(tmpdir(), 'm8-06-propose-'));
  const prior = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = dir;
  const db = new DatabaseSync(join(dir, 'fixture.db'));
  t.after(() => {
    db.close();
    if (prior === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = prior;
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  db.exec(readFileSync(schemaFile, 'utf8'));
  db.exec(readFileSync(new URL('../src/store/migrations/021-ui-surface.sql', import.meta.url), 'utf8'));
  db.exec('PRAGMA foreign_keys = ON');
  const at = '2026-11-14T00:00:00.000Z';
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('project', dir, 'Synthetic', at, at);
  db.prepare('INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('fake', '{}', 1, 'local-cli');
  for (let i = 1; i <= sessions; i++) {
    db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(`session-${i}`, 'project', 'fake', 'pty', 'idle', at, at);
  }
  const methods = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'synthetic-key' });
  const call = async (method: string, params: any) => methods.get(method)!.handler(params, { ui: false, origin: 'test' }) as any;
  const show = (i: number, surface: string, title: string, spec: unknown) => call('ui.show', { session_id: `session-${i}`, surface, zone: 'tab', title, catalogue: '1', spec });
  return { dir, db, call, show };
}

const runSummary = (i: number) => ({
  type: 'page',
  children: [
    { type: 'text', text: `Run r${i}` },
    { type: 'text', text: 'Status' },
    { type: 'log', lines: ['start', `step ${i}`, `done ${i * 7}`] },
  ],
});

test('three synthetic transcripts with one repeated screen produce one proposed template', async t => {
  const { show, db } = await setup(t, 3);
  for (let i = 1; i <= 3; i++) await show(i, `run-${i}`, 'Run summary', runSummary(i));
  await show(1, 'other-1', 'Other', { type: 'page', children: [{ type: 'text', text: 'only here' }] });
  await show(1, 'pair-1', 'Pair', { type: 'page', children: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] });
  await show(2, 'pair-2', 'Pair', { type: 'page', children: [{ type: 'text', text: 'c' }, { type: 'text', text: 'd' }] });

  const got = proposeTemplates(db);
  assert.equal(got.length, 1);
  const p = got[0];
  assert.equal(p.name, 'run-summary');
  assert.equal(p.sessions, 3);
  assert.equal(p.kept, true);
  assert.equal(p.why, undefined);
  assert.deepEqual(p.template, {
    type: 'page',
    children: [
      { type: 'text', text: '{{g1}}' },
      { type: 'text', text: 'Status' },
      { type: 'log', lines: ['start', '{{g2}}', '{{g3}}'] },
    ],
  });
});

test('a template that loses on replay is dropped', async t => {
  const { show, db, dir, call } = await setup(t, 3);
  const spec = (i: number) => ({ type: 'page', children: [{ type: 'text', text: `Run r${i}` }, { type: 'text', text: 'keep {{x}}' }] });
  for (let i = 1; i <= 3; i++) await show(i, `loss-${i}`, 'Lossy', spec(i));
  const got = proposeTemplates(db);
  assert.equal(got.length, 1);
  assert.equal(got[0].kept, false);
  assert.ok(got[0].why);
  const { proposals } = await call('templates.proposals', {});
  assert.equal(proposals[0].kept, false);
  await assert.rejects(call('templates.keep', { name: 'lossy' }), (e: any) => e.code === -32003);
  assert.equal(existsSync(join(dir, 'templates', 'lossy.json')), false);
});

test('keeping a proposal saves it where use parts find it', async t => {
  const { show, db, dir, call } = await setup(t, 4);
  for (let i = 1; i <= 3; i++) await show(i, `run-${i}`, 'Run summary', runSummary(i));
  const kept = keepTemplate(db, 'run-summary');
  assert.equal(kept.name, 'run-summary');
  const file = join(dir, 'templates', 'run-summary.json');
  assert.equal(existsSync(file), true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).children[0], { type: 'text', text: '{{g1}}' });

  for (const bad of ['Bad Name', '', 'a/b', 5]) assert.throws(() => keepTemplate(db, bad), (e: any) => e.code === -32602);

  const data = lineUp([1, 2, 3].map(runSummary)).values[0];
  const res = await call('ui.show', { session_id: 'session-4', surface: 'again', zone: 'tab', title: 'Again', catalogue: '1', spec: { type: 'page', children: [{ type: 'use', template: 'run-summary', data }] } });
  assert.deepEqual(res.fellBack, []);
  assert.equal(res.status, 'drawn');
});
