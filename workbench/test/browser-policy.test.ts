import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { checkUrl } from '../../core/src/browser/policy.ts';

// Stub the Electron import so the real pane manager and browser server run without a browser process.
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
    const panes = await import('../src/browser/panes.ts');
    const server = await import('../src/browser/server.ts');
    return { ...panes, ...server };
  } finally {
    hook.deregister();
  }
}

function fixtureDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE project (id TEXT PRIMARY KEY, path TEXT);
    CREATE TABLE session (id TEXT PRIMARY KEY, pid INTEGER, project_id TEXT, ended_at TEXT);
    CREATE TABLE browser_pane (id TEXT PRIMARY KEY, project_id TEXT, run_id TEXT, variant INTEGER, session_id TEXT, url TEXT, dev_port INTEGER, open INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE session_dev_server (id TEXT PRIMARY KEY, session_id TEXT, project_id TEXT, port INTEGER, url TEXT, pid INTEGER, matched_by TEXT, status TEXT, seen_at TEXT);
    INSERT INTO project VALUES ('project-test', '/synthetic/missing-project');
    INSERT INTO session VALUES ('session-a', ${process.pid}, 'project-test', NULL), ('session-b', 1, 'project-test', NULL);
    INSERT INTO browser_pane (id, project_id, session_id, dev_port) VALUES ('bp_agent_a', 'project-test', 'session-a', 5173), ('bp_user', 'project-test', NULL, 3001);
    INSERT INTO session_dev_server VALUES
      ('ds_1', 'session-a', 'project-test', 4100, 'http://localhost:4100/', 11, 'ancestry', 'ready', 'x'),
      ('ds_2', 'session-a', 'project-test', 4200, 'http://localhost:4200/', 12, 'printed', 'stopped', 'x'),
      ('ds_3', 'session-b', 'project-test', 4300, 'http://localhost:4300/', 13, 'printed', 'ready', 'x');
  `);
  return db;
}

async function allowed(ctx: unknown, url: string): Promise<boolean> {
  return (await checkUrl(url, ctx as never)).allow;
}

test('M6-03 an agent pane loads only the loopback ports of its own session\'s ready dev servers', async () => {
  const { PaneManager } = await load();
  const db = fixtureDb();
  try {
    const manager = new PaneManager({} as any, { db: () => db } as any);
    const ctx = (manager as any).policy({ id: 'bp_agent_a', project_id: 'project-test', session_id: 'session-a' });
    for (const url of ['http://localhost:4100/', 'http://127.0.0.1:4100/x', 'http://[::1]:4100/']) assert.equal(await allowed(ctx, url), true, url);
    for (const url of ['http://localhost:4200/', 'http://localhost:4300/', 'http://localhost:5173/', 'http://localhost:3001/']) assert.equal(await allowed(ctx, url), false, url);
    db.prepare("UPDATE session_dev_server SET status = 'stopped' WHERE id = 'ds_1'").run();
    const later = (manager as any).policy({ id: 'bp_agent_a', project_id: 'project-test', session_id: 'session-a' });
    assert.equal(await allowed(later, 'http://localhost:4100/'), false);
    db.prepare("UPDATE session_dev_server SET status = 'ready' WHERE id = 'ds_2'").run();
    const fresh = (manager as any).policy({ id: 'bp_agent_a', project_id: 'project-test', session_id: 'session-a' });
    assert.equal(await allowed(fresh, 'http://localhost:4200/'), true, 'a row that turns ready is seen at once');
  } finally {
    db.close();
  }
});

test('M6-03c a user pane loads any loopback port the user typed, and only those', async () => {
  const { PaneManager, loopbackPort } = await load();
  const db = fixtureDb();
  try {
    const manager = new PaneManager({} as any, { db: () => db } as any);
    const loaded: string[] = [];
    const pane = (row: Record<string, unknown>) => ({ row, typed: new Set<number>(), view: { webContents: { loadURL: async (u: string) => { loaded.push(u); } } } });
    (manager as any).panes.set('bp_user', pane({ id: 'bp_user', project_id: 'project-test', session_id: null }));
    (manager as any).panes.set('bp_agent_a', pane({ id: 'bp_agent_a', project_id: 'project-test', session_id: 'session-a' }));
    await manager.userNavigate('bp_user', 'http://localhost:4999/');
    await manager.userNavigate('bp_user', 'http://127.0.0.1:5001/app');
    assert.deepEqual(loaded, ['http://localhost:4999/', 'http://127.0.0.1:5001/app']);
    const ctx = (manager as any).paneCtx((manager as any).panes.get('bp_user'));
    assert.equal(await allowed(ctx, 'http://localhost:4999/main.js'), true);
    assert.equal(await allowed(ctx, 'http://localhost:4100/'), false, 'a port the user never typed');
    await assert.rejects(manager.userNavigate('bp_agent_a', 'http://localhost:4999/'), /navigation blocked/);
    assert.deepEqual(loopbackPort('http://[::1]:8080/'), [8080]);
    assert.deepEqual(loopbackPort('https://localhost/'), [443]);
    assert.deepEqual(loopbackPort('http://example.com:8080/'), []);
  } finally {
    db.close();
  }
});

test('M6-03c no agent tool can drive a user pane', async () => {
  const { PaneManager, ownedPanes, startBrowserServer } = await load();
  const db = fixtureDb();
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\mt-policy-${randomUUID()}` : `/tmp/mt-policy-${randomUUID()}.sock`;
  const panes = new PaneManager({} as any, { db: () => db } as any);
  const server = await startBrowserServer(pipe, { db: () => db, uiKey: () => null, panes, refreshPanes: () => {}, openPane: async () => 'unused' });
  const sock = net.connect(pipe);
  try {
    assert.deepEqual(ownedPanes(db, 'session-a').map((r: { id: string }) => r.id), ['bp_agent_a']);
    await new Promise((r) => sock.once('connect', r));
    let buf = '';
    const replies = new Map<string, any>();
    sock.setEncoding('utf8');
    sock.on('data', (c: string) => { buf += c; let i; while ((i = buf.indexOf('\n')) >= 0) { const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1); replies.set(m.id, m); } });
    const call = async (id: string, method: string, params: object) => {
      sock.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      for (let i = 0; i < 400 && !replies.has(id); i++) await new Promise((r) => setTimeout(r, 25));
      return replies.get(id);
    };
    assert.equal((await call('1', 'browser.hello', { session_id: 'session-a', pid: process.pid })).result.bound, 'session');
    assert.deepEqual((await call('2', 'browser.panes', {})).result.map((p: { pane_id: string }) => p.pane_id), ['bp_agent_a']);
    for (const [n, tool] of ['navigate', 'snapshot', 'click', 'type', 'evaluate'].entries()) {
      const r = await call(`t${n}`, `browser.${tool}`, { pane_id: 'bp_user', url: 'http://localhost:4100/' });
      assert.equal(r.error?.code, -32030, tool);
    }
  } finally {
    sock.destroy();
    server.close();
    db.close();
  }
});
