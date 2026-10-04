import net from 'node:net';
import { browserPipe } from '../paths.ts';
import { createDecoder, encode } from '../pipe/framing.ts';
import { E, RpcError } from '../pipe/errors.ts';

/** One call on the browser pipe over a fresh connection bound as the core (`browser.hello` with the ui key). */
export function browserCall(uiKey: string, method: string, params: Record<string, unknown>, timeoutMs = 60_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(browserPipe());
    let n = 0;
    const waiting = new Map<string, (r: { result?: unknown; error?: { code: number; message: string } }) => void>();
    const timer = setTimeout(() => { socket.destroy(); reject(new RpcError(E.INTERNAL, `${method} timed out`)); }, timeoutMs);
    const request = (m: string, p: Record<string, unknown>) => new Promise<{ result?: unknown; error?: { code: number; message: string } }>((res) => {
      const id = `core-${++n}`;
      waiting.set(id, res);
      socket.write(encode({ jsonrpc: '2.0', id, method: m, params: p }));
    });
    const decode = createDecoder((raw) => {
      const r = raw as { id?: string };
      const w = r.id ? waiting.get(r.id) : undefined;
      if (w) { waiting.delete(r.id as string); w(raw as never); }
    });
    socket.on('data', (c) => { try { decode(c); } catch {} });
    socket.once('error', () => { clearTimeout(timer); reject(new RpcError(E.NOT_FOUND, 'browser not available: the MetaTrooper workbench is closed')); });
    socket.once('connect', async () => {
      try {
        const hello = await request('browser.hello', { ui_key: uiKey });
        if (hello.error) throw new RpcError(hello.error.code, hello.error.message);
        const r = await request(method, params);
        if (r.error) throw new RpcError(r.error.code, r.error.message);
        resolve(r.result);
      } catch (e) {
        reject(e);
      } finally {
        clearTimeout(timer);
        socket.destroy();
      }
    });
  });
}
