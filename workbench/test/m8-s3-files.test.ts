import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { listDir, readText, MAX_FILE_BYTES } from '../src/files.ts';

function fixture(t: any) {
  const temp = mkdtempSync(path.join(tmpdir(), 'm8-s3-files-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const root = path.join(temp, 'project');
  const outside = path.join(temp, 'project-neighbor');
  mkdirSync(root);
  mkdirSync(outside);
  writeFileSync(path.join(outside, 'secret.txt'), 'outside secret');
  return { temp, root, outside };
}

test('listDir lists only direct entries, folders first by name, hiding .git', (t) => {
  const { root } = fixture(t);
  mkdirSync(path.join(root, 'z-folder'));
  mkdirSync(path.join(root, 'a-folder'));
  mkdirSync(path.join(root, '.git'));
  writeFileSync(path.join(root, '.git', 'config'), 'private');
  writeFileSync(path.join(root, 'z-file.txt'), 'z');
  writeFileSync(path.join(root, 'a-file.txt'), 'a');
  writeFileSync(path.join(root, '.env'), 'synthetic');
  writeFileSync(path.join(root, 'a-folder', 'nested.txt'), 'nested');
  const expected = [
    { name: 'a-folder', dir: true }, { name: 'z-folder', dir: true },
    { name: '.env', dir: false }, { name: 'a-file.txt', dir: false }, { name: 'z-file.txt', dir: false },
  ];
  assert.deepEqual(listDir(root, '.'), expected);
  assert.deepEqual(listDir(root, ''), expected);
  assert.deepEqual(listDir(root, 'a-folder'), [{ name: 'nested.txt', dir: false }]);
  assert.deepEqual(listDir(root, 'z-folder'), []);
});

test('listDir hides a .git regular file as well as a .git folder', (t) => {
  const { root } = fixture(t);
  writeFileSync(path.join(root, '.git'), 'gitdir: synthetic');
  assert.deepEqual(listDir(root, '.'), []);
});

test('listDir returns null for files, missing paths and nonexistent roots', (t) => {
  const { root, temp } = fixture(t);
  writeFileSync(path.join(root, 'file.txt'), 'hello');
  for (const rel of ['file.txt', 'missing', 'missing/child']) assert.equal(listDir(root, rel), null, rel);
  assert.equal(listDir(path.join(temp, 'missing-root'), '.'), null);
});

test('readText reads UTF-8, empty files and normalized paths within the project', (t) => {
  const { root } = fixture(t);
  mkdirSync(path.join(root, 'folder'));
  writeFileSync(path.join(root, 'hello.txt'), 'hello café 🌿\nsecond\n');
  writeFileSync(path.join(root, 'empty.txt'), '');
  assert.deepEqual(readText(root, 'hello.txt'), { text: 'hello café 🌿\nsecond\n' });
  assert.deepEqual(readText(root, 'folder/../hello.txt'), { text: 'hello café 🌿\nsecond\n' });
  assert.deepEqual(readText(root, 'empty.txt'), { text: '' });
});

test('readText rejects folders, missing paths and nonexistent roots', (t) => {
  const { root, temp } = fixture(t);
  mkdirSync(path.join(root, 'folder'));
  for (const rel of ['.', '', 'folder', 'missing', 'missing/child']) {
    assert.deepEqual(readText(root, rel), { error: 'not a file in this project' }, rel);
  }
  assert.deepEqual(readText(path.join(temp, 'missing-root'), 'file.txt'), { error: 'not a file in this project' });
});

test('both helpers reject traversal, absolute outside paths and NUL paths', (t) => {
  const { root, outside } = fixture(t);
  for (const rel of ['..', '../project-neighbor', path.join(outside), '../project-neighbor/secret.txt', path.join(outside, 'secret.txt'), 'bad\0path', '.\0', '../project-neighbor/secret.txt\0']) {
    assert.equal(listDir(root, rel), null, JSON.stringify(rel));
    assert.deepEqual(readText(root, rel), { error: 'not a file in this project' }, JSON.stringify(rel));
  }
});

test('readText rejects a NUL byte at the beginning, middle or end', (t) => {
  const { root } = fixture(t);
  for (const [name, bytes] of [['first', [0, 65]], ['middle', [65, 0, 66]], ['last', [65, 0]]] as const) {
    writeFileSync(path.join(root, name), Buffer.from(bytes));
    assert.deepEqual(readText(root, name), { error: 'not a text file' });
  }
});

test('readText accepts exactly 512 KiB and rejects larger files with literal size messages', (t) => {
  const { root } = fixture(t);
  assert.equal(MAX_FILE_BYTES, 524288);
  writeFileSync(path.join(root, 'boundary.txt'), 'x'.repeat(524288));
  writeFileSync(path.join(root, 'one-over.txt'), 'y'.repeat(524289));
  writeFileSync(path.join(root, 'large.txt'), 'z'.repeat(614400));
  assert.deepEqual(readText(root, 'boundary.txt'), { text: 'x'.repeat(524288) });
  assert.deepEqual(readText(root, 'one-over.txt'), { error: 'too large to show (512 KiB)' });
  assert.deepEqual(readText(root, 'large.txt'), { error: 'too large to show (600 KiB)' });
});

test('outside junctions or symlinks cannot expose a folder or its contents', (t) => {
  const { root, outside } = fixture(t);
  const link = path.join(root, 'escape');
  try { symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (e: any) {
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(e.code)) throw e;
    t.skip('OS refused the synthetic junction or symlink: ' + e.code);
    return;
  }
  assert.deepEqual(listDir(root, '.'), []);
  assert.equal(listDir(root, 'escape'), null);
  assert.deepEqual(readText(root, 'escape/secret.txt'), { error: 'not a file in this project' });
});


test('readText applies the limit to UTF-8 bytes rather than character count', (t) => {
  const { root } = fixture(t);
  writeFileSync(path.join(root, 'utf8-boundary.txt'), 'é'.repeat(262144));
  writeFileSync(path.join(root, 'utf8-over.txt'), 'é'.repeat(262145));
  assert.deepEqual(readText(root, 'utf8-boundary.txt'), { text: 'é'.repeat(262144) });
  assert.deepEqual(readText(root, 'utf8-over.txt'), { error: 'too large to show (512 KiB)' });
});
