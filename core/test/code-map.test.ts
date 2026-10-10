import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, root, startCore, teardownCore, uiHello } from './helpers.ts';

before(buildGenerated);

const manifestFile = join(root, 'plugins', 'optional', 'code-map', 'troop-plugin.json');
const { validateManifest } = await import(pathToFileURL(join(root, 'core', 'src', 'plugins', 'manifest.ts')).href);

test('M4-03 manifest accepts code-map and rejects env/env_keys overlap', () => {
  const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
  assert.deepEqual(validateManifest(manifest, join(root, 'plugins', 'optional', 'code-map')), []);
  manifest.mcp[0].env_keys = ['PYTHONUTF8'];
  assert.ok(validateManifest(manifest, join(root, 'plugins', 'optional', 'code-map')).some((e: string) => e.includes('PYTHONUTF8')));
});

test('M4-03 mcp shim replaces the exact {{cwd}} argument with its working directory', async () => {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([]));
  const project = join(isolated.home, 'shim-cwd');
  mkdirSync(project, { recursive: true });
  const pluginDir = join(isolated.home, 'plugins', 'cwd-check');
  mkdirSync(pluginDir, { recursive: true });
  const fixture = join(isolated.home, 'shim-argv-fixture.js');
  writeFileSync(join(pluginDir, 'troop-plugin.json'), JSON.stringify({ schema: 1, id: 'cwd-check', version: '1.0.0', name: 'cwd-check', mcp: [{ id: 'cwd', command: process.execPath, args: [fixture, '{{cwd}}'], engines: ['codex'] }] }));
  writeFileSync(fixture, "process.stdin.once('data',()=>{process.stdout.write(JSON.stringify({cwd:process.argv[2]})+'\\n')})\n");
  const core = await startCore({ ...isolated, env: { ...isolated.env, METATROOPER_ENGINES: registry } });
  try {
    const pipe = await client(isolated.prefix);
    try {
      await uiHello(pipe, isolated.home);
      const preview = await pipe.request('plugin.preview', { source: pluginDir });
      const installed = await pipe.request('plugin.install', { source: pluginDir, approved_permissions: [], manifest_hash: preview.result.manifest_hash });
      assert.equal(installed.error, undefined, JSON.stringify(installed));
    } finally { pipe.close(); }
    const child = spawn(process.execPath, [join(root, 'core', 'mcp-shim.js'), 'cwd-check', 'cwd'], { cwd: project, env: { ...process.env, ...isolated.env, METATROOPER_ENGINES: registry }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const output = await new Promise<string>((resolve, reject) => {
      let data = '';
      const timer = setTimeout(() => { child.kill(); reject(new Error('shim did not spawn cwd fixture')); }, 8000);
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => { data += chunk; if (data.includes('\n')) { clearTimeout(timer); resolve(data); child.kill(); } });
      child.once('error', reject);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'initialize', params: {} })}\n`);
    });
    assert.deepEqual(JSON.parse(output), { cwd: project });
  } finally { await teardownCore(core, isolated); }
});
