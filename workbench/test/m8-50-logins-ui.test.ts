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
  assert.match(h, /offerDelete\(held\.file/);
  const offer = main.match(/const offerDelete = [\s\S]*?\n  \};/)?.[0] ?? '';
  assert.match(offer, /showMessageBox/);
  assert.match(offer, /buttons: \['Delete the file'/);
  assert.match(offer, /defaultId: 0/);
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

// protects=Cancel in the window offers to delete the exported file, and a held file never outlives 10 minutes
// fails_when=loginsCancel is not exposed, bypasses trusted on(), keeps the token, skips offerDelete, or the 10 minute timer goes
// no_claim=runtime behaviour of the timers
test('loginsCancel drops the token and offers to delete; held files expire after 10 minutes', () => {
  const pre = readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8');
  assert.match(pre, /loginsCancel:[^\n]*invoke\('loginsCancel'/);
  const h = handler('loginsCancel');
  assert.match(h, /takeLoginFile\(token\)/);
  assert.match(h, /offerDelete\(held\.file/);
  const take = main.match(/const takeLoginFile = [\s\S]*?\n  \};/)?.[0] ?? '';
  assert.match(take, /clearTimeout\(held\.timer\)/);
  assert.match(take, /loginFiles\.delete\(/);
  assert.match(main, /on = \(channel[\s\S]{0,200}?if \(!trusted\(e\)\) throw/);
  assert.ok(!/ipcMain\.handle\('loginsCancel'/.test(main), 'registered through on(), not ipcMain.handle');
  assert.match(handler('loginsPick'), /timer: setTimeout\(\(\) => loginFiles\.delete\(token\), 10 \* 60_000\)/);
});

// protects=the import waits as long as its size needs and the file is offered for deletion on every outcome
// fails_when=the wait is a fixed default, offerDelete is skipped on an error or offline outcome, or the path used is not the real one
// no_claim=the core's actual speed
test('loginsImport waits by size, offers delete on every outcome; loginsPick uses the real path', () => {
  const h = handler('loginsImport');
  assert.match(h, /const n = Array\.isArray\(picks\) \? picks\.length : 0/);
  assert.match(h, /Math\.min\(60_000 \+ 2_000 \* n, 20 \* 60_000\)/);
  const offer = h.indexOf('offerDelete(held.file');
  const fail = h.indexOf('if (!ok) return');
  assert.ok(offer > 0 && fail > offer, 'offerDelete runs before the error and offline return');
  assert.match(h, /const ok = out\.kind === 'reply' && !out\.reply\.error/);
  assert.match(h, /the core did not answer in time/);
  assert.match(h, /offerDelete\(held\.file, ok\)/);
  const pick = handler('loginsPick');
  assert.match(pick, /const file = fs\.realpathSync\(picked\)/);
  assert.match(pick, /statSync\(file\)/);
  assert.match(pick, /readFileSync\(file,/);
  assert.match(pick, /loginFiles\.set\(token, \{ file,/);
  assert.ok(!/readFileSync\(picked/.test(pick) && !/statSync\(picked/.test(pick));
  assert.match(main, /fs\.rmSync\(file\)/);
  assert.match(main, /async function callUi\(method: string, params: Record<string, unknown>, waitMs\?: number\)/);
});
