import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildMethods } from '../src/methods.ts';
import { issueSecret } from '../src/sessions/secret.ts';
import { schemaFile } from '../src/paths.ts';
import { withEnv } from './helpers.ts';

const NEEDS_UI = -32012;
const NOT_FOUND = -32002;

const home = mkdtempSync(join(tmpdir(), 'm8-12-proof-'));
after(() => rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));

const db = new DatabaseSync(':memory:');
db.exec(readFileSync(schemaFile, 'utf8'));
db.exec('PRAGMA foreign_keys = OFF');
db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
const addSession = db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p', 'fake', 'pty', 'idle', 'x', 'x')");
addSession.run('sess-a');
addSession.run('sess-b');
const secretA = issueSecret('sess-a', 'ask');

const engineRun = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'k' }).get('engine.run')!.handler as (p: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<unknown>;
const run = async (p: Record<string, unknown>, ctx: Record<string, unknown>) => await withEnv({ METATROOPER_HOME: home }, () => engineRun({ engine: 'x', action: 'y', ...p }, ctx));
const cli = { ui: false, origin: 'cli' };
const code = (c: number) => (e: { code?: number }) => e.code === c;

test('a direct engine.run naming a session without its secret is refused', async () => {
  await assert.rejects(run({ session_id: 'sess-a' }, cli), code(NEEDS_UI));
});

test('a session secret proves only its own session', async () => {
  await assert.rejects(run({ session_id: 'sess-b', session_secret: secretA }, cli), code(NEEDS_UI));
  await assert.rejects(run({ session_id: 'sess-a', session_secret: secretA }, cli), code(NOT_FOUND));
});

test('an in-process caller\'s proven session is accepted and params cannot set it', async () => {
  await assert.rejects(run({ session_id: 'sess-a' }, { ...cli, session: 'sess-a' }), code(NOT_FOUND));
  await assert.rejects(run({ session_id: 'sess-a', session: 'sess-a' }, cli), code(NEEDS_UI));
  await assert.rejects(run({ session_id: 'sess-b' }, { ...cli, session: 'sess-a' }), code(NEEDS_UI));
});

test('the UI may run engine.run', async () => {
  await assert.rejects(run({ session_id: 'sess-a' }, { ui: true, origin: 'ui' }), code(NOT_FOUND));
});
