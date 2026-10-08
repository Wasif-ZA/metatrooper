import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { runDetail } from '../src/rundetail.ts';
import { root, sleep, until } from '../../core/test/helpers.ts';
import { revisionHarness } from '../../core/test/ui-revision-helpers.ts';

const schema = readFileSync(resolve(import.meta.dirname, '../../contracts/schema.sql'), 'utf8');
const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const enabled = process.env.METATROOPER_UI_REVISION_E2E === '1';
const options = { skip: !enabled && 'set METATROOPER_UI_REVISION_E2E=1 for real Electron tests', timeout: 150000 };

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'wb-rundetail-'));
  const db = new DatabaseSync(join(dir, 'troop.db'));
  db.exec(schema);
  db.exec('PRAGMA foreign_keys = ON');
  const project = join(dir, 'project');
  const runDir = join(project, '.troop', 'runs', 'run-1');
  mkdirSync(runDir, { recursive: true });
  const now = new Date().toISOString();
  db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run('project-1', project, 'Project', now, now);
  db.prepare('INSERT INTO pipeline (id, source, path, version, valid) VALUES (?, ?, ?, ?, ?)').run('pipeline-1', 'project', join(dir, 'pipeline.json'), 1, 1);
  db.prepare('INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('run-1', 'pipeline-1', 'project-1', JSON.stringify({ fromRun: true }), runDir, 'done', 'manual', 0, 0, 0, now);
  const close = () => { db.close(); rmSync(dir, { recursive: true, force: true }); };
  return { dir, project, runDir, db, close };
}

function writeAssists(runDir: string) {
  writeFileSync(join(runDir, 'pipeline.json'), JSON.stringify({ assists: [
    { tool: 'semgrep', steps: ['review'] },
    { tool: 'difftastic', steps: ['review'] },
    { tool: 'context7', steps: ['plan'] },
  ] }));
  writeFileSync(join(runDir, 'assists.json'), JSON.stringify([
    { tool: 'semgrep', installed: true, version: '1.0.0' },
  ]));
}

test('runDetail joins run pipeline helpers with installed status and registry metadata', () => {
  const f = fixture();
  try {
    writeAssists(f.runDir);
    const detail = runDetail(f.db, 'run-1');
    assert.ok(!('error' in detail));
    assert.deepEqual(detail.assists.map((a) => a.tool), ['semgrep', 'difftastic', 'context7']);
    assert.equal(detail.assists.length, 3);
    assert.equal(detail.assists[0].installed, true);
    assert.equal(detail.assists[1].installed, false);
    assert.equal(detail.assists[2].installed, false);
    assert.equal(detail.assists[0].risk, 'caution');
    assert.equal(detail.assists[0].risk_note, 'LGPL-2.1: fine to run as an external CLI, do not bundle or link it');
    assert.equal(detail.assists[2].egress, 'library names and doc queries to context7.com (Upstash)');
  } finally { f.close(); }
});

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
    const wait = async (expression: string, timeout = 20000) => until(() => evaluate(expression), timeout);
    await wait('typeof ui !== "undefined" && ui.snap && ui.snap.core.online');
    return { evaluate, click, wait, async close() { ws?.send(JSON.stringify({ id: ++seq, method: 'Browser.close' })); await sleep(300); ws?.close(); await stop(); } };
  } catch (e) { ws?.close(); await stop(); throw e; }
}

test('run screen renders helper chips, caution note, and orange egress', options, async () => {
  const h = await revisionHarness(); let w;
  try {
    const def = {
      schema: 1,
      id: 'assist-chips',
      title: 'Assist chips',
      steps: [{ id: 'approve', kind: 'gate', gate: 'approve', title: 'Keep run open' }],
      assists: [
        { tool: 'semgrep', steps: ['approve'], use: 'scan source' },
        { tool: 'difftastic', steps: ['approve'], use: 'compare changes' },
        { tool: 'context7', steps: ['approve'], use: 'look up docs' },
      ],
    };
    const run = await h.pipeline(def);
    const gate = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve' AND status = 'waiting'").get(run), 60000);
    const runDir = h.db.prepare('SELECT run_dir FROM run WHERE id = ?').get(run).run_dir as string;
    writeFileSync(join(runDir, 'pipeline.json'), JSON.stringify(def));
    writeFileSync(join(runDir, 'assists.json'), JSON.stringify([{ tool: 'semgrep', installed: true, version: '1.0.0' }]));
    assert.ok(gate);
    w = await windowFor(h);
    await w.click('[data-action="tab"][data-tab="runs"]');
    await w.wait(`document.querySelector('#runbox [data-action="run-open"][data-id=${JSON.stringify(run)}]')`);
    await w.click(`#runbox [data-action="run-open"][data-id="${run}"]`);
    await w.wait('document.querySelectorAll(".rs-helpers .chip.helper").length === 3');
    const chips = await w.evaluate(`(()=>{
      const by = (tool) => document.querySelector('.rs-helpers .chip.helper[data-helper="' + tool + '"]');
      const semgrep = by('semgrep'); const context7 = by('context7'); const difftastic = by('difftastic');
      return {
        count: document.querySelectorAll('.rs-helpers .chip.helper').length,
        note: semgrep?.querySelector('.hn')?.textContent,
        contextClass: context7?.className,
        contextColour: context7 ? getComputedStyle(context7).color : null,
        amber: (() => {
          const value = getComputedStyle(document.documentElement).getPropertyValue('--amber').trim();
          const probe = document.createElement('span'); probe.style.color = value; document.body.append(probe);
          const colour = getComputedStyle(probe).color; probe.remove(); return colour;
        })(),
        diffClass: difftastic?.className,
      };
    })()`);
    assert.equal(chips.count, 3);
    assert.equal(chips.note, 'LGPL-2.1: fine to run as an external CLI, do not bundle or link it');
    assert.match(chips.contextClass || '', /(?:^|\s)egress(?:\s|$)/);
    assert.equal(chips.contextColour, chips.amber);
    assert.match(chips.diffClass || '', /(?:^|\s)off(?:\s|$)/);
  } finally { await w?.close(); await h.close(); }
});
