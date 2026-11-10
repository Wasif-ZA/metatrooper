import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { openCoreDb } from '../src/store/db.ts';
import { buildMethods } from '../src/methods.ts';
import { settings, settingsFile } from '../src/settings.ts';
import { CommandRunner } from '../src/pipe/commands.ts';
import { startPipeServer } from '../src/pipe/server.ts';
import { client, pipePath } from './helpers.ts';

function fixture() {
  const previous = process.env.METATROOPER_HOME;
  const home = mkdtempSync(join(tmpdir(), 'lend-core-'));
  process.env.METATROOPER_HOME = home;
  const db = openCoreDb();
  db.exec(`INSERT INTO project (id,path,name,opened_at,last_opened) VALUES ('A','/synthetic/a','A','x','x'),('B','/synthetic/b','B','x','x');
    INSERT INTO engine (id,spec_json,cost_rank) VALUES ('codex','{}',1);
    INSERT INTO session (id,project_id,engine_id,host,state,state_at,started_at) VALUES ('sA','A','codex','external','idle','x','x'),('sB','B','codex','external','idle','x','x');`);
  const methods = buildMethods(db, {} as never);
  const call = (name: string, params: Record<string, unknown>) => methods.get(name)!.handler(params, { ui: true, origin: 'test' }) as any;
  return { home, db, methods, call, close() { db.close(); rmSync(home, { recursive: true, force: true }); if (previous === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = previous; } };
}
const code = (expected: number) => (error: any) => { assert.equal(error.code, expected); return true; };

test('browser.lent defaults to an empty map in the isolated user settings', () => {
  const h = fixture();
  try { assert.deepEqual(settings().browser.lent, {}); assert.equal(settingsFile(), join(h.home, 'settings.json')); }
  finally { h.close(); }
});

test('lend.set normalises, deduplicates, separates schemes and projects, persists and removes empty keys', () => {
  const h = fixture();
  try {
    assert.deepEqual(h.call('lend.set', { project_id: 'A', origin: 'https://shop.example/path?q=1', on: true }), { sites: ['https://shop.example'] });
    assert.deepEqual(h.call('lend.set', { project_id: 'A', origin: 'https://shop.example/', on: true }), { sites: ['https://shop.example'] });
    assert.deepEqual(h.call('lend.set', { project_id: 'A', origin: 'http://shop.example/', on: true }), { sites: ['https://shop.example', 'http://shop.example'] });
    assert.deepEqual(settings().browser.lent, { A: ['https://shop.example', 'http://shop.example'] });
    assert.deepEqual(JSON.parse(readFileSync(join(h.home, 'settings.json'), 'utf8')).browser.lent, { A: ['https://shop.example', 'http://shop.example'] });
    assert.deepEqual(h.call('lend.set', { project_id: 'B', origin: 'https://other.example/', on: true }), { sites: ['https://other.example'] });
    assert.deepEqual(h.call('lend.set', { project_id: 'A', origin: 'https://shop.example/else', on: false }), { sites: ['http://shop.example'] });
    assert.deepEqual(h.call('lend.set', { project_id: 'A', origin: 'http://shop.example/', on: false }), { sites: [] });
    assert.deepEqual(settings().browser.lent, { B: ['https://other.example'] });
    assert.deepEqual(h.call('lend.set', { project_id: 'A', origin: 'https://absent.example', on: false }), { sites: [] });
  } finally { h.close(); }
});

test('lend RPCs reject invalid schemes, unknown records and non-boolean on without side effects', () => {
  const h = fixture();
  try {
    for (const origin of ['file:///tmp/x', 'data:text/html,x', 'ftp://shop.example', 'javascript:1', 'not a url']) {
      assert.throws(() => h.call('lend.set', { project_id: 'A', origin, on: true }), code(-32602));
      assert.throws(() => h.call('lend.ask', { session_id: 'sA', origin }), code(-32602));
    }
    for (const on of [undefined, 1, 'true', null]) assert.throws(() => h.call('lend.set', { project_id: 'A', origin: 'https://shop.example', on }), code(-32602));
    assert.throws(() => h.call('lend.set', { project_id: 'missing', origin: 'https://shop.example', on: true }), code(-32002));
    assert.throws(() => h.call('lend.ask', { session_id: 'missing', origin: 'https://shop.example' }), code(-32002));
    assert.deepEqual(settings().browser.lent, {});
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM needs_you').get()!.n, 0);
  } finally { h.close(); }
});

test('lend.ask creates one literal open request per project and origin and lend.set resolves only that request', () => {
  const h = fixture();
  try {
    h.call('lend.ask', { session_id: 'sA', origin: 'https://shop.example/path' });
    h.call('lend.ask', { session_id: 'sA', origin: 'https://shop.example/' });
    const rows = () => h.db.prepare('SELECT kind,ref,text,resolved_at FROM needs_you ORDER BY rowid').all().map(r => ({ ...r }));
    assert.deepEqual(rows(), [{ kind: 'other', ref: 'lend:A https://shop.example', text: 'codex wants to use your sign-in on https://shop.example', resolved_at: null }]);
    h.call('lend.ask', { session_id: 'sB', origin: 'https://shop.example' });
    h.call('lend.set', { project_id: 'A', origin: 'https://shop.example/', on: true });
    assert.equal(typeof rows()[0].resolved_at, 'string');
    assert.equal(rows()[1].resolved_at, null);
    h.call('lend.ask', { session_id: 'sA', origin: 'https://shop.example' });
    assert.equal(rows().length, 3);
    h.call('lend.set', { project_id: 'A', origin: 'https://shop.example', on: false });
    assert.equal(typeof rows()[2].resolved_at, 'string');
    assert.equal(rows()[1].resolved_at, null);
  } finally { h.close(); }
});

test('pane.open lent requires an agent, a session and an origin lent in this project with no rejected rows', () => {
  const h = fixture();
  try {
    h.call('lend.set', { project_id: 'A', origin: 'https://shop.example', on: true });
    for (const params of [
      { project_id: 'A', session_id: 'sA', url: 'https://shop.example', lent: true },
      { project_id: 'A', agent: true, url: 'https://shop.example', lent: true },
      { project_id: 'A', session_id: 'sA', agent: true, lent: true },
      { project_id: 'A', session_id: 'sA', agent: true, url: 'https://other.example', lent: true },
      { project_id: 'A', session_id: 'sA', agent: true, url: 'http://shop.example', lent: true },
      { project_id: 'B', session_id: 'sB', agent: true, url: 'https://shop.example', lent: true },
      { project_id: 'A', session_id: 'sA', agent: true, url: 'file:///tmp/x', lent: true },
    ]) {
      assert.throws(() => h.call('pane.open', params), code(-32602));
      assert.equal(h.db.prepare('SELECT count(*) AS n FROM browser_pane').get()!.n, 0);
    }
    const lent = h.call('pane.open', { project_id: 'A', session_id: 'sA', agent: true, url: 'https://shop.example/path', lent: true });
    assert.match(lent.pane_id, /^bp_agent_/);
    const ordinary = h.call('pane.open', { project_id: 'A', session_id: 'sA', agent: true });
    const user = h.call('pane.open', { project_id: 'A' });
    for (const [id, expected] of [[lent.pane_id, 1], [ordinary.pane_id, 0], [user.pane_id, 0]]) assert.equal(h.db.prepare('SELECT lent FROM browser_pane WHERE id=?').get(id)!.lent, expected);
  } finally { h.close(); }
});

test('opening an old database adds lent with zero on existing rows and survives reopening', () => {
  const h = fixture();
  try {
    h.call('pane.open', { project_id: 'A', session_id: 'sA', agent: true });
    h.db.exec('ALTER TABLE browser_pane DROP COLUMN lent');
    const migrated = openCoreDb();
    assert.equal(migrated.prepare('SELECT lent FROM browser_pane').get()!.lent, 0);
    const column = migrated.prepare('PRAGMA table_info(browser_pane)').all().find(r => r.name === 'lent')!;
    assert.equal(column.notnull, 1);
    assert.equal(column.dflt_value, '0');
    migrated.close();
    const reopened = openCoreDb();
    assert.equal(reopened.prepare('SELECT lent FROM browser_pane').get()!.lent, 0);
    reopened.close();
  } finally { h.close(); }
});

test('a pipe connection without ui.hello cannot lend or change browser.lent even with a forged UI origin', async () => {
  const h = fixture();
  const prefix = 'lend-' + randomUUID();
  const pipe = pipePath(prefix);
  const server = await startPipeServer(pipe, Promise.resolve({ runner: new CommandRunner(h.db, h.methods), uiKey: 'synthetic-ui-key' }));
  const agent = await client(prefix);
  try {
    for (const [method, params] of [
      ['lend.set', { project_id: 'A', origin: 'https://shop.example', on: true }],
      ['lend.ask', { session_id: 'sA', origin: 'https://shop.example' }],
      ['settings.set', { section: 'browser', key: 'lent', value: { A: ['https://shop.example'] } }],
    ] as const) {
      const response: any = await agent.request(method, params, { meta: { origin: 'ui' } });
      assert.equal(response.error?.code, -32012);
    }
    assert.deepEqual(settings().browser.lent, {});
    assert.equal(h.db.prepare('SELECT count(*) AS n FROM needs_you').get()!.n, 0);
    const hello: any = await agent.request('ui.hello', { ui_key: 'synthetic-ui-key' });
    assert.deepEqual(hello.result, { ok: true });
    const allowed: any = await agent.request('lend.set', { project_id: 'A', origin: 'https://shop.example', on: true });
    assert.deepEqual(allowed.result, { sites: ['https://shop.example'] });
  } finally { agent.close(); await new Promise<void>(resolve => server.close(() => resolve())); h.close(); }
});

test('navigate MCP schema exposes signed_in as a boolean', () => {
  const source = readFileSync(new URL('../src/hook/browser-mcp.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const pane =');
  const end = source.indexOf('const browser =');
  assert.ok(start >= 0 && end > start);
  const declarations = stripTypeScriptTypes(source.slice(start, end));
  const schema = runInNewContext(declarations + '; TOOLS.find(t => t.name === "navigate").inputSchema', { BATCH_MAX: 8, BATCH_TOOLS: [] });
  assert.deepEqual(JSON.parse(JSON.stringify(schema.properties.signed_in)), { type: 'boolean' });
  assert.deepEqual(JSON.parse(JSON.stringify(schema.required)), ['url']);
});


for (const on of [true, false]) test('lend.set on ' + on + ' preserves or closes only this projects open lent panes', () => {
  const h = fixture();
  try {
    h.call('lend.set', { project_id: 'A', origin: 'https://shop.example', on: true });
    h.call('lend.set', { project_id: 'A', origin: 'https://other.example', on: true });
    h.db.exec("INSERT INTO browser_pane (id, project_id, session_id, url, open, lent) VALUES " +
      "('bp_agent_shop','A','sA','https://shop.example/',1,1)," +
      "('bp_agent_other_site','A','sA','https://other.example/',1,1)," +
      "('bp_agent_closed','A','sA','https://shop.example/',0,1)," +
      "('bp_agent_plain','A','sA','https://shop.example/',1,0)," +
      "('bp_user','A',NULL,'https://shop.example/',1,0)," +
      "('bp_agent_project_b','B','sB','https://shop.example/',1,1)");
    const rows = () => h.db.prepare('SELECT id, open FROM browser_pane ORDER BY id').all().map(r => ({ ...r }));
    assert.deepEqual(rows(), [
      { id: 'bp_agent_closed', open: 0 }, { id: 'bp_agent_other_site', open: 1 },
      { id: 'bp_agent_plain', open: 1 }, { id: 'bp_agent_project_b', open: 1 },
      { id: 'bp_agent_shop', open: 1 }, { id: 'bp_user', open: 1 },
    ]);
    h.call('lend.set', { project_id: 'A', origin: 'https://shop.example/path', on });
    assert.deepEqual(rows(), on ? [
      { id: 'bp_agent_closed', open: 0 }, { id: 'bp_agent_other_site', open: 1 },
      { id: 'bp_agent_plain', open: 1 }, { id: 'bp_agent_project_b', open: 1 },
      { id: 'bp_agent_shop', open: 1 }, { id: 'bp_user', open: 1 },
    ] : [
      { id: 'bp_agent_closed', open: 0 }, { id: 'bp_agent_other_site', open: 0 },
      { id: 'bp_agent_plain', open: 1 }, { id: 'bp_agent_project_b', open: 1 },
      { id: 'bp_agent_shop', open: 0 }, { id: 'bp_user', open: 1 },
    ]);
  } finally { h.close(); }
});
