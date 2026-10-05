import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { root, sleep, until } from '../../core/test/helpers.ts';
import { revisionHarness } from '../../core/test/ui-revision-helpers.ts';

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
    if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(wb.pid), '/T', '/F'], { stdio: 'ignore' });
    else try { process.kill(-wb.pid, 'SIGKILL'); } catch {}
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
    const key = async (key: string, code: string, modifiers?: number) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
    };
    const wait = async (expression: string, timeout = 20000) => until(() => evaluate(expression), timeout);
    await wait('typeof ui !== "undefined" && ui.snap && ui.snap.core.online');
    return { evaluate, click, key, wait, async close() { ws?.send(JSON.stringify({ id: ++seq, method: 'Browser.close' })); await sleep(300); ws?.close(); await stop(); } };
  } catch (e) { ws?.close(); await stop(); throw e; }
}

async function pausedRun(h: Awaited<ReturnType<typeof revisionHarness>>) {
  const def = JSON.parse(readFileSync(join(root, 'pipelines/spec-to-pr.json'), 'utf8'));
  for (const s of def.steps) if (s.kind === 'agent') {
    s.engine = 'fake';
    const directive = s.id === 'spec' ? { outputs: { title: 'Add greet' } }
      : s.id === 'build' ? { files: { 'greet.js': 'export const greet = n => `Hello, ${n}!`;\n' }, commit: 'Add greet', outputs: { summary: 'Adds greet(name).' } } : {};
    s.prompt = `FAKE ${JSON.stringify(directive)}\n${s.prompt}`;
  }
  const run = await h.pipeline(def, { idea: readFileSync(join(h.project, 'idea.md'), 'utf8'), repo: 'fake/repo' });
  const gate = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve-spec' AND status = 'waiting'").get(run), 60000);
  return { run, gate };
}

async function fixture(mode: 'runbox' | 'screen') {
  const h = await revisionHarness('spec-to-pr'); let w;
  try {
    const { run, gate } = await pausedRun(h); w = await windowFor(h);
    await w.click('[data-action="tab"][data-tab="runs"]');
    await w.wait(`document.querySelector(${JSON.stringify(`#runbox [data-action="run-open"][data-id="${run}"]`)})`);
    if (mode === 'screen') {
      await w.click(`#runbox [data-action="run-open"][data-id="${run}"]`);
      await w.wait('document.querySelector("#runscreen") && !document.querySelector("#runscreen").hidden');
    }
    return { h, w, run, gate };
  } catch (e) { await w?.close(); await h.close(); throw e; }
}

async function cleanup(f: Awaited<ReturnType<typeof fixture>>) { await f.w.close(); await f.h.close(); }
const status = (id: string) => `document.querySelector(${JSON.stringify(`#runbox [data-action="run-open"][data-id="${id}"]`)})?.textContent || ''`;
const assertCancelled = async (f: Awaited<ReturnType<typeof fixture>>) => {
  await until(() => f.h.db.prepare('SELECT status FROM run WHERE id = ?').get(f.run)?.status === 'cancelled', 10000);
  await until(() => f.h.db.prepare('SELECT status FROM gate WHERE id = ?').get(f.gate.id)?.status === 'rejected', 10000);
};

test('runbox Cancel arms without cancelling the paused run', options, async () => {
  const f = await fixture('runbox');
  try {
    await f.w.click('#runbox [data-action="cancel-run"]');
    await f.w.wait('document.querySelector("#runbox [data-action=cancel-run]")?.textContent === "Confirm cancel"');
    await sleep(1000);
    assert.notEqual(f.h.db.prepare('SELECT status FROM run WHERE id = ?').get(f.run)?.status, 'cancelled');
    assert.equal(f.h.db.prepare('SELECT status FROM gate WHERE id = ?').get(f.gate.id)?.status, 'waiting');
  } finally { await cleanup(f); }
});

test('runbox Cancel confirms within three seconds and rejects the waiting gate', options, async () => {
  const f = await fixture('runbox');
  try {
    await f.w.click('#runbox [data-action="cancel-run"]');
    await f.w.click('#runbox [data-action="cancel-run"]');
    await assertCancelled(f);
    await f.w.wait('!document.querySelector("#runbox [data-action=cancel-run]")', 10000);
  } finally { await cleanup(f); }
});

test('runbox Cancel arm expires after three seconds', options, async () => {
  const f = await fixture('screen');
  try {
    await f.w.click('#runscreen [data-action="cancel-run"]'); await sleep(3500);
    await f.w.click('#runscreen [data-action="cancel-run"]'); await sleep(1000);
    assert.notEqual(f.h.db.prepare('SELECT status FROM run WHERE id = ?').get(f.run)?.status, 'cancelled');
    assert.equal(f.h.db.prepare('SELECT status FROM gate WHERE id = ?').get(f.gate.id)?.status, 'waiting');
  } finally { await cleanup(f); }
});

test('run screen header Cancel confirms cancellation', options, async () => {
  const f = await fixture('screen');
  try {
    await f.w.click('#runscreen [data-action="cancel-run"]');
    await f.w.click('#runscreen [data-action="cancel-run"]');
    await assertCancelled(f);
    await f.w.wait('!document.querySelector("#runscreen [data-action=cancel-run]")', 10000);
  } finally { await cleanup(f); }
});

test('Ctrl+K Cancel run palette item arms and Enter confirms', options, async () => {
  const f = await fixture('runbox');
  try {
    await f.w.key('k', 'KeyK', 2);
    await f.w.wait('!document.querySelector("#palette").hidden');
    await f.w.wait('document.querySelector("#palette-list")?.textContent.includes("Cancel run:")');
    await f.w.evaluate('(()=>{const input=document.querySelector("#palette-input");input.value="Cancel run";input.dispatchEvent(new Event("input",{bubbles:true}))})()');
    await f.w.key('Enter', 'Enter');
    await f.w.wait('document.querySelector("#palette-input").value.startsWith("Confirm cancel run:")');
    await f.w.key('Enter', 'Enter');
    await assertCancelled(f);
  } finally { await cleanup(f); }
});
