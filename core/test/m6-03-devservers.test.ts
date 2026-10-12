import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { root } from './helpers.ts';
import { devServersGone, pollDevServers, probe, scanOutput } from '../src/devservers.ts';

// Netstat and the process table are stubbed, so these run on any platform without a pty.
const db = new DatabaseSync(':memory:');
const OWNER = 4242;

before(() => {
  db.exec(readFileSync(join(root, 'contracts', 'schema.sql'), 'utf8'));
  const at = new Date().toISOString();
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p-dev', '.', 'dev', ?, ?)").run(at, at);
  db.prepare("INSERT OR IGNORE INTO engine (id, spec_json, cost_rank) VALUES ('fake', '{}', 1)").run();
  probe.parentTableAsync = async () => new Map([[OWNER, 1]]);
});

function session(): string {
  const id = `s-${randomUUID()}`;
  const at = new Date().toISOString();
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at) VALUES (?, 'p-dev', 'fake', 'pty', 'working', ?, ?)").run(id, at, at);
  return id;
}

function rows(sessionId: string) {
  return db.prepare('SELECT port, pid, matched_by, status FROM session_dev_server WHERE session_id = ?').all(sessionId).map((r) => ({ ...r }));
}

/** Netstat output with each port listening on 127.0.0.1 under OWNER. */
function listen(...ports: number[]): () => Promise<string> {
  return async () => ports.map((p) => `  TCP    127.0.0.1:${p}         0.0.0.0:0              LISTENING       ${OWNER}`).join('\r\n');
}

// First in the file: no netstat has run yet, so the snapshot is stale, as on a core whose first terminal just opened.
test('M6-03 a URL printed while the snapshot is stale is judged by the next netstat, so a detached server that listens later gets a printed row', async () => {
  const id = session();
  probe.netstat = listen();
  scanOutput(db, id, 'dev server: http://localhost:5301/\n');
  await pollDevServers(db);
  probe.netstat = listen(5301);
  await pollDevServers(db);
  assert.deepEqual(rows(id), [{ port: 5301, pid: OWNER, matched_by: 'printed', status: 'ready' }]);
});

test('M6-03 a terminal that exits while ownership is being decided leaves no ready row', async () => {
  const id = session();
  probe.netstat = listen();
  scanOutput(db, id, 'dev server: http://localhost:5302/\n');
  await pollDevServers(db);
  const table = probe.parentTableAsync;
  probe.parentTableAsync = async () => { devServersGone(db, id); return table(); };
  try {
    probe.netstat = listen(5302);
    await pollDevServers(db);
  } finally {
    probe.parentTableAsync = table;
  }
  assert.deepEqual(rows(id), []);
});
