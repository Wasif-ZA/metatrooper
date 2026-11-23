import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// main.ts imports Electron, so evaluate the real samePath/trusted source text with stubs.
const source = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const sameSrc = source.match(/export const samePath = [^]*?\n\};/)?.[0];
const trustedSrc = source.match(/function trusted\([^]*?\n\}/)?.[0];
assert.ok(sameSrc && trustedSrc, 'samePath and trusted must exist in main.ts');

type SamePath = (a: string, b: string, platform?: string) => boolean;
function load(index: string, platform: string) {
  const strip = (s: string) => s
    .replace('export const', 'const')
    .replace(/\(a: string, b: string, platform = process\.platform\): boolean/, '(a, b, platform = process.platform)')
    .replace('(p: string)', '(p)')
    .replace('(e: IpcMainInvokeEvent): boolean', '(e)');
  const body = `${strip(sameSrc!)}\n${strip(trustedSrc!)}\nreturn { samePath, trusted };`;
  const make = new Function('path', 'fileURLToPath', 'INDEX', 'process', body);
  return make(path, (u: string) => fileURLToPath(u, { windows: platform === 'win32' }), index, { platform }) as {
    samePath: SamePath;
    trusted: (e: { senderFrame?: { url?: string } }) => boolean;
  };
}
const real = load('x', 'win32');
const w = (a: string, b: string) => real.samePath(a, b, 'win32');

// protects=main.ts samePath: Windows compares without case, slash style or '..' segments.
test('win32: same file regardless of case, slashes and .. segments', () => {
  assert.ok(w('c:\\app\\renderer\\index.html', 'C:\\APP\\Renderer\\index.html'));
  assert.ok(w('C:/app/renderer/index.html', 'C:\\app\\renderer\\index.html'));
  assert.ok(w('C:\\app\\other\\..\\renderer\\index.html', 'C:\\app\\renderer\\index.html'));
});

// protects=main.ts samePath: only the exact file is trusted, never a sibling, other file or prefix.
test('win32: a different file, sibling folder or prefix trick is not the same', () => {
  assert.ok(!w('C:\\app\\renderer\\other.html', 'C:\\app\\renderer\\index.html'));
  assert.ok(!w('C:\\app2\\renderer\\index.html', 'C:\\app\\renderer\\index.html'));
  assert.ok(!w('C:\\app\\renderer\\index.html.evil', 'C:\\app\\renderer\\index.html'));
});

// protects=main.ts samePath: other platforms stay case-sensitive.
test('non-win32: case matters, exact path is the same', () => {
  assert.ok(real.samePath('/app/index.html', '/app/index.html', 'linux'));
  assert.ok(!real.samePath('/app/index.html', '/APP/index.html', 'linux'));
});

// protects=main.ts trusted(): only the app's own index.html (query and hash ignored) may call IPC.
test('trusted(): own index.html with query and hash passes; https, data, empty and other files are refused', () => {
  const m = load('c:\\app\\renderer\\index.html', 'win32');
  const t = (url?: string) => m.trusted({ senderFrame: url === undefined ? undefined : { url } });
  assert.equal(t('file:///C:/app/renderer/index.html?x#y'), true);
  assert.equal(t('https://example.com/C:/app/renderer/index.html'), false);
  assert.equal(t('data:text/html,<h1>x</h1>'), false);
  assert.equal(t(''), false);
  assert.equal(t(undefined), false);
  assert.equal(t('file:///C:/app/renderer/other.html'), false);
});
