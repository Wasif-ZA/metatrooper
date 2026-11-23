import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { folderApproval } from '../src/sessions/launch.ts';
import { tmpdir } from 'node:os';
import { root, withEnv } from './helpers.ts';

const listed = 'C:/Users/Example/work/ACU';

function approvalWithAskPaths(dir: string, approval?: string, askPaths = [listed]) {
  const home = mkdtempSync(join(tmpdir(), 'ask-paths-'));
  try {
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ sessions: { ask_paths: askPaths } }));
    return withEnv({ METATROOPER_HOME: home }, () => folderApproval(dir, approval));
  } finally { rmSync(home, { recursive: true, force: true }); }
}

test('M5-10 folder inside an ask path keeps contained approval', () => {
  // protects= D89: ask_paths cannot change approval inside a listed folder.
  assert.equal(approvalWithAskPaths('C:/Users/Example/work/ACU/repo'), 'contained');
});

test('M5-10 folder holding a listed path one or two levels below keeps contained approval', () => {
  // protects= D89: parent folders of ask_paths default to contained.
  assert.equal(approvalWithAskPaths('C:/Users/Example/work'), 'contained');
  assert.equal(approvalWithAskPaths('C:/Users/Example'), 'contained');
});

test('M5-10 folders below the tree two levels above a listed path keep requested approval', () => {
  // protects= D89: proximity to ask_paths cannot override an explicit approval.
  assert.equal(approvalWithAskPaths('C:/Users/Example/work/other/repo', 'contained'), 'contained');
  assert.equal(approvalWithAskPaths('C:/Users/Example/work/other/repo', 'edits'), 'edits');
});

test('M5-10 unrelated folder preserves requested approval and empty ask_paths changes nothing', () => {
  // protects= D89: explicit approval is preserved with populated or empty ask_paths.
  assert.equal(approvalWithAskPaths('C:/Users/Elsewhere/repo', 'contained'), 'contained');
  assert.equal(approvalWithAskPaths('C:/Users/Example/work/other', 'contained', []), 'contained');
});

test('M5-10 case and slash style do not change contained approval near ask_paths', () => {
  // protects= D89: differently spelled paths cannot turn contained into ask.
  assert.equal(approvalWithAskPaths('c:\\users\\example\\WORK\\acu\\repo'), 'contained');
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
