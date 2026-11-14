import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, pluginRepo, root, startCore, teardownCore, uiHello, withEnv } from './helpers.ts';
import { mcpAttachArgs, shimToken } from '../src/plugins/mcp.ts';

before(buildGenerated);

// A synthetic stdio MCP server: answers initialize and lists two tools.
const SERVER = `let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    if (msg.id === undefined) continue;
    const result = msg.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'url-tools', version: '1.0.0' } }
      : msg.method === 'tools/list' ? { tools: [{ name: 'tool_a', inputSchema: { type: 'object' } }, { name: 'tool_b', inputSchema: { type: 'object' } }] } : {};
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
  }
});
`;

function shimCall(args: string[], env: Record<string, string | undefined>, lines: object[]): Promise<{ replies: any[]; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(root, 'core', 'mcp-shim.js'), ...args], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '', stderr = '';
    const replies: any[] = [];
    const timer = setTimeout(() => { child.kill(); reject(new Error(`shim timeout: ${stderr}`)); }, 15_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (c) => {
      out += c;
      let i;
      while ((i = out.indexOf('\n')) >= 0) {
        const l = out.slice(0, i).trim();
        out = out.slice(i + 1);
        if (l) replies.push(JSON.parse(l));
      }
      if (replies.length >= lines.length) child.stdin.end();
    });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('exit', () => { clearTimeout(timer); resolve({ replies, stderr }); });
    for (const l of lines) child.stdin.write(JSON.stringify(l) + '\n');
  });
}

test('a plugin installed from a file:// git URL reaches a new session: its MCP server is in the config and answers through the shim', { timeout: 180_000 }, async () => {
  const iso = isolation();
  const env = { ...iso.env, METATROOPER_FAKE_DPAPI: '1', METATROOPER_ENGINES: join(iso.home, 'engines.json') };
  writeFileSync(env.METATROOPER_ENGINES, '[]');
  const repo = pluginRepo(iso.home, 'url-tools', { mcp: [{ id: 'tools', command: 'node', args: ['{{plugin_dir}}/bin/server.mjs'], engines: ['claude'] }] });
  mkdirSync(join(repo, 'bin'), { recursive: true });
  writeFileSync(join(repo, 'bin', 'server.mjs'), SERVER);
  const { execFileSync } = await import('node:child_process');
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.'], { stdio: 'pipe' });
  execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'server'], { stdio: 'pipe' });
  const core = await startCore({ ...iso, env });
  const c = await client(iso.prefix);
  try {
    await uiHello(c, iso.home);
    const source = pathToFileURL(repo).href;
    const preview = await c.request('plugin.preview', { source }, { timeout: 15_000 });
    assert.ok(preview.result, JSON.stringify(preview.error));
    assert.equal(preview.result.valid, true, JSON.stringify(preview.result.errors));
    const installed = await c.request('plugin.install', { source, approved_permissions: [], manifest_hash: preview.result.manifest_hash }, { timeout: 15_000 });
    assert.ok(installed.result, JSON.stringify(installed.error));
    assert.equal(installed.result.plugin_id, 'url-tools');
    assert.ok(existsSync(join(iso.home, 'plugins', 'url-tools', 'bin', 'server.mjs')), 'the installed copy holds the server');

    const db = new DatabaseSync(join(iso.home, 'troop.db'));
    try {
      const claude = { id: 'claude', command: 'claude', version_cmd: ['claude'], state_source: 'hooks' as const, roles: ['worker'], cost_rank: 3, mcp_attach: { kind: 'claude-mcp-config-flag' } };
      const args = withEnv({ METATROOPER_HOME: iso.home }, () => mcpAttachArgs(db, claude as never, 'S1', false));
      assert.ok(args[0]?.startsWith('--mcp-config='), JSON.stringify(args));
      const config = JSON.parse(readFileSync(args[0].slice('--mcp-config='.length), 'utf8'));
      const entry = config.mcpServers['url-tools-tools'];
      assert.ok(entry, JSON.stringify(config));
      const token = withEnv({ METATROOPER_HOME: iso.home }, () => shimToken('url-tools'));
      assert.deepEqual(entry.args.slice(1), ['url-tools', 'tools', token]);

      const shimEnv: Record<string, string | undefined> = { ...process.env, METATROOPER_HOME: iso.home, METATROOPER_PIPE_PREFIX: iso.prefix };
      delete shimEnv.NODE_TEST_CONTEXT;
      const r = await shimCall(entry.args.slice(1), shimEnv, [
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {} } },
        { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
      ]);
      assert.equal(r.replies[0]?.result?.serverInfo?.name, 'url-tools', r.stderr);
      assert.deepEqual(r.replies[1].result.tools.map((t: { name: string }) => t.name).sort(), ['tool_a', 'tool_b']);
    } finally {
      db.close();
    }
  } finally {
    c.close?.();
    await teardownCore(core, iso);
  }
});
