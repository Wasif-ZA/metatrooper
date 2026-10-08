import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitAct, gitView, runIn } from '../src/gitpane.ts';

test('git tab: stage, commit, view and history on a real repo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gitpane-'));
  const git = runIn(dir);
  git(['init', '-q', '-b', 'main']);
  git(['config', 'user.email', 't@example.com']);
  git(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  fs.writeFileSync(path.join(dir, 'b c.txt'), 'two\n');

  let v = gitView(git);
  assert.equal(v.branch, 'main');
  assert.deepEqual(v.changes.map((f) => [f.code, f.path]).sort(), [['U', 'a.txt'], ['U', 'b c.txt']]);
  assert.throws(() => gitAct(git, 'commit', 'msg'), /nothing staged/);

  gitAct(git, 'stage', 'a.txt');
  v = gitView(git);
  assert.deepEqual(v.staged.map((f) => f.path), ['a.txt']);
  assert.throws(() => gitAct(git, 'commit', '  '), /message/);

  gitAct(git, 'commit', "first 'quoted' commit");
  v = gitView(git);
  assert.equal(v.staged.length, 0);
  assert.match(v.log, /first 'quoted' commit/);

  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\nmore\n');
  v = gitView(git);
  const a = v.changes.find((f) => f.path === 'a.txt');
  assert.deepEqual([a?.code, a?.added, a?.deleted], ['M', 1, 0]);

  gitAct(git, 'stage', '');
  assert.equal(gitView(git).changes.length, 0);
  gitAct(git, 'unstage', '');
  assert.equal(gitView(git).staged.length, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('git tab: branch names keep their dots, with and without an upstream', () => {
  const head = (h: string) => gitView((args) => (args[0] === 'status' ? `${h}\0` : '')).branch;
  assert.equal(head('## release-1.2'), 'release-1.2');
  assert.equal(head('## release-1.2...origin/release-1.2 [ahead 1]'), 'release-1.2');
  assert.equal(head('## No commits yet on v0.3'), 'v0.3');
  assert.equal(head('## main...origin/main'), 'main');
});
