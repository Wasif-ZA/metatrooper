import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gitIn, sessionChanges } from '../src/handback.ts';
import { gitAct, runIn } from '../src/gitpane.ts';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

async function unbornRepo(fn: (dir: string) => Promise<void>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w4-unborn-'));
  try {
    const git = runIn(dir);
    await git(['init', '-q', '--object-format=sha1']);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'staged\n');
    fs.writeFileSync(path.join(dir, 'untracked.txt'), 'untracked\n');
    await git(['add', '--', 'a.txt']);
    await assert.rejects(git(['rev-parse', '--verify', 'HEAD']));
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// protects=FIX-W4b,FIX-W4c
test('FIX-W4 sessionChanges lists staged and untracked files before the first commit', async () => {
  await unbornRepo(async (dir) => {
    const changes = await sessionChanges(gitIn(dir), EMPTY_TREE);
    assert.deepEqual(changes.files, [{ path: 'a.txt', added: 1, deleted: 0 }]);
    assert.deepEqual(changes.untracked, ['untracked.txt']);
  });
});

for (const op of ['unstage', 'unstage-paths', 'unstage-all']) {
  // protects=FIX-W4a,FIX-W4c
  test(`FIX-W4 ${op} preserves working files and empties the unborn index`, async () => {
    await unbornRepo(async (dir) => {
      const git = runIn(dir);
      if (op !== 'unstage') {
        fs.writeFileSync(path.join(dir, 'b.txt'), 'also staged\n');
        await git(['add', '--', 'b.txt']);
      }
      await gitAct(git, op === 'unstage-all' ? 'unstage' : op, op === 'unstage-paths' ? ['a.txt', 'b.txt'] : op === 'unstage-all' ? '' : 'a.txt');
      assert.equal((await git(['diff', '--cached', '--name-only'])).trim(), '');
      assert.equal(fs.readFileSync(path.join(dir, 'a.txt'), 'utf8'), 'staged\n');
      assert.equal(fs.readFileSync(path.join(dir, 'untracked.txt'), 'utf8'), 'untracked\n');
      if (op !== 'unstage') assert.equal(fs.readFileSync(path.join(dir, 'b.txt'), 'utf8'), 'also staged\n');
      await assert.rejects(git(['rev-parse', '--verify', 'HEAD']));
    });
  });
}

// protects=FIX-W4b
test('FIX-W4 diffBase verifies HEAD and falls back to the empty tree', () => {
  const source = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const start = source.indexOf('const diffBase =');
  const end = source.indexOf("on('sessionDiff'", start);
  assert.ok(start >= 0 && end > start, 'diffBase source is present');
  const diffBase = source.slice(start, end);
  assert.match(diffBase, /try\s*\{\s*await g\(\['rev-parse', '--verify', '-q', 'HEAD'\]\);\s*return 'HEAD';\s*\}\s*catch\s*\{\}/);
  assert.match(diffBase, new RegExp(`return[^;]*'${EMPTY_TREE}'`, 's'));
});
