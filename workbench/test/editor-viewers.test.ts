import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { readFileUrl } from '../src/files.ts';

function fixture(t: any) {
  const dir = fs.mkdtempSync(path.join(tmpdir(), 'editor-viewers-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'project');
  fs.mkdirSync(root);
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, 'document.html'), '%PDF-1.7\n');
  fs.writeFileSync(path.join(dir, 'outside.html'), '%PDF-1.7\n');
  fs.writeFileSync(path.join(root, '.git', 'private.html'), 'private');
  const handlers: Record<string, Function> = {};
  const source = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const registration = source.match(/^  on\('fsFileUrl'[^\n]+/m);
  assert.ok(registration);
  vm.runInNewContext(stripTypeScriptTypes(registration[0]), {
    on: (name: string, fn: Function) => { handlers[name] = fn; },
    projectRoot: (id: unknown) => id === 'p1' ? root : null,
    readFileUrl,
  });
  return { root, dir, read: (rel: unknown, pid = 'p1') => handlers.fsFileUrl(pid, rel) };
}

test('fsFileUrl returns checked HTML data URLs and refuses PDFs', t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.root, 'doc.pdf'), '%PDF-1.7\n');
  assert.equal(typeof f.read('doc.pdf').error, 'string');
  for (const ext of ['html', 'htm']) {
    fs.writeFileSync(path.join(f.root, `page.${ext}`), '<h1>Hello</h1>');
    assert.equal(f.read(`page.${ext}`).url, `data:text/html;charset=utf-8;base64,${Buffer.from('<h1>Hello</h1>').toString('base64')}`);
  }
});

test('fsFileUrl refuses outside, absolute, traversal, git and invalid paths', t => {
  const f = fixture(t);
  for (const rel of [path.join(f.dir, 'outside.html'), path.join(f.root, 'document.html'), '../outside.html', 'nested/../document.html', '.git/private.html', 'missing.html', 'document.html\0', '.', null, 42]) {
    assert.equal(typeof f.read(rel).error, 'string', String(rel));
  }
  assert.equal(typeof f.read('document.html', 'unknown').error, 'string');
  fs.writeFileSync(path.join(f.root, 'code.js'), 'alert(1)');
  assert.equal(typeof f.read('code.js').error, 'string');
});

test('fsFileUrl refuses an outside file reached through a junction', t => {
  const f = fixture(t);
  const outside = path.join(f.dir, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'secret.html'), 'secret');
  fs.symlinkSync(outside, path.join(f.root, 'link'), 'junction');
  assert.equal(typeof f.read('link/secret.html').error, 'string');
});
