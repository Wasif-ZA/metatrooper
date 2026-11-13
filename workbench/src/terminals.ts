import fs from 'node:fs';
import net from 'node:net';
import { termPipe, uiKeyFile } from '../../core/src/paths.ts';

export type TermMessage = { op: string; seq?: number; data?: string; code?: number | string };

const conns = new Map<string, net.Socket>();

/** One terminal-pipe connection per attached session; messages go to `send` in arrival order. Resolves true once the core sends the screen, false when it refuses or the pipe closes first. */
export function attachTerm(sessionId: string, cols: number | undefined, rows: number | undefined, send: (sessionId: string, msg: TermMessage) => void): Promise<boolean> {
  detachTerm(sessionId);
  let settle: (ok: boolean) => void = () => {};
  const ready = new Promise<boolean>((r) => { settle = r; });
  let key = '';
  try { key = fs.readFileSync(uiKeyFile(), 'utf8').trim(); } catch {}
  const s = net.connect(termPipe(), () => s.write(JSON.stringify({ op: 'attach', session: sessionId, cols, rows, ui_key: key }) + '\n'));
  conns.set(sessionId, s);
  let buf = '';
  s.setEncoding('utf8');
  s.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    let ok: boolean | null = null;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try {
        const msg = JSON.parse(line) as TermMessage;
        if (msg.op === 'error' || msg.op === 'exit') { ok = false; s.end(); }
        else if (ok === null) ok = true;
        send(sessionId, msg);
      } catch {}
    }
    if (ok !== null) settle(ok);
  });
  const gone = () => {
    settle(false);
    if (conns.get(sessionId) !== s) return;
    conns.delete(sessionId);
    send(sessionId, { op: 'closed' });
  };
  s.on('close', gone);
  s.on('error', gone);
  return ready;
}

const INPUT_CHUNK = 64 * 1024;

/** False when this window holds no live connection for the session, so nothing was sent. */
export function termInput(sessionId: string, data: string): boolean {
  const s = conns.get(sessionId);
  if (!s || s.destroyed || s.writableEnded) return false;
  for (let i = 0; i < data.length;) {
    let end = Math.min(i + INPUT_CHUNK, data.length);
    const c = data.charCodeAt(end - 1);
    if (end < data.length && c >= 0xd800 && c <= 0xdbff) end--;
    s.write(JSON.stringify({ op: 'input', data: data.slice(i, end) }) + '\n');
    i = end;
  }
  return true;
}

export function termAck(sessionId: string, bytes: number): void {
  conns.get(sessionId)?.write(JSON.stringify({ op: 'ack', bytes }) + '\n');
}

export function termResize(sessionId: string, cols: number, rows: number): void {
  conns.get(sessionId)?.write(JSON.stringify({ op: 'resize', cols, rows }) + '\n');
}

export function detachAll(): void {
  for (const id of [...conns.keys()]) detachTerm(id);
}

export function detachTerm(sessionId: string): void {
  const s = conns.get(sessionId);
  if (!s) return;
  conns.delete(sessionId);
  s.destroy();
}
