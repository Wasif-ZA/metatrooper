import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { isolation, root, runNode, pipePath } from './helpers.ts';

test('M7-11g troop browser without a tool lists tools and exits 2', async () => {
  const iso = isolation();
  try {
    const result = await runNode(['core/cli.ts', 'browser'], iso.env);
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stdout, /navigate/);
  } finally { rmSync(iso.home, { recursive: true, force: true }); }
});

test('M7-11g troop browser tools --json lists navigate', async () => {
  const iso = isolation();
  try {
    const result = await runNode(['core/cli.ts', 'browser', 'tools', '--json'], iso.env);
    assert.equal(result.code, 0, result.stderr);
    const tools = JSON.parse(result.stdout);
    assert.ok(Array.isArray(tools));
    assert.ok(tools.some((tool: { name: string }) => tool.name === 'navigate'));
  } finally { rmSync(iso.home, { recursive: true, force: true }); }
});

test('M7-11g troop browser rejects bad JSON args with exit 2', async () => {
  const iso = isolation();
  try {
    const result = await runNode(['core/cli.ts', 'browser', 'navigate', '{bad'], iso.env);
    assert.equal(result.code, 2, result.stderr);
    assert.match(result.stderr, /JSON object/);
  } finally { rmSync(iso.home, { recursive: true, force: true }); }
});

test('M7-11g troop browser reports a closed workbench and exits 1', async () => {
  const iso = isolation();
  try {
    const result = await runNode(['core/cli.ts', 'browser', 'panes'], iso.env);
    assert.equal(result.code, 1, result.stderr);
    assert.match(result.stderr, /browser not available: the MetaTrooper workbench is closed/);
  } finally { rmSync(iso.home, { recursive: true, force: true }); }
});

test('M7-11g troop browser uses the session token and prints a refused hello reason', async () => {
  const iso = isolation();
  const token = 'a'.repeat(64);
  const hello: any[] = [];
  const pipe = pipePath(`${iso.prefix}-browser`);
  let refuse = false;
  const server = createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      for (let end; (end = buffer.indexOf('\n')) >= 0;) {
        const request = JSON.parse(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (request.method === 'browser.hello') hello.push(request.params);
        const reply = request.method === 'browser.hello' && refuse
          ? { error: { code: -32030, message: 'browser token does not match the session' } }
          : { result: request.method === 'browser.hello' ? { ok: true, bound: 'session' } : [] };
        socket.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...reply }) + '\n');
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(pipe, resolve); });
    const env = { ...iso.env, TROOP_SESSION_ID: 'session-from-env', TROOP_BROWSER_TOKEN: token };
    const accepted = await runNode(['core/cli.ts', 'browser', 'panes'], env);
    assert.equal(accepted.code, 0, accepted.stderr);
    assert.deepEqual(JSON.parse(accepted.stdout), []);
    assert.deepEqual(hello[0], { session_id: 'session-from-env', pid: hello[0].pid, token });
    assert.equal(typeof hello[0].pid, 'number');
    refuse = true;
    const denied = await runNode(['core/cli.ts', 'browser', 'navigate', '{"url":"https://example.com"}'], env);
    assert.equal(denied.code, 1, denied.stderr);
    assert.match(denied.stderr, /browser refused this session: browser token does not match the session/);
  } finally {
    server.close();
    rmSync(iso.home, { recursive: true, force: true });
  }
});

test('M7-11g browser MCP still answers initialize and tools/list', async () => {
  const iso = isolation();
  const child = spawn(process.execPath, [join(root, 'core', 'src', 'hook', 'browser-mcp.ts')], {
    cwd: root, env: iso.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  });
  try {
    const replies = await new Promise<any[]>((resolve, reject) => {
      const collected: any[] = [];
      let buffer = '';
      const timer = setTimeout(() => reject(new Error('MCP replies timed out')), 4000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        buffer += chunk;
        for (let end; (end = buffer.indexOf('\n')) >= 0;) {
          collected.push(JSON.parse(buffer.slice(0, end)));
          buffer = buffer.slice(end + 1);
          if (collected.length === 2) { clearTimeout(timer); resolve(collected); }
        }
      });
      child.once('error', reject);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } }) + '\n');
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) + '\n');
    });
    const init = replies.find((r) => r.id === 1);
    const list = replies.find((r) => r.id === 2);
    assert.deepEqual(init?.result, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'metatrooper-browser', version: '1.0.0' } });
    assert.ok(Array.isArray(list?.result?.tools));
    assert.ok(list.result.tools.some((tool: { name: string }) => tool.name === 'navigate'));
  } finally {
    child.kill();
    rmSync(iso.home, { recursive: true, force: true });
  }
});
