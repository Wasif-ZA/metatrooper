import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildMethods } from '../src/methods.ts';
import { schemaFile } from '../src/paths.ts';

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
