import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer as createHttp } from 'node:http';
import { createServer as createNet } from 'node:net';
import { existsSync, openSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, sleep, startCore, teardownCore, until, uiHello } from '../../core/test/helpers.ts';
import { killTree } from '../../tests/helpers/kill-tree.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
export const exe = process.env.METATROOPER_HEADLESS_EXE ?? '';
export const runnable = process.env.METATROOPER_BROWSER_E2E === '1' && process.platform === 'win32' && existsSync(electron) && exe !== '' && existsSync(exe);
const held = readFileSync(join(workbench, 'src', 'browser', 'panes.ts'), 'utf8').match(/const HEADLESS_HELD = '([^']*)'/)?.[1] ?? '';
const options = { skip: held !== '' ? `the chrome-headless-shell engine is held (HEADLESS_HELD: ${held})` : !runnable, timeout: 240_000 };

type Step = [string, string, Record<string, unknown>];
type Reply = { result?: any; error?: { code: number; message: string } };
type Out = { hello?: Reply; steps: Record<string, { reply: Reply; ms: number; at: number }> };

// The ref of the snapshot line for this label. A label is the quoted accessible name.
export function refOf(text: string, label: string): string {
  const line = text.split(/\r?\n/).find((l) => l.includes(`"${label}"`));
  const ref = line?.match(/\[ref=((?:f\d+)?e\d+)\]/)?.[1];
  assert.ok(ref, `no ref for "${label}" in the snapshot: ${text}`);
  return ref;
}

async function freePort(): Promise<number> {
  const s = createNet();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

export const ENGINES = {
  electron: { browser: { agent_engine: 'electron' } },
  headless: { browser: { agent_engine: 'chrome-headless-shell', headless_path: exe } },
};

export async function boot(settings: object) {
  await buildGenerated();
  const iso = isolation();
  writeFileSync(join(iso.home, 'settings.json'), JSON.stringify(settings));
  const registry = join(iso.home, 'engines.json');
  const engineFile = join(iso.home, 'm701-cef-engine.cjs');
  writeFileSync(registry, JSON.stringify([{ id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 1, version_cmd: [process.execPath, '--version'] }]));
  const shimPath = join(workbench, '..', 'core', 'src', 'hook', 'browser-mcp.ts');
  writeFileSync(engineFile, readFileSync(join(workbench, 'test', 'fixtures', 'm7-01-cef-engine.cjs'), 'utf8').replace('__SHIM_PATH__', JSON.stringify(shimPath)));
  const env = { ...iso.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...iso, env });
  const pipe = await client(iso.prefix);
  await uiHello(pipe, iso.home);
  const project = join(iso.home, 'project');
  mkdirSync(project);
  const projectId = (await pipe.request('project.open', { path: project })).result.project_id as string;
  const counters = new Map<string, number>();
  let wb: { pid?: number; close: () => Promise<void> } | null = null;

  // Runs job k of a session: writes its job file, then waits for the engine's result file.
  const runJob = async (sid: string, steps: Step[]): Promise<Out> => {
    const k = (counters.get(sid) ?? 0) + 1;
    counters.set(sid, k);
    const job = join(iso.home, `m701-job-${sid}-${k}.json`);
    writeFileSync(`${job}.tmp`, JSON.stringify({ steps }));
    renameSync(`${job}.tmp`, job);
    const out = join(iso.home, `m701-out-${sid}-${k}.json`);
    const errFile = join(iso.home, `m701-error-${sid}.txt`);
    return until(() => {
      if (existsSync(out)) return JSON.parse(readFileSync(out, 'utf8')) as Out;
      if (existsSync(errFile)) {
        const logs = readdirSync(iso.home).filter((f) => f.startsWith('m701-mcp-stderr-')).map((f) => `${f}:\n${readFileSync(join(iso.home, f), 'utf8')}`);
        throw new Error(`engine failed: ${readFileSync(errFile, 'utf8')}\n${logs.join('\n')}`);
      }
      return null;
    }, 90_000);
  };

  const session = async (url: string, devPort: number) => {
    const launch = await pipe.request('session.launch', { project_id: projectId, engine_id: 'fake', prompt: engineFile, browser_grant: 'debug' });
    assert.ok(launch.result?.session_id, JSON.stringify(launch));
    const sid = launch.result.session_id as string;
    // A ready dev server the session started: the policy then lets panes load its port.
    const db = new DatabaseSync(join(iso.home, 'troop.db'));
    try {
      db.prepare("INSERT INTO session_dev_server (id, session_id, project_id, port, url, pid, matched_by, status, seen_at) VALUES (?, ?, ?, ?, ?, ?, 'printed', 'ready', ?)")
        .run(`ds_m842_${devPort}`, sid, projectId, devPort, `http://127.0.0.1:${devPort}/`, process.pid, new Date().toISOString());
    } finally {
      db.close();
    }
    const opened = await pipe.request('pane.open', { project_id: projectId, session_id: sid, agent: true, url });
    assert.ok(opened.result?.pane_id, JSON.stringify(opened));
    return { sid, pane: opened.result.pane_id as string, job: (steps: Step[]) => runJob(sid, steps) };
  };

  const openWorkbench = async () => {
    const port = await freePort();
    const proc: ChildProcess = spawn(electron, [`--remote-debugging-port=${port}`, workbench], { env: { ...env, METATROOPER_BROWSER_E2E: '1' }, stdio: ['ignore', 'ignore', openSync(join(iso.home, 'workbench.err'), 'w')] });
    const target = await until(async () => {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
      return (list as any[]).find((t) => t.type === 'page' && String(t.url).includes('index.html'));
    }, 30_000);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((r, j) => { ws.addEventListener('open', () => r(), { once: true }); ws.addEventListener('error', j, { once: true }); });
    let seq = 0;
    const pending = new Map<number, (m: any) => void>();
    ws.addEventListener('message', (e) => { const m = JSON.parse(String(e.data)); pending.get(m.id)?.(m); pending.delete(m.id); });
    const ready = async (): Promise<any> => {
      const id = ++seq;
      const m = await new Promise<any>((r) => { pending.set(id, r); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression: 'Boolean(window.troop && typeof ui !== "undefined" && ui.snap && ui.snap.core.online)', returnByValue: true } })); });
      return m.result?.result?.value;
    };
    await until(ready, 30_000);
    wb = { pid: proc.pid, close: async () => { ws.close(); killTree(proc); await sleep(500); } };
  };

  const approvals = (sid: string, status: string): Array<{ id: string; reason: string }> => {
    const db = new DatabaseSync(join(iso.home, 'troop.db'));
    try {
      return db.prepare('SELECT id, reason FROM approval WHERE session_id = ? AND status = ?').all(sid, status) as Array<{ id: string; reason: string }>;
    } finally {
      db.close();
    }
  };

  return {
    iso, pipe, session, openWorkbench, approvals,
    get wb() { assert.ok(wb, 'the workbench is not open'); return wb; },
    async done() {
      await (wb as { close: () => Promise<void> } | null)?.close();
      await teardownCore(core, iso);
      pipe.close();
    },
  };
}

type Harness = Awaited<ReturnType<typeof boot>>;

function ps(command: string): string {
  return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { encoding: 'utf8' }).stdout.trim();
}
export const headlessProcs = () => Number(ps('@(Get-Process -Name chrome-headless-shell -ErrorAction SilentlyContinue).Count')) || 0;
export const killHeadless = () => { ps('Get-Process -Name chrome-headless-shell -ErrorAction SilentlyContinue | Stop-Process -Force'); };

// electron.exe processes and visible top-level windows in the workbench tree: a view or window in the app adds a renderer or a window
function tree(h: Harness): { electrons: number; windows: number } {
  const script = join(h.iso.home, 'tree.ps1');
  writeFileSync(script, `param([int]$root)
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Collections.Generic;
public class W {
  public delegate bool P(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(P p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  public static int Count(HashSet<uint> set) { int n = 0; EnumWindows((h, l) => { uint p; GetWindowThreadProcessId(h, out p); if (set.Contains(p) && IsWindowVisible(h)) n++; return true; }, IntPtr.Zero); return n; }
}
"@
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name
$set = New-Object 'System.Collections.Generic.HashSet[uint32]'
[void]$set.Add([uint32]$root)
do { $before = $set.Count; foreach ($p in $all) { if ($set.Contains([uint32]$p.ParentProcessId)) { [void]$set.Add([uint32]$p.ProcessId) } } } while ($set.Count -gt $before)
$e = @($all | Where-Object { $set.Contains([uint32]$_.ProcessId) -and $_.Name -eq 'electron.exe' }).Count
"$e $([W]::Count($set))"
`);
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, String(h.wb.pid)], { encoding: 'utf8' });
  const [electrons, windows] = r.stdout.trim().split(' ').map(Number);
  assert.ok(Number.isInteger(electrons) && Number.isInteger(windows), `tree failed: ${r.stdout} ${r.stderr}`);
  return { electrons, windows };
}

export async function served(html: (port: number) => string) {
  const port = await freePort();
  const hits: string[] = [];
  const srv = createHttp((req, res) => { hits.push(req.url ?? ''); res.setHeader('content-type', 'text/html'); res.end(html(port)); });
  await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
  return { port, url: `http://127.0.0.1:${port}/`, hits, close: () => { srv.close(); } };
}

// Answers every waiting approval of the session with approve until the job settles.
async function approveUntilDone<T>(h: Harness, sid: string, pending: Promise<T>): Promise<{ result: T; asked: Array<{ id: string; reason: string }> }> {
  pending.catch(() => {});
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  const asked: Array<{ id: string; reason: string }> = [];
  while (!settled) {
    for (const row of h.approvals(sid, 'waiting')) {
      asked.push(row);
      const resolved = await h.pipe.request('approval.resolve', { approval_id: row.id, decision: 'approve' });
      assert.ok(resolved.result, JSON.stringify(resolved));
    }
    await sleep(100);
  }
  return { result: await pending, asked };
}

const outText = (pane: string): Step => ['out', 'browser.evaluate', { pane_id: pane, expression: `'out=[' + document.getElementById('out').textContent + ']'` }];
const text = (r: Reply) => String(r.result?.content?.[0]?.text ?? JSON.stringify(r));

const demoPage = () => `<!doctype html><html><head><title>demo</title></head><body>
<h1>Demo</h1>
<input id="name" type="text" aria-label="name">
<button id="go" onclick="document.getElementById('out').textContent = 'hello ' + document.getElementById('name').value">Go</button>
<div id="out"></div>
</body></html>`;

type Run = { reasons: string[]; snap: string; read: string; out: string; navigate: string; procs: number; electrons: number; windows: number };

// The same calls on one engine; every approval is answered with approve.
async function demoRun(engine: keyof typeof ENGINES): Promise<Run> {
  const h = await boot(ENGINES[engine]);
  const srv = await served(demoPage);
  try {
    const s = await h.session(srv.url, srv.port);
    await h.openWorkbench();
    const first = await s.job([['nav', 'mcp.call', { name: 'navigate', arguments: { pane_id: s.pane, url: srv.url } }], ['snap', 'browser.snapshot', { pane_id: s.pane }]]);
    const snap = String(first.steps.snap.reply.result?.text ?? '');
    const { result, asked } = await approveUntilDone(h, s.sid, s.job([
      ['type', 'mcp.call', { name: 'type', arguments: { pane_id: s.pane, ref: refOf(snap, 'name'), text: 'Ada' } }],
      ['click', 'mcp.call', { name: 'click', arguments: { pane_id: s.pane, ref: refOf(snap, 'Go') } }],
      ['read', 'mcp.call', { name: 'read', arguments: { pane_id: s.pane } }],
      outText(s.pane),
    ]));
    for (const k of ['type', 'click', 'read']) assert.notEqual(result.steps[k].reply.result?.isError, true, `${k}: ${JSON.stringify(result.steps[k].reply)}`);
    const norm = (v: string) => v.replaceAll(String(srv.port), 'PORT').replace(/page-data [0-9a-f]+/g, 'page-data N');
    return {
      reasons: asked.map((a) => a.reason),
      snap: norm(snap),
      read: norm(text(result.steps.read.reply)),
      out: JSON.stringify(result.steps.out.reply.result),
      navigate: norm(text(first.steps.nav.reply)),
      procs: headlessProcs(),
      ...tree(h),
    };
  } finally {
    srv.close();
    await h.done();
    killHeadless();
  }
}

// protects=the same tool calls give the same results on electron and on chrome-headless-shell, and the headless pane has no view in the window
// fails_when=any result differs, the page does not show hello Ada, no headless process runs, or the headless run has as many electron processes or windows as the electron run
// no_claim=timing, memory (M8-42d), pages that need a real display
test('M8-42a the same calls give the same results on electron and chrome-headless-shell', options, async () => {
  killHeadless();
  const e = await demoRun('electron');
  assert.equal(e.procs, 0, 'the electron run started a headless process');
  const hl = await demoRun('headless');
  assert.ok(hl.procs >= 1, 'no chrome-headless-shell process ran for the headless pane');
  assert.match(e.out, /hello Ada/);
  assert.equal(hl.out, e.out);
  assert.equal(hl.snap, e.snap);
  assert.equal(hl.read, e.read);
  assert.equal(hl.navigate, e.navigate);
  assert.deepEqual(hl.reasons, e.reasons);
  assert.ok(hl.electrons < e.electrons, `the headless pane added an electron process: ${hl.electrons} vs ${e.electrons}`);
  assert.equal(hl.windows, e.windows, `windows differ: ${hl.windows} vs ${e.windows}`);
});

// protects=on headless a click on a control of a new origin asks approval, a subresource to a blocked address is not fetched, window.open without a click opens nothing
// fails_when=no new origin row is written, the unowned server is reached, a fetch is not refused, or the popup page is requested
// no_claim=window.open after a click (unit tests of headless.ts)
test('M8-42c headless asks approval for a new origin and enforces the request and popup checks', options, async () => {
  killHeadless();
  const h = await boot(ENGINES.headless);
  const foreign = await served(() => 'foreign');
  const srv = await served(() => `<!doctype html><html><head><title>guard</title></head><body>
<button id="go" onclick="document.getElementById('out').textContent = 'clicked'">Go</button>
<div id="out"></div><div id="res"></div>
<script>
const note = (s) => { document.getElementById('res').textContent += s; };
fetch('http://127.0.0.1:${foreign.port}/fetched', { mode: 'no-cors' }).then(() => note('a-ok;'), () => note('a-blocked;'));
fetch('http://10.0.0.1/x', { mode: 'no-cors' }).then(() => note('b-ok;'), () => note('b-blocked;'));
</script></body></html>`);
  try {
    const s = await h.session(srv.url, srv.port);
    await h.openWorkbench();
    const snap = await s.job([['snap', 'browser.snapshot', { pane_id: s.pane }]]);
    const ref = refOf(String(snap.steps.snap.reply.result?.text ?? ''), 'Go');
    assert.ok(headlessProcs() >= 1, 'no chrome-headless-shell process');
    // before any click, so the page holds no user activation
    await s.job([['open', 'browser.evaluate', { pane_id: s.pane, expression: `(window.open('${srv.url}popup'), 'tried')` }]]);
    await sleep(1500);
    assert.equal(srv.hits.filter((x) => x === '/popup').length, 0, 'window.open without a click loaded the popup');
    const again = await s.job([['read', 'mcp.call', { name: 'read', arguments: { pane_id: s.pane } }]]);
    assert.notEqual(again.steps.read.reply.result?.isError, true, 'the pane is not usable after the blocked popup');
    const { result, asked } = await approveUntilDone(h, s.sid, s.job([['click', 'mcp.call', { name: 'click', arguments: { pane_id: s.pane, ref } }], outText(s.pane)]));
    assert.notEqual(result.steps.click.reply.result?.isError, true, JSON.stringify(result.steps.click.reply));
    assert.deepEqual(asked.map((a) => a.reason), ['new origin']);
    assert.match(JSON.stringify(result.steps.out.reply), /out=\[clicked\]/);
    const res = await until(async () => {
      const r = await s.job([['res', 'browser.evaluate', { pane_id: s.pane, expression: `document.getElementById('res').textContent` }]]);
      const v = JSON.stringify(r.steps.res.reply.result);
      return /a-.*b-|b-.*a-/.test(v) ? v : null;
    }, 20_000);
    assert.match(res, /a-blocked/);
    assert.match(res, /b-blocked/);
    assert.equal(foreign.hits.length, 0, 'the unowned loopback server was reached');
  } finally {
    srv.close();
    foreign.close();
    await h.done();
    killHeadless();
  }
});

const fileInputPage = () => `<!doctype html><html><head><title>upload</title></head><body>
<input id="f" type="file" multiple aria-label="files">
<div id="out"></div>
<script>document.getElementById('f').addEventListener('change', (e) => { document.getElementById('out').textContent = Array.from(e.target.files).map((x) => x.name).join('|'); });</script>
</body></html>`;

// protects=on headless upload, handoff and signed_in are refused by name and screenshot still returns an image
// fails_when=a refusal lacks the engine name, a file reaches the page, or the screenshot has no image
// no_claim=the electron refusals
test('M8-42b headless refuses upload, handoff and signed_in by name and still takes screenshots', options, async () => {
  killHeadless();
  const h = await boot(ENGINES.headless);
  const srv = await served(fileInputPage);
  const named = /not supported on the chrome-headless-shell engine/;
  try {
    const file = join(h.iso.home, 'project', 'alpha.txt');
    writeFileSync(file, 'alpha');
    const s = await h.session(srv.url, srv.port);
    await h.openWorkbench();
    const snap = await s.job([['snap', 'browser.snapshot', { pane_id: s.pane }]]);
    const ref = refOf(String(snap.steps.snap.reply.result?.text ?? ''), 'files');
    const { result } = await approveUntilDone(h, s.sid, s.job([
      ['up', 'mcp.call', { name: 'upload', arguments: { pane_id: s.pane, ref, paths: [file] } }],
      ['hand', 'mcp.call', { name: 'handoff', arguments: { pane_id: s.pane, reason: 'check' } }],
      ['nav', 'mcp.call', { name: 'navigate', arguments: { pane_id: s.pane, url: srv.url, signed_in: true } }],
      ['shot', 'mcp.call', { name: 'screenshot', arguments: { pane_id: s.pane } }],
      outText(s.pane),
    ]));
    for (const k of ['up', 'hand', 'nav']) {
      const r = result.steps[k].reply;
      assert.ok(r.error || r.result?.isError, `${k} was not refused: ${JSON.stringify(r)}`);
      assert.match(JSON.stringify(r), named, `${k}: ${JSON.stringify(r)}`);
    }
    const shot = result.steps.shot.reply.result;
    assert.notEqual(shot?.isError, true, JSON.stringify(shot).slice(0, 300));
    assert.ok(shot.content.some((c: any) => c.type === 'image' && String(c.data ?? '').length > 100), 'no image in the screenshot reply');
    assert.match(JSON.stringify(result.steps.out.reply), /out=\[\]/, 'a file reached the page');
  } finally {
    srv.close();
    await h.done();
    killHeadless();
  }
});
