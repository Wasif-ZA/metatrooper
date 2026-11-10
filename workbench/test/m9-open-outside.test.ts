import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { openOutside, inside } from '../src/files.ts';

function createFixture(t: any) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-outside-'));
  t.after(() => {
    try { fs.rmSync(temp, { recursive: true, force: true, maxRetries: 3 }); } catch {}
  });
  const root = path.join(temp, 'project');
  const outside = path.join(temp, 'outside');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.pdf'), 'secret pdf');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret txt');
  return { temp, root, outside };
}

function extractHandler(src: string, name: string): string {
  const marker = "on('" + name + "', ";
  const start = src.indexOf(marker);
  assert.ok(start >= 0, name + ' handler exists in main.ts');
  const fnStart = start + marker.length;
  let depth = 0;
  let inString: string | null = null;
  let i = fnStart;
  for (; i < src.length; i++) {
    const ch = src[i];
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === inString) inString = null;
    } else if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        i++;
        break;
      }
    }
  }
  return src.slice(fnStart, i);
}

test('openOutside refuses traversal with ..', (t) => {
  const { root } = createFixture(t);
  fs.writeFileSync(path.join(root, 'valid.pdf'), 'pdf content');
  assert.deepEqual(openOutside(root, '..'), { error: 'not a file in this project' });
  assert.deepEqual(openOutside(root, '../outside/secret.pdf'), { error: 'not a file in this project' });
  assert.deepEqual(openOutside(root, 'sub/../../outside/secret.pdf'), { error: 'not a file in this project' });
});

test('openOutside refuses absolute paths', (t) => {
  const { root, outside } = createFixture(t);
  fs.writeFileSync(path.join(root, 'valid.pdf'), 'pdf content');
  assert.deepEqual(openOutside(root, path.join(outside, 'secret.pdf')), { error: 'not a file in this project' });
  assert.deepEqual(openOutside(root, path.join(root, 'valid.pdf')), { error: 'not a file in this project' });
  assert.deepEqual(openOutside(root, 'C:\\secret.pdf'), { error: 'not a file in this project' });
  assert.deepEqual(openOutside(root, 'C:secret.pdf'), { error: 'not a file in this project' });
  assert.deepEqual(openOutside(root, '/secret.pdf'), { error: 'not a file in this project' });
});

test('openOutside refuses a junction escaping root', (t) => {
  const { root, outside } = createFixture(t);
  const linkPath = path.join(root, 'junction_outside');
  try {
    fs.symlinkSync(outside, linkPath, 'junction');
  } catch (err: any) {
    if (['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(err?.code)) {
      t.skip('OS refused junction creation: ' + err.code);
      return;
    }
    throw err;
  }
  assert.deepEqual(openOutside(root, 'junction_outside/secret.pdf'), { error: 'not a file in this project' });
});

test('openOutside refuses .git paths', (t) => {
  const { root } = createFixture(t);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'doc.pdf'), 'git pdf');
  assert.deepEqual(openOutside(root, '.git'), { error: 'not a file in this project' });
  assert.deepEqual(openOutside(root, '.git/doc.pdf'), { error: 'not a file in this project' });
  assert.deepEqual(openOutside(root, '.GIT/doc.pdf'), { error: 'not a file in this project' });
  assert.deepEqual(openOutside(root, 'GIT~1/doc.pdf'), { error: 'not a file in this project' });
});

test('openOutside refuses folders', (t) => {
  const { root } = createFixture(t);
  fs.mkdirSync(path.join(root, 'folder.pdf'), { recursive: true });
  fs.mkdirSync(path.join(root, 'dir.pdf'), { recursive: true });
  fs.mkdirSync(path.join(root, 'subfolder'), { recursive: true });
  assert.deepEqual(openOutside(root, 'folder.pdf'), { error: 'not a file in this project' });
  assert.deepEqual(openOutside(root, 'dir.pdf'), { error: 'not a file in this project' });
  assert.ok('error' in (openOutside(root, 'subfolder') as any));
  assert.ok('error' in (openOutside(root, '.') as any));
  assert.ok('error' in (openOutside(root, '') as any));
});

test('openOutside refuses missing files', (t) => {
  const { root } = createFixture(t);
  assert.deepEqual(openOutside(root, 'missing.pdf'), { error: 'not a file in this project' });
  assert.deepEqual(openOutside(root, 'missing/file.png'), { error: 'not a file in this project' });
});

test('openOutside refuses extensions off allow-list', (t) => {
  const { root } = createFixture(t);
  const disallowed = ['script.js', 'app.exe', 'style.css', 'doc.txt', 'data.json', 'archive.zip', 'noext', 'code.ts'];
  for (const name of disallowed) {
    fs.writeFileSync(path.join(root, name), 'content');
    assert.deepEqual(openOutside(root, name), { error: 'this file type cannot be opened outside' });
  }
});

test('openOutside is case-insensitive for allowed extensions', (t) => {
  const { root } = createFixture(t);
  const allowed = [
    'UPPER.PDF', 'PHOTO.PNG', 'IMAGE.JPG', 'PIC.JPEG', 'ANIM.GIF',
    'HERO.WEBP', 'ICON.SVG', 'PAGE.HTML', 'DOC.HTM', 'mixed.PdF', 'test.JpG'
  ];
  for (const name of allowed) {
    const full = path.join(root, name);
    fs.writeFileSync(full, 'data');
    assert.equal(openOutside(root, name), fs.realpathSync(full));
  }
});

test('openOutside checks extension on the real path', (t) => {
  const { root } = createFixture(t);
  const targetExe = path.join(root, 'target.exe');
  fs.writeFileSync(targetExe, 'binary content');
  const targetTxt = path.join(root, 'notes.txt');
  fs.writeFileSync(targetTxt, 'notes content');
  const linkPdf = path.join(root, 'x.pdf');
  const linkAlias = path.join(root, 'alias.pdf');
  try {
    fs.symlinkSync(targetExe, linkPdf, 'file');
    assert.deepEqual(openOutside(root, 'x.pdf'), { error: 'this file type cannot be opened outside' });
  } catch (err: any) {
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(err?.code)) throw err;
  }
  try {
    fs.symlinkSync(targetTxt, linkAlias, 'file');
    assert.deepEqual(openOutside(root, 'alias.pdf'), { error: 'this file type cannot be opened outside' });
  } catch (err: any) {
    if (!['EPERM', 'EACCES', 'ENOTSUP', 'ENOSYS'].includes(err?.code)) throw err;
  }
});

test('openOutside accepts plain allowed files and returns real path', (t) => {
  const { root } = createFixture(t);
  for (const ext of ['pdf', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'html', 'htm']) {
    const name = `file.${ext}`;
    const p = path.join(root, name);
    fs.writeFileSync(p, 'sample');
    assert.equal(openOutside(root, name), fs.realpathSync(p));
  }
});

test('fsOpenOutside turns non-empty shell.openPath return or throw into { error }', async (t) => {
  const { root } = createFixture(t);
  const pdfPath = path.join(root, 'doc.pdf');
  fs.writeFileSync(pdfPath, 'sample pdf');

  const mainSrc = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const body = extractHandler(mainSrc, 'fsOpenOutside');

  let openResult: string = '';
  let shouldThrow = false;
  const mockShell = {
    openPath: async (_p: string) => {
      if (shouldThrow) throw new Error('stubbed shell failure');
      return openResult;
    },
  };

  const handler = vm.runInNewContext(stripTypeScriptTypes('(' + body + ')'), {
    projectRoot: (id: unknown) => (id === 'p1' ? root : null),
    openOutside,
    shell: mockShell,
  });

  // Non-empty string from shell.openPath becomes { error }
  openResult = 'failed to open file';
  shouldThrow = false;
  const errRes = await handler('p1', 'doc.pdf');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(errRes)), { error: 'failed to open file' });

  // A throw from shell.openPath becomes { error }
  shouldThrow = true;
  const throwRes = await handler('p1', 'doc.pdf');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(throwRes)), { error: 'Error: stubbed shell failure' });

  // Successful open returns { ok: true }
  openResult = '';
  shouldThrow = false;
  const okRes = await handler('p1', 'doc.pdf');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(okRes)), { ok: true });

  // Invalid project or non-string rel
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await handler('invalid', 'doc.pdf'))), { error: 'pick a project first' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(await handler('p1', 123 as any))), { error: 'pick a project first' });

  // Refused file returns openOutside error
  const refusedRes = await handler('p1', 'secret.txt');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(refusedRes)), { error: 'this file type cannot be opened outside' });
});

test('openInVsCode logs exactly {at, event, projectId, extension} and never path or text', async (t) => {
  const { root } = createFixture(t);
  fs.writeFileSync(path.join(root, 'confidential_secret.ts'), 'private code');

  const mainSrc = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const body = extractHandler(mainSrc, 'openInVsCode');

  const loggedLines: string[] = [];
  const mockConsole = {
    log: (msg: string) => { loggedLines.push(msg); },
    error: () => {},
  };
  const spawned: any[] = [];
  const mockSpawn = (...args: any[]) => {
    spawned.push(args);
    return {
      on: () => ({ unref: () => {} }),
      unref: () => {},
    };
  };

  const handler = vm.runInNewContext(stripTypeScriptTypes('(' + body + ')'), {
    console: mockConsole,
    path,
    projectRoot: (id: unknown) => (id === 'p1' ? root : null),
    fsInside: inside,
    resolveLaunch: (cmd: string) => (cmd === 'code' ? { argv: ['code'], env: {} } : null),
    spawn: mockSpawn,
    process: { env: {} },
  });

  // Call with specific file
  loggedLines.length = 0;
  const res = handler('p1', 'confidential_secret.ts');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(res)), { ok: true });
  assert.equal(loggedLines.length, 1);

  const parsed = JSON.parse(loggedLines[0]);
  assert.deepEqual(Object.keys(parsed).sort(), ['at', 'event', 'extension', 'projectId']);
  assert.equal(parsed.event, 'openInVsCode');
  assert.equal(parsed.projectId, 'p1');
  assert.equal(parsed.extension, '.ts');
  assert.ok(!loggedLines[0].includes('confidential_secret'));
  assert.ok(!loggedLines[0].includes('private code'));

  // Call with rel == null (open root)
  loggedLines.length = 0;
  handler('p1', null);
  assert.equal(loggedLines.length, 1);
  const parsedNull = JSON.parse(loggedLines[0]);
  assert.deepEqual(Object.keys(parsedNull).sort(), ['at', 'event', 'extension', 'projectId']);
  assert.equal(parsedNull.event, 'openInVsCode');
  assert.equal(parsedNull.projectId, 'p1');
  assert.equal(parsedNull.extension, '');

  // Call with multi-dot extension
  loggedLines.length = 0;
  fs.writeFileSync(path.join(root, 'archive_secret.tar.gz'), 'binary');
  handler('p1', 'archive_secret.tar.gz');
  assert.equal(loggedLines.length, 1);
  const parsedGz = JSON.parse(loggedLines[0]);
  assert.deepEqual(Object.keys(parsedGz).sort(), ['at', 'event', 'extension', 'projectId']);
  assert.equal(parsedGz.extension, '.gz');
  assert.ok(!loggedLines[0].includes('archive_secret'));

  // Call with extensionless file
  loggedLines.length = 0;
  fs.writeFileSync(path.join(root, 'MakefileSecret'), 'text');
  handler('p1', 'MakefileSecret');
  assert.equal(loggedLines.length, 1);
  const parsedNone = JSON.parse(loggedLines[0]);
  assert.deepEqual(Object.keys(parsedNone).sort(), ['at', 'event', 'extension', 'projectId']);
  assert.equal(parsedNone.extension, '');
  assert.ok(!loggedLines[0].includes('MakefileSecret'));
});
