import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openCoreDb } from '../src/store/db.ts';
import { isolation, withEnv } from './helpers.ts';
import { installPlugin, removePlugin } from '../src/plugins/store.ts';
import { resolveMcpServer } from '../src/plugins/mcp.ts';

test('a plugin binary whose hash differs from the approved one does not run', (t) => {
  const isolated = isolation();
  const env = { METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix };
  const db = withEnv(env, openCoreDb);
  t.after(() => { db.close(); rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const source = join(isolated.home, 'src-hash');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'server.js'), 'console.log(1);\n');
  writeFileSync(join(source, 'troop-plugin.json'), JSON.stringify({ schema: 1, id: 'hash-check', version: '1.0.0', name: 'hash-check', platforms: ['windows', 'linux', 'macos'], mcp: [{ id: 'x', command: 'node', args: ['{{plugin_dir}}/server.js'], engines: ['codex'] }] }));
  const install = () => withEnv(env, () => installPlugin(db, { source, approved_permissions: [] }));
  const resolve = () => withEnv(env, () => resolveMcpServer(db, 'hash-check', 'x'));
  const hashRow = () => db.prepare("SELECT value FROM meta WHERE key = 'plugin_files:hash-check'").get();

  install();
  assert.ok(hashRow(), 'install records the approved hashes');
  assert.equal(resolve().command, 'node', 'an unchanged file starts');

  const { path } = db.prepare('SELECT path FROM plugin WHERE id = ?').get('hash-check') as { path: string };
  writeFileSync(join(path, 'server.js'), 'console.log("tampered");\n');
  assert.throws(resolve, (e: any) => e.code === -32003 && /server\.js/.test(e.message));

  writeFileSync(join(source, 'server.js'), 'console.log(2);\n');
  install();
  assert.equal(resolve().command, 'node', 'reinstalling approves the new file');

  withEnv(env, () => removePlugin(db, 'hash-check'));
  assert.equal(hashRow(), undefined, 'removing the plugin drops its hashes');
});
