import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openCoreDb } from '../src/store/db.ts';
import { isolation, pluginRepo, withEnv } from './helpers.ts';

test('the install preview shows {{plugin_dir}} as the folder the plugin will run from', async (t) => {
  const isolated = isolation();
  const env = { METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix };
  const db = withEnv(env, openCoreDb);
  t.after(() => { db.close(); rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const { previewPlugin, pluginsDir } = await import('../src/plugins/store.ts');
  const mcp = [{ id: 'x', command: 'node', args: ['{{plugin_dir}}/bin/x.mjs'], engines: ['codex'] }];
  const folder = pluginRepo(isolated.home, 'dir-preview', { mcp });
  const local = withEnv(env, () => previewPlugin(db, folder));
  assert.equal(local.screen?.mcp_servers[0].command, `node ${folder}/bin/x.mjs`, 'a local folder runs in place');
  const cloned = withEnv(env, () => previewPlugin(db, pathToFileURL(folder).href));
  assert.equal(cloned.screen?.mcp_servers[0].command, `node ${join(withEnv(env, pluginsDir), 'dir-preview')}/bin/x.mjs`, 'a git source runs from its installed copy');
});

test('a plugin installs from a file:// git URL, cloned like any other git source', async (t) => {
  const isolated = isolation();
  const env = { METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix };
  const db = withEnv(env, openCoreDb);
  t.after(() => { db.close(); rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const { installPlugin, previewPlugin, pluginsDir } = await import('../src/plugins/store.ts');
  const source = pathToFileURL(pluginRepo(isolated.home, 'url-fixture')).href;
  assert.match(source, /^file:\/\//);
  const preview = withEnv(env, () => previewPlugin(db, source));
  assert.equal(preview.valid, true, JSON.stringify(preview));
  withEnv(env, () => installPlugin(db, { source, approved_permissions: [] }));
  assert.ok(existsSync(join(withEnv(env, pluginsDir), 'url-fixture', 'troop-plugin.json')), 'the clone is installed');
});
