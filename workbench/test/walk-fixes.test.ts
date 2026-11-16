import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitView, runIn } from '../src/gitpane.ts';

test('git view has no upstream without a remote, and names it once a branch tracks one', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-upstream-'));
  const remote = fs.mkdtempSync(path.join(os.tmpdir(), 'walk-remote-'));
  const git = runIn(dir);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 't@example.com']);
  await git(['config', 'user.name', 't']);
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\n');
  await git(['add', 'a.txt']);
  await git(['commit', '-q', '-m', 'one']);
  assert.equal((await gitView(git)).upstream, null);

  await runIn(remote)(['init', '-q', '--bare']);
  await git(['remote', 'add', 'origin', remote]);
  await git(['push', '-q', '-u', 'origin', 'main']);
  const v = await gitView(git);
  assert.equal(v.upstream, 'origin/main');
  assert.deepEqual([v.ahead, v.behind], [0, 0]);
});
