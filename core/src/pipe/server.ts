import net from 'node:net';
import { encode, createDecoder, LineTooLong } from './framing.ts';
import { E, RpcError, toRpcError } from './errors.ts';
import type { CommandRunner } from './commands.ts';

interface Conn {
  ui: boolean;
}

export function startPipeServer(pipePath: string, runner: CommandRunner, uiKey: string): Promise<net.Server> {
  const server = net.createServer((socket) => {
    const conn: Conn = { ui: false };
    const send = (msg: object) => {
      if (!socket.destroyed) socket.write(encode(msg));
    };
    const decode = createDecoder(async (raw) => {
      const msg = raw as { jsonrpc?: string; id?: unknown; method?: unknown; params?: unknown; meta?: { origin?: string } };
      const id = typeof msg?.id === 'string' ? msg.id : null;
      if (!msg || msg.jsonrpc !== '2.0' || !id || typeof msg.method !== 'string') {
        send({ jsonrpc: '2.0', id, error: new RpcError(E.INVALID_REQUEST, 'invalid request').toJSON() });
        return;
      }
      const params = (msg.params && typeof msg.params === 'object' ? msg.params : {}) as Record<string, unknown>;
      try {
        if (msg.method === 'ui.hello') {
          if (typeof params.ui_key !== 'string' || params.ui_key !== uiKey) throw new RpcError(E.NEEDS_UI, 'ui key does not match');
          conn.ui = true;
          send({ jsonrpc: '2.0', id, result: { ok: true } });
          return;
        }
        const result = await runner.call(
          { id, method: msg.method, params, origin: String(msg.meta?.origin ?? 'unknown') },
          { ui: conn.ui, origin: String(msg.meta?.origin ?? 'unknown') },
        );
        send({ jsonrpc: '2.0', id, result });
      } catch (e) {
        send({ jsonrpc: '2.0', id, error: toRpcError(e).toJSON() });
      }
    });
    socket.on('data', (chunk) => {
      try {
        decode(chunk);
      } catch (e) {
        const code = e instanceof LineTooLong ? E.INVALID_REQUEST : E.PARSE;
        send({ jsonrpc: '2.0', id: null, error: { code, message: e instanceof Error ? e.message : 'parse error' } });
        if (e instanceof LineTooLong) socket.end();
      }
    });
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
