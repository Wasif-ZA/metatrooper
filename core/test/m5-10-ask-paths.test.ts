import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { folderApproval } from '../src/sessions/launch.ts';
import { root } from './helpers.ts';

const listed = 'C:/Users/Example/work/ACU';

test('M5-10 folder inside an ask path requests approval', () => {
  assert.equal(folderApproval('C:/Users/Example/work/ACU/repo', 'contained', {}, [listed]), 'ask');
});

test('M5-10 folder holding a listed path one or two levels below requests approval', () => {
  assert.equal(folderApproval('C:/Users/Example/work', 'contained', {}, [listed]), 'ask');
  assert.equal(folderApproval('C:/Users/Example', 'contained', {}, [listed]), 'ask');
});

test('M5-10 ask_near_paths covers folders below the tree two levels above a listed path', () => {
  assert.equal(
    folderApproval('C:/Users/Example/work/other/repo', 'contained', { ask_near_paths: true } as never, [listed]),
    'ask',
  );
});

test('M5-10 unrelated folder preserves requested approval and empty ask_paths changes nothing', () => {
  assert.equal(folderApproval('C:/Users/Elsewhere/repo', 'contained', {}, [listed]), 'contained');
  assert.equal(folderApproval('C:/Users/Example/work/other', 'contained', {}, []), 'contained');
});

test('M5-10 path matching ignores case and slash style', () => {
  assert.equal(folderApproval('c:\\users\\example\\WORK\\acu\\repo', 'contained', {}, [listed]), 'ask');
});

test('M5-10 source contains no employer-specific ACU path and each plugin has a license', () => {
  const grep = spawnSync('git', ['grep', '-n', 'work/ACU', '--', 'core/src', 'workbench/src'], {
    cwd: root,
    encoding: 'utf8',
  });
  assert.equal(grep.status, 1, grep.stdout + grep.stderr);

  const manifests = spawnSync('git', ['ls-files', 'plugins/*troop-plugin.json'], { cwd: root, encoding: 'utf8' }).stdout.trim().split(/\r?\n/);
  assert.ok(manifests.length > 0, 'expected plugin manifests');
  for (const manifest of manifests) {
    const dir = manifest.replace(/\/troop-plugin\.json$/, '');
    assert.ok(readdirSync(join(root, dir)).includes('LICENSE'), `${dir} has no LICENSE`);
  }
});
