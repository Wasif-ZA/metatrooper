import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDecoder } from '../../core/src/pipe/framing.ts';

test('a 2 MiB paste reaches the terminal pipe intact and the connection stays up', async () => {
  process.env.METATROOPER_HOME = mkdtempSync(join(tmpdir(), 'term-input-'));
  process.env.METATROOPER_PIPE_PREFIX = `term-input-${randomUUID().replaceAll('-', '')}`;
  const { termPipe } = await import('../../core/src/paths.ts');
  const { attachTerm, detachTerm, termInput } = await import('../src/terminals.ts');
  const frames: string[] = [];
  let attached!: () => void;
  const ready = new Promise<void>((r) => { attached = r; });
  const server = net.createServer((socket) => {
    const decode = createDecoder((m) => {
      const msg = m as { op: string; data?: string };
      if (msg.op === 'attach') attached();
      if (msg.op === 'input') frames.push(msg.data ?? '');
    });
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { try { decode(chunk); } catch { socket.end(); } });
    socket.on('error', () => {});
  });
  await new Promise<void>((r) => server.listen(termPipe(), r));
  const seen: string[] = [];
  try {
    attachTerm('s1', 80, 24, (_id, msg) => seen.push(msg.op));
    await ready;
    const paste = 'x\u{1F600}'.repeat(700_000);
    termInput('s1', paste);
    const end = Date.now() + 10_000;
    while (frames.join('').length < paste.length && !seen.includes('closed') && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(seen, []);
    assert.ok(frames.join('') === paste);
    const high = (s: string) => s.length > 0 && s.charCodeAt(s.length - 1) >= 0xd800 && s.charCodeAt(s.length - 1) <= 0xdbff;
    assert.ok(!frames.some(high));
  } finally {
    detachTerm('s1');
    server.close();
  }
});
