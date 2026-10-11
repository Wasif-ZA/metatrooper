import { mock } from 'node:test';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

mock.module('electron', { exports: { app: {}, clipboard: {}, Menu: {}, nativeImage: {}, session: {}, WebContentsView: class {} } });
const { startBrowserServer } = await import('../../src/browser/server.ts');
const { createDecoder, encode } = await import('../../../core/src/pipe/framing.ts');

const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE session (id TEXT, pid INTEGER, ended_at TEXT, project_id TEXT)');
db.prepare('INSERT INTO session (id, pid) VALUES (?, ?)').run('s1', process.pid);
const pipe = process.platform === 'win32' ? `\\\\.\\pipe\\hello-lag-${randomUUID()}` : `/tmp/hello-lag-${randomUUID()}.sock`;
const server = await startBrowserServer(pipe, { db: () => db, uiKey: () => null, panes: {} as never, refreshPanes() {}, openPane: async () => '' });

let maxLag = 0;
let last = performance.now();
const probe = setInterval(() => { const now = performance.now(); maxLag = Math.max(maxLag, now - last - 5); last = now; }, 5);
const reply = await new Promise<any>((resolve) => {
  const s = net.connect(pipe, () => s.write(encode({ jsonrpc: '2.0', id: 'h', method: 'browser.hello', params: { session_id: 's1', pid: process.pid } })));
  s.on('data', createDecoder((m) => { resolve(m); s.destroy(); }));
});
clearInterval(probe);
server.close();
console.log(JSON.stringify({ bound: reply.result?.bound ?? reply.error?.message, maxLag: Math.round(maxLag) }));
process.exit(0);
