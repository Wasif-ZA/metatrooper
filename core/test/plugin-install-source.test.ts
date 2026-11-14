import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openCoreDb } from '../src/store/db.ts';
import { isolation, withEnv } from './helpers.ts';

/** A committed git repo of a synthetic plugin, in a folder whose name does not end in .git. */
export function pluginRepo(home: string, id: string, extra: Record<string, unknown> = {}): string {
  const repo = join(home, `${id}-repo`);
  mkdirSync(repo, { recursive: true });
  writeFileSync(join(repo, 'troop-plugin.json'), JSON.stringify({ schema: 1, id, version: '1.0.0', name: id, ...extra }));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { stdio: 'pipe' });
  git('init', '-q');
  git('add', '.');
  git('commit', '-qm', 'fixture');
  return repo;
}

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
