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
    const key = async (key: string, code: string) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
    };
    const wait = async (expression: string, timeout = 20000) => until(() => evaluate(expression), timeout);
    await wait('typeof ui !== "undefined" && ui.snap && ui.snap.core.online');
    return { evaluate, click, key, wait, async close() { ws?.send(JSON.stringify({ id: ++seq, method: 'Browser.close' })); await sleep(300); ws?.close(); await stop(); } };
  } catch (e) { ws?.close(); await stop(); throw e; }
}

async function specRun(h: Awaited<ReturnType<typeof revisionHarness>>, failed = false) {
  const def = JSON.parse(readFileSync(join(root, 'pipelines/spec-to-pr.json'), 'utf8'));
  for (const s of def.steps) if (s.kind === 'agent') {
    s.engine = 'fake';
    const directive = s.id === 'spec' ? { outputs: { title: 'Add greet' } } : s.id === 'build'
      ? failed ? { status: 'failed', outputs: { error: 'revision build exploded' } } : { files: { 'greet.js': 'export const greet = n => `Hello, ${n}!`;\n' }, commit: 'Add greet', outputs: { summary: 'Adds greet(name).' } } : {};
    s.prompt = `FAKE ${JSON.stringify(directive)}\n${s.prompt}`;
  }
  const run = await h.pipeline(def, { idea: readFileSync(join(h.project, 'idea.md'), 'utf8'), repo: 'fake/repo' });
  const gate = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve-spec' AND status = 'waiting'").get(run), 60000);
  assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined })).result, {});
  return run;
}

test('runbox run-open row opens the spec-to-pr run screen and approve-pr uses pr-first to approve the gate', options, async () => {
  const h = await revisionHarness('spec-to-pr'); let w;
  try {
    const run = await specRun(h);
    const gate = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve-pr' AND status = 'waiting'").get(run), 60000);
    const session = h.db.prepare("SELECT session_id FROM run_step WHERE run_id = ? AND session_id IS NOT NULL ORDER BY started_at DESC LIMIT 1").get(run).session_id;
    w = await windowFor(h); await w.click('[data-action="tab"][data-tab="runs"]');
    await w.wait(`document.querySelector('#runbox [data-action="run-open"][data-id=${JSON.stringify(run)}]')`);
    await w.click(`#runbox [data-action="run-open"][data-id="${run}"]`);
    await w.wait('document.querySelector("#runscreen .rsv.L-pr-first") && getComputedStyle(document.querySelector("#runscreen")).display !== "none"');
    assert.equal(await w.evaluate('runScreen.layout()'), 'pr-first');
    await w.click('#runscreen .gin [data-action="gate"][data-decision="approve"]');
    await until(() => h.db.prepare('SELECT status FROM gate WHERE id = ?').get(gate.id).status !== 'waiting', 10000);
    assert.equal(h.db.prepare('SELECT status FROM gate WHERE id = ?').get(gate.id).status, 'approved');
    void session;
  } finally { await w?.close(); await h.close(); }
});

test('failed build opens on run-log and shows the error, numeric keys switch layouts, 0 restores auto, Esc returns to wall', options, async () => {
  const h = await revisionHarness('spec-to-pr'); let w;
  try {
    const run = await specRun(h, true);
    await until(() => h.db.prepare("SELECT 1 FROM run_step WHERE run_id = ? AND step_id = 'build' AND status = 'failed'").get(run), 60000);
    const runDir = h.db.prepare('SELECT run_dir FROM run WHERE id = ?').get(run).run_dir as string;
    const event = await until(() => readFileSync(join(runDir, 'log.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(e => e.event === 'step failed' && e.step === 'build').at(-1), 10000);
    const session = h.db.prepare("SELECT session_id FROM run_step WHERE run_id = ? AND step_id = 'build'").get(run).session_id;
    w = await windowFor(h); await w.click('[data-action="tab"][data-tab="runs"]');
    await w.wait(`document.querySelector(${JSON.stringify(`#runbox [data-action="run-open"][data-id="${run}"]`)})`); await w.click(`#runbox [data-action="run-open"][data-id="${run}"]`);
    await w.wait('document.querySelector("#runscreen .rsv.L-run-log") && document.querySelector("#runscreen .rsv").getBoundingClientRect().width > 0');
    assert.ok((await w.evaluate('document.querySelector("#runscreen .rsv").innerText')).includes(event.why));
    const names = ['run-log', 'artifact-columns', 'pr-first', 'pipe', 'agent-split'];
    for (let i = 1; i <= 5; i++) {
      await w.key(String(i), `Digit${i}`);
      await w.wait(`document.querySelector("#runscreen .rsv.L-${names[i - 1]}") && document.querySelector("#runscreen [data-rs=layout][data-l=${names[i - 1]}]").classList.contains("hand")`);
      await w.wait('!document.querySelector("#runscreen .rs-ghost")');
      const width = await w.evaluate(`document.querySelector("#runscreen .rsv.L-${names[i - 1]}").getBoundingClientRect().width`);
      assert.ok(width > 0, `${names[i - 1]} has settled geometry`);
    }
    await w.key('0', 'Digit0');
    await w.wait('document.querySelector("#runscreen [data-rs=auto]").classList.contains("on") && document.querySelector("#runscreen .rsv.L-run-log")');
    await w.key('Escape', 'Escape');
    await w.wait('document.querySelector("#runscreen").hidden');
    void session;
  } finally { await w?.close(); await h.close(); }
});
