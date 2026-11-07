import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { Approvals } from '../src/approvals.ts';
import { createDecoder, encode } from '../src/pipe/framing.ts';
import { until } from './helpers.ts';

for (const instruction of ['  Stop​ and save a draft instead  ', undefined]) {
  test('M8-40b: rejection reaches an agent over MCP stdio ' + String(instruction), { timeout: 30000 }, async t => {
    const home = mkdtempSync(join(tmpdir(), 'overnight-mcp-'));
    const db = new DatabaseSync(join(home, 'troop.db'));
    db.exec(readFileSync(new URL('../../contracts/schema.sql', import.meta.url), 'utf8'));
    db.exec("PRAGMA foreign_keys=OFF; INSERT INTO session (id,project_id,engine_id,host,state,state_at,started_at,pid) VALUES ('s1','p1','fake','pty','working','t','t'," + process.pid + ")");
    const approvals = new Approvals(db, 10000, () => [], { granted: () => true });
    const prefix = 'overnight-' + randomUUID();
    const path = (browser: boolean) => process.platform === 'win32'
      ? String.fromCharCode(92,92) + '.' + String.fromCharCode(92) + 'pipe' + String.fromCharCode(92) + prefix + (browser ? '-browser' : '')
      : join(tmpdir(), prefix + (browser ? '-browser' : '') + '.sock');
    const sockets = new Set<net.Socket>();
    const methods: string[] = [];
    const servers: net.Server[] = [];
    t.after(async () => {
      for (const s of sockets) s.destroy();
      await Promise.all(servers.map(s => new Promise<void>(r => s.close(() => r()))));
      db.close();
      rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    for (const browser of [false, true]) {
      const server = net.createServer(socket => {
        sockets.add(socket);
        socket.on('close', () => sockets.delete(socket));
        socket.on('data', createDecoder(raw => {
          const msg = raw as any;
          methods.push(msg.method);
          void (async () => {
            const result = msg.method === 'approval.check' ? await approvals.check(msg.params)
              : msg.method === 'desktop.describe' ? { grant_id: 'gr_fixture', control: { name: 'Send', role: 'button', automation_id: 'send' }, password: false, hidden: false, file_dialog: false, rect: [0,0,20,20] }
              : {};
            if (!socket.destroyed) socket.write(encode({ jsonrpc: '2.0', id: msg.id, result }));
          })();
        }));
      });
      servers.push(server);
      server.listen(path(browser));
      await once(server, 'listening');
    }
    const child = spawn(process.execPath, [fileURLToPath(new URL('../src/hook/desktop-mcp.ts', import.meta.url))], {
      env: { ...process.env, METATROOPER_HOME: home, METATROOPER_PIPE_PREFIX: prefix }, stdio: ['pipe','pipe','pipe'],
    });
    t.after(async () => { if (child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } });
    let stderr = '';
    child.stderr.on('data', b => { stderr += b; });
    const replies = new Map<number, any>();
    child.stdout.on('data', createDecoder((r: any) => replies.set(r.id, r)));
    child.stdin.write(encode({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await until(() => replies.get(1), 10000);
    child.stdin.write(encode({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'click', arguments: { window: 100, ref: 'e1' } } }));
    const waiting: any = await until(() => { if (replies.has(2)) assert.fail(JSON.stringify({ reply: replies.get(2), methods, stderr })); return db.prepare("SELECT id FROM approval WHERE status='waiting'").get(); }, 10000);
    approvals.resolve({ approval_id: waiting.id, decision: 'reject', ...(instruction === undefined ? {} : { instruction }) });
    const reply: any = await until(() => replies.get(2), 10000);
    assert.equal(reply.error, undefined, stderr);
    assert.equal(reply.result.isError, true);
    const blocks = reply.result.content;
    assert.equal(blocks[0].text, 'not approved: the user rejected this action');
    assert.match(blocks[1].text, /untrusted screen data/);
    assert.equal(blocks.length, instruction === undefined ? 2 : 3);
    if (instruction !== undefined) assert.equal(blocks[2].text, 'The user rejected this action and stopped the rest of this batch. Their instruction, from the user: Stop and save a draft instead');
    assert.equal('userNote' in reply.result, false);
    assert.deepEqual(methods, ['browser.hello', 'desktop.describe', 'approval.check']);
  });
}
