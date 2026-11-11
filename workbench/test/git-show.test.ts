import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runIn, showAt, SHOW_MAX_BYTES } from '../src/gitpane.ts';

test('showAt returns HEAD and index text, and refuses paths outside the repo and other revisions', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-git-show-'));
  try {
    const git = runIn(dir);
    await git(['init', '-q']);
    await git(['config', 'user.email', 't@t']); await git(['config', 'user.name', 't']); await git(['config', 'core.autocrlf', 'false']);
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'sub', 'a.txt'), 'one\n');
    writeFileSync(join(dir, 'bin.dat'), Buffer.from([1, 0, 2]));
    writeFileSync(join(dir, 'big.txt'), 'x'.repeat(SHOW_MAX_BYTES + 1));
    await git(['add', '.']); await git(['commit', '-qm', 'base']);
    writeFileSync(join(dir, 'sub', 'a.txt'), 'two\n'); await git(['add', 'sub/a.txt']);
    writeFileSync(join(dir, 'sub', 'a.txt'), 'three\n');

    assert.equal(await showAt(git, 'HEAD', 'sub/a.txt'), 'one\n');
    assert.equal(await showAt(git, ':', 'sub/a.txt'), 'two\n');
    assert.equal(await showAt(git, ':', 'sub\\a.txt'), 'two\n');
    assert.equal(await showAt(runIn(join(dir, 'sub')), 'HEAD', 'a.txt'), 'one\n');
    const sha = (await git(['rev-parse', 'HEAD'])).trim();
    assert.equal(await showAt(git, sha, 'sub/a.txt'), 'one\n');
    assert.equal(await showAt(git, 'HEAD', 'new.txt'), '');
    assert.equal(await showAt(git, 'HEAD', 'bin.dat'), null);
    assert.equal(await showAt(git, 'HEAD', 'big.txt'), null);
    for (const p of ['../a.txt', 'sub/../../a.txt', '/etc/passwd', 'C:/x', '.git/config', '', '.', 3, null]) assert.equal(await showAt(git, 'HEAD', p), null, String(p));
    for (const r of ['HEAD~1', 'main', '--output=x', 'HEAD:sub', sha.slice(0, 7), '']) assert.equal(await showAt(git, r, 'sub/a.txt'), null, r);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
