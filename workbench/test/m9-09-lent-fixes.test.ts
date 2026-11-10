import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

// Runs the lent pane fixes fixture covering webRequest header stripping and handoff rules with fake Electron.
test('M9-09 lent pane fixes with fake Electron', (t) => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const fixturePath = fileURLToPath(new URL('./fixtures/m9-09-lent-fixes.ts', import.meta.url));
  const result = spawnSync(
    process.execPath,
    ['--experimental-test-module-mocks', '--no-warnings', '--test', '--test-reporter=tap', fixturePath],
    { env, encoding: 'utf8', timeout: 60000 },
  );
  const output = result.stdout + result.stderr;
  t.diagnostic(output);
  assert.ifError(result.error);
  assert.equal(result.status, 0, output);
  assert.match(output, /^# pass 11$/m);
  assert.match(output, /^# fail 0$/m);
});

// Stubs Electron so browser server module can be imported without an Electron process.
async function loadServer() {
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

// Connects to a browser server named pipe or Unix socket and sends newline-delimited JSON-RPC calls.
async function connectServer(pipe: string) {
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
    async call(method: string, params: object) {
      const id = `m${++seq}`;
      sock.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      for (let i = 0; i < 400 && !replies.has(id); i++) await new Promise((r) => setTimeout(r, 25));
      return replies.get(id);
    },
  };
}

// Tests browser server ownedPanes returns bp_agent_ panes only and skips user bp_ panes.
test('browser server: ownedPanes skips bp_ row owned by session', async () => {
  const { ownedPanes } = await loadServer();
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`CREATE TABLE project (id TEXT PRIMARY KEY, path TEXT);
      CREATE TABLE session (id TEXT PRIMARY KEY, pid INTEGER, project_id TEXT, ended_at TEXT);
      CREATE TABLE browser_pane (id TEXT PRIMARY KEY, project_id TEXT, session_id TEXT, url TEXT, open INTEGER, lent INTEGER);
      INSERT INTO project VALUES ('A', '/synthetic/a');
      INSERT INTO session VALUES ('sA', 1, 'A', NULL);
      INSERT INTO browser_pane VALUES
        ('bp_user_1', 'A', 'sA', 'https://example.com', 1, 0),
        ('bp_agent_1', 'A', 'sA', 'https://example.com', 1, 0),
        ('bp_agent_2', 'A', 'sB', 'https://example.com', 1, 0),
        ('bp_agent_3', 'A', 'sA', 'https://example.com', 0, 0);`);
    const owned = ownedPanes(db, 'sA');
    assert.equal(owned.length, 1);
    assert.equal(owned[0].id, 'bp_agent_1');
    assert.equal(owned.some((r) => r.id === 'bp_user_1'), false);
  } finally {
    db.close();
  }
});

// Tests browser server refuses explicit bp_ user pane id with -32030.
test('browser server: explicit bp_ pane_id fails with -32030', async (t) => {
  const { startBrowserServer } = await loadServer();
  const dir = mkdtempSync(join(tmpdir(), 'm9-09-c1-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(`CREATE TABLE project (id TEXT PRIMARY KEY, path TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY, pid INTEGER, project_id TEXT, ended_at TEXT);
    CREATE TABLE browser_pane (id TEXT PRIMARY KEY, project_id TEXT, session_id TEXT, url TEXT, open INTEGER, lent INTEGER);
    INSERT INTO project VALUES ('project-1', '/synthetic/p1');
    INSERT INTO session VALUES ('sA', ${process.pid}, 'project-1', NULL);
    INSERT INTO browser_pane VALUES
      ('bp_user_1', 'project-1', 'sA', 'https://example.com', 1, 0),
      ('bp_agent_1', 'project-1', 'sA', 'https://example.com', 1, 0);`);
  const pipe = process.platform === 'win32'
    ? `\\\\.\\pipe\\m909-c1-${randomUUID()}`
    : join(tmpdir(), `m909-c1-${randomUUID()}.sock`);
  const server = await startBrowserServer(pipe, {
    db: () => db,
    uiKey: () => null,
    panes: { has: () => true, origin: () => 'https://example.com', tool: async () => ({ ok: true }) } as never,
    refreshPanes: () => {},
    openPane: async () => 'unused',
    askLend: async () => {},
  });
  t.after(() => {
    server.close();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const client = await connectServer(pipe);
  t.after(() => client.sock.destroy());

  const hello = await client.call('browser.hello', { session_id: 'sA', pid: process.pid });
  assert.equal(hello?.result?.bound, 'session');

  const reply = await client.call('browser.snapshot', { pane_id: 'bp_user_1' });
  assert.equal(reply.error?.code, -32030);
  assert.equal(
    reply.error?.message,
    "an agent may drive only its own agent panes, not a user pane; to use the user's sign-in, ask them to lend the site (navigate with signed_in: true)",
  );
});
