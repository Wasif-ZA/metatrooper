import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { inside, listDir, readText, writeText, createEntry, renameEntry, searchText, MAX_FILE_BYTES, type SearchHit } from '../src/files.ts';

function createFixture(t: any) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-files-'));
  t.after(() => {
    try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  });
  const root = path.join(temp, 'project');
  const outside = path.join(temp, 'outside');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret outside project', 'utf8');
  return { temp, root, outside };
}

test('step 1: refused read and write cases for traversal, absolute, and drive paths', (t) => {
  const { root, outside } = createFixture(t);
  fs.writeFileSync(path.join(root, 'valid.txt'), 'hello world', 'utf8');

  // Traversal with ..
  assert.deepEqual(readText(root, '..'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, '..', 'data', null), { error: 'not a file in this project' });
  assert.deepEqual(readText(root, '../outside/secret.txt'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, '../outside/secret.txt', 'data', null), { error: 'not a file in this project' });

  // Absolute paths outside root
  const absOutside = path.join(outside, 'secret.txt');
  assert.deepEqual(readText(root, absOutside), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, absOutside, 'data', null), { error: 'not a file in this project' });

  // Absolute path inside root is refused for write
  const absInside = path.join(root, 'valid.txt');
  assert.deepEqual(writeText(root, absInside, 'data', null), { error: 'not a file in this project' });

  // Drive paths
  assert.deepEqual(readText(root, 'C:\\secret.txt'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, 'C:\\secret.txt', 'data', null), { error: 'not a file in this project' });
  assert.deepEqual(readText(root, 'C:secret.txt'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, 'C:secret.txt', 'data', null), { error: 'not a file in this project' });
  assert.deepEqual(readText(root, 'Z:/outside.txt'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, 'Z:/outside.txt', 'data', null), { error: 'not a file in this project' });
});

test('step 1: refused read and write cases for git internals (.git, .GIT, GIT~1)', (t) => {
  const { root } = createFixture(t);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'config'), 'repo config', 'utf8');

  // .git/config
  assert.deepEqual(readText(root, '.git/config'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, '.git/config', 'data', null), { error: 'git internals cannot be edited' });

  // .GIT/config
  assert.deepEqual(readText(root, '.GIT/config'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, '.GIT/config', 'data', null), { error: 'git internals cannot be edited' });

  // GIT~1
  assert.deepEqual(readText(root, 'GIT~1'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, 'GIT~1', 'data', null), { error: 'git internals cannot be edited' });
  assert.deepEqual(readText(root, 'GIT~1/config'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, 'GIT~1/config', 'data', null), { error: 'git internals cannot be edited' });
});

test('step 1: refused read and write cases for Windows names (stream, device, dot, space)', (t) => {
  const { root } = createFixture(t);

  // Colon stream
  assert.deepEqual(readText(root, 'a:stream'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, 'a:stream', 'data', null), { error: 'not a file in this project' });

  // DOS device names
  assert.deepEqual(readText(root, 'con'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, 'con', 'data', null), { error: 'not a file in this project' });
  assert.deepEqual(readText(root, 'com1.txt'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, 'com1.txt', 'data', null), { error: 'not a file in this project' });
  assert.deepEqual(readText(root, 'aux'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, 'aux', 'data', null), { error: 'not a file in this project' });
  assert.deepEqual(readText(root, 'nul'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, 'nul', 'data', null), { error: 'not a file in this project' });

  // Trailing dot and trailing space
  assert.deepEqual(readText(root, 'name.'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, 'name.', 'data', null), { error: 'not a file in this project' });
  assert.deepEqual(readText(root, 'name '), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, 'name ', 'data', null), { error: 'not a file in this project' });
});

test('step 1: junction to outside is refused for read, write, and create', (t) => {
  const { root, outside } = createFixture(t);
  const linkPath = path.join(root, 'junction_escape');
  try {
    fs.symlinkSync(outside, linkPath, 'junction');
  } catch (err: any) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(err.code)) {
      t.skip('OS refused junction creation: ' + err.code);
      return;
    }
    throw err;
  }

  assert.deepEqual(readText(root, 'junction_escape/secret.txt'), { error: 'not a file in this project' });
  assert.deepEqual(writeText(root, 'junction_escape/secret.txt', 'hacked', null), { error: 'not a file in this project' });
  assert.deepEqual(createEntry(root, 'junction_escape/new.txt', 'file'), { error: 'cannot create that here' });
});

test('step 1: NUL in text or rel is refused and leaves file untouched', (t) => {
  const { root } = createFixture(t);
  fs.writeFileSync(path.join(root, 'target.txt'), 'initial content', 'utf8');

  assert.deepEqual(writeText(root, 'target.txt', 'hello\x00world', null), { error: 'bad file or text' });
  assert.deepEqual(writeText(root, 'target.txt\x00', 'hello', null), { error: 'bad file or text' });
  assert.deepEqual(readText(root, 'target.txt\x00'), { error: 'not a file in this project' });
  assert.equal(fs.readFileSync(path.join(root, 'target.txt'), 'utf8'), 'initial content');
});

test('step 1: text over 512 KiB by byte length with multi-byte chars is refused', (t) => {
  const { root } = createFixture(t);
  assert.equal(MAX_FILE_BYTES, 524288);

  // 262145 copies of 'é' (2 bytes each) equals 524290 bytes > 512 KiB
  const multiByteOver = 'é'.repeat(262145);
  assert.equal(Buffer.byteLength(multiByteOver, 'utf8'), 524290);
  assert.deepEqual(writeText(root, 'large.txt', multiByteOver, null), { error: 'too large to save (over 512 KiB)' });

  // Read file over 512 KiB
  fs.writeFileSync(path.join(root, 'on_disk_large.txt'), multiByteOver, 'utf8');
  assert.deepEqual(readText(root, 'on_disk_large.txt'), { error: 'too large to show (512 KiB)' });
});

test('step 1: overwrite of a file containing NUL is refused', (t) => {
  const { root } = createFixture(t);
  const binaryContent = Buffer.from([65, 66, 0, 67, 68]);
  fs.writeFileSync(path.join(root, 'binary.bin'), binaryContent);

  assert.deepEqual(readText(root, 'binary.bin'), { error: 'not a text file' });
  assert.deepEqual(writeText(root, 'binary.bin', 'clean text', null), { error: 'not a text file' });
  assert.deepEqual(fs.readFileSync(path.join(root, 'binary.bin')), binaryContent);
});

test('step 1: accepted cases keep CRLF and BOM exactly', (t) => {
  const { root } = createFixture(t);
  const original = '\uFEFFheader\r\nfirst line\r\nsecond line\r\n';
  fs.writeFileSync(path.join(root, 'styled.txt'), original, 'utf8');

  // Overwriting with plain LF text and no BOM preserves original BOM and CRLF
  const saveRes = writeText(root, 'styled.txt', 'updated line 1\nupdated line 2', null) as { ok: true; mtimeMs: number };
  assert.equal(saveRes.ok, true);
  assert.equal(typeof saveRes.mtimeMs, 'number');

  const raw = fs.readFileSync(path.join(root, 'styled.txt'));
  assert.equal(raw[0], 0xEF);
  assert.equal(raw[1], 0xBB);
  assert.equal(raw[2], 0xBF);
  assert.equal(raw.toString('utf8'), '\uFEFFupdated line 1\r\nupdated line 2');

  const readBack = readText(root, 'styled.txt') as { text: string; mtimeMs: number };
  assert.equal(readBack.text, '\uFEFFupdated line 1\r\nupdated line 2');
});

test('step 1: new files are LF without BOM', (t) => {
  const { root } = createFixture(t);
  assert.deepEqual(createEntry(root, 'newfile.txt', 'file'), { ok: true });

  const saveRes = writeText(root, 'newfile.txt', 'first line\nsecond line', null) as { ok: true; mtimeMs: number };
  assert.equal(saveRes.ok, true);

  const raw = fs.readFileSync(path.join(root, 'newfile.txt'));
  assert.notEqual(raw[0], 0xEF);
  assert.equal(raw.toString('utf8'), 'first line\nsecond line');
});

test('step 1: baseMtimeMs mismatch returns conflict and leaves file unchanged; null overwrites', (t) => {
  const { root } = createFixture(t);
  fs.writeFileSync(path.join(root, 'doc.txt'), 'version 1', 'utf8');

  const initial = readText(root, 'doc.txt') as { text: string; mtimeMs: number };
  assert.equal(initial.text, 'version 1');

  // Conflict on mismatch
  const conflictRes = writeText(root, 'doc.txt', 'version 2', initial.mtimeMs + 5000);
  assert.deepEqual(conflictRes, { error: 'changed on disk', conflict: true });
  assert.equal(fs.readFileSync(path.join(root, 'doc.txt'), 'utf8'), 'version 1');

  // Null overwrites
  const overwriteRes = writeText(root, 'doc.txt', 'version 2 forced', null) as { ok: true; mtimeMs: number };
  assert.equal(overwriteRes.ok, true);
  assert.equal(fs.readFileSync(path.join(root, 'doc.txt'), 'utf8'), 'version 2 forced');
});

test('step 1: fsCreate refuses missing parent and existing targets', (t) => {
  const { root } = createFixture(t);
  assert.deepEqual(createEntry(root, 'missing/folder/file.txt', 'file'), { error: 'cannot create that here' });
  assert.deepEqual(createEntry(root, 'missing/folder', 'dir'), { error: 'cannot create that here' });

  assert.deepEqual(createEntry(root, 'exist.txt', 'file'), { ok: true });
  assert.deepEqual(createEntry(root, 'exist.txt', 'file'), { error: 'cannot create that here' });
});

test('step 1: fsRename refuses either end outside and renames valid entries', (t) => {
  const { root, outside } = createFixture(t);
  fs.writeFileSync(path.join(root, 'source.txt'), 'sample', 'utf8');

  assert.deepEqual(renameEntry(root, '../outside/secret.txt', 'dest.txt'), { error: 'cannot rename that' });
  assert.deepEqual(renameEntry(root, 'source.txt', '../outside/dest.txt'), { error: 'cannot rename that' });
  assert.deepEqual(renameEntry(root, 'source.txt', path.join(outside, 'dest.txt')), { error: 'cannot rename that' });
  assert.deepEqual(renameEntry(root, path.join(outside, 'secret.txt'), 'dest.txt'), { error: 'cannot rename that' });

  assert.deepEqual(renameEntry(root, 'source.txt', 'renamed.txt'), { ok: true });
  assert.equal(fs.existsSync(path.join(root, 'source.txt')), false);
  assert.equal(fs.readFileSync(path.join(root, 'renamed.txt'), 'utf8'), 'sample');
});

test('step 2: fsSearch returns empty on query under 2, over 200 chars, or with NUL', async (t) => {
  const { root } = createFixture(t);
  fs.writeFileSync(path.join(root, 'file.txt'), 'testing search content', 'utf8');

  assert.deepEqual(await searchText(root, ''), { hits: [], more: false });
  assert.deepEqual(await searchText(root, 'a'), { hits: [], more: false });
  assert.deepEqual(await searchText(root, 'x'.repeat(201)), { hits: [], more: false });
  assert.deepEqual(await searchText(root, 'ab\x00cd'), { hits: [], more: false });
  assert.deepEqual(await searchText(root, 12345 as any), { hits: [], more: false });
});

test('step 2: fsSearch finds fixed string literally and query starting with - is not a flag', async (t) => {
  const { root } = createFixture(t);
  const content = 'literal line: [a-z]+.*?(foo)\\d+ test\nflag line: -v is verbose and --no-config set\n';
  fs.writeFileSync(path.join(root, 'search_sample.txt'), content, 'utf8');

  // Metacharacters match literally
  const litRes = await searchText(root, '[a-z]+.*?');
  assert.equal(litRes.hits.length, 1);
  assert.equal(litRes.hits[0].line, 1);
  assert.ok(litRes.hits[0].text.includes('[a-z]+.*?'));

  // Leading dash not parsed as flag
  const flagRes = await searchText(root, '-v is verbose');
  assert.equal(flagRes.hits.length, 1);
  assert.equal(flagRes.hits[0].line, 2);
  assert.ok(flagRes.hits[0].text.includes('-v is verbose'));
});

test('step 2: fsSearch caps at 200 hits and sets more: true', async (t) => {
  const { root } = createFixture(t);
  const lines: string[] = [];
  for (let i = 1; i <= 210; i++) lines.push(`line ${i}: TARGET_WORD_OCCURRENCE sample data`);
  fs.writeFileSync(path.join(root, 'many_matches.txt'), lines.join('\n'), 'utf8');

  const res = await searchText(root, 'TARGET_WORD_OCCURRENCE');
  assert.equal(res.hits.length, 200);
  assert.equal(res.more, true);
  assert.equal(res.hits[0].line, 1);
  assert.equal(res.hits[199].line, 200);
});

test('step 2: searchText falls back to git grep when ripgrep is unavailable', async (t) => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-gitgrep-'));
  t.after(() => {
    try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  });
  execFileSync('git', ['init'], { cwd: temp, windowsHide: true });
  execFileSync('git', ['config', 'user.name', 'Ouros Test'], { cwd: temp, windowsHide: true });
  execFileSync('git', ['config', 'user.email', 'ouros@test.local'], { cwd: temp, windowsHide: true });

  const query = 'needle';
  fs.writeFileSync(path.join(temp, 'sample.txt'), 'first line\nneedle in haystack\nthird line\n', 'utf8');
  execFileSync('git', ['add', '.'], { cwd: temp, windowsHide: true });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: temp, windowsHide: true });

  const rgResult = await searchText(temp, query);

  const curPath = process.env.PATH ?? process.env.Path ?? '';
  const withoutRg = curPath
    .split(path.delimiter)
    .filter((dir) => {
      try {
        return !['rg.exe', 'rg.cmd', 'rg.bat', 'rg'].some((bin) => fs.existsSync(path.join(dir, bin)));
      } catch {
        return true;
      }
    })
    .join(path.delimiter);

  const origPath = process.env.PATH;
  const origPathVar = process.env.Path;
  let gitResult: { hits: SearchHit[]; more: boolean };
  try {
    process.env.PATH = withoutRg;
    process.env.Path = withoutRg;
    gitResult = await searchText(temp, query);
  } finally {
    if (origPath !== undefined) process.env.PATH = origPath;
    else delete process.env.PATH;
    if (origPathVar !== undefined) process.env.Path = origPathVar;
    else delete process.env.Path;
  }

  assert.equal(typeof gitResult.more, 'boolean');
  assert.equal(gitResult.more, rgResult.more);
  assert.equal(Array.isArray(gitResult.hits), true);
  assert.equal(gitResult.hits.length, rgResult.hits.length);
  assert.equal(gitResult.hits[0].path, rgResult.hits[0].path);
  assert.equal(gitResult.hits[0].line, rgResult.hits[0].line);
  assert.equal(typeof gitResult.hits[0].text, 'string');
  assert.equal(gitResult.hits[0].text.replace(/\x00+$/, ''), rgResult.hits[0].text);
});
