import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, openSync, closeSync, cpSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sleep, until } from '../../core/test/helpers.ts';
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
  closeSync(output);
  const stop = async () => {
    if (!wb.pid) return;
    killTree(wb.pid);
    if (wb.exitCode === null) wb.kill();
    await Promise.race([new Promise<void>(r => wb.once('exit', () => r())), sleep(3000)]);
  };
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
    const send = (method: string, params = {}) => new Promise<any>((r, j) => {
      const id = ++seq; const timer = setTimeout(() => { pending.delete(id); j(new Error(`CDP timeout: ${method}`)); }, 10000);
      pending.set(id, { resolve: r, reject: j, timer }); ws!.send(JSON.stringify({ id, method, params }));
    });
    await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    const evaluate = async (expression: string) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 600));
      return r.result.value;
    };
    const wait = (expression: string, timeout = 30000) => until(() => evaluate(expression), timeout);
    const key = async (k: string, code: string) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code });
    };
    const click = async (selector: string) => evaluate(`document.querySelector(${JSON.stringify(selector)})?.click()`);
    await wait('typeof ui !== "undefined" && ui.snap && ui.snap.core.online');
    return { evaluate, wait, key, click, close: async () => { ws?.close(); await stop(); } };
  } catch (error) {
    ws?.close(); await stop(); throw error;
  }
}

type Window = Awaited<ReturnType<typeof windowFor>>;

async function withReview(fn: (h: Awaited<ReturnType<typeof revisionHarness>>, w: Window, run: string) => Promise<void>, calm: boolean) {
  const h = await revisionHarness(); let w: Window | undefined;
  try {
    writeFileSync(join(h.project, 'index.js'), 'export function greet(name) {\n  const n = name || process.env.DEFAULT_NAME;\n  return `Hello, ${n}!`;\n}\n');
    cpSync(join(resolve(workbench, '..'), 'pipelines/two-engine-review'), join(h.project, '.troop/pipelines/two-engine-review'), { recursive: true });
    const def = JSON.parse(readFileSync(join(resolve(workbench, '..'), 'pipelines/two-engine-review.json'), 'utf8'));
    def.requires = [];
    const directive = (verdict: string, findings: unknown[], delay: number) => `FAKE ${JSON.stringify({ delay_ms: delay, outputs: { verdict, findings: JSON.stringify(findings) } })}\n`;
    const finding = (file: string, a: number, b: number, severity: string, title: string, body: string) => ({ file, line_start: a, line_end: b, severity, title, body });
    const codex = calm
      ? directive('approve', [finding('index.js', 2, 2, 'low', 'Fallback is implicit', 'Document the fallback.')], 7000)
      : directive('reject', [finding('index.js', 2, 2, 'high', 'Fallback is unchecked', 'Check the environment fallback.'), finding('test.js', 1, 1, 'medium', 'Missing test', 'Add a test for greet.')], 7000);
    const gemini = calm
      ? directive('approve', [finding('test.js', 1, 1, 'low', 'Test could be clearer', 'Name the test after the behavior.')], 5000)
      : directive('approve', [finding('index.js', 2, 2, 'medium', 'Fallback is intended', 'This is expected configuration.'), finding('index.js', 4, 4, 'critical', 'Secret exposed', 'A live secret is committed.')], 5000);
    for (const step of def.steps) if (step.kind === 'agent') {
      step.engine = 'fake'; step.prompt = (step.id === 'codex-review' ? codex : gemini) + step.prompt;
    }
    w = await windowFor(h);
    const run = await h.pipeline(def, {});
    await fn(h, w, run);
  } finally { await w?.close(); await h.close(); }
}

test('a disagree and critical result auto-opens once, Escape folds it, and the hot bar stays folded', options, async () => {
  await withReview(async (h, w, run) => {
    await w.wait(`!!document.querySelector('#runbars .rbar[data-run="${run}"]')`);
    await until(() => ['done', 'failed'].includes(h.db.prepare('SELECT status FROM run WHERE id = ?').get(run).status), 60000);
    await w.wait('runScreen.isOpen() && runScreen.layout() === "duel"', 15000);
    await w.key('Escape', 'Escape');
    await w.wait('!runScreen.isOpen()');
    assert.equal(await w.evaluate(`document.querySelector('#runbars .rbar[data-run="${run}"]')?.classList.contains('halo')`), true);
    await sleep(2200);
    assert.equal(await w.evaluate('runScreen.isOpen()'), false, 'the same need must not auto-open again after folding');
    assert.equal(await w.evaluate(`document.querySelector('#runbars .rbar[data-run="${run}"]')?.classList.contains('halo')`), true);
  }, false);
});

test('a clean run stays folded with a quiet bar; Enter opens inline and key presses suppress auto-open for two seconds', options, async () => {
  await withReview(async (h, w, run) => {
    await w.wait(`!!document.querySelector('#runbars .rbar[data-run="${run}"]')`);
    await until(() => ['done', 'failed'].includes(h.db.prepare('SELECT status FROM run WHERE id = ?').get(run).status), 60000);
    await w.wait(`document.querySelector('#runbars .rbar[data-run="${run}"] .fl')?.textContent.includes('nothing needs you')`, 15000);
    await sleep(2200);
    assert.equal(await w.evaluate('runScreen.isOpen()'), false, 'clean results must not auto-open');
    assert.equal(await w.evaluate(`document.querySelector('#runbars .rbar[data-run="${run}"]')?.classList.contains('hot')`), false);
    await w.key('Enter', 'Enter');
    await w.wait('runScreen.isOpen() && runScreen.layout() === "pr-inline"');
    await w.key('Escape', 'Escape');
    await w.wait('!runScreen.isOpen()');
    await w.key('x', 'KeyX');
    await sleep(2100);
    assert.equal(await w.evaluate('runScreen.isOpen()'), false, 'the key press must not cause an automatic open during the two-second quiet window');
  }, true);
});
