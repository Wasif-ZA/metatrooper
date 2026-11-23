import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const handler = (name: string) => {
  const m = main.match(new RegExp(`on\\('${name}'[\\s\\S]*?\\n  \\}\\);`));
  assert.ok(m, `${name} handler found`);
  return m[0];
};

// protects=the exported CSV stays in the main process and the window gets rows without passwords
// fails_when=loginsPick skips the size check, bypasses browser.logins.preview, or returns the file text
// no_claim=runtime behaviour of the dialog
test('loginsPick keeps the CSV text in main', () => {
  const h = handler('loginsPick');
  assert.match(h, /readFileSync\(file/);
  assert.match(h, /5 \* 1024 \* 1024/);
  assert.match(h, /callUi\('browser\.logins\.preview'/);
  const ret = h.match(/return \{ token[^\n]*\n/);
  assert.ok(ret, 'success return found');
  assert.ok(!/\btext\b/.test(ret[0]), 'the return value carries no text');
  assert.match(ret[0], /rows/);
});

// protects=the person is asked to delete the password file after an import, defaulting to Delete
// fails_when=the prompt is dropped or Keep becomes the default
// no_claim=the file really being deleted
test('loginsImport offers to delete the file with Delete as the default', () => {
  const h = handler('loginsImport');
  assert.match(h, /showMessageBox/);
  assert.match(h, /buttons: \['Delete the file'/);
  assert.match(h, /defaultId: 0/);
  assert.match(h, /callUi\('browser\.logins\.import', \{ text: held\.text/);
});

// protects=the renderer cannot send CSV text to the core itself
// fails_when=browser.logins.preview or browser.logins.import enters UI_METHODS
// no_claim=the ipc transport
test('the renderer may list and remove logins but not preview or import', () => {
  const body = main.match(/UI_METHODS\s*=\s*new Set\(\[([\s\S]*?)\]\)/)?.[1];
  assert.ok(body, 'UI_METHODS found');
  assert.ok(body.includes("'browser.logins.list'"));
  assert.ok(body.includes("'browser.logins.remove'"));
  assert.ok(!body.includes('browser.logins.preview'));
  assert.ok(!body.includes('browser.logins.import'));
});

// protects=the window can reach the two handlers
// fails_when=preload drops loginsPick or loginsImport
// no_claim=contextBridge isolation
test('preload exposes loginsPick and loginsImport', () => {
  const pre = readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8');
  assert.match(pre, /loginsPick:[^\n]*invoke\('loginsPick'\)/);
  assert.match(pre, /loginsImport:[^\n]*invoke\('loginsImport'/);
});
