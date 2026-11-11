import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const extract = (re: RegExp) => { const m = source.match(re); assert.ok(m, String(re)); return m[0]; };
function closeHarness(responses: number[], ownCore = true, dirty = true, busy = true) {
  const events: string[] = [];
  const listeners: Record<string, Function> = {};
  let unloads = 0;
  const c: any = vm.createContext({ ownCore, dirtyFiles: dirty, dirtySummary: '', closing: false, demo: false,
    busy: () => busy, detachAll() {},
    dialog: {
      showMessageBox: async (_w: unknown, options: any) => { events.push(options.message); assert.ok(responses.length, 'unexpected dialog'); return { response: responses.shift() }; },
      showMessageBoxSync: () => { unloads++; return 1; },
    },
    stopCore: async () => { events.push('core.stop'); c.ownCore = false; },
    win: { isDestroyed: () => false, on: (name: string, fn: Function) => { listeners[name] = fn; },
      webContents: { on: (name: string, fn: Function) => { listeners[name] = fn; } },
      close: () => { events.push('close'); listeners['will-prevent-unload']({ preventDefault() {} }); } },
  });
  const code = [
    extract(/^const unsavedMessage[^\n]+/m),
    extract(/^async function onClose\([^]*?^}/m),
    extract(/  win\.on\('close', \(e\) => \{[^]*?\n  \}\);/),
    extract(/  win\.webContents\.on\('will-prevent-unload', \(e\) => \{[^]*?\n  \}\);/),
    extract(/  win\.webContents\.on\('did-start-navigation'[^\n]+/),
  ].join('\n');
  vm.runInContext(stripTypeScriptTypes(code), c);
  return { c, events, listeners, unloads: () => unloads };
}

// Protects main.ts:905-907: Cancel must precede every core stop.
test('fix-01 unsaved Cancel leaves own core, agents and window running', async () => {
  const h = closeHarness([1]); await h.c.onClose();
  assert.deepEqual(h.events, ['Some files in the IDE have unsaved changes.']);
  assert.equal(h.c.closing, false); assert.equal(h.c.ownCore, true);
});
// Protects main.ts:918: cancelling the agents question is still reversible.
test('fix-01 discard then agents Cancel leaves core running', async () => {
  const h = closeHarness([0, 2]); await h.c.onClose();
  assert.deepEqual(h.events, ['Some files in the IDE have unsaved changes.', 'Agents are still open.']);
  assert.equal(h.c.closing, false); assert.equal(h.c.ownCore, true);
});
// Protects main.ts:919-922 and :725: stop once, suppress the second unload question.
test('fix-01 discard then Stop everything stops once after the question', async () => {
  const h = closeHarness([0, 1]); await h.c.onClose();
  assert.deepEqual(h.events, ['Some files in the IDE have unsaved changes.', 'Agents are still open.', 'core.stop', 'close']);
  assert.equal(h.c.closing, true); assert.equal(h.unloads(), 0);
});
// Protects main.ts:905, :918-920: clean closes keep the previous busy/idle behavior.
test('fix-01 clean busy core can stay in background and clean idle core stops', async () => {
  const h = closeHarness([0], true, false); await h.c.onClose();
  assert.deepEqual(h.events, ['Agents are still open.', 'close']); assert.equal(h.c.ownCore, true);
  const idle = closeHarness([], true, false, false); await idle.c.onClose();
  assert.deepEqual(idle.events, ['core.stop', 'close']);
});
// Protects main.ts:741 and :727: a borrowed core uses just the native unload question.
test('fix-01 borrowed core close uses the single unload question', () => {
  const h = closeHarness([], false); let prevented = false;
  h.listeners.close({ preventDefault() { prevented = true; } });
  h.listeners['will-prevent-unload']({ preventDefault() {} });
  assert.equal(prevented, false); assert.equal(h.unloads(), 1); assert.deepEqual(h.events, []);
});
// Protects main.ts:737: only a new main document clears stale renderer dirtiness.
test('fix-01 main-frame reload clears dirty state, subframe and same-document do not', async () => {
  const h = closeHarness([0], true, true);
  for (const e of [{ isMainFrame: false }, { isMainFrame: true, isSameDocument: true }]) {
    h.listeners['did-start-navigation'](e); assert.equal(h.c.dirtyFiles, true);
  }
  h.listeners['did-start-navigation']({ isMainFrame: true, isSameDocument: false });
  assert.equal(h.c.dirtyFiles, false); await h.c.onClose(); assert.deepEqual(h.events, ['Agents are still open.', 'close']);
});

const expected = [
  'session.search', 'session.list', 'project.open', 'session.launch', 'session.focus', 'session.seen', 'session.hide', 'session.limit-resume', 'project.clear', 'project.hide', 'engines.check',
  'needs.dismiss', 'session.paste-prompt', 'shell.list', 'shell.open', 'shell.close', 'session.clear-status', 'session.resume', 'needs_you.mark-read', 'needs_you.mark-unread', 'pane.open', 'pane.close', 'pane.assign', 'pane.capture', 'approval.resolve', 'loop.choose', 'lend.set',
  'notify.sink.set', 'notify.sink.list', 'notify.sink.test', 'notify.sink.remove', 'grant.candidates', 'grant.window', 'grant.revoke', 'grant.pin', 'takeover.resume', 'takeover.pause',
  'done.result', 'usage.summary', 'usage.session', 'stats.sessions', 'stats.checks', 'session.owners', 'audit.list', 'worktree.create', 'automation.list', 'automation.set', 'automation.enable', 'automation.delete', 'plugin.preview', 'plugin.install', 'plugin.remove', 'session.read', 'session.handoff',
  'session.labels-set', 'labels.list', 'session.monitor-set', 'session.reviewers-set', 'session.approve', 'session.reject', 'session.priority-set', 'session.block-set', 'session.block-clear',
  'label.list', 'label.set', 'automation.labels-set', 'automation.run', 'cron.next', 'session.send',
];
// Protects main.ts:57-66 and the call handler: exact capability set and the actual IPC gate.
test('wire-00 exact 69 IPC methods pass with UI authentication; other methods are refused', async () => {
  const calls: any[] = []; let handler: Function = () => {};
  const c = vm.createContext({ on: (_name: string, fn: Function) => { handler = fn; },
    call: async (...args: any[]) => { calls.push(args); return { kind: 'reply', reply: { result: {} } }; }, schedulePush() {} });
  const decl = extract(/export const UI_METHODS = new Set\([^]*?\n\]\);/).replace('export ', '');
  vm.runInContext(stripTypeScriptTypes(decl + '\n' + extract(/  on\('call', async[^]*?\n  \}\);/)), c);
  assert.deepEqual(Array.from(vm.runInContext('[...UI_METHODS]', c)).sort(), [...expected].sort());
  for (const name of expected) await handler(name, { test: true });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), expected.map(name => [name, { test: true }, { ui: true }]));
  for (const name of ['core.stop', 'done.check', 'plugin.secret.set', 'hooks.install', '__proto__', 'plugin.install.extra', '', null, 3]) {
    const r = await handler(name, {}); assert.equal(r.reply.error.code, -32601, String(name));
  }
  assert.equal(calls.length, expected.length);
});

// Protects preload.cjs:14 and main.ts:648: the renderer's dirty bit reaches onClose.
test('fix-01 preload setDirty uses the named IPC handler and activates the close guard', async () => {
  const h = closeHarness([1], true, false); let setDirty: Function = () => {};
  h.c.on = (_name: string, handler: Function) => { setDirty = handler; };
  vm.runInContext(stripTypeScriptTypes(extract(/  on\('setDirty'[^\n]+/)), h.c);
  let api: any;
  const invocations: any[] = [];
  vm.runInNewContext(readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8'), {
    require: (name: string) => { assert.equal(name, 'electron'); return {
      contextBridge: { exposeInMainWorld: (name: string, value: any) => { if (name === 'troop') api = value; } },
      ipcRenderer: { on() {}, invoke: (name: string, value: unknown) => { invocations.push([name, value]); assert.equal(name, 'setDirty'); return setDirty(value); } }, webUtils: {},
    }; },
  });
  await api.setDirty(true); assert.deepEqual(invocations, [['setDirty', true]]);
  assert.equal(h.c.dirtyFiles, true); await h.c.onClose();
  assert.deepEqual(h.events, ['Some files in the IDE have unsaved changes.']); assert.equal(h.c.ownCore, true);
});
