import fs from 'node:fs';
import net from 'node:net';
import { createDecoder } from '../pipe/framing.ts';
import * as term from './index.ts';
import { settings } from '../settings.ts';

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
    let snapshotBytes = 0;
    const send = (msg: object) => {
      if (socket.destroyed || socket.writableEnded) return;
      socket.write(JSON.stringify(msg) + '\n');
      if (socket.writableLength > snapshotBytes + settings().terminal.slow_viewer_bytes) {
        socket.write(JSON.stringify({ op: 'error', code: 'slow-viewer' }) + '\n');
        drop();
        socket.end();
      }
    };
    const drop = () => {
      if (session && viewer) term.detach(session, viewer);
      viewer = null;
    };
    const bad = () => send({ op: 'error', code: 'bad-op' });
    const decode = createDecoder((raw) => {
      const m = raw as { op?: unknown; session?: unknown; cols?: unknown; rows?: unknown; data?: unknown; ui_key?: unknown };
      if (!m || typeof m !== 'object') return bad();
      if (m.op === 'attach') {
        if (session) return bad();
        if (m.ui_key !== uiKey) {
          send({ op: 'error', code: 'needs-ui' });
          return void socket.end();
        }
        const id = typeof m.session === 'string' ? m.session : '';
        const v: term.Viewer = {
          snapshot: (data) => { snapshotBytes = Buffer.byteLength(JSON.stringify(data)); send({ op: 'snapshot', seq: seq++, data }); },
          output: (data) => { for (const part of splitChunks(data)) send({ op: 'output', seq: seq++, data: part }); },
          exit: (code) => { send({ op: 'exit', code }); viewer = null; socket.end(); },
        };
        if (typeof m.cols === 'number' && typeof m.rows === 'number') term.resize(id, m.cols, m.rows);
        if (!term.attach(id, v)) {
          send({ op: 'error', code: 'no-session' });
          return void socket.end();
        }
        session = id;
        viewer = v;
        return;
      }
      if (!session) return bad();
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
