import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
    assert.equal(await showAt(git, 'HEAD', 'sub'), null);
    for (const p of ['../a.txt', 'sub/../../a.txt', '/etc/passwd', 'C:/x', '.git/config', '', '.', 3, null]) assert.equal(await showAt(git, 'HEAD', p), null, String(p));
    for (const r of ['HEAD~1', 'main', '--output=x', 'HEAD:sub', sha.slice(0, 7), '']) assert.equal(await showAt(git, r, 'sub/a.txt'), null, r);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('showAt reads raw blobs without running smudge filters', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'wb-git-filter-'));
  try {
    const git = runIn(dir);
    await git(['init', '-q']);
    await git(['config', 'user.email', 't@t']); await git(['config', 'user.name', 't']); await git(['config', 'core.autocrlf', 'false']);
    writeFileSync(join(dir, '.gitattributes'), '*.txt filter=marker\n');
    writeFileSync(join(dir, 'a.txt'), 'raw\r\n');
    await git(['add', '.']); await git(['commit', '-qm', 'base']);
    await git(['config', 'filter.marker.smudge', 'echo ran > marker; cat']);
    assert.equal(await showAt(git, 'HEAD', 'a.txt'), 'raw\r\n');
    assert.equal(await showAt(git, ':', 'a.txt'), 'raw\r\n');
    assert.equal(existsSync(join(dir, 'marker')), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('showAt pins the blob id and bounds the raw read even if its size was understated', async () => {
  const id = 'a'.repeat(40);
  const calls: any[] = [];
  const git = async (args: string[], input?: string, options?: { maxBuffer: number }) => {
    calls.push([args, input, options]);
    if (args[0] === 'rev-parse') return id;
    if (args[1] === '-t') return 'blob';
    if (args[1] === '-s') return '1';
    return 'x'.repeat(SHOW_MAX_BYTES + 1);
  };
  assert.equal(await showAt(git, 'HEAD', 'a.txt'), null);
  assert.deepEqual(calls, [
    [['rev-parse', '--verify', 'HEAD:./a.txt'], undefined, undefined],
    [['cat-file', '-t', id], undefined, undefined],
    [['cat-file', '-s', id], undefined, undefined],
    [['cat-file', 'blob', id], undefined, { maxBuffer: SHOW_MAX_BYTES + 1 }],
  ]);
  let read = false;
  assert.equal(await showAt(async (args) => {
    if (args[0] === 'rev-parse') return id;
    if (args[1] === '-t') return 'blob';
    if (args[1] === '-s') return String(SHOW_MAX_BYTES + 1);
    read = true;
    return '';
  }, 'HEAD', 'a.txt'), null);
  assert.equal(read, false);
});
