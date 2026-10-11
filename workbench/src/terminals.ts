import fs from 'node:fs';
import net from 'node:net';
import { termPipe, uiKeyFile } from '../../core/src/paths.ts';

export type TermMessage = { op: string; seq?: number; data?: string; code?: number | string };

const conns = new Map<string, net.Socket>();

/** One terminal-pipe connection per attached session; messages go to `send` in arrival order. */
export function attachTerm(sessionId: string, cols: number, rows: number, send: (sessionId: string, msg: TermMessage) => void): void {
  detachTerm(sessionId);
  let key = '';
  try { key = fs.readFileSync(uiKeyFile(), 'utf8').trim(); } catch {}
  const s = net.connect(termPipe(), () => s.write(JSON.stringify({ op: 'attach', session: sessionId, cols, rows, ui_key: key }) + '\n'));
  conns.set(sessionId, s);
  let buf = '';
  s.setEncoding('utf8');
  s.on('data', (chunk: string) => {
    buf += chunk;
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try { send(sessionId, JSON.parse(line)); } catch {}
    }
  });
  const gone = () => {
    if (conns.get(sessionId) !== s) return;
    conns.delete(sessionId);
    send(sessionId, { op: 'closed' });
  };
  s.on('close', gone);
  s.on('error', gone);
}

export function termInput(sessionId: string, data: string): void {
  conns.get(sessionId)?.write(JSON.stringify({ op: 'input', data }) + '\n');
}

export function termAck(sessionId: string, bytes: number): void {
  conns.get(sessionId)?.write(JSON.stringify({ op: 'ack', bytes }) + '
');
}

export function termResize(sessionId: string, cols: number, rows: number): void {
  conns.get(sessionId)?.write(JSON.stringify({ op: 'resize', cols, rows }) + '\n');
}

export function detachTerm(sessionId: string): void {
  const s = conns.get(sessionId);
  if (!s) return;
  conns.delete(sessionId);
  s.destroy();
}
