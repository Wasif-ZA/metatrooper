import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

// Stub the Electron import so the real browser server runs without an Electron process (same stub as browser-policy.test.ts).
async function load() {
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'electron' ? { url: 'test:electron', shortCircuit: true } : nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      return url === 'test:electron'
        ? { format: 'module', source: 'export const app = {}, clipboard = {}, Menu = {}, nativeImage = {}, session = {}, WebContentsView = {};', shortCircuit: true }
        : nextLoad(url, context);
    },
  });
  try {
    return await import('../src/browser/server.ts');
  } finally {
    hook.deregister();
  }
}

// The database is built from contracts/schema.sql, so session.browser_grant and the event table are the real ones.
function fixtureDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(readFileSync(new URL('../../contracts/schema.sql', import.meta.url), 'utf8'));
  db.exec('PRAGMA foreign_keys = OFF');
  const now = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)')
    .run('project-test', '/synthetic/m7-01', 'm7-01', now, now);
  const session = db.prepare("INSERT INTO session (id, project_id, engine_id, host, pid, state, state_at, started_at, browser_grant) VALUES (?, ?, 'claude', 'pty', ?, 'working', ?, ?, ?)");
  // Both sessions carry this test process's pid, so the caller's ancestry check passes for each.
  session.run('session-look', 'project-test', process.pid, now, now, 'look');
  session.run('session-none', 'project-test', process.pid, now, now, null);
  const pane = db.prepare('INSERT INTO browser_pane (id, project_id, session_id) VALUES (?, ?, ?)');
  pane.run('bp_look', 'project-test', 'session-look');
  pane.run('bp_none', 'project-test', 'session-none');
  return db;
}

type Conn = { sock: net.Socket; call: (method: string, params: object) => Promise<any> };

async function connect(pipe: string): Promise<Conn> {
  const sock = net.connect(pipe);
  await new Promise((resolve, reject) => { sock.once('connect', resolve); sock.once('error', reject); });
  let buf = '';
  const replies = new Map<string, any>();
  sock.setEncoding('utf8');
  sock.on('data', (chunk: string) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const message = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      replies.set(message.id, message);
    }
  });
  let seq = 0;
  return {
    sock,
    async call(method, params) {
      const id = `m${++seq}`;
      sock.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      for (let i = 0; i < 400 && !replies.has(id); i++) await new Promise((r) => setTimeout(r, 25));
      return replies.get(id);
    },
  };
}

async function setup() {
  const { startBrowserServer } = await load();
  const dir = mkdtempSync(join(tmpdir(), 'm7-01-grant-'));
  const db = fixtureDb(join(dir, 'troop.db'));
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\m701-grant-${randomUUID()}` : join(tmpdir(), `m701-grant-${randomUUID()}.sock`);
  // Records every pane method the server calls. A refused call must leave this list empty.
  const ran: string[] = [];
  const panes = new Proxy({}, {
    get: (_target, name) => (typeof name !== 'string' || name === 'then') ? undefined : (...args: unknown[]) => {
      ran.push(name);
      return { ok: true, value: 1 };
    },
  });
  const server = await startBrowserServer(pipe, { db: () => db, uiKey: () => null, panes: panes as never, refreshPanes: () => {}, openPane: async () => 'unused' });
  const socks: net.Socket[] = [];
  return {
    db, ran,
    async session(id: string) {
      const conn = await connect(pipe);
      socks.push(conn.sock);
      return conn;
    },
    done() {
      for (const sock of socks) sock.destroy();
      server.close();
      db.close();
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    },
  };
}

// The audit writes at most one browser.tool row per call; give a late write time to land before counting.
const settle = () => new Promise((r) => setTimeout(r, 200));

function toolRows(db: DatabaseSync): string[] {
  return db.prepare("SELECT payload FROM event WHERE kind = 'browser.tool'").all()
    .map((row: any) => JSON.parse(row.payload).tool);
}

// protects=the workbench checks the stored session grant on browser.evaluate, so a look session cannot run evaluate even over the pipe directly
// fails_when=evaluate runs for a look session, the refusal is not -32039, the message does not name debug, or a browser.tool row is written for the refused call
// no_claim=the MCP server's tools/list or its own refusal text (the MCP side is not built here)
test('M7-01a browser.evaluate on a look session fails -32039 naming debug and writes no browser.tool row', async (t) => {
  const h = await setup();
  t.after(() => h.done());
  const conn = await h.session('session-look');
  assert.equal((await conn.call('browser.hello', { session_id: 'session-look', pid: process.pid })).result?.bound, 'session');
  const reply = await conn.call('browser.evaluate', { pane_id: 'bp_look', expression: '1 + 1' });
  assert.equal(reply.error?.code, -32039, JSON.stringify(reply));
  assert.match(reply.error.message, /\bdebug\b/);
  await settle();
  assert.deepEqual(toolRows(h.db), [], 'the refused call wrote a browser.tool row');
  assert.deepEqual(h.ran, [], 'the refused call reached the pane');
});

// protects=browser.hello reports the session's stored grant, which tools/list relies on
// fails_when=hello omits grant or reports a different preset than the session row holds
// no_claim=what tools/list shows (the MCP side)
test('M7-01a browser.hello returns grant look for a look session', async (t) => {
  const h = await setup();
  t.after(() => h.done());
  const conn = await h.session('session-look');
  const reply = await conn.call('browser.hello', { session_id: 'session-look', pid: process.pid });
  assert.deepEqual(reply.result, { ok: true, bound: 'session', grant: 'look' });
});

// protects=a session with no grant is not refused by the grant check, so the no-preset case keeps every tool
// fails_when=a null grant is treated as a preset and evaluate gets -32039, or hello reports a grant for it
// no_claim=whether evaluate then succeeds (the pane and the page are not set up here, so only the absence of -32039 is checked)
test('M7-01a a session with grant null is not refused for evaluate with -32039', async (t) => {
  const h = await setup();
  t.after(() => h.done());
  const conn = await h.session('session-none');
  const hello = await conn.call('browser.hello', { session_id: 'session-none', pid: process.pid });
  assert.equal(hello.result?.grant, null, JSON.stringify(hello));
  const reply = await conn.call('browser.evaluate', { pane_id: 'bp_none', expression: '1 + 1' });
  assert.notEqual(reply.error?.code, -32039, JSON.stringify(reply));
});

// protects=the grant check names the smallest preset holding the tool, not always debug
// fails_when=click on a look session is refused with a message that names debug instead of act
// no_claim=whether a click would then be approved (D61 is a separate check)
test('M7-01a browser.click on a look session fails -32039 naming act', async (t) => {
  const h = await setup();
  t.after(() => h.done());
  const conn = await h.session('session-look');
  assert.equal((await conn.call('browser.hello', { session_id: 'session-look', pid: process.pid })).result?.bound, 'session');
  const reply = await conn.call('browser.click', { pane_id: 'bp_look', ref: 'e1' });
  assert.equal(reply.error?.code, -32039, JSON.stringify(reply));
  assert.match(reply.error.message, /\bact\b/);
  assert.doesNotMatch(reply.error.message, /\bdebug\b/);
  assert.deepEqual(h.ran, [], 'the refused click reached the pane');
});
