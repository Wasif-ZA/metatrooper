import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { READ_STDIN } from '../src/clipboard.ts';

test('the clipboard stdin read keeps non-ASCII text unchanged', { skip: process.platform !== 'win32' }, () => {
  const text = 'pässwörd-日本-€';
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes(${READ_STDIN}))`], { input: text, encoding: 'utf8', windowsHide: true });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(Buffer.from(r.stdout.trim(), 'base64').toString('utf8'), text);
});
