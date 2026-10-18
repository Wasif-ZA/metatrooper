import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');

async function load() {
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'electron' ? { url: 'test:hardening-electron', shortCircuit: true } : nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      return url === 'test:hardening-electron' ? {
        format: 'module', shortCircuit: true,
        source: "export const app = {}, clipboard = {}, Menu = {}, session = {}, WebContentsView = {}; const image = { getSize: () => ({ width: 20, height: 20 }), toJPEG: () => Buffer.from('fake image'), toPNG: () => Buffer.from('fake image') }; export const nativeImage = { createFromBuffer: () => image };",
      } : nextLoad(url, context);
    },
  });
  try { return await import('../src/browser/panes.ts'); }
  finally { hook.deregister(); }
}

function gate() {
  let enter!: () => void;
  let release!: () => void;
  const entered = new Promise<void>((r) => { enter = r; });
  const pending = new Promise<void>((r) => { release = r; });
  return { entered, release, wait: async () => { enter(); await pending; } };
}

async function fixture() {
  const { PaneManager } = await load();
  const dir = mkdtempSync(join(tmpdir(), 'mt-hardening-ui-'));
  const db = new DatabaseSync(join(dir, 'synthetic.sqlite'));
  db.exec(schema);
  db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', ?, 'p1', '2026-10-14T00:00:00.000Z', '2026-10-14T00:00:00.000Z')").run(dir);
  db.prepare("INSERT INTO engine (id, spec_json, cost_rank, provider) VALUES ('claude', '{}', 1, 'local-cli')").run();
  db.prepare("INSERT INTO session (id, project_id, engine_id, host, state, state_at, started_at, pid) VALUES ('session-a', 'p1', 'claude', 'pty', 'working', '2026-10-14T00:00:00.000Z', '2026-10-14T00:00:00.000Z', ?)").run(process.pid);
  const manager: any = new PaneManager({} as any, { db: () => db, probe: () => {} } as any);
  const sent: Array<{ method: string; params: any }> = [];
  const pane: any = {
    row: { id: 'pane-1', project_id: 'p1', session_id: 'session-a' }, handoff: null,
    handedBack: false, secretOnPage: false, navs: 0, errorFor: null, status: 200,
    view: { webContents: { loadURL: async (url: string) => { sent.push({ method: 'loadURL', params: { url } }); } } },
  };
  manager.answer = async (_pane: any, _session: string, action: () => Promise<unknown>) => action();
  manager.target = async () => ({ node: { backendNodeId: 1, frameId: 'frame-1' }, x: 10, y: 20 });
  manager.node = () => ({ backendNodeId: 1, frameId: 'frame-1' });
  manager.pointAt = async () => {};
  const focus = { backendNodeId: 1 };
  manager.cmd = async (_pane: any, method: string, params: any = {}) => {
    sent.push({ method, params });
    if (method === 'Runtime.evaluate' && String(params.expression).includes('document.activeElement')) return { result: { objectId: 'focused-1' } };
    if (method === 'DOM.describeNode' && params.objectId === 'focused-1') return { node: { ...focus, frameId: 'frame-1' } };
    if (method === 'Page.getFrameTree') return { frameTree: { frame: { id: 'frame-1' } } };
    if (method === 'Page.createIsolatedWorld') return { executionContextId: 7 };
    if (method === 'DOM.resolveNode') return { object: { objectId: 'object-1' } };
    if (method === 'Runtime.callFunctionOn') return { result: { value: params.functionDeclaration.includes('isConnected') ? true : null } };
    if (method === 'DOM.getBoxModel') return { model: { border: [0, 0, 20, 0, 20, 20, 0, 20] } };
    if (method === 'Page.getLayoutMetrics') return { cssLayoutViewport: { pageX: 0, pageY: 0 } };
    if (method === 'Page.captureScreenshot') return { data: 'ZmFrZSBpbWFnZQ==' };
    if (method === 'Runtime.evaluate') return { result: { value: 42 } };
    return {};
  };
  const pause = () => db.prepare("INSERT INTO meta (key, value) VALUES ('takeover_paused_at', '2026-10-14T10:00:00.000Z')").run();
  const args = { _session: 'session-a', ref: 'e1' };
  const stopAt = (match: (method: string, params: any) => boolean) => {
    const hold = gate();
    const cmd = manager.cmd;
    manager.cmd = async (p: any, method: string, params: any = {}) => {
      const response = await cmd(p, method, params);
      if (match(method, params)) await hold.wait();
      return response;
    };
    return hold;
  };
  return { manager, pane, args, sent, pause, stopAt, focus, close: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

async function pausedDuring(f: Awaited<ReturnType<typeof fixture>>, hold: ReturnType<typeof gate>, work: Promise<unknown>) {
  const rejection = assert.rejects(work, { code: -32030, message: 'paused by the user' });
  await hold.entered;
  f.pause();
  hold.release();
  await rejection;
}

const mouseTypes = (sent: Array<{ method: string; params: any }>) => sent.filter((c) => c.method === 'Input.dispatchMouseEvent').map((c) => c.params.type);
const keyEvents = (sent: Array<{ method: string; params: any }>) => sent.filter((c) => c.method === 'Input.dispatchKeyEvent').map((c) => [c.params.key, c.params.type]);

test('M6-15 hardening click paused during mouseMoved sends no press or release', async () => {
  const f = await fixture();
  try {
    const hold = f.stopAt((m, p) => m === 'Input.dispatchMouseEvent' && p.type === 'mouseMoved');
    await pausedDuring(f, hold, f.manager.run(f.pane, 'click', f.args));
    assert.deepEqual(mouseTypes(f.sent), ['mouseMoved']);
  } finally { f.close(); }
});

test('M6-15 hardening unpaused click sends move, press and release', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.manager.run(f.pane, 'click', f.args), { ok: true });
    assert.deepEqual(mouseTypes(f.sent), ['mouseMoved', 'mousePressed', 'mouseReleased']);
  } finally { f.close(); }
});

for (const step of ['DOM.focus', 'select-all', 'insertText'] as const) {
  test('M6-15 hardening type paused during ' + step + ' stops later input', async () => {
    const f = await fixture();
    try {
      const hold = f.stopAt((m, p) => step === 'DOM.focus' ? m === 'DOM.focus' : step === 'select-all' ? m === 'Input.dispatchKeyEvent' && p.key === 'a' && p.type === 'keyDown' : m === 'Input.insertText');
      await pausedDuring(f, hold, f.manager.run(f.pane, 'type', { ...f.args, text: 'hello', submit: true }));
      assert.deepEqual(mouseTypes(f.sent), ['mouseMoved', 'mousePressed', 'mouseReleased']);
      assert.deepEqual(keyEvents(f.sent), step === 'DOM.focus' ? [] : step === 'select-all' ? [['a', 'keyDown']] : [['a', 'keyDown'], ['a', 'keyUp']]);
      assert.deepEqual(f.sent.filter((c) => c.method === 'Input.insertText').map((c) => c.params.text), step === 'insertText' ? ['hello'] : []);
    } finally { f.close(); }
  });
}

test('M6-15 hardening unpaused type focuses, selects, inserts and submits', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.manager.run(f.pane, 'type', { ...f.args, text: 'hello', submit: true }), { ok: true });
    assert.equal(f.sent.filter((c) => c.method === 'DOM.focus').length, 1);
    assert.deepEqual(keyEvents(f.sent), [['a', 'keyDown'], ['a', 'keyUp'], ['Enter', 'keyDown'], ['Enter', 'keyUp']]);
    assert.deepEqual(f.sent.filter((c) => c.method === 'Input.insertText').map((c) => c.params.text), ['hello']);
  } finally { f.close(); }
});

for (const change of ['focus', 'navigate'] as const) test('M6-15 hardening type stops before the next 8-character piece when the page ' + (change === 'focus' ? 'moves focus to another field' : 'navigates') + ' after the first', async () => {
  const f = await fixture();
  try {
    const cmd = f.manager.cmd;
    f.manager.cmd = async (p: any, method: string, params: any = {}) => {
      const r = await cmd(p, method, params);
      if (method === 'Input.insertText') { if (change === 'focus') f.focus.backendNodeId = 2; else f.pane.navs++; }
      return r;
    };
    await assert.rejects(f.manager.run(f.pane, 'type', { ...f.args, text: 'abcdefghijklmnopq', submit: true }), { code: -32037, message: change === 'focus' ? 'focus moved off the field; 8 of 17 characters were typed, the rest were not' : 'the page navigated; 8 of 17 characters were typed, the rest were not' });
    assert.deepEqual(f.sent.filter((c) => c.method === 'Input.insertText').map((c) => c.params.text), ['abcdefgh']);
    assert.equal(keyEvents(f.sent).filter(([k]) => k === 'Enter').length, 0);
  } finally { f.close(); }
});

test('M6-15 hardening type checks focus before the first piece too', async () => {
  const f = await fixture();
  try {
    f.focus.backendNodeId = 2;
    await assert.rejects(f.manager.run(f.pane, 'type', { ...f.args, text: 'hello' }), { code: -32037, message: 'focus moved off the field; nothing was typed' });
    assert.equal(f.sent.filter((c) => c.method === 'Input.insertText').length, 0);
  } finally { f.close(); }
});

test('M6-15 hardening empty type paused during Delete keyDown sends no keyUp', async () => {
  const f = await fixture();
  try {
    const hold = f.stopAt((m, p) => m === 'Input.dispatchKeyEvent' && p.key === 'Delete' && p.type === 'keyDown');
    await pausedDuring(f, hold, f.manager.run(f.pane, 'type', { ...f.args, text: '', submit: true }));
    assert.deepEqual(keyEvents(f.sent), [['a', 'keyDown'], ['a', 'keyUp'], ['Delete', 'keyDown']]);
    assert.equal(f.sent.filter((c) => c.method === 'Input.insertText').length, 0);
  } finally { f.close(); }
});

test('M6-15 hardening unpaused empty type sends both Delete events', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.manager.run(f.pane, 'type', { ...f.args, text: '' }), { ok: true });
    assert.deepEqual(keyEvents(f.sent), [['a', 'keyDown'], ['a', 'keyUp'], ['Delete', 'keyDown'], ['Delete', 'keyUp']]);
  } finally { f.close(); }
});

for (const paused of [true, false]) {
  test('M6-15 hardening select ' + (paused ? 'paused during recheck describe sends no value change' : 'unpaused sends the value change'), async () => {
    const f = await fixture();
    try {
      f.manager.box = async () => ({ objectId: 'object-1', x: 10, y: 20 });
      const hold = gate();
      f.manager.describeControl = async () => {
        if (paused) await hold.wait();
        return { origin: 'https://synthetic.test', control: { name: 'Choice', automation_id: 'choice', role: 'combobox' }, password: false, hidden: false };
      };
      const work = f.manager.run(f.pane, 'select', { ...f.args, value: 'two', expect: { origin: 'https://synthetic.test', name: 'Choice', automation_id: 'choice', password: false, hidden: false } });
      if (paused) await pausedDuring(f, hold, work);
      else assert.deepEqual(await work, { ok: true });
      assert.deepEqual(f.sent.filter((c) => c.method === 'Runtime.callFunctionOn').map((c) => c.params.arguments), paused ? [] : [[{ value: 'two' }]]);
    } finally { f.close(); }
  });
}

for (const paused of [true, false]) {
  test('M6-15 hardening screenshot ref ' + (paused ? 'paused before call sends no scroll' : 'unpaused scrolls and captures'), async () => {
    const f = await fixture();
    try {
      if (paused) f.pause();
      const work = f.manager.run(f.pane, 'screenshot', f.args);
      if (paused) await assert.rejects(work, { code: -32030, message: 'paused by the user' });
      else assert.deepEqual(await work, { data_base64: 'ZmFrZSBpbWFnZQ==', mime: 'image/jpeg', width: 20, height: 20, truncated: false });
      assert.equal(f.sent.filter((c) => c.method === 'DOM.scrollIntoViewIfNeeded').length, paused ? 0 : 1);
      assert.equal(f.sent.filter((c) => c.method === 'Page.captureScreenshot').length, paused ? 0 : 1);
    } finally { f.close(); }
  });
}

for (const paused of [true, false]) {
  test('M6-15 hardening click box ' + (paused ? 'paused during resolve sends no scroll or mouse input' : 'unpaused resolves, scrolls and clicks'), async () => {
    const f = await fixture();
    try {
      delete f.manager.target;
      const hold = f.stopAt((m) => paused && m === 'DOM.resolveNode');
      const work = f.manager.run(f.pane, 'click', f.args);
      if (paused) await pausedDuring(f, hold, work);
      else assert.deepEqual(await work, { ok: true });
      assert.equal(f.sent.filter((c) => c.method === 'DOM.resolveNode').length, 1);
      assert.equal(f.sent.filter((c) => c.method === 'DOM.scrollIntoViewIfNeeded').length, paused ? 0 : 1);
      assert.deepEqual(mouseTypes(f.sent), paused ? [] : ['mouseMoved', 'mousePressed', 'mouseReleased']);
    } finally { f.close(); }
  });
}

for (const paused of [true, false]) {
  test('M6-15 hardening evaluate ' + (paused ? 'paused during isolated world creation sends no expression' : 'unpaused sends the expression'), async () => {
    const f = await fixture();
    try {
      const hold = f.stopAt((m) => paused && m === 'Page.createIsolatedWorld');
      const work = f.manager.run(f.pane, 'evaluate', { ...f.args, expression: '6 * 7' });
      if (paused) await pausedDuring(f, hold, work);
      else assert.deepEqual(await work, { value: 42 });
      assert.equal(f.sent.filter((c) => c.method === 'Page.createIsolatedWorld').length, 1);
      assert.deepEqual(f.sent.filter((c) => c.method === 'Runtime.evaluate').map((c) => c.params.expression), paused ? [] : ['6 * 7']);
    } finally { f.close(); }
  });
}

for (const paused of [true, false]) {
  test('M6-15 hardening navigate ' + (paused ? 'paused during URL policy sends no loadURL' : 'unpaused loads the allowed URL'), async () => {
    const f = await fixture();
    try {
      const hold = gate();
      let lookups = 0;
      f.manager.paneCtx = () => ({ ownedPorts: new Set(), allowHosts: new Set(), lookup: async () => { lookups++; if (paused) await hold.wait(); return ['93.184.216.34']; } });
      const work = f.manager.run(f.pane, 'navigate', { ...f.args, url: 'https://synthetic.test/page' });
      if (paused) await pausedDuring(f, hold, work);
      else assert.deepEqual(await work, { status: 200 });
      assert.equal(lookups, 1);
      assert.deepEqual(f.sent.filter((c) => c.method === 'loadURL').map((c) => c.params.url), paused ? [] : ['https://synthetic.test/page']);
    } finally { f.close(); }
  });
}
