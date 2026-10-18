import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { READ_STDIN, writeClipboard } from '../src/clipboard.ts';

const text = 'pässwörd-日本-€';

test('the clipboard stdin read keeps non-ASCII text unchanged', { skip: process.platform !== 'win32' }, () => {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(${READ_STDIN}))`], { input: text, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(Buffer.from(r.stdout.trim(), 'base64').toString('utf8'), text);
});

const readClipboard = () => {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string](Get-Clipboard -Raw)))'], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  return Buffer.from(r.stdout.trim(), 'base64').toString('utf8');
};

test('writeClipboard puts non-ASCII text on the clipboard unchanged', { skip: process.platform !== 'win32' || process.env.METATROOPER_CLIPBOARD_TEST !== '1' }, () => {
  const before = readClipboard();
  try {
    assert.equal(writeClipboard(text), true);
    assert.equal(readClipboard(), text);
  } finally {
    if (before) writeClipboard(before);
  }
});
