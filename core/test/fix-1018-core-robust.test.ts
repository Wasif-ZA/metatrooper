import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openCoreDb } from '../src/store/db.ts';
import { call, enqueue } from '../src/pipe/client.ts';
import { corePipe, dbFile } from '../src/paths.ts';
import { createDecoder, encode } from '../src/pipe/framing.ts';
import { logOnce } from '../src/log.ts';
import { startPipeServer } from '../src/pipe/server.ts';
import { isolation, withEnv } from './helpers.ts';

function home(t): { home: string; env: Record<string, string> } {
  const isolated = isolation();
  t.after(() => rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }));
  return { home: isolated.home, env: { METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix } };
}

test('h-a-d1 CLI enqueue never creates or migrates troop.db and refuses one migrated by a newer core', (t) => {
  const { env } = home(t);
  assert.throws(() => withEnv(env, () => enqueue('c0', 'project.open', {})), /does not exist/);
  assert.equal(withEnv(env, () => existsSync(dbFile())), false);
  withEnv(env, openCoreDb).close();
  withEnv(env, () => enqueue('c1', 'project.open', { path: 'x' }));
  const db = new DatabaseSync(withEnv(env, dbFile));
  try {
    db.prepare("INSERT INTO schema_migration (id, applied_at) VALUES (999, 'x')").run();
    assert.throws(() => withEnv(env, () => enqueue('c2', 'project.open', {})), /migration 999/);
    assert.deepEqual(db.prepare('SELECT id FROM command ORDER BY id').all().map((r) => r.id), ['c1']);
  } finally { db.close(); }
});

test('h-rv-waitms a slow ui.hello does not eat into the wait for the reply', async (t) => {
  const { home: dir, env } = home(t);
  writeFileSync(join(dir, 'ui.key'), 'k');
  const server = net.createServer((s) => {
    s.on('data', createDecoder((m) => {
      const id = (m as { id: string }).id;
      setTimeout(() => { if (!s.destroyed) s.write(encode({ jsonrpc: '2.0', id, result: { ok: true } })); }, 400);
    }));
  });
  const pipe = withEnv(env, corePipe);
  await new Promise<void>((r) => server.listen(pipe, r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const saved = { ...process.env };
  Object.assign(process.env, env);
  try {
    const out = await call('pane.url', { pane_id: 'p', url: 'x' }, { ui: true, waitMs: 600 });
    assert.equal(out.kind, 'reply');
  } finally {
    for (const k of Object.keys(env)) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  }
});

test('h-a-d2 logOnce writes each distinct timer error once', (t) => {
  const lines: string[] = [];
  t.mock.method(console, 'error', (s: string) => { lines.push(s); });
  logOnce('core timer failed: fixture a');
  logOnce('core timer failed: fixture a');
  logOnce('core timer failed: fixture b');
  assert.deepEqual(lines, ['core timer failed: fixture a', 'core timer failed: fixture b']);
});

test('h-a-d3 lines after a too-long line on the same socket never run', async (t) => {
  // a TCP port, since a Windows named pipe has no half-close and hides the bug
  const probe = net.createServer();
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const pipe = String((probe.address() as net.AddressInfo).port);
  await new Promise<void>((r) => probe.close(() => r()));
  const ran: string[] = [];
  const runner = { call: async (req: { method: string }) => { ran.push(req.method); return {}; } };
  const server = await startPipeServer(pipe, Promise.resolve({ runner: runner as never, uiKey: 'k' }));
  t.after(() => server.close());
  const socket = net.connect({ port: Number(pipe), host: '127.0.0.1', allowHalfOpen: true });
  t.after(() => socket.destroy());
  const replies: unknown[] = [];
  socket.on('data', createDecoder((m) => replies.push(m)));
  socket.on('error', () => {});
  await new Promise((r) => socket.once('connect', r));
  socket.write(JSON.stringify({ jsonrpc: '2.0', id: 'a', method: 'before.ok' }) + '\n');
  socket.write(' '.repeat(1024 * 1024 + 10) + '\n');
  await new Promise((r) => setTimeout(r, 100));
  socket.write(JSON.stringify({ jsonrpc: '2.0', id: 'b', method: 'after.never' }) + '\n');
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(ran, ['before.ok']);
  assert.ok(replies.some((m) => (m as { error?: { code: number } }).error?.code === -32600));
});
