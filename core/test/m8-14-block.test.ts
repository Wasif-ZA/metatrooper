import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openCoreDb } from '../src/store/db.ts';
import { isolation, withEnv } from './helpers.ts';
import { installPlugin, previewPlugin } from '../src/plugins/store.ts';
import { applyBlocks, blockReason, readBlocks, BLOCK_FILE } from '../src/plugins/blocklist.ts';

test('a plugin on the remote block list is disabled with its reason', (t) => {
  const isolated = isolation();
  const env = { METATROOPER_HOME: isolated.home, METATROOPER_PIPE_PREFIX: isolated.prefix };
  const db = withEnv(env, openCoreDb);
  t.after(() => { db.close(); rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const source = join(isolated.home, 'src-blocked');
  mkdirSync(source, { recursive: true });
  writeFileSync(join(source, 'server.js'), 'console.log(1);\n');
  writeFileSync(join(source, 'troop-plugin.json'), JSON.stringify({ schema: 1, id: 'bad-plug', version: '1.0.0', name: 'bad-plug', platforms: ['windows', 'linux', 'macos'], mcp: [{ id: 'x', command: 'node', args: ['{{plugin_dir}}/server.js'], engines: ['codex'] }] }));
  withEnv(env, () => installPlugin(db, { source, approved_permissions: [] }));
  const enabled = () => (db.prepare("SELECT enabled FROM plugin WHERE id = 'bad-plug'").get() as { enabled: number }).enabled;
  const rows = () => db.prepare("SELECT kind, ref, text FROM needs_you WHERE ref = 'bad-plug' AND resolved_at IS NULL").all() as Array<{ kind: string; ref: string; text: string }>;
  assert.equal(enabled(), 1);

  assert.equal(applyBlocks(db, [{ id: 'bad-plug', versions: ['9.9.9'], reason: 'other version' }]).length, 0);
  assert.equal(enabled(), 1, 'a block for other versions leaves it on');
  assert.equal(rows().length, 0);

  assert.equal(blockReason('bad-plug', '1.0.0', [{ id: 'bad-plug', versions: ['1.0.0'], reason: 'r' }]), 'r');
  assert.equal(blockReason('bad-plug', '1.0.1', [{ id: 'bad-plug', versions: ['1.0.0'], reason: 'r' }]), null);
  assert.equal(blockReason('bad-plug', '3.0.0', [{ id: 'bad-plug', reason: 'all' }]), 'all');
  assert.equal(blockReason('other', '1.0.0', [{ id: 'bad-plug', reason: 'all' }]), null);

  const blocks = [{ id: 'bad-plug', reason: 'leaks tokens' }];
  assert.deepEqual(applyBlocks(db, blocks), ['bad-plug']);
  assert.equal(enabled(), 0);
  assert.equal(rows().length, 1);
  assert.equal(rows()[0].kind, 'other');
  assert.match(rows()[0].text, /leaks tokens/);
  applyBlocks(db, blocks);
  assert.equal(rows().length, 1, 'a second pass adds no duplicate row');

  db.prepare("INSERT INTO plugin (id, version, path, manifest, source, permissions, enabled, installed_at) VALUES ('core-thing', '1.0.0', '', '{}', 'builtin', '{}', 1, ?)").run(new Date().toISOString());
  assert.deepEqual(applyBlocks(db, [{ id: 'core-thing', reason: 'x' }]), []);
  assert.equal((db.prepare("SELECT enabled FROM plugin WHERE id = 'core-thing'").get() as { enabled: number }).enabled, 1, 'a builtin is never turned off');

  // preview and install read the shipped file, so it is swapped for the test and put back
  const backup = join(isolated.home, 'blocked.json.bak');
  copyFileSync(BLOCK_FILE, backup);
  try {
    writeFileSync(BLOCK_FILE, JSON.stringify([{ id: 'bad-plug', versions: ['1.0.0'], reason: 'leaks tokens' }]));
    const p = withEnv(env, () => previewPlugin(db, source));
    assert.equal(p.valid, false);
    assert.ok(p.errors.some((e) => /bad-plug 1\.0\.0 is on cc's block list: leaks tokens/.test(e)));
    assert.throws(() => withEnv(env, () => installPlugin(db, { source, approved_permissions: [] })), (e: any) => /leaks tokens/.test(JSON.stringify(e.data ?? e.message)));
  } finally {
    copyFileSync(backup, BLOCK_FILE);
  }
});

test('the shipped block list parses and is a list', () => {
  assert.ok(Array.isArray(readBlocks()));
});
