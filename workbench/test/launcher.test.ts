import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, openSync, closeSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { client, sleep, until } from '../../core/test/helpers.ts';
import { git, revisionHarness } from '../../core/test/ui-revision-helpers.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const enabled = process.env.METATROOPER_UI_REVISION_E2E === '1';
const runnable = existsSync(electron) && (process.platform !== 'linux' || Boolean(process.env.DISPLAY) || spawnSync('which', ['xvfb-run']).status === 0);
const options = { skip: (!enabled && 'set METATROOPER_UI_REVISION_E2E=1 for real Electron tests') || (!runnable && 'needs Electron and a display (xvfb-run on Linux)'), timeout: 150000 };

async function windowFor(h: Awaited<ReturnType<typeof revisionHarness>>, folder?: string) {
  assert.ok(existsSync(electron), 'Electron binary is required');
  const server = createServer(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port; await new Promise<void>(r => server.close(() => r()));
  const args = ['--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, workbench, ...(folder ? [folder] : [])];
  const errorLog = join(h.iso.home, 'launcher-electron-stderr.log');
  const output = openSync(errorLog, 'w');
  const wb = process.platform === 'linux' && !process.env.DISPLAY
    ? spawn('xvfb-run', ['-a', electron, ...args], { env: h.env, stdio: 'ignore', detached: true })
    : spawn(electron, args, { env: h.env, stdio: ['ignore', 'ignore', output], windowsHide: true, detached: process.platform !== 'win32' });
  const stopWindow = async () => {
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
      const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 10000);
      pending.set(id, { resolve, reject, timer }); ws!.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression: string) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value;
    };
    const key = async (key: string, code: string, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
    };
    const wait = async (expression: string, timeout = 15000) => until(() => evaluate(expression), timeout);
    await wait('typeof ui !== "undefined" && ui.snap && ui.snap.core.online');
    return { evaluate, key, send, wait, async close() {
      ws?.send(JSON.stringify({ id: ++seq, method: 'Browser.close' })); await sleep(300); ws?.close(); await stopWindow(); await sleep(300);
    } };
  } catch (e) { ws?.close(); await stopWindow(); throw e; }
}

async function coreAnswers(h: Awaited<ReturnType<typeof revisionHarness>>, timeout = 15000): Promise<boolean> {
  try {
    return Boolean(await until(async () => {
      const pipe = await client(h.iso.prefix);
      try { return (await pipe.request('core.ping', {}, { timeout: 1000 })).result?.ok === true; }
      finally { pipe.close(); }
    }, timeout));
  } catch { return false; }
}

async function stopPid(pid: number): Promise<void> {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  else try { process.kill(pid, 'SIGTERM'); } catch {}
  await sleep(250);
  if (process.platform !== 'win32') try { process.kill(pid, 'SIGKILL'); } catch {}
}

function corePid(h: Awaited<ReturnType<typeof revisionHarness>>): number | undefined {
  const pid = Number(h.db.prepare("SELECT value FROM meta WHERE key = 'core_pid'").get()?.value);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

test('launcher starts an isolated core, removes CLAUDECODE, and closes its own idle core', options, async () => {
  const h = await revisionHarness(); let w;
  let launchedPid: number | undefined;
  const oldClaudeCode = process.env.CLAUDECODE;
  try {
    process.env.CLAUDECODE = '1';
    h.env.CLAUDECODE = '1';
    const harnessPid = corePid(h);
    // The harness core is deliberately stopped so only the window can satisfy this pipe check.
    await h.core.kill();
    w = await windowFor(h);
    assert.equal(await coreAnswers(h, 15000), true, 'window starts a core that answers the core pipe');
    launchedPid = await until(() => {
      const pid = corePid(h);
      return pid !== undefined && pid !== harnessPid ? pid : undefined;
    }, 15000);
    if (process.platform === 'linux' && existsSync(`/proc/${launchedPid}/environ`)) {
      const environ = readFileSync(`/proc/${launchedPid}/environ`);
      assert.equal(environ.includes(Buffer.from('CLAUDECODE=')), false, 'spawned core does not inherit CLAUDECODE');
    }
    await w.close(); w = undefined;
    await until(async () => !(await coreAnswers(h, 500)), 15000);
  } finally {
    if (oldClaudeCode === undefined) delete process.env.CLAUDECODE; else process.env.CLAUDECODE = oldClaudeCode;
    await w?.close();
    if (launchedPid !== undefined) await stopPid(launchedPid);
    await h.close();
  }
});

test('launcher leaves a harness-started core running when the window closes', options, async () => {
  const h = await revisionHarness(); let w;
  try {
    w = await windowFor(h);
    await w.close(); w = undefined;
    assert.equal(await coreAnswers(h), true, 'core pipe still answers after window close');
  } finally { await w?.close(); await h.close(); }
});

test('launcher selects the folder passed as a window argument', options, async () => {
  const h = await revisionHarness(); let w;
  const folder = join(h.iso.home, 'argument-project');
  try {
    mkdirSync(folder); git(folder, 'init', '-q', '-b', 'main');
    git(folder, 'config', 'user.email', 'fixture@example.com'); git(folder, 'config', 'user.name', 'fixture');
    git(folder, 'commit', '--allow-empty', '-qm', 'fixture');
    w = await windowFor(h, folder);
    const projectId = await until(async () => {
      const pipe = await client(h.iso.prefix);
      try { return (await pipe.request('project.open', { path: folder })).result?.project_id; }
      finally { pipe.close(); }
    });
    await w.wait(`ui.projectId === ${JSON.stringify(projectId)}`);
    assert.equal(await w.evaluate('ui.projectId'), projectId);
  } finally { await w?.close(); await h.close(); }
});

test('launcher core palette lists restart and stop commands; Stop core stops the pipe', options, async () => {
  const h = await revisionHarness(); let w;
  try {
    w = await windowFor(h);
    await w.key('k', 'KeyK', 2);
    await w.wait('!document.querySelector("#palette").hidden');
    const labels = await w.evaluate('[...document.querySelectorAll("#palette-list [data-palette]")].map(e=>e.textContent)');
    assert.ok(labels.some((label: string) => label.startsWith('Restart core')));
    assert.ok(labels.some((label: string) => label.startsWith('Stop core')));
    await w.send('Input.insertText', { text: 'Stop core' });
    await w.key('Enter', 'Enter');
    await until(async () => !(await coreAnswers(h, 500)), 15000);
  } finally {
    await w?.close();
    const pid = corePid(h);
    if (pid !== undefined && pid !== h.core.pid) await stopPid(pid);
    await h.close();
  }
});
