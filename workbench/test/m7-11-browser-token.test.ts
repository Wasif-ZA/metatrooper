import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import net from 'node:net';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { snapshot } from '../src/queries.ts';

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
    const { startBrowserServer } = await import('../src/browser/server.ts');
    return startBrowserServer;
  } finally { hook.deregister(); }
}

test('M7-11h browser.hello binds with the right token without ancestry', async () => {
  const startBrowserServer = await loadServer();
  const token = 'a'.repeat(64);
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, pid INTEGER, ended_at TEXT, browser_token_hash TEXT); CREATE TABLE browser_pane (id TEXT PRIMARY KEY, session_id TEXT, url TEXT, dev_port INTEGER, open INTEGER)');
  db.prepare('INSERT INTO session VALUES (?, ?, NULL, ?)').run('token-session', 1, createHash('sha256').update(token).digest('hex'));
  db.prepare('INSERT INTO session VALUES (?, ?, NULL, NULL)').run('legacy-session', 1);
  const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\mt-token-${randomUUID()}` : `/tmp/mt-token-${randomUUID()}.sock`;
  const server = await startBrowserServer(pipe, { db: () => db, uiKey: () => null, panes: {} as any, refreshPanes: () => {}, openPane: async () => 'unused' });
  const socket = net.connect(pipe);
  try {
    await new Promise<void>((resolve, reject) => { socket.once('connect', resolve); socket.once('error', reject); });
    let buffer = '';
    const pending = new Map<string, (reply: any) => void>();
    socket.setEncoding('utf8');
    socket.on('data', (chunk: string) => {
      buffer += chunk;
      for (let end; (end = buffer.indexOf('\n')) >= 0;) {
        const reply = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        pending.get(reply.id)?.(reply);
        pending.delete(reply.id);
      }
    });
    let id = 0;
    const call = (params: object) => new Promise<any>((resolve, reject) => {
      const key = String(++id);
      const timer = setTimeout(() => { pending.delete(key); reject(new Error('browser.hello timed out')); }, 3000);
      pending.set(key, (reply) => { clearTimeout(timer); resolve(reply); });
      socket.write(JSON.stringify({ jsonrpc: '2.0', id: key, method: 'browser.hello', params }) + '\n');
    });
    assert.equal((await call({ session_id: 'token-session', pid: -1, token })).result?.bound, 'session');
    const wrong = await call({ session_id: 'token-session', pid: -1, token: 'b'.repeat(64) });
    assert.equal(wrong.error?.code, -32030);
    assert.match(wrong.error?.message, /token/i);
    const legacy = await call({ session_id: 'legacy-session', pid: -1, token });
    assert.equal(legacy.error?.code, -32030);
    assert.match(legacy.error?.message, /ancestor/i);
  } finally {
    socket.destroy();
    server.close();
    db.close();
  }
});

test('M7-11h snapshot marks sessions with a token hash as browser capable', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mt-browser-query-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  try {
    db.exec(readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8'));
    const now = new Date().toISOString();
    db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('p', dir, 'test', now, now);
    db.prepare("INSERT INTO engine (id, spec_json, cost_rank) VALUES ('test', '{}', 1)").run();
    for (const [id, browser, hash] of [['mcp', 1, null], ['token', 0, 'a'.repeat(64)], ['none', 0, null]] as const) {
      db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, browser, browser_token_hash) VALUES (?, 'p', 'test', 'pty', 'working', ?, ?, ?, ?)").run(id, now, now, browser, hash);
    }
    const rows = new Map(snapshot(db, 'p').sessions.map((row) => [row.id, row.browser]));
    assert.equal(rows.get('mcp'), 1);
    assert.equal(rows.get('token'), 1);
    assert.equal(rows.get('none'), 0);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
