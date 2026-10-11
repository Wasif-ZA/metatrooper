import fs from 'node:fs';
import net from 'node:net';
import { createDecoder } from '../pipe/framing.ts';
import * as term from './index.ts';
import { settings } from '../settings.ts';

export const CREDIT_BYTES = 64 * 1024;
export const HOLD_BYTES = 1024 * 1024;

/** Splits on code-point boundaries so no message ends inside a surrogate pair. */
export function splitChunks(data: string, max = Math.max(2, settings().terminal.chunk_bytes)): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < data.length) {
    let end = Math.min(i + max, data.length);
    const c = data.charCodeAt(end - 1);
    if (end < data.length && c >= 0xd800 && c <= 0xdbff) end--;
    out.push(data.slice(i, end));
    i = end;
  }
  return out;
}

export async function startTermServer(pipePath: string, uiKey: string): Promise<net.Server> {
  if (process.platform !== 'win32' && fs.existsSync(pipePath)) {
    try { fs.unlinkSync(pipePath); } catch {}
  }
  const server = net.createServer((socket) => {
    let session: string | null = null;
    let viewer: term.Viewer | null = null;
    let seq = 0;
    let unacked = 0;
    let held: string[] = [];
    let heldBytes = 0;
    let stale = false;
    const send = (msg: object) => {
      if (socket.destroyed || socket.writableEnded) return;
      socket.write(JSON.stringify(msg) + '\n');
    };
    const sendData = (op: 'snapshot' | 'output', data: string) => {
      unacked += data.length;
      send({ op, seq: seq++, data });
    };
    const drop = () => {
      if (session && viewer) term.detach(session, viewer);
      viewer = null;
    };
    const makeViewer = (): term.Viewer => {
      const v: term.Viewer = {
        snapshot: (data) => sendData('snapshot', data),
        output: (data) => {
          if (viewer !== v) return;
          for (const part of splitChunks(data)) {
            if (unacked < CREDIT_BYTES && !held.length) sendData('output', part);
            else { held.push(part); heldBytes += part.length; }
          }
          if (heldBytes > HOLD_BYTES && session) {
            held = [];
            heldBytes = 0;
            stale = true;
            term.detach(session, v);
          }
        },
        exit: (code) => {
          for (const part of held) send({ op: 'output', seq: seq++, data: part });
          held = [];
          heldBytes = 0;
          send({ op: 'exit', code });
          viewer = null;
          socket.end();
        },
      };
      return v;
    };
    const pump = () => {
      while (held.length && unacked < CREDIT_BYTES) {
        const part = held.shift() as string;
        heldBytes -= part.length;
        sendData('output', part);
      }
      if (stale && unacked < CREDIT_BYTES && session) {
        stale = false;
        const v = makeViewer();
        viewer = v;
        if (!term.attach(session, v)) { send({ op: 'error', code: 'no-session' }); socket.end(); }
      }
    };
    const bad = () => send({ op: 'error', code: 'bad-op' });
    const decode = createDecoder((raw) => {
      const m = raw as { op?: unknown; session?: unknown; cols?: unknown; rows?: unknown; data?: unknown; ui_key?: unknown; bytes?: unknown };
      if (!m || typeof m !== 'object') return bad();
      if (m.op === 'attach') {
        if (session) return bad();
        if (m.ui_key !== uiKey) {
          send({ op: 'error', code: 'needs-ui' });
          return void socket.end();
        }
        const id = typeof m.session === 'string' ? m.session : '';
        const v = makeViewer();
        if (typeof m.cols === 'number' && typeof m.rows === 'number') term.resize(id, m.cols, m.rows);
        viewer = v;
        if (!term.attach(id, v)) {
          viewer = null;
          send({ op: 'error', code: 'no-session' });
          return void socket.end();
        }
        session = id;
        return;
      }
      if (!session) return bad();
      if (m.op === 'ack' && typeof m.bytes === 'number' && m.bytes >= 0) { unacked = Math.max(0, unacked - m.bytes); return pump(); }
      if (m.op === 'input' && typeof m.data === 'string') return void term.write(session, m.data);
      if (m.op === 'resize' && typeof m.cols === 'number' && typeof m.rows === 'number') return term.resize(session, m.cols, m.rows);
      if (m.op === 'detach') { drop(); return void socket.end(); }
      bad();
    }, () => bad());
    socket.on('data', (chunk) => {
      try { decode(chunk); } catch { bad(); socket.end(); }
    });
    socket.on('close', drop);
    socket.on('error', () => {});
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(pipePath, () => {
      server.off('error', reject);
      resolve(server);
    });
  });
}
