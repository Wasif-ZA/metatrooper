import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeClipboard } from '../src/clipboard.ts';

const readClipboard = () => {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string](Get-Clipboard -Raw)))'], { encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  return Buffer.from(r.stdout.trim(), 'base64').toString('utf8');
};

test('writeClipboard puts non-ASCII text on the clipboard unchanged', { skip: process.platform !== 'win32' }, () => {
  const before = readClipboard();
  const text = 'pässwörd-日本-€';
  try {
    assert.equal(writeClipboard(text), true);
    assert.equal(readClipboard(), text);
  } finally {
    if (before) writeClipboard(before);
  }
});
