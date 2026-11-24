import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { coreMcpStdio } from '../src/hook/mcp-core.ts';
import { buildMethods } from '../src/methods.ts';
import { issueSecret } from '../src/sessions/secret.ts';
import { schemaFile } from '../src/paths.ts';
import { withEnv } from './helpers.ts';

const NEEDS_UI = -32012;
const NOT_FOUND = -32002;
const NOT_IN = 'this process is not inside a cc session';

const home = mkdtempSync(join(tmpdir(), 'm8-12-hello-'));
after(() => rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(schemaFile, 'utf8'));
db.exec('PRAGMA foreign_keys = OFF');
db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
const addSession = db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, pid) VALUES (?, 'p', 'fake', 'pty', 'idle', 'x', 'x', ?)");
addSession.run('victim', process.pid);
addSession.run('mine', null);
const secretMine = issueSecret('mine', 'ask');

const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
const runner = { call: async (req: { method: string; params: Record<string, unknown> }) => { calls.push(req); return { ok: true }; } };
const handler = coreMcpStdio(db, runner as never);
const call = async (hello: Record<string, unknown>, server: string, name: string, args: object) => {
  const reply: any = await handler({ server, ...hello }, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } } as never);
  return reply.result.content[0].text as string;
};
const steps = (sid: string) => (db.prepare("SELECT COUNT(*) AS n FROM event WHERE session_id = ? AND kind = 'core.steps'").get(sid) as { n: number }).n;

test('a forged mcp.stdio hello naming another live session by id or by pid gets no session', async () => {
  for (const hello of [{ session_id: 'victim' }, { session_id: 'victim', pid: process.pid }, { pid: process.pid }, { session_id: 'victim', session_secret: 'nope' }]) {
    assert.equal(await call(hello, 'steps', 'steps_set', { items: [{ text: 'x', done: false }] }), NOT_IN, JSON.stringify(hello));
    assert.equal(await call(hello, 'ui', 'ouros_engine', { engine: 'e', action: 'a' }), NOT_IN, JSON.stringify(hello));
  }
  assert.equal(steps('victim'), 0);
  assert.equal(calls.length, 0);
});

test('a hello with the right session_secret saves steps for its own session, even when it names another session_id', async () => {
  assert.equal(await call({ session_id: 'victim', session_secret: secretMine }, 'steps', 'steps_set', { items: [{ text: 'a', done: true }] }), 'saved 1 steps');
  assert.equal(steps('mine'), 1);
  assert.equal(steps('victim'), 0);
  await call({ session_secret: secretMine }, 'ui', 'ouros_engine', { engine: 'e', action: 'a' });
  assert.equal(calls.at(-1)?.params.session_id, 'mine');
});

test('engine.run through the session path refuses an unknown approval profile and passes the proof once one is issued', async () => {
  const run = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'k' }).get('engine.run')!.handler as (p: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>;
  const go = async () => await withEnv({ METATROOPER_HOME: home }, () => run({ engine: 'x', action: 'y', session_id: 'A' }, { ui: false, session: 'A' }));
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES ('A', 'p', 'fake', 'pty', 'idle', 'x', 'x')").run();
  await assert.rejects(go(), (e: { code?: number }) => e.code === NEEDS_UI);
  issueSecret('A', 'ask');
  await assert.rejects(go(), (e: { code?: number }) => e.code === NOT_FOUND);
});
