import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { root, sleep, until } from '../../core/test/helpers.ts';
import { revisionHarness } from '../../core/test/ui-revision-helpers.ts';
import { killTree } from '../../tests/helpers/kill-tree.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const enabled = process.env.METATROOPER_UI_REVISION_E2E === '1';
const options = { skip: !enabled && 'set METATROOPER_UI_REVISION_E2E=1 for real Electron tests', timeout: 150000 };

async function windowFor(h: Awaited<ReturnType<typeof revisionHarness>>) {
  assert.ok(existsSync(electron), 'Electron binary is required');
  const server = createServer(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port; await new Promise<void>(r => server.close(() => r()));
  const args = ['--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, workbench];
  const errorLog = join(h.iso.home, 'electron-stderr.log'); const output = openSync(errorLog, 'w');
  const wb = process.platform === 'linux' && !process.env.DISPLAY
    ? spawn('xvfb-run', ['-a', electron, '--no-sandbox', ...args], { env: h.env, stdio: 'ignore', detached: true })
    : spawn(electron, args, { env: h.env, stdio: ['ignore', 'ignore', output], windowsHide: true, detached: process.platform !== 'win32' });
  const stop = async () => {
    if (!wb.pid) return;
    killTree(wb.pid);
    if (wb.exitCode === null) wb.kill();
    await Promise.race([new Promise<void>(r => wb.once('exit', () => r())), sleep(3000)]);
  };
  closeSync(output);
  let ws: WebSocket | undefined;
  try {
    const target = await until(async () => {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      return (await r.json()).find((t: any) => t.type === 'page' && t.url.includes('index.html'));
    }, 25000);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((r, j) => { ws!.addEventListener('open', () => r(), { once: true }); ws!.addEventListener('error', j, { once: true }); });
    let seq = 0; const pending = new Map<number, any>();
    ws.addEventListener('message', e => { const m = JSON.parse(String(e.data)); if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
    const send = (method: string, params = {}): Promise<any> => new Promise((resolve, reject) => {
      const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out; stderr ${readFileSync(errorLog, 'utf8').slice(-3000)}`)); }, 10000);
      pending.set(id, { resolve, reject, timer }); ws!.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression: string) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value;
    };
    const click = async (selector: string) => {
      const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      assert.ok(point, `missing ${selector}`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const key = async (key: string, code: string, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
    };
    const wait = async (expression: string, timeout = 20000) => until(() => evaluate(expression), timeout);
    await wait('typeof ui !== "undefined" && ui.snap && ui.snap.core.online');
    return { evaluate, click, key, wait, async close() { ws?.send(JSON.stringify({ id: ++seq, method: 'Browser.close' })); await sleep(300); ws?.close(); await stop(); } };
  } catch (e) { ws?.close(); await stop(); throw e; }
}

async function waitingRun(h: Awaited<ReturnType<typeof revisionHarness>>, title = 'Runbox fixture', withAgent = false) {
  const id = `runbox-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const dir = join(h.project, '.troop/pipelines');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const plugin = join(h.project, '.troop/plugins/runbox-test');
  if (!h.db.prepare("SELECT 1 FROM plugin WHERE id = 'runbox-test'").get()) {
    mkdirSync(join(plugin, 'bin'), { recursive: true });
    writeFileSync(join(plugin, 'troop-plugin.json'), JSON.stringify({
      schema: 1, id: 'runbox-test', name: 'Runbox test', version: '1.0.0', engines: [],
      actions: [{ id: 'noop', title: 'No-op', run: ['bin/noop.mjs'] }],
    }));
    writeFileSync(join(plugin, 'bin/noop.mjs'), `
#!/usr/bin/env node
let input = '';
for await (const chunk of process.stdin) input += chunk;
process.stdout.write(JSON.stringify({ ok: true, outputs: {} }));
`);
    const installed = await h.pipe.request('plugin.install', { source: plugin, approved_permissions: [] });
    assert.ok(installed.result, JSON.stringify(installed));
  }
  mkdirSync(dir, { recursive: true });
  const definition = { schema: 1, id, title, requires: ['runbox-test'], steps: [
    ...(withAgent ? [{ id: 'work', kind: 'agent', engine: 'fake', prompt: 'FAKE {"outputs":{}}' }] : []),
    { id: 'approve', kind: 'gate', gate: 'approve', gate_summary: `Approve ${title}` },
    { id: 'publish', kind: 'action', uses: 'plugin:runbox-test/noop' },
  ] };
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(definition));
  const run = await h.pipeline(definition);
  const gate = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND status = 'waiting'").get(run), 20000);
  const session = h.db.prepare('SELECT session_id FROM run_step WHERE run_id = ? AND session_id IS NOT NULL ORDER BY started_at DESC LIMIT 1').get(run)?.session_id;
  return { run, gate, session, pipelineId: id };
}

async function fixture(withSession = false) {
  const h = await revisionHarness(); let w;
  try {
    const own = await waitingRun(h, 'Owned pipeline');
    const session = withSession ? await h.launch() : null;
    if (session) {
      await h.pipe.request('session.focus', { session_id: session.session_id });
      // Fake agent exits can clear UI selection; the test session is ticker-backed.
    }
    w = await windowFor(h);
    await w.click('[data-action="tab"][data-tab="runs"]');
    await w.wait('Boolean(document.querySelector("#runbox"))');
    return { h, w, own, session };
  } catch (e) { await w?.close(); await h.close(); throw e; }
}

async function cleanup(f: Awaited<ReturnType<typeof fixture>>) { await f.w.close(); await f.h.close(); }
const row = (id: string) => `document.querySelector(${JSON.stringify(`#runbox [data-action="run-open"][data-id="${id}"]`)})`;
const insertFailedItem = (h: Awaited<ReturnType<typeof revisionHarness>>, run: string, id: string) => {
  h.db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'run-failed', ?, 'Run failed')").run(id, new Date().toISOString(), run);
  h.db.prepare("UPDATE run SET status='failed', paused_why='failure' WHERE id=?").run(run);
};

test('nothing selected shows the waiting run with Needs you label, run-open, and Cancel', options, async () => {
  const f = await fixture();
  try {
    await f.w.wait(`Boolean(${row(f.own.run)}) && document.querySelector('#runbox').innerText.includes('Needs you: Owned pipeline')`);
    assert.equal(await f.w.evaluate(`${row(f.own.run)}?.dataset.action`), 'run-open');
    assert.ok(await f.w.evaluate(`${row(f.own.run)}?.querySelector('[data-action="cancel-run"]')?.textContent`));
  } finally { await cleanup(f); }
});

test('selected session owning a run shows that run without Needs you while another run waits', options, async () => {
  const f = await fixture(true);
  try {
    const mine = await waitingRun(f.h, 'Second owned run', true);
    const ownerSession = mine.session;
    assert.ok(ownerSession, 'the run step should own an agent session');
    await f.h.pipe.request('session.focus', { session_id: ownerSession });
    await f.w.wait(`Boolean(${row(mine.run)}) && document.querySelector('#runbox').innerText.includes('Second owned run step')`);
    assert.equal(await f.w.evaluate(`document.querySelector('#runbox').innerText.includes('Needs you:')`), false);
  } finally { await cleanup(f); }
});

test('selected session with no run falls back to the newest needs-you run', options, async () => {
  const f = await fixture(true);
  try {
    await f.w.wait(`Boolean(${row(f.own.run)}) && document.querySelector('#runbox').innerText.includes('Needs you: Owned pipeline')`);
    assert.equal(await f.w.evaluate(`Boolean(${row(f.own.run)})`), true);
  } finally { await cleanup(f); }
});

test('newer of two waiting runs wins', options, async () => {
  const f = await fixture();
  try {
    const newer = await waitingRun(f.h, 'Newer run');
    await f.w.wait(`Boolean(${row(newer.run)}) && document.querySelector('#runbox').innerText.includes('Needs you: Newer run')`);
    assert.equal(await f.w.evaluate(`${row(f.own.run)} === null`), true);
  } finally { await cleanup(f); }
});

test('failed run with unresolved unread run-failed item shows in runbox', options, async () => {
  const f = await fixture();
  try {
    f.h.db.prepare("UPDATE gate SET status='approved' WHERE run_id=?").run(f.own.run);
    f.h.db.prepare("UPDATE run SET status='failed' WHERE id=?").run(f.own.run);
    insertFailedItem(f.h, f.own.run, 'failed-unread');
    await f.w.wait(`Boolean(${row(f.own.run)}) && document.querySelector('#runbox').innerText.includes('Needs you: Owned pipeline')`);
  } finally { await cleanup(f); }
});

test('resolved run-failed item does not show its failed run', options, async () => {
  const f = await fixture();
  try {
    f.h.db.prepare("UPDATE gate SET status='approved' WHERE run_id=?").run(f.own.run);
    f.h.db.prepare("UPDATE run SET status='failed' WHERE id=?").run(f.own.run);
    insertFailedItem(f.h, f.own.run, 'failed-resolved');
    f.h.db.prepare("UPDATE needs_you SET resolved_at=? WHERE id='failed-resolved'").run(new Date().toISOString());
    await sleep(700);
    assert.equal(await f.w.evaluate(`${row(f.own.run)} === null`), true);
  } finally { await cleanup(f); }
});

test('read run-failed item does not show its failed run', options, async () => {
  const f = await fixture();
  try {
    f.h.db.prepare("UPDATE gate SET status='approved' WHERE run_id=?").run(f.own.run);
    f.h.db.prepare("UPDATE run SET status='failed' WHERE id=?").run(f.own.run);
    insertFailedItem(f.h, f.own.run, 'failed-read');
    f.h.db.prepare("UPDATE needs_you SET read_at=? WHERE id='failed-read'").run(new Date().toISOString());
    await sleep(700);
    assert.equal(await f.w.evaluate(`${row(f.own.run)} === null`), true);
  } finally { await cleanup(f); }
});

test('done or cancelled runs never show in runbox', options, async () => {
  const f = await fixture();
  try {
    f.h.db.prepare("UPDATE gate SET status='approved' WHERE run_id=?").run(f.own.run);
    f.h.db.prepare("UPDATE run SET status='done' WHERE id=?").run(f.own.run);
    await sleep(700);
    assert.equal(await f.w.evaluate(`${row(f.own.run)} === null`), true);
    const cancelled = await waitingRun(f.h, 'Cancelled run');
    f.h.db.prepare("UPDATE gate SET status='rejected' WHERE run_id=?").run(cancelled.run);
    f.h.db.prepare("UPDATE run SET status='cancelled' WHERE id=?").run(cancelled.run);
    await sleep(700);
    assert.equal(await f.w.evaluate(`${row(cancelled.run)} === null`), true);
  } finally { await cleanup(f); }
});

test('grid mode shows nothing in runbox', options, async () => {
  const f = await fixture();
  try {
    await f.w.key('g', 'KeyG', 2);
    await f.w.wait('ui.mode === "grid" && document.querySelector("#runbox").innerHTML === ""');
  } finally { await cleanup(f); }
});
