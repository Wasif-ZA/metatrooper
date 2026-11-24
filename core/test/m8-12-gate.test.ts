import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openCoreDb } from '../src/store/db.ts';
import { isolation, withEnv, until } from './helpers.ts';
import { installPlugin } from '../src/plugins/store.ts';
import { runEngine } from '../src/plugins/engine-run.ts';
import { Approvals } from '../src/approvals.ts';

const SCRIPT = `
const fs = require('fs');
const path = require('path');
const req = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.writeFileSync(path.join(req.project, 'published.marker'), 'ran');
console.log(JSON.stringify({ ok: true, outputs: { posted: true } }));
`;
const OLD_APPROVAL = `CREATE TABLE approval (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES session(id),
  surface TEXT NOT NULL CHECK (surface IN ('browser','desktop')),
  target TEXT NOT NULL, control TEXT, action TEXT NOT NULL, action_hash TEXT NOT NULL, summary TEXT NOT NULL, reason TEXT NOT NULL, shot TEXT,
  status TEXT NOT NULL CHECK (status IN ('waiting','approved','rejected','expired')),
  scope TEXT CHECK (scope IN ('once','session')), created_at TEXT NOT NULL, decided_at TEXT
)`;
const INPUT = { channel: '#general', text: 'hi' };

function harness(t: any, timeoutMs = 60_000) {
  const isolated = isolation();
  const env = { METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix };
  const db = withEnv(env, openCoreDb);
  t.after(() => { db.close(); rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const source = join(isolated.home, 'src-publish');
  mkdirSync(join(source, 'bin'), { recursive: true });
  writeFileSync(join(source, 'bin', 'publish.js'), SCRIPT);
  const manifest = {
    schema: 1, id: 'fake-publish', version: '1.0.0', name: 'fake-publish', permissions: ['run:write', 'project:write'], platforms: ['windows', 'linux', 'macos'],
    actions: [{ id: 'publish', run: ['bin/publish.js'], external: true, destination_field: 'channel' }],
  };
  writeFileSync(join(source, 'troop-plugin.json'), JSON.stringify(manifest));
  withEnv(env, () => installPlugin(db, { source, approved_permissions: ['run:write', 'project:write'] }));
  const project = join(isolated.home, 'project');
  mkdirSync(project, { recursive: true });
  const at = '2026-11-24T00:00:00.000Z';
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('project', project, 'Synthetic', at, at);
  db.prepare('INSERT OR IGNORE INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('fake', '{}', 1, 'local-cli');
  db.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('session-a', 'project', 'fake', 'pty', 'idle', at, at);
  const approvals = new Approvals(db, timeoutMs, () => []);
  const run = (input: Record<string, unknown> = INPUT) => withEnv(env, () => runEngine(db, { session_id: 'session-a', engine: 'fake-publish', action: 'publish', input }, approvals));
  const waiting = (n = 1) => until(() => {
    const rows = db.prepare("SELECT * FROM approval WHERE surface = 'engine' AND status = 'waiting'").all() as any[];
    return rows.length >= n ? rows : null;
  });
  const marker = () => existsSync(join(project, 'published.marker'));
  return { db, approvals, run, waiting, marker, isolated, env };
}

test('a publish action creates a pending approval and runs nothing until it is approved', async (t) => {
  const h = harness(t);
  const pending = h.run();
  const [row] = await h.waiting();
  assert.equal(row.action, 'run');
  assert.equal(row.target, 'fake-publish');
  assert.match(row.summary, /fake-publish/);
  assert.match(row.summary, /publish/);
  assert.match(row.summary, /#general/);
  assert.equal(h.marker(), false);
  const ny = h.db.prepare("SELECT * FROM needs_you WHERE kind = 'approval' AND ref = ?").all(row.id);
  assert.equal(ny.length, 1);
  h.approvals.resolve({ approval_id: row.id, decision: 'approve' });
  const res = await pending;
  assert.equal(res.status, 'ok');
  assert.equal(h.marker(), true);
});

test('a rejected or timed-out publish runs nothing', async (t) => {
  const h = harness(t);
  const pending = h.run();
  const [row] = await h.waiting();
  h.approvals.resolve({ approval_id: row.id, decision: 'reject' });
  await assert.rejects(pending, (e: any) => e.code === -32003 && /rejected/.test(e.message));
  assert.equal(h.marker(), false);

  const slow = harness(t, 50);
  await assert.rejects(slow.run(), (e: any) => e.code === -32003 && /not approved in time/.test(e.message));
  assert.equal(slow.marker(), false);
});

test('an engine approval is never reused for the session', async (t) => {
  const h = harness(t);
  const first = h.run();
  const [row] = await h.waiting();
  h.approvals.resolve({ approval_id: row.id, decision: 'approve', scope: 'session' });
  await first;
  const second = h.run();
  const [again] = await h.waiting();
  assert.notEqual(again.id, row.id);
  h.approvals.resolve({ approval_id: again.id, decision: 'reject' });
  await assert.rejects(second, (e: any) => e.code === -32003);
});

test('the engine surface takes only the run action', async (t) => {
  const h = harness(t);
  const base = { session_id: 'session-a', target: 'fake-publish', args: {}, control: null };
  await assert.rejects(h.approvals.check({ ...base, surface: 'engine', action: 'click' }), (e: any) => e.code === -32602);
  await assert.rejects(h.approvals.check({ ...base, surface: 'browser', action: 'run' }), (e: any) => e.code === -32602);
});

test('an old database learns the engine surface', (t) => {
  const isolated = isolation();
  const env = { METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix };
  t.after(() => rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  const first = withEnv(env, openCoreDb);
  const at = '2026-11-24T00:00:00.000Z';
  first.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('project', isolated.home, 'Synthetic', at, at);
  first.prepare('INSERT OR IGNORE INTO engine (id, spec_json, cost_rank, provider) VALUES (?, ?, ?, ?)').run('fake', '{}', 1, 'local-cli');
  first.prepare('INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run('session-a', 'project', 'fake', 'pty', 'idle', at, at);
  first.exec('PRAGMA foreign_keys = OFF');
  first.exec('DROP TABLE approval');
  first.exec(OLD_APPROVAL);
  const insert = (db: any) => db.prepare("INSERT INTO approval (id, session_id, surface, target, action, action_hash, summary, reason, status, created_at) VALUES ('ap_1', 'session-a', 'engine', 'p', 'run', 'h', 's', 'leaves this machine', 'waiting', ?)").run(at);
  assert.throws(() => insert(first), /CHECK/);
  first.close();
  const db = withEnv(env, openCoreDb);
  try {
    insert(db);
    assert.equal((db.prepare("SELECT surface FROM approval WHERE id = 'ap_1'").get() as any).surface, 'engine');
  } finally { db.close(); }
});

test('a plugin file changed while the gate waits runs nothing after approval', async (t) => {
  const h = harness(t);
  const pending = h.run();
  const [row] = await h.waiting();
  const { path: dir } = h.db.prepare("SELECT path FROM plugin WHERE id = 'fake-publish'").get() as { path: string };
  appendFileSync(join(dir, 'bin', 'publish.js'), '\n// changed while waiting\n');
  h.approvals.resolve({ approval_id: row.id, decision: 'approve' });
  await assert.rejects(pending, (e: any) => e.code === -32003 && /publish\.js/.test(e.message));
  assert.equal(h.marker(), false);
});

test('the gate shows what leaves and names the destination', async (t) => {
  const h = harness(t);
  const token = 'sk-abcdefghijklmnopqrstuvwxyz123456';
  const first = h.run({ channel: '#general', text: 'ship v2 today', token });
  const [row] = await h.waiting();
  assert.match(row.summary, /#general/);
  assert.match(row.summary, /ship v2 today/);
  assert.ok(!row.summary.includes(token));
  h.approvals.resolve({ approval_id: row.id, decision: 'reject' });
  await assert.rejects(first, (e: any) => e.code === -32003);

  const second = h.run({ text: 'no destination' });
  const [again] = await h.waiting();
  assert.match(again.summary, /a destination the plugin does not name/);
  h.approvals.resolve({ approval_id: again.id, decision: 'reject' });
  await assert.rejects(second, (e: any) => e.code === -32003);
});

test('a plugin reinstalled while the gate waits does not run on the old approval', async (t) => {
  const h = harness(t);
  const pending = h.run();
  const [row] = await h.waiting();
  const source = join(h.isolated.home, 'src-publish');
  writeFileSync(join(source, 'bin', 'publish.js'), SCRIPT + '\n// reinstalled\n');
  const manifestPath = join(source, 'troop-plugin.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '1.0.1' }));
  withEnv(h.env, () => installPlugin(h.db, { source, approved_permissions: ['run:write', 'project:write'] }));
  h.approvals.resolve({ approval_id: row.id, decision: 'approve' });
  await assert.rejects(pending, (e: any) => e.code === -32003 && /updated while the approval waited/.test(e.message));
  assert.equal(h.marker(), false);
});

test('a long input preview says how much more there is', async (t) => {
  const h = harness(t);
  const pending = h.run({ channel: '#general', text: 'x'.repeat(400) });
  const [row] = await h.waiting();
  assert.match(row.summary, /more characters/);
  h.approvals.resolve({ approval_id: row.id, decision: 'reject' });
  await assert.rejects(pending, (e: any) => e.code === -32003);
});
