import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { root, sleep, until } from './helpers.ts';
import type { revisionHarness } from './ui-revision-helpers.ts';

/** Drive the real workbench's QA WebContents through its local debugging port. */
export async function qaWindow(h: Awaited<ReturnType<typeof revisionHarness>>, devPort: number) {
  const workbench = join(root, 'workbench');
  const electron = join(workbench, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
  assert.ok(existsSync(electron), 'Electron binary is required with METATROOPER_BROWSER_E2E=1');
  const server = createServer();
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(r => server.close(() => r()));
  const log = join(h.iso.home, 'qa-electron-stderr.log');
  const fd = openSync(log, 'w');
  const args = ['--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, workbench];
  const wb = process.platform === 'linux' && !process.env.DISPLAY
    ? spawn('xvfb-run', ['-a', electron, ...args], { env: h.env, stdio: ['ignore', 'ignore', fd], detached: true })
    : spawn(electron, args, { env: h.env, stdio: ['ignore', 'ignore', fd], windowsHide: true, detached: process.platform !== 'win32' });
  closeSync(fd);
  let ws: WebSocket | undefined;
  const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  const close = async () => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      const closed = new Promise<void>(r => ws!.addEventListener('close', () => r(), { once: true }));
      ws.close();
      await Promise.race([closed, sleep(1000)]);
    }
    for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Electron closed')); }
    pending.clear();
    if (wb.pid && wb.exitCode === null) {
      if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(wb.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      else try { process.kill(-wb.pid, 'SIGKILL'); } catch {}
      if (wb.exitCode === null) wb.kill();
    }
    await sleep(300);
  };
  try {
    const target = await until(async () => {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      return list.find((t: any) => t.type === 'page' && t.url.startsWith(`http://127.0.0.1:${devPort}/`));
    }, 25000);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((r, j) => { ws!.addEventListener('open', () => r(), { once: true }); ws!.addEventListener('error', j, { once: true }); });
    let sequence = 0;
    let loads = 0;
    const errors: string[] = [];
    ws.addEventListener('message', e => {
      const m = JSON.parse(String(e.data));
      if (m.method === 'Page.loadEventFired') loads++;
      const p = pending.get(m.id);
      if (p) { clearTimeout(p.timer); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
      if (m.method === 'Runtime.exceptionThrown' || (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') || (m.method === 'Log.entryAdded' && m.params.entry.level === 'error')) errors.push(JSON.stringify(m.params));
    });
    const send = (method: string, params = {}): Promise<any> => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 10000);
      pending.set(id, { resolve, reject, timer }); ws!.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression: string) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.ok(!r.exceptionDetails, JSON.stringify(r)); return r.result.value;
    };
    await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable'); await send('Page.enable');
    await send('Network.setCacheDisabled', { cacheDisabled: true });
    const reload = async () => {
      const before = loads;
      await send('Page.reload', { ignoreCache: true });
      await until(() => loads > before, 10000);
    };
    return { errors, send, evaluate, reload, close };
  } catch (error) { await close(); throw new Error(`${error}; Electron stderr: ${readFileSync(log, 'utf8')}`); }
}
