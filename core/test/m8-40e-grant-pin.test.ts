import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Approvals } from '../src/approvals.ts';
import { Desktop, PAUSED_DRIFT } from '../src/desktop/driver.ts';
import { grantPin, takeoverPaused, titleMatches } from '../src/grants.ts';
import { METHODS } from '../src/methods.ts';
import { CommandRunner } from '../src/pipe/commands.ts';

const PAUSED = 'paused by the user';
const NOTEPAD = { hwnd: 100, pid: 4100, process_start: '2026-10-12T01:00:00.000Z', exe: 'Notepad.exe', title: 'Untitled - Notepad', controls: [{ role: 'document', name: 'Text editor', automation_id: 'RichEditD2DPT' }] };
const DIALOG = { hwnd: 101, owner: 100, pid: 4100, process_start: NOTEPAD.process_start, exe: 'Notepad.exe', title: 'Save as', class: '#32770', file_dialog: true, controls: [{ role: 'button', name: 'Save', automation_id: '1' }] };
const WORKBENCH = { hwnd: 300, pid: process.pid, process_start: '2026-10-12T00:59:00.000Z', exe: 'electron.exe', title: 'MetaTrooper', controls: [] };
const CONTROL = NOTEPAD.controls[0];
const ME = { session_id: 's1', pid: process.pid };
const pausedByUser = (e: any) => { assert.equal(e.message, PAUSED); return true; };
const pausedDrift = (e: any) => { assert.equal(e.message, PAUSED_DRIFT); return true; };

async function fixture(t: any) {
  const home = mkdtempSync(join(tmpdir(), 'm8-40e-'));
  const statePath = join(home, 'fake-uia.json');
  const logPath = join(home, 'fake-uia.log');
  const setWindows = (windows: object[]) => writeFileSync(statePath, JSON.stringify({ windows }));
  setWindows([NOTEPAD, DIALOG, WORKBENCH]);
  const env: Record<string, string> = { METATROOPER_UIA_HELPER: join(import.meta.dirname, 'fake-uia-helper.js'), FAKE_UIA_STATE: statePath, FAKE_UIA_LOG: logPath, FAKE_UIA_DELAY_MS: '0' };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  Object.assign(process.env, env);
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../contracts/schema.sql', import.meta.url), 'utf8'));
  db.exec(`PRAGMA foreign_keys = OFF; INSERT INTO plugin (id, version, path, manifest, source, permissions, installed_at) VALUES ('desktop', '1', '', '{}', 'builtin', '[]', 't'); INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, pid) VALUES ('s1', 'p1', 'fake', 'pty', 'working', 't', 't', ${process.pid}), ('s2', 'p1', 'fake', 'pty', 'working', 't', 't', NULL)`);
  const desktop = new Desktop(db);
  const methods = new Map<string, any>();
  desktop.methods(methods);
  const call = (method: string, params: any = {}) => Promise.resolve().then(() => methods.get(method).handler(params));
  await call('desktop.ui-window', { pid: process.pid, takeover_key: 'Control+Alt+Q', takeover_error: null });
  const grant: string = ((await call('grant.window', { session_id: 's1', hwnd: 100, pid: NOTEPAD.pid, process_start: NOTEPAD.process_start })) as any).grant_id;
  const inputs = (): any[] => existsSync(logPath) ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const act = (p: object = {}) => call('desktop.act', { ...ME, window: 100, action: 'click', ref: 'e1', expect: CONTROL, ...p });
  const check = async (p: object = {}) => new Approvals(db, 5000, () => [], { paused: (s) => takeoverPaused(db, s), granted: () => true }).check({ session_id: 's1', surface: 'desktop', target: grant, action: 'click', args: { window: 100, ref: 'e1' }, control: CONTROL, ...p } as any);
  const retitle = (title: string) => setWindows([{ ...NOTEPAD, title }, DIALOG, WORKBENCH]);
  t.after(() => {
    desktop.helper.stop();
    db.close();
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return { db, desktop, methods, grant, call, act, check, inputs, setWindows, retitle };
}

test('M8-40e: titleMatches: * is any run, everything else literal, whole title, case-sensitive', () => {
  assert.equal(titleMatches('Untitled - *', 'Untitled - Notepad'), true);
  assert.equal(titleMatches('*', 'anything at all'), true);
  assert.equal(titleMatches('Inbox * (*)', 'Inbox - Mail (3)'), true);
  assert.equal(titleMatches('Notepad', 'Untitled - Notepad'), false, 'whole title, not a substring');
  assert.equal(titleMatches('Untitled', 'Untitled - Notepad'), false, 'whole title, not a prefix');
  assert.equal(titleMatches('Untitled - Notepad ', 'Untitled - Notepad'), false, 'no slack at the ends');
  assert.equal(titleMatches('compose', 'Compose'), false, 'case-sensitive');
  assert.equal(titleMatches('Compose', 'compose'), false, 'case-sensitive');
  assert.equal(titleMatches('a.c', 'abc'), false, '. is literal');
  assert.equal(titleMatches('a.c', 'a.c'), true);
  assert.equal(titleMatches('Inbox (3)', 'Inbox (3)'), true, '( is literal');
  assert.equal(titleMatches('Inbox (3)', 'Inbox 3'), false, '( is literal');
  assert.equal(titleMatches('(', '('), true, 'an unbalanced ( does not throw');
  assert.equal(titleMatches('[x]', '[x]'), true, '[ is literal');
  assert.equal(titleMatches('[x]', 'x'), false, '[ is literal');
  assert.equal(titleMatches('a+b', 'aab'), false, '+ is literal');
  assert.equal(titleMatches('a+b', 'a+b'), true, '+ is literal');
  assert.equal(titleMatches('a?', 'a'), false, '? is literal');
  assert.equal(titleMatches('^Mail$', 'Mail'), false, '^ and $ are literal');
  assert.equal(titleMatches('^Mail$', '^Mail$'), true, '^ and $ are literal');
  assert.equal(titleMatches('a|b', 'a'), false, '| is literal');
  assert.equal(titleMatches('C:\\x\\*', 'C:\\x\\file.txt'), true, 'backslash is literal');
  assert.equal(titleMatches('C:\\x', 'C:x'), false, 'backslash is literal');
});

test('M8-40e: grant.pin is a trusted-UI method: needsUi, refused on an agent connection, and no MCP tool exposes it', async (t) => {
  assert.equal(METHODS.find((d) => d.name === 'grant.pin')?.needsUi, true);
  const f = await fixture(t);
  assert.equal(f.methods.get('grant.pin').needsUi, true);
  const runner = new CommandRunner(f.db, f.methods);
  await assert.rejects(runner.call({ id: 1, jsonrpc: '2.0', method: 'grant.pin', params: { grant_id: f.grant, title_pattern: '*' } } as any, {} as any), /needs a trusted UI connection/);
  assert.equal(grantPin(f.db, f.grant), null, 'the refused pin was not stored');
  const mcp = readFileSync(join(import.meta.dirname, '../src/hook/desktop-mcp.ts'), 'utf8');
  assert.doesNotMatch(mcp, /grant\.pin|unpin|title_pattern/);
});

test('M8-40e: grant.pin refuses a pattern that does not match the live title, and stores nothing', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Calc*' }), (e: any) => {
    assert.equal(e.code, -32003);
    assert.match(e.message, /the pattern does not match the window title now/);
    return true;
  });
  assert.equal(grantPin(f.db, f.grant), null);
});

test('M8-40e: grant.pin rejects a non-string, an empty pattern, a missing pattern and one over 2000 characters with -32602', async (t) => {
  const f = await fixture(t);
  for (const title_pattern of [5, true, '', 'x'.repeat(2001), undefined]) {
    await assert.rejects(f.call('grant.pin', { grant_id: f.grant, title_pattern }), (e: any) => { assert.equal(e.code, -32602); return true; }, String(title_pattern));
  }
  assert.equal(grantPin(f.db, f.grant), null);
});

test('M8-40e: grant.pin accepts a 2000-character pattern, and null unpins', async (t) => {
  const f = await fixture(t);
  const long = '*'.repeat(2000);
  assert.deepEqual(await f.call('grant.pin', { grant_id: f.grant, title_pattern: long }), { title_pattern: long });
  assert.deepEqual(await f.call('grant.pin', { grant_id: f.grant, title_pattern: null }), { title_pattern: null });
  assert.equal(grantPin(f.db, f.grant), null);
});

test('M8-40e: grant.pin on an unknown or ended grant is NOT_FOUND "grant not found"', async (t) => {
  const f = await fixture(t);
  await assert.rejects(f.call('grant.pin', { grant_id: 'gr_nope', title_pattern: '*' }), (e: any) => { assert.equal(e.code, -32002); assert.match(e.message, /grant not found/); return true; });
  await f.call('grant.revoke', { grant_id: f.grant });
  await assert.rejects(f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Untitled - *' }), (e: any) => { assert.equal(e.code, -32002); assert.match(e.message, /grant not found/); return true; });
});

test('M8-40e: grant.live rows carry title_pattern, null until pinned', async (t) => {
  const f = await fixture(t);
  const [row] = (await f.call('grant.live')).grants;
  assert.equal(row.id, f.grant);
  assert.equal(row.title, 'Untitled - Notepad');
  assert.equal(row.title_pattern, null);
  await f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Untitled - *' });
  assert.equal((await f.call('grant.live')).grants[0].title_pattern, 'Untitled - *');
  await f.call('grant.pin', { grant_id: f.grant, title_pattern: null });
  assert.equal((await f.call('grant.live')).grants[0].title_pattern, null);
});

test('M8-40e: pin, then the window title drifts: act is refused with PAUSED_DRIFT and no input is sent', async (t) => {
  const f = await fixture(t);
  await f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Untitled - *' });
  assert.equal((await f.act()).status, 'confirmed', 'matching title: input goes through');
  assert.equal(f.inputs().length, 1);
  f.retitle('Inbox - Mail (3)');
  await assert.rejects(f.act(), pausedDrift);
  assert.equal(f.inputs().length, 1, 'no new line in the fake input log');
});

test('M8-40e: after drift, desktop.describe, snapshot, find and screenshot each refuse with PAUSED_DRIFT', async (t) => {
  const reads: Array<[string, object]> = [
    ['desktop.describe', { ...ME, window: 100, ref: 'e1' }],
    ['desktop.snapshot', { ...ME, window: 100 }],
    ['desktop.find', { ...ME, window: 100, text: 'Text' }],
    ['desktop.screenshot', { ...ME, window: 100 }],
  ];
  for (const [method, params] of reads) {
    const f = await fixture(t);
    await f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Untitled - *' });
    f.retitle('Inbox - Mail (3)');
    await assert.rejects(f.call(method, params), pausedDrift, method);
  }
});

test('M8-40e: after a drift pause, desktop.act and approval.check for that session say paused by the user; other sessions are not paused', async (t) => {
  const f = await fixture(t);
  await f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Untitled - *' });
  f.retitle('Inbox - Mail (3)');
  await assert.rejects(f.act(), pausedDrift);
  await assert.rejects(f.act(), pausedByUser);
  assert.equal(takeoverPaused(f.db, 's1'), true);
  assert.equal(takeoverPaused(f.db, 's2'), false);
  const r: any = await f.check();
  assert.equal(r.decision, 'deny');
  assert.equal(r.reason, PAUSED);
  const other: any = await f.check({ session_id: 's2' });
  assert.notEqual(other.reason, PAUSED, 'the drift pause is per session');
  assert.equal(f.inputs().length, 0);
});

test('M8-40e: tick() alone pauses the session on drift, before any call', async (t) => {
  const f = await fixture(t);
  await f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Untitled - *' });
  f.retitle('Inbox - Mail (3)');
  await f.desktop.tick();
  assert.equal(takeoverPaused(f.db, 's1'), true);
  assert.equal(takeoverPaused(f.db, 's2'), false);
  await assert.rejects(f.act(), (e: any) => { assert.match(e.message, /^paused/); return true; });
  assert.equal((await f.check()).reason, PAUSED);
  assert.equal(f.inputs().length, 0);
});

test('M8-40e: a title change on an owned dialog does not pause a session whose granted window still matches', async (t) => {
  const f = await fixture(t);
  await f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Untitled - *' });
  f.setWindows([NOTEPAD, { ...DIALOG, title: 'Open' }, WORKBENCH]);
  await f.desktop.tick();
  assert.equal(takeoverPaused(f.db, 's1'), false);
  const r = await f.act();
  assert.equal(r.status, 'confirmed');
  assert.equal(f.inputs().length, 1);
});

test('M8-40e: resume while the title still does not match pauses again on the next check', async (t) => {
  const f = await fixture(t);
  await f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Untitled - *' });
  f.retitle('Inbox - Mail (3)');
  await assert.rejects(f.act(), pausedDrift);
  assert.deepEqual(await f.call('takeover.resume', { session_id: 's1' }), {});
  // The contract says the next check pauses again but does not name the message on the re-pause.
  await assert.rejects(f.act(), (e: any) => { assert.match(e.message, /^paused/); return true; });
  assert.equal(takeoverPaused(f.db, 's1'), true);
  assert.equal(f.inputs().length, 0);
});

test('M8-40e: title restored, then resume: input goes through again', async (t) => {
  const f = await fixture(t);
  await f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Untitled - *' });
  f.retitle('Inbox - Mail (3)');
  await assert.rejects(f.act(), pausedDrift);
  f.retitle('Untitled - Notepad');
  // A person needs more than a millisecond to fix the title and press Resume. Without this gap, a resume stamped in
  // the same millisecond as the drift pause did not clear it (observed; see the report).
  await new Promise((r) => setTimeout(r, 50));
  await f.call('takeover.resume', { session_id: 's1' });
  assert.equal((await f.act()).status, 'confirmed');
  assert.equal(f.inputs().length, 1);
});

test('M8-40e: unpin (null) stops drift pausing: a changed title no longer pauses', async (t) => {
  const f = await fixture(t);
  await f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Untitled - *' });
  await f.call('grant.pin', { grant_id: f.grant, title_pattern: null });
  f.retitle('Inbox - Mail (3)');
  await f.desktop.tick();
  assert.equal(takeoverPaused(f.db, 's1'), false);
  assert.equal((await f.act()).status, 'confirmed');
  assert.equal(f.inputs().length, 1);
});

test('M8-40e: grant.revoke drops the pin', async (t) => {
  const f = await fixture(t);
  await f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Untitled - *' });
  assert.equal(grantPin(f.db, f.grant), 'Untitled - *');
  await f.call('grant.revoke', { grant_id: f.grant });
  assert.equal(grantPin(f.db, f.grant), null);
  assert.deepEqual((await f.call('grant.live')).grants, []);
});

test('M8-40e: a new Desktop on the same db clears pins and the drift pause', async (t) => {
  const f = await fixture(t);
  await f.call('grant.pin', { grant_id: f.grant, title_pattern: 'Untitled - *' });
  f.retitle('Inbox - Mail (3)');
  await assert.rejects(f.act(), pausedDrift);
  assert.equal(takeoverPaused(f.db, 's1'), true);
  assert.notEqual(grantPin(f.db, f.grant), null);
  new Desktop(f.db);
  assert.equal(grantPin(f.db, f.grant), null, 'pins end on core restart');
  assert.equal(takeoverPaused(f.db, 's1'), false, 'the drift pause ends on core restart');
});
