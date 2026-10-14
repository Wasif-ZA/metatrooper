import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { buildGenerated, client, isolation, sleep, startCore, teardownCore, until } from '../../core/test/helpers.ts';
import { killTree } from '../../tests/helpers/kill-tree.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const xvfb = process.platform === 'linux' && spawnSync('which', ['xvfb-run']).status === 0;
const runnable = existsSync(electron) && (process.platform !== 'linux' || xvfb || Boolean(process.env.DISPLAY));

const freePort = () => new Promise<number>((done) => { const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address() as { port: number }; s.close(() => done(port)); }); });

/** One Chrome DevTools Protocol session on the workbench page. */
async function devtools(port: number) {
  const pages = await until(async () => {
    try { return ((await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl: string }>).find((p) => p.type === 'page' && p.url.includes('index.html')); } catch { return undefined; }
  }, 30_000);
  const ws = new WebSocket(pages.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let seq = 0;
  const waiting = new Map<number, (v: any) => void>();
  ws.onmessage = (m) => { const msg = JSON.parse(String(m.data)); waiting.get(msg.id)?.(msg); waiting.delete(msg.id); };
  const send = (method: string, params: object = {}) => new Promise<any>((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async (expression: string) => (await send('Runtime.evaluate', { expression, returnByValue: true })).result?.result?.value;
  const key = async (k: { key: string; code: string; vk: number; modifiers?: number; text?: string }) => {
    for (const type of ['rawKeyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k.key, code: k.code, windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk, modifiers: k.modifiers ?? 0 });
  };
  return { evaluate, key, close: () => ws.close() };
}

test('M6-26e the window has no application menu; Alt and Ctrl+R leave the renderer focused and loaded', { skip: !runnable && 'needs the Electron binary and a display (xvfb-run on Linux)', timeout: 120_000 }, async () => {
  // protects=the Windows menu bar: Menu.getApplicationMenu() is null after start
  // fails_when=Menu.setApplicationMenu(null) is dropped, or the renderer itself moves focus on Alt or reloads on Ctrl+R
  // no_claim=the OS menu bar's own Alt and Ctrl+R handling: DevTools key events never reach it, so this passes with the default menu too; nor that Ctrl+R's bytes reach the pty
  await buildGenerated();
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{ id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 1, version_cmd: [process.execPath, '--version'] }]));
  const probeFile = join(iso.home, 'probe.jsonl');
  const env = { ...iso.env, METATROOPER_ENGINES: registry, METATROOPER_WORKBENCH_PROBE: probeFile };
  const core = await startCore({ ...iso, env });
  const port = await freePort();
  const args = [`--remote-debugging-port=${port}`, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), workbench];
  const wb = process.platform === 'linux' && !process.env.DISPLAY
    ? spawn('xvfb-run', ['-a', '-s', '-screen 0 1400x900x24', electron, ...args], { env, stdio: 'ignore', detached: true })
    : spawn(electron, args, { env, stdio: 'ignore', detached: process.platform !== 'win32' });
  let dt: Awaited<ReturnType<typeof devtools>> | null = null;
  try {
    const project = join(iso.home, 'project');
    mkdirSync(project);
    const pipe = await client(iso.prefix);
    const opened = await pipe.request('project.open', { path: project });
    const launched = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id: 'fake', prompt: join(workbench, 'test', 'fixtures', 'long-engine.js') });
    pipe.close();
    const id = launched.result.session_id as string;
    const probes = () => (existsSync(probeFile) ? readFileSync(probeFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
    const first = await until(() => probes().find((p) => p.state.sessions.some((x: { id: string }) => x.id === id)), 30_000);
    assert.equal(first.app_menu, false, 'Menu.getApplicationMenu() is null');
    assert.equal(first.loads, 1);

    dt = await devtools(port);
    const textarea = `document.querySelector('.tile[data-id="${id}"] .xterm-helper-textarea')`;
    await until(async () => Boolean(await dt!.evaluate(`Boolean(${textarea})`)), 15_000);
    await dt.evaluate(`window.__m626 = 1; ${textarea}.focus(); true`);
    assert.equal(await dt.evaluate(`document.activeElement === ${textarea}`), true);

    await dt.key({ key: 'Alt', code: 'AltLeft', vk: 18, modifiers: 1 });
    await sleep(300);
    assert.equal(await dt.evaluate(`document.activeElement === ${textarea}`), true, 'a bare Alt leaves focus in the tile');

    await dt.key({ key: 'r', code: 'KeyR', vk: 82, modifiers: 2 });
    await sleep(1500);
    assert.equal(await dt.evaluate('window.__m626'), 1, 'Ctrl+R did not reload the renderer');
    const last = probes().at(-1);
    assert.equal(last.loads, 1);
  } finally {
    dt?.close();
    if (wb.pid) killTree(wb.pid);
    await teardownCore(core, iso);
  }
});
