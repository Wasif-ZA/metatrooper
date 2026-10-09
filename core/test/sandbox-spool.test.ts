import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openCoreDb, allowSandbox } from '../src/store/db.ts';
import { ingestSpools, spoolDir } from '../src/sandbox/spool.ts';
import { withEnv } from './helpers.ts';

const root = path.resolve(import.meta.dirname, '../..');
const session = (db: DatabaseSync, id: string, state = 'working') => {
  db.prepare("INSERT INTO project (id,path,name,opened_at,last_opened) VALUES ('p','/p','p','now','now')").run();
  db.prepare("INSERT INTO engine (id,spec_json,cost_rank,provider) VALUES ('e','{}',1,'local-cli')").run();
  db.prepare("INSERT INTO session (id,project_id,engine_id,host,state,state_at,started_at) VALUES (?,'p','e','sandbox',?,'now','now')").run(id, state);
};
const eventLines = (dir: string) => path.join(dir, 'events.ndjson');

function isolated<T>(fn: (home: string, db: DatabaseSync) => T): T {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-spool-'));
  return withEnv({ METATROOPER_HOME: home }, () => {
    const db = openCoreDb();
    try { return fn(home, db); }
    finally { db.close(); fs.rmSync(home, { recursive: true, force: true }); }
  });
}

test('event.js spools only redacted hook payloads and ingest preserves order, session, and source', () => isolated((home, db) => {
  const id = 'sandbox-ingest';
  session(db, id);
  const dir = spoolDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const marker = 'SPOOL_SECRET_MARKER_7d4d';
  const payload = { session_id: 'untrusted-session', cwd: '/work', prompt: marker, tool_name: 'Bash', tool_input: { command: marker }, tool_response: marker, message: marker };
  const run = spawnSync(process.execPath, [path.join(root, 'core/event.js'), 'claude.UserPromptSubmit'], { cwd: root, env: { ...process.env, METATROOPER_HOME: home, METATROOPER_SPOOL: dir, TROOP_SESSION_ID: id }, input: JSON.stringify(payload), encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const encoded = fs.readFileSync(eventLines(dir), 'utf8');
  assert.ok(encoded.length > 0);
  assert.equal(encoded.includes(marker), false);
  fs.appendFileSync(eventLines(dir), [
    JSON.stringify({ kind: 'claude.Stop', payload: { session_id: 'wrong', cwd: '/w', stop_hook_active: true } }),
    JSON.stringify({ kind: 'codex.turn', payload: { type: 'turn', 'thread-id': 't' } }),
    '{bad json}', JSON.stringify({ kind: 'core.activity', payload: { state: marker } }),
  ].join('\n') + '\n');
  ingestSpools(db);
  const rows = db.prepare('SELECT source,session_id,kind,payload FROM event ORDER BY seq').all() as Array<{source:string;session_id:string;kind:string;payload:string}>;
  assert.deepEqual(rows.map(r => [r.kind, r.source]), [['claude.UserPromptSubmit','claude-hook'], ['claude.Stop','claude-hook'], ['codex.turn','codex-notify']]);
  assert.ok(rows.every(r => r.session_id === id));
  assert.equal(JSON.stringify(rows).includes(marker), false);
  const offset = db.prepare('SELECT value FROM meta WHERE key = ?').get(`spool_offset:${id}`) as {value:string};
  assert.equal(Number(offset.value), fs.statSync(eventLines(dir)).size);
}));

test('ingest skips oversized lines, holds an incomplete tail, and records offsets', () => isolated((home, db) => {
  const id = 'sandbox-lines';
  session(db, id);
  const dir = spoolDir(id); fs.mkdirSync(dir, { recursive: true });
  const valid = JSON.stringify({ kind: 'claude.Stop', payload: { stop_hook_active: false } });
  fs.writeFileSync(eventLines(dir), `${'x'.repeat(64 * 1024 + 1)}\n${valid}\n${JSON.stringify({ kind: 'codex.turn', payload: {} })}`);
  ingestSpools(db);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM event').get() as {n:number}).n, 1);
  const key = `spool_offset:${id}`;
  const offset = Number((db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as {value:string}).value);
  assert.equal(offset, 64 * 1024 + 2 + valid.length + 1);
  fs.appendFileSync(eventLines(dir), '\n');
  ingestSpools(db);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM event').get() as {n:number}).n, 2);
  assert.equal(Number((db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as {value:string}).value), fs.statSync(eventLines(dir)).size);
}));

test('oversized spool creates exactly one notice and inserts no events', () => isolated((home, db) => {
  const id = 'sandbox-oversized';
  session(db, id);
  const dir = spoolDir(id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(eventLines(dir), Buffer.alloc(10 * 1024 * 1024 + 1, 120));
  ingestSpools(db); ingestSpools(db);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM event').get() as {n:number}).n, 0);
  assert.equal((db.prepare("SELECT COUNT(*) n FROM needs_you WHERE kind='spool-too-large' AND ref=?").get(id) as {n:number}).n, 1);
}));

test('exit ingests complete lines, drops a partial line, then removes spool and offset', () => isolated((home, db) => {
  const id = 'sandbox-exited';
  session(db, id, 'exited');
  const dir = spoolDir(id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(eventLines(dir), JSON.stringify({ kind: 'claude.Stop', payload: {} }) + '\n' + JSON.stringify({ kind: 'claude.Stop', payload: {} }));
  db.prepare('INSERT INTO meta (key,value) VALUES (?,?)').run(`spool_offset:${id}`, '0');
  ingestSpools(db);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM event').get() as {n:number}).n, 1);
  assert.equal(fs.existsSync(dir), false);
  assert.equal(db.prepare('SELECT value FROM meta WHERE key=?').get(`spool_offset:${id}`), undefined);
}));

test('after exit the marker is absent from every table, home file, database, and WAL', () => isolated((home, db) => {
  const id = 'sandbox-no-marker'; const marker = 'NO_PERSIST_MARKER_a90c';
  session(db, id, 'exited');
  const dir = spoolDir(id); fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(eventLines(dir), JSON.stringify({ kind: 'claude.UserPromptSubmit', payload: { prompt: marker, prompt_length: marker.length } }) + '\n');
  ingestSpools(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{name:string}>;
  for (const {name} of tables) {
    const cols = db.prepare(`PRAGMA table_info("${name.replaceAll('"','""')}")`).all() as Array<{name:string;type:string}>;
    for (const col of cols.filter(c => /CHAR|TEXT|CLOB/i.test(c.type))) {
      const sql = `SELECT "${col.name.replaceAll('"','""')}" AS value FROM "${name.replaceAll('"','""')}"`;
      assert.ok((db.prepare(sql).all() as Array<{value:unknown}>).every(row => !String(row.value ?? '').includes(marker)), `${name}.${col.name} contains marker`);
    }
  }
  for (const file of allFiles(home)) assert.equal(fs.readFileSync(file).includes(marker), false, `${file} contains marker`);
  assert.equal(fs.existsSync(dir), false);
}));

function allFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const p = path.join(dir, entry.name);
    return entry.isDirectory() ? allFiles(p) : [p];
  });
}

test('allowSandbox rebuilds a legacy session CHECK to allow sandbox, keeps every row and is idempotent', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'sandbox-legacy-'));
  withEnv({ METATROOPER_HOME: home }, () => {
  const file = path.join(home, 'troop.db');
  const legacy = new DatabaseSync(file);
  legacy.exec("CREATE TABLE session (id TEXT PRIMARY KEY, host TEXT NOT NULL CHECK (host IN ('pty')), project_id TEXT NOT NULL, engine_id TEXT NOT NULL, driven_engine TEXT, pid INTEGER, native_id TEXT, run_id TEXT, step_id TEXT, state TEXT, state_at TEXT, last_tool TEXT, cwd TEXT, title TEXT, last_line TEXT, turn_base TEXT, hidden INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL, ended_at TEXT)");
  legacy.exec("INSERT INTO session (id,host,project_id,engine_id,state,state_at,started_at) VALUES ('keep','pty','p','e','working','now','now')");
  legacy.exec("CREATE TABLE project (id TEXT PRIMARY KEY)");
  legacy.exec("CREATE TABLE engine (id TEXT PRIMARY KEY)");
  legacy.exec("INSERT INTO project VALUES ('p')");
  legacy.exec("INSERT INTO engine VALUES ('e')");
  legacy.exec("CREATE TABLE needs_you (id TEXT PRIMARY KEY, at TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('other')), ref TEXT, text TEXT NOT NULL)");
  legacy.exec("INSERT INTO needs_you (id,at,kind,text) VALUES ('n','now','other','preserved')");
  allowSandbox(legacy);
  const after = legacy.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='session'").get() as {sql:string};
  assert.ok(after.sql?.includes("'sandbox'"));
  assert.ok(after.sql?.includes("'external'"));
  assert.ok(after.sql?.includes('parent_id'));
  assert.ok((legacy.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='needs_you'").get() as {sql:string}).sql.includes("'uncommitted'"));
  assert.equal((legacy.prepare('SELECT COUNT(*) n FROM session').get() as {n:number}).n, 1);
  assert.equal((legacy.prepare('SELECT COUNT(*) n FROM needs_you').get() as {n:number}).n, 1);
  allowSandbox(legacy);
  assert.equal((legacy.prepare('SELECT COUNT(*) n FROM session').get() as {n:number}).n, 1);
  assert.equal((legacy.prepare('SELECT COUNT(*) n FROM needs_you').get() as {n:number}).n, 1);
  legacy.close();
  const reopened = new DatabaseSync(file);
  allowSandbox(reopened);
  assert.equal((reopened.prepare('SELECT COUNT(*) n FROM session').get() as {n:number}).n, 1);
  assert.equal((reopened.prepare('SELECT COUNT(*) n FROM needs_you').get() as {n:number}).n, 1);
  reopened.close();
  });
  fs.rmSync(home, { recursive: true, force: true });
});
