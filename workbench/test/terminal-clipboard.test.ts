import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { revisionHarness, terminalViewer } from '../../core/test/ui-revision-helpers.ts';
import { sleep, until } from '../../core/test/helpers.ts';

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
    const mouse = async (type: string, x: number, y: number, button = 'left') => {
      await send('Input.dispatchMouseEvent', { type, x, y, button, ...(type === 'mousePressed' || type === 'mouseReleased' ? { clickCount: 1 } : {}), ...(type === 'mousePressed' || type === 'mouseMoved' ? { buttons: 1 } : {}) });
    };
    const click = async (selector: string) => {
      const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      assert.ok(point, `missing ${selector}`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const key = async (key: string, code: string, modifiers = 0) => {
      const virtualKeyCode = code === 'KeyC' ? 67 : undefined;
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers, windowsVirtualKeyCode: virtualKeyCode, nativeVirtualKeyCode: virtualKeyCode });
    };
    const wait = async (expression: string, timeout = 20000) => until(() => evaluate(expression), timeout);
    await wait('typeof ui !== "undefined" && ui.snap && ui.snap.core.online');
    return { evaluate, click, key, mouse, wait, async close() { ws?.send(JSON.stringify({ id: ++seq, method: 'Browser.close' })); await sleep(300); ws?.close(); await stop(); } };
  } catch (e) { ws?.close(); await stop(); throw e; }
}

async function fixture() {
  const fakeEngine = `if (process.stdin.setRawMode) process.stdin.setRawMode(true); process.stdin.resume(); process.stdout.write('clipboard sample\\r\\n'); process.stdin.on('data', data => process.stdout.write('INPUTHEX:' + [...data].map(x => x.toString(16).padStart(2, '0')).join('') + '\\r\\n'));`;
  const h = await revisionHarness(undefined, fakeEngine);
  let w: Awaited<ReturnType<typeof windowFor>> | undefined;
  let viewer: Awaited<ReturnType<typeof terminalViewer>> | undefined;
  try {
    const session = await h.launch('fake');
    w = await windowFor(h);
    const saved = await w.evaluate('troop.readText()');
    await w.wait(`Boolean(document.querySelector('.tile[data-id="${session.session_id}"]'))`, 30000);
    await w.wait(`termView.state()?.session === ${JSON.stringify(session.session_id)} && termView.state().attach_ms !== null`, 30000);
    viewer = await terminalViewer(h.iso.prefix, h.iso.home, session.session_id, false);
    return { h, w, pane: String(session.session_id), viewer, savedClipboard: saved };
  } catch (error) {
    viewer?.socket.destroy();
    try { await w?.close(); } finally { await h.close(); }
    throw error;
  }
}

async function engineHas(f: Awaited<ReturnType<typeof fixture>>, text: string) {
  return until(async () => {
    return f.viewer.messages.filter(message => message.op === 'output' || message.op === 'snapshot').map(message => String(message.data)).join('').includes(text);
  }, 10000, `engine did not receive ${JSON.stringify(text)}`);
}

async function prepareTerminal(f: Awaited<ReturnType<typeof fixture>>) {
  await f.w.wait('document.querySelector(".tile .xterm-screen")', 10000);
}

async function selectSample(f: Awaited<ReturnType<typeof fixture>>) {
  const point = await f.w.evaluate(`(()=>{const screen=document.querySelector('.tile .xterm-screen');if(!screen)return null;const r=screen.getBoundingClientRect();return{x:r.x+2,y:r.y+8}})()`);
  assert.ok(point, 'terminal screen should be visible');
  await f.w.mouse('mousePressed', point.x, point.y);
  await f.w.mouse('mouseMoved', point.x + 150, point.y);
  await f.w.mouse('mouseReleased', point.x + 150, point.y);
}

async function cleanup(f: Awaited<ReturnType<typeof fixture>>) {
  f.viewer.socket.destroy();
  try { await f.w.evaluate('troop.copyText(' + JSON.stringify(f.savedClipboard ?? '') + ')'); }
  finally { try { await f.w.close(); } finally { await f.h.close(); } }
}

test('selecting terminal text copies it immediately and keeps the selection', options, async () => {
  const f = await fixture();
  try {
    await prepareTerminal(f);
    await f.w.evaluate("window.troop.copyText('clipboard sentinel A')");
    await selectSample(f);
    await until(async () => (await f.w.evaluate('window.troop.readText()')) !== 'clipboard sentinel A', 10000);
    assert.equal(await f.w.evaluate('window.troop.readText()'), 'clipboard sample');
    assert.ok(await f.w.evaluate("document.querySelectorAll('.tile .xterm-selection div').length") > 0);
  } finally { await cleanup(f); }
});

test('Ctrl+C with no selection sends ETX to the engine', options, async () => {
  const f = await fixture();
  try {
    await prepareTerminal(f);
    await engineHas(f, 'clipboard sample');
    await f.w.click('.tile .xterm-screen');
    await f.w.wait("document.activeElement?.classList.contains('xterm-helper-textarea')", 10000);
    await f.w.key('c', 'KeyC', 2);
    await engineHas(f, 'INPUTHEX:03');
  } finally { await cleanup(f); }
});

test('Ctrl+C with a selection copies without sending ETX to the engine', options, async () => {
  const f = await fixture();
  try {
    await prepareTerminal(f);
    await f.w.evaluate("window.troop.copyText('clipboard sentinel B')");
    await selectSample(f);
    await f.w.key('c', 'KeyC', 2);
    await until(async () => (await f.w.evaluate('window.troop.readText()')) !== 'clipboard sentinel B', 10000);
    assert.equal(await f.w.evaluate('window.troop.readText()'), 'clipboard sample');
    assert.equal(f.viewer.messages.some(message => message.op === 'output' && String(message.data).includes('INPUTHEX:03')), false, 'copy shortcut must not send Ctrl+C to the pty');
  } finally { await cleanup(f); }
});

test('Ctrl+Shift+C with a selection copies without sending ETX to the engine', options, async () => {
  const f = await fixture();
  try {
    await prepareTerminal(f);
    await f.w.evaluate("window.troop.copyText('clipboard sentinel C')");
    await selectSample(f);
    await f.w.key('C', 'KeyC', 10);
    await until(async () => (await f.w.evaluate('window.troop.readText()')) !== 'clipboard sentinel C', 10000);
    assert.equal(await f.w.evaluate('window.troop.readText()'), 'clipboard sample');
    assert.equal(f.viewer.messages.some(message => message.op === 'output' && String(message.data).includes('INPUTHEX:03')), false, 'copy shortcut must not send Ctrl+C to the pty');
  } finally { await cleanup(f); }
});

test('right-click pastes clipboard text into the terminal', options, async () => {
  const f = await fixture();
  try {
    await prepareTerminal(f);
    await f.w.evaluate("window.troop.copyText('clipboard paste payload')");
    await f.w.evaluate(`document.querySelector('.tile .tile-body').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))`);
    await engineHas(f, Buffer.from('clipboard paste payload').toString('hex'));
  } finally { await cleanup(f); }
});

test('right-click with a selection still pastes clipboard text', options, async () => {
  const f = await fixture();
  try {
    await prepareTerminal(f);
    await selectSample(f);
    await f.w.evaluate(`document.querySelector('.tile .tile-body').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))`);
    await engineHas(f, Buffer.from('clipboard sample').toString('hex'));
  } finally { await cleanup(f); }
});
