import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { schemaFile } from '../../core/src/paths.ts';
import { settings, setSetting, DEFAULTS } from '../../core/src/settings.ts';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const PAGE_KEYS = new Set<string>(vm.runInNewContext(/const PAGE_KEYS = new Set\((\[[\s\S]*?\])\)/.exec(main)![1]));
const plain = (value: any) => JSON.parse(JSON.stringify(value));
function handler(name: string, globals: any) {
  const start = main.indexOf("on('" + name + "', ");
  assert.ok(start >= 0, name + ' IPC exists');
  const body = main.slice(start + name.length + 7).split('\n  });')[0];
  return vm.runInNewContext(stripTypeScriptTypes('(' + body + '\n  })'), { PAGE_KEYS, DEFAULTS, ...globals });
}
function ipcFixture(t: any) {
  const home = mkdtempSync(join(tmpdir(), 'rel-settings-'));
  const previous = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = home;
  setSetting('reliability', 'checks', { p2: 'keep this command' });
  const db = new DatabaseSync(':memory:'); db.exec(readFileSync(schemaFile, 'utf8'));
  const writes: any[] = [];
  const globals = { settings, DEFAULTS, PAGE_KEYS, db: () => db, projectRoot: (id: string) => id === 'p1' || id === 'p2' ? home : null,
    writeSetting: async (key: string, value: any) => { writes.push([key, plain(value)]); const [section, name] = key.split('.'); setSetting(section, name, plain(value)); return null; } };
  t.after(() => { db.close(); if (previous === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = previous; rmSync(home, { recursive: true, force: true }); });
  return { db, writes, globals };
}

test('Settings exposes five reliability keys and loop.choose is allowed through the UI', () => {
  const keys = vm.runInNewContext(/const PAGE_KEYS = new Set\((\[[\s\S]*?\])\)/.exec(main)![1]);
  assert.deepEqual(Array.from(keys).filter((k: any) => k.startsWith('reliability.')).sort(), ['reliability.done_needs_check', 'reliability.loop_alarm', 'reliability.loop_nudge_at', 'reliability.loop_stop_at', 'reliability.token_limit']);
  const methods = vm.runInNewContext(/const UI_METHODS = new Set\((\[[\s\S]*?\])\)/.exec(main)![1]);
  assert.ok(methods.includes('loop.choose'));
});

test('settingsPage returns reliability settings and persisted false alarms, defaulting to zero', (t) => {
  const h = ipcFixture(t), page = handler('settingsPage', h.globals);
  assert.deepEqual(plain(page().reliability), { loop_alarm: true, loop_nudge_at: 3, loop_stop_at: 5, token_limit: 0, done_needs_check: true, checks: { p2: 'keep this command' }, false_alarms: 0 });
  h.db.prepare("INSERT INTO meta (key,value) VALUES ('loop_false_alarms','2')").run();
  assert.equal(page().reliability.false_alarms, 2);
  h.globals.db = () => null as any;
  assert.equal(handler('settingsPage', h.globals)().reliability.false_alarms, 0);
});

test('setCheck trims commands, retains other projects, accepts 500 characters and removes empty entries', async (t) => {
  const h = ipcFixture(t), set = handler('setCheck', h.globals);
  assert.deepEqual(plain(await set('p1', '  node check.mjs  ')), { ok: true });
  assert.deepEqual(h.writes, [['reliability.checks', { p2: 'keep this command', p1: 'node check.mjs' }]]);
  assert.equal((await set('p1', 'x'.repeat(500))).ok, true);
  assert.equal(settings().reliability.checks.p1.length, 500);
  assert.equal((await set('p1', '   ')).ok, true);
  assert.deepEqual(settings().reliability.checks, { p2: 'keep this command' });
});

test('setCheck rejects unknown projects, nonstrings and overlong commands without writing', async (t) => {
  const h = ipcFixture(t), set = handler('setCheck', h.globals);
  for (const [pid, command] of [['missing', 'node check.mjs'], [undefined, 'check'], [42, 'check'], ['p1', undefined], ['p1', null], ['p1', 42], ['p1', {}], ['p1', []], ['p1', 'x'.repeat(501)]]) {
    assert.deepEqual(plain(await set(pid, command)), { error: 'bad check command' });
  }
  assert.deepEqual(h.writes, []);
  assert.deepEqual(settings().reliability.checks, { p2: 'keep this command' });
});

test('setCheck propagates a settings write error', async (t) => {
  const h = ipcFixture(t);
  const set = handler('setCheck', { ...h.globals, writeSetting: async () => 'synthetic write failure' });
  assert.deepEqual(plain(await set('p1', 'check')), { error: 'synthetic write failure' });
  assert.deepEqual(settings().reliability.checks, { p2: 'keep this command' });
});

test('preload setCheck invokes IPC with the project and command unchanged', async () => {
  const calls: any[] = [];
  let api: any;
  const preload = readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8');
  vm.runInNewContext(preload, { require: (name: string) => { assert.equal(name, 'electron'); return { contextBridge: { exposeInMainWorld: (_name: string, value: any) => { api = value; } }, ipcRenderer: { invoke: (...args: any[]) => { calls.push(args); return Promise.resolve({ ok: true }); }, on() {} } }; } });
  await api.setCheck('p1', 'node check.mjs');
  assert.deepEqual(calls, [['setCheck', 'p1', 'node check.mjs']]);
});
