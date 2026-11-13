import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createDecoder } from '../../core/src/pipe/framing.ts';

const src = (p: string) => readFileSync(join(import.meta.dirname, '..', p), 'utf8');

test('fix 2: termInput says whether text was sent; attaching reports a session the core refuses', async () => {
  process.env.METATROOPER_HOME = mkdtempSync(join(tmpdir(), 'term-sent-'));
  process.env.METATROOPER_PIPE_PREFIX = `term-sent-${randomUUID().replaceAll('-', '')}`;
  const { termPipe } = await import('../../core/src/paths.ts');
  const { attachTerm, detachTerm, termInput } = await import('../src/terminals.ts');
  const inputs: string[] = [];
  const server = net.createServer((socket) => {
    const reply = (m: object) => socket.write(JSON.stringify(m) + '\n');
    const decode = createDecoder((m) => {
      const msg = m as { op: string; session?: string; data?: string };
      if (msg.op === 'attach' && msg.session === 'live') reply({ op: 'snapshot', seq: 0, data: '' });
      else if (msg.op === 'attach') { reply({ op: 'error', code: 'no-session' }); socket.end(); }
      if (msg.op === 'input') inputs.push(msg.data ?? '');
    });
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => { try { decode(chunk); } catch { socket.end(); } });
    socket.on('error', () => {});
  });
  await new Promise<void>((r) => server.listen(termPipe(), r));
  try {
    assert.equal(termInput('live', 'early'), false, 'no connection yet, so nothing is sent');
    assert.equal(await attachTerm('gone', undefined, undefined, () => {}), false);
    assert.equal(termInput('gone', 'x'), false);
    assert.equal(await attachTerm('live', undefined, undefined, () => {}), true);
    assert.equal(termInput('live', 'yes\r'), true);
    const end = Date.now() + 3000;
    while (!inputs.length && Date.now() < end) await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(inputs, ['yes\r']);
  } finally {
    detachTerm('live');
    server.close();
  }
});

test('fix 2: the termInput IPC attaches before giving up, and Home and Needs you keep the text when it was not sent', () => {
  const main = src('src/main.ts');
  assert.match(main, /if \(termInput\(sessionId, data\)\) return true;\s*\n(\s*\/\/.*\n)?\s*if \(!\(await attachTerm\(sessionId/);
  const home = src('ui/src/home.jsx');
  assert.equal((home.match(/if \(!\(await troop\.termInput\([^)]*\)\)\) return toast\(NOT_SENT, true\)/g) || []).length, 2);
  assert.match(src('ui/src/inbox.jsx'), /if \(!\(await troop\.termInput\(x\.id, textToSend \+ '\\r'\)\)\) return toast\(NOT_SENT, true\);\s*setAnswer\(''\)/);
});
