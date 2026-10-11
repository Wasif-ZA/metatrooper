import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

test('a slow UI call waits for its reply and is never queued; UI clicks are not queueable', async () => {
  process.env.METATROOPER_HOME = path.join(os.tmpdir(), `mt-client-${randomUUID()}`);
  process.env.METATROOPER_PIPE_PREFIX = `mt-client-${randomUUID()}`;
  const { call, QUEUE_AFTER_MS } = await import('../src/pipe/client.ts');
  const { corePipe } = await import('../src/paths.ts');
  const { encode, createDecoder } = await import('../src/pipe/framing.ts');
  const { isQueueable } = await import('../src/pipe/commands.ts');
  for (const m of ['session.launch', 'session.resume']) assert.equal(isQueueable(m), false, m);
  const server = net.createServer((s) => {
    s.on('data', createDecoder((msg) => {
      const id = (msg as { id: string }).id;
      setTimeout(() => s.write(encode({ jsonrpc: '2.0', id, result: { ok: true } })), QUEUE_AFTER_MS + 200);
    }));
  });
  await new Promise<void>((r) => server.listen(corePipe(), r));
  try {
    const out = await call('pane.url', { pane_id: 'p', url: 'x' }, { ui: true });
    assert.equal(out.kind, 'reply');
    assert.equal(existsSync(process.env.METATROOPER_HOME), false);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test('a finished call leaves no timer that keeps the process alive', async () => {
  const { spawnSync } = await import('node:child_process');
  const script = [
    "const net = await import('node:net');",
    "const { call } = await import('./src/pipe/client.ts');",
    "const { corePipe } = await import('./src/paths.ts');",
    "const { encode, createDecoder } = await import('./src/pipe/framing.ts');",
    "const server = net.createServer((s) => s.on('data', createDecoder((m) => s.end(encode({ jsonrpc: '2.0', id: m.id, result: {} })))));",
    'await new Promise((r) => server.listen(corePipe(), r));',
    "const out = await call('core.ping');",
    'server.close();',
    'console.log(out.kind);',
  ].join('\n');
  const env = { ...process.env, METATROOPER_HOME: path.join(os.tmpdir(), `mt-client-${randomUUID()}`), METATROOPER_PIPE_PREFIX: `mt-client-${randomUUID()}` };
  const started = Date.now();
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: path.join(import.meta.dirname, '..'), env, encoding: 'utf8', timeout: 20_000 });
  assert.equal(r.stdout.trim(), 'reply');
  assert.ok(Date.now() - started < 10_000, `process lingered ${Date.now() - started} ms`);
});
