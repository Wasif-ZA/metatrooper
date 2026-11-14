import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { buildGenerated, client, isolation, root, startCore, teardownCore, uiHello, withEnv } from './helpers.ts';

before(buildGenerated);

const { shimToken } = await import(pathToFileURL(join(root, 'core', 'src', 'plugins', 'mcp.ts')).href);

const server = `import { fileURLToPath } from 'node:url';
const here = fileURLToPath(import.meta.url);
let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
  buf += c;
  let i;
  while ((i = buf.indexOf('\\n')) >= 0) {
    const msg = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
    const result = msg.method === 'tools/list' ? { tools: [{ name: 'where', description: here, inputSchema: { type: 'object' } }] } : {};
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
  }
});
`;

test('L0 mcp shim expands {{plugin_dir}} so a plugin server started by node from PATH runs its own script', async () => {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([]));
  const project = join(isolated.home, 'buyer-project');
  mkdirSync(project, { recursive: true });
  const source = join(isolated.home, 'src-plugin');
  mkdirSync(join(source, 'bin'), { recursive: true });
  writeFileSync(join(source, 'bin', 'x.mjs'), server);
  writeFileSync(join(source, 'troop-plugin.json'), JSON.stringify({ schema: 1, id: 'dir-check', version: '1.0.0', name: 'dir-check', mcp: [{ id: 'x', command: 'node', args: ['{{plugin_dir}}/bin/x.mjs'], engines: ['codex'] }] }));
  const core = await startCore({ ...isolated, env: { ...isolated.env, METATROOPER_ENGINES: registry } });
  try {
    const pipe = await client(isolated.prefix);
    try {
      await uiHello(pipe, isolated.home);
      const preview = await pipe.request('plugin.preview', { source });
      assert.equal(preview.error, undefined, `D85: node + script entry refused: ${JSON.stringify(preview)}`);
      const installed = await pipe.request('plugin.install', { source, approved_permissions: [], manifest_hash: preview.result.manifest_hash });
      assert.equal(installed.error, undefined, JSON.stringify(installed));
    } finally { pipe.close(); }
    const child = spawn(process.execPath, [join(root, 'core', 'mcp-shim.js'), 'dir-check', 'x', withEnv({ METATROOPER_HOME: isolated.home }, () => shimToken('dir-check'))], { cwd: project, env: { ...process.env, ...isolated.env, METATROOPER_ENGINES: registry }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => { stderr += c; });
    const line = await new Promise<string>((resolve, reject) => {
      let data = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error(`no tools/list answer; stderr: ${stderr}`)); }, 8000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { data += chunk; if (data.includes('\n')) { clearTimeout(timer); resolve(data.split('\n')[0]!); child.kill(); } });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`shim exited ${code}; stderr: ${stderr}`)); });
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })}\n`);
    });
    const tool = JSON.parse(line).result.tools[0];
    assert.equal(tool.name, 'where');
    assert.equal(tool.description, join(source, 'bin', 'x.mjs'), 'a local-folder install runs the script from that folder, not the buyer project');
  } finally { await teardownCore(core, isolated); }
});
