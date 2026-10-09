import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, openSync, closeSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { revisionHarness } from '../../core/test/ui-revision-helpers.ts';
import { sleep, until } from '../../core/test/helpers.ts';
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
  const output = openSync(join(h.iso.home, 'electron-stderr.log'), 'w');
  const wb = process.platform === 'linux' && !process.env.DISPLAY
    ? spawn('xvfb-run', ['-a', electron, '--no-sandbox', ...args], { env: h.env, stdio: 'ignore', detached: true })
    : spawn(electron, args, { env: h.env, stdio: ['ignore', 'ignore', output], windowsHide: true, detached: process.platform !== 'win32' });
  const stopWindow = async () => {
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
    let seq = 0; const pending = new Map(); const received: any[] = [];
    ws.addEventListener('message', e => { const m = JSON.parse(String(e.data)); received.push(m); if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
    const send = (method: string, params = {}): Promise<any> => new Promise((resolve, reject) => {
      const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out; CDP ${JSON.stringify(received.slice(-3))}; stderr ${readFileSync(errorLog, 'utf8').slice(-3000)}`)); }, 10000);
      pending.set(id, { resolve, reject, timer }); ws!.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression: string) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value;
    };
    const click = async (selector: string) => {
      const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      assert.ok(point, `missing ${selector}`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const key = async (key: string, code: string, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
    };
    const wait = async (expression: string, timeout = 15000) => {
      try { return await until(() => evaluate(expression), timeout); }
      catch (error) { throw new Error(`${(error as Error).message}; waiting for ${expression}; view: ${await evaluate('document.querySelector("#view")?.innerText')}; toasts: ${await evaluate('document.querySelector("#toasts")?.innerText')}`); }
    };
    await wait('typeof ui !== "undefined" && ui.snap && ui.snap.core.online');
    return { send, evaluate, click, key, wait, async close() {
      ws?.send(JSON.stringify({ id: ++seq, method: 'Browser.close' }));
      await sleep(300);
      ws?.close();
      await stopWindow();
      await sleep(300);
    } };
  } catch (error) {
    ws?.close(); await stopWindow(); throw error;
  }
}

async function withWall(fn: (h: Awaited<ReturnType<typeof revisionHarness>>, w: Awaited<ReturnType<typeof windowFor>>) => Promise<void>) {
  const h = await revisionHarness(); let w: Awaited<ReturnType<typeof windowFor>> | undefined;
  try { w = await windowFor(h); await fn(h, w); }
  finally { await w?.close(); await h.close(); }
}

test('Ctrl+B opens the session list and Ctrl+B closes it', options, async () => withWall(async (_h, w) => {
  await w.key('b', 'KeyB', 2);
  await w.wait('document.querySelector("#listBtn").getAttribute("aria-pressed") === "true" && getComputedStyle(document.querySelector("#list")).visibility === "visible"');
  assert.equal(await w.evaluate('document.querySelector("#listBtn").getAttribute("aria-pressed")'), 'true');
  assert.equal(await w.evaluate('getComputedStyle(document.querySelector("#list")).visibility'), 'visible');
  await w.key('b', 'KeyB', 2);
  await w.wait('document.querySelector("#listBtn").getAttribute("aria-pressed") === "false" && getComputedStyle(document.querySelector("#list")).visibility === "hidden"');
  assert.equal(await w.evaluate('document.querySelector("#listBtn").getAttribute("aria-pressed")'), 'false');
  assert.equal(await w.evaluate('getComputedStyle(document.querySelector("#list")).visibility'), 'hidden');
}));

test('Ctrl+K focuses #palette-input and Enter runs the selected item', options, async () => withWall(async (_h, w) => {
  await w.key('k', 'KeyK', 2);
  await w.wait('document.activeElement === document.querySelector("#palette-input")');
  assert.equal(await w.evaluate('document.activeElement.id'), 'palette-input');
  const label = await w.evaluate('ui.paletteItems[ui.paletteAt]?.label');
  await w.key('Enter', 'Enter');
  await w.wait('document.querySelector("#palette").hidden');
  assert.ok(label);
  assert.equal(await w.evaluate('document.querySelector("#palette").hidden'), true);
}));

test('waiting sessions get attn and the NEEDS YOU count matches the fixture', options, async () => withWall(async (h, w) => {
  const session = await h.launch();
  h.db.prepare("UPDATE session SET state = 'waiting_for_you' WHERE id = ?").run(session.session_id);
  const expected = h.db.prepare("SELECT (SELECT COUNT(*) FROM gate WHERE status = 'waiting') + (SELECT COUNT(*) FROM session WHERE state = 'waiting_for_you') + (SELECT COUNT(*) FROM needs_you WHERE read_at IS NULL AND kind NOT IN ('gate', 'handoff')) AS n").get().n;
  const waiting = h.db.prepare("SELECT COUNT(*) AS n FROM session WHERE state = 'waiting_for_you'").get().n;
  await w.wait(`document.querySelectorAll('#centre .tile.attn').length === ${waiting}`);
  assert.equal(await w.evaluate("document.querySelectorAll('#centre .tile.attn').length"), waiting);
  await w.wait(`Number(document.querySelector('#needsN').lastElementChild.textContent) === ${expected}`);
  assert.equal(await w.evaluate("Number(document.querySelector('#needsN').lastElementChild.textContent)"), expected);
}));

test('a done session folds to a 36px bar', options, async () => withWall(async (h, w) => {
  await h.launch();
  await h.launch();
  await w.wait("document.querySelectorAll('#centre .tile').length >= 2");
  const id = await w.evaluate("[...document.querySelectorAll('#centre .tile')].map(e => e.dataset.id).find(id => !wall.isBig(id))");
  assert.ok(id);
  h.db.prepare("UPDATE session SET state = 'done' WHERE id = ?").run(id);
  await w.wait(`wall.isFolded("${id}") && document.querySelector('#centre .tile[data-id="${id}"]').classList.contains('fold')`);
  const heightExpr = `document.querySelector('#centre .tile[data-id="${id}"]').getBoundingClientRect().height`;
  await w.wait(`${heightExpr} === 36`);
  const height = await w.evaluate(heightExpr);
  assert.equal(height, 36);
}));

test('Approve from the gate sheet records approval and displays the verdict stamp', options, async () => withWall(async (h, w) => {
  const def = {
    schema: 1, id: 'wall-gate', title: 'Wall gate', lane: 'coding', requires: [], inputs: {},
    steps: [{ id: 'approve', title: 'Approve wall action', kind: 'gate', gate: 'approve', gate_summary: 'Approve the wall test action.' }],
  };
  const runId = await h.pipeline(def);
  const gate = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND status = 'waiting'").get(runId), 15000);
  assert.ok(gate);
  await w.click('#sheet-tab');
  await w.wait('!document.querySelector("#sheet").classList.contains("closed")');
  const approve = `[data-action="gate"][data-id="${gate.id}"][data-decision="approve"]`;
  await w.wait(`document.querySelector(${JSON.stringify(approve)})`);
  await w.click(approve);
  await until(() => h.db.prepare('SELECT status FROM gate WHERE id = ?').get(gate.id)?.status === 'approved', 15000);
  await w.wait(`document.querySelector('.gate[data-g="${gate.id}"] .verdict.ok')?.textContent.includes('Approved')`);
  assert.equal(h.db.prepare('SELECT status FROM gate WHERE id = ?').get(gate.id).status, 'approved');
  assert.match(await w.evaluate(`document.querySelector('.gate[data-g="${gate.id}"] .verdict.ok')?.textContent`), /Approved/);
}));

test('default theme is dither and search switches to persistent charcoal settings', options, async () => withWall(async (h, w) => {
  assert.equal(await w.evaluate('document.documentElement.dataset.look'), 'dither');
  await w.key('k', 'KeyK', 2);
  await w.evaluate(`(()=>{const i=document.querySelector('#palette-input');i.value='charcoal';i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
  await w.wait('ui.paletteItems.some(x => x.label.toLowerCase().includes("charcoal"))');
  await w.key('Enter', 'Enter');
  await w.wait('document.documentElement.dataset.look === "charcoal"');
  const settingsPath = join(h.iso.home, 'settings.json');
  await until(() => { try { return JSON.parse(readFileSync(settingsPath, 'utf8')).ui.theme === 'charcoal'; } catch { return false; } }, 10000);
  assert.equal(JSON.parse(readFileSync(settingsPath, 'utf8')).ui.theme, 'charcoal');
}));
