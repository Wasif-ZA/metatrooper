import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer as createHttp } from 'node:http';
import { createServer as createNet } from 'node:net';
import { existsSync, openSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync, rmSync, symlinkSync, linkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, sleep, startCore, teardownCore, until, uiHello } from '../../core/test/helpers.ts';
import { killTree } from '../../tests/helpers/kill-tree.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const xvfb = spawnSync('which', ['xvfb-run']).status === 0;
const runnable = process.env.METATROOPER_BROWSER_E2E === '1' && existsSync(electron) && (process.platform === 'win32' || (process.platform === 'linux' && xvfb));
const options = { skip: !runnable, timeout: 240_000 };

type Step = [string, string, Record<string, unknown>];
type Reply = { result?: any; error?: { code: number; message: string } };
type Out = { hello?: Reply; steps: Record<string, { reply: Reply; ms: number; at: number }> };

// The ref of the snapshot line for this label. A label is the quoted accessible name.
function refOf(text: string, label: string): string {
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

async function boot() {
  await buildGenerated();
  const iso = isolation();
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
  let wb: { pid?: number; paneEvents: () => Promise<any[]>; paneAct: (pane: string) => Promise<unknown>; close: () => Promise<void> } | null = null;

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
        // The shim's stderr logs go with the error, since the home is removed at teardown.
        const logs = readdirSync(iso.home).filter((f) => f.startsWith('m701-mcp-stderr-')).map((f) => `${f}:\n${readFileSync(join(iso.home, f), 'utf8')}`);
        throw new Error(`engine failed: ${readFileSync(errFile, 'utf8')}\n${logs.join('\n')}`);
      }
      return null;
    }, 90_000);
  };

  const session = async (url: string, grant?: string, devPort?: number) => {
    const launch = await pipe.request('session.launch', { project_id: projectId, engine_id: 'fake', prompt: engineFile, ...(grant ? { browser_grant: grant } : {}) });
    assert.ok(launch.result?.session_id, JSON.stringify(launch));
    const sid = launch.result.session_id as string;
    if (devPort) {
      // A ready dev server the session started (as m7-01-v3-e2e registers its fixture): the policy then lets panes load it.
      const db = new DatabaseSync(join(iso.home, 'troop.db'));
      try {
        db.prepare("INSERT INTO session_dev_server (id, session_id, project_id, port, url, pid, matched_by, status, seen_at) VALUES (?, ?, ?, ?, ?, ?, 'printed', 'ready', ?)")
          .run(`ds_m701_${devPort}`, sid, projectId, devPort, `http://127.0.0.1:${devPort}/`, process.pid, new Date().toISOString());
      } finally {
        db.close();
      }
    }
    const opened = await pipe.request('pane.open', { project_id: projectId, session_id: sid, agent: true, url });
    assert.ok(opened.result?.pane_id, JSON.stringify(opened));
    const pane = opened.result.pane_id as string;
    return { sid, pane, job: (steps: Step[]) => runJob(sid, steps) };
  };

  // Starts the workbench (env METATROOPER_BROWSER_E2E=1 for the test-detach seam) and reads its renderer over CDP.
  const openWorkbench = async () => {
    const port = await freePort();
    const flags = [`--remote-debugging-port=${port}`];
    const [cmd, argv] = process.platform === 'win32'
      ? [electron, [...flags, workbench]]
      : ['xvfb-run', ['-a', '-s', '-screen 0 1400x900x24', electron, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', ...flags, workbench]];
    const proc: ChildProcess = spawn(cmd, argv, { env: { ...env, METATROOPER_BROWSER_E2E: '1' }, stdio: ['ignore', 'ignore', openSync(join(iso.home, 'workbench.err'), 'w')], detached: process.platform !== 'win32' });
    const targetOf = async () => {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
      return (list as any[]).find((t) => t.type === 'page' && String(t.url).includes('index.html'));
    };
    const target = await until(targetOf, 30_000);
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise<void>((r, j) => { ws.addEventListener('open', () => r(), { once: true }); ws.addEventListener('error', j, { once: true }); });
    let seq = 0;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(String(e.data));
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
    });
    const send = (method: string, params: object = {}): Promise<any> => new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression: string): Promise<any> => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails));
      return r.result.value;
    };
    await until(() => evaluate('Boolean(window.troop && typeof ui !== "undefined" && ui.snap && ui.snap.core.online)'), 30_000);
    // Subscribes once; the preload's onPaneEvent hands every pane event to this page, kept in window.__m701.
    await evaluate('(window.__m701 = [], window.troop.onPaneEvent((e) => window.__m701.push(e)), true)');
    wb = {
      pid: proc.pid,
      paneEvents: async () => JSON.parse(await evaluate('JSON.stringify(window.__m701 || [])')),
      paneAct: (pane: string) => evaluate(`window.troop.paneAct(${JSON.stringify(pane)}, 'test-detach')`),
      close: async () => {
        ws.close();
        killTree(proc);
        await sleep(500);
      },
    };
  };

  // Browser tool rows the workbench audit wrote, read after a short settle for the late write.
  const toolRows = async (): Promise<string[]> => {
    await sleep(300);
    const db = new DatabaseSync(join(iso.home, 'troop.db'));
    try {
      return db.prepare("SELECT payload FROM event WHERE kind = 'browser.tool'").all().map((r: any) => JSON.parse(String(r.payload)).tool);
    } finally {
      db.close();
    }
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
    iso, pipe, session, openWorkbench, toolRows, approvals,
    get wb() { assert.ok(wb, 'the workbench is not open'); return wb; },
    async done() {
      await wb?.close();
      await teardownCore(core, iso);
      pipe.close();
    },
  };
}

type Harness = Awaited<ReturnType<typeof boot>>;

const PS = `param([int]$root)
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
$all = Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId
$set = New-Object 'System.Collections.Generic.HashSet[uint32]'
[void]$set.Add([uint32]$root)
do { $before = $set.Count; foreach ($p in $all) { if ($set.Contains([uint32]$p.ParentProcessId)) { [void]$set.Add([uint32]$p.ProcessId) } } } while ($set.Count -gt $before)
[W]::Count($set)
`;

// Visible top-level windows of the workbench process tree; null off Windows. A native file dialog would add one.
function topLevelWindows(h: Harness): number | null {
  if (process.platform !== 'win32') return null;
  const script = join(h.iso.home, 'count-windows.ps1');
  writeFileSync(script, PS);
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script, String(h.wb.pid)], { encoding: 'utf8' });
  const n = Number(r.stdout.trim());
  assert.ok(Number.isInteger(n), `window count failed: ${r.stdout} ${r.stderr}`);
  return n;
}

const fileInputPage = `<!doctype html><html><head><title>upload</title></head><body>
<input id="f" type="file" multiple aria-label="files">
<div id="out"></div>
<script>document.getElementById('f').addEventListener('change', (e) => { document.getElementById('out').textContent = Array.from(e.target.files).map((x) => x.name).join('|'); });</script>
</body></html>`;

const chooserPage = `<!doctype html><html><head><title>chooser</title></head><body>
<input id="f" type="file" multiple style="display:none">
<button id="pick" onclick="document.getElementById('f').click()">Choose files</button>
<div id="out"></div>
<script>document.getElementById('f').addEventListener('change', (e) => { document.getElementById('out').textContent = Array.from(e.target.files).map((x) => x.name).join('|'); });</script>
</body></html>`;

async function served(html: string) {
  const port = await freePort();
  const srv = createHttp((_req, res) => { res.setHeader('content-type', 'text/html'); res.end(html); });
  await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
  return { port, url: `http://127.0.0.1:${port}/`, close: () => { srv.close(); } };
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

const outText = (s: { pane: string }): Step => ['out', 'browser.evaluate', { pane_id: s.pane, expression: `'out=[' + document.getElementById('out').textContent + ']'` }];

function projectFiles(h: Harness) {
  const a = join(h.iso.home, 'project', 'alpha.txt');
  const b = join(h.iso.home, 'project', 'beta.txt');
  writeFileSync(a, 'alpha');
  writeFileSync(b, 'beta beta');
  return [a, b];
}

async function uploadTwo(page: string, label: string) {
  const h: Harness = await boot();
  const srv = await served(page);
  try {
    const [a, b] = projectFiles(h);
    const s = await h.session(srv.url, 'debug', srv.port);
    await h.openWorkbench();
    const snap = await s.job([['snap', 'browser.snapshot', { pane_id: s.pane }]]);
    const ref = refOf(String(snap.steps.snap.reply.result?.text ?? ''), label);
    const before = topLevelWindows(h);
    const { result, asked } = await approveUntilDone(h, s.sid, s.job([['up', 'mcp.call', { name: 'upload', arguments: { pane_id: s.pane, ref, paths: [a, b] } }], outText(s)]));
    const reply = result.steps.up.reply.result;
    assert.notEqual(reply.isError, true, JSON.stringify(reply));
    assert.equal(asked.length, 1);
    assert.match(asked[0].reason, /file upload/);
    assert.match(JSON.stringify(result.steps.out.reply), /out=\[alpha\.txt\|beta\.txt\]/, 'the change handler did not see both names');
    const after = topLevelWindows(h);
    assert.equal(after, before, `a top-level window appeared: ${before} -> ${after}`);
  } finally {
    srv.close();
    await h.done();
  }
}

// protects=upload attaches 2 project files to a file input in a background agent pane and the page's change handler sees both names
// fails_when=the approval is not asked, the page shows other names, or a top-level window (a native dialog) appears
// no_claim=a chooser opened by a button (the next test), and paths outside the project
test('M8-49d upload attaches 2 files to a file input with no native dialog', options, async () => {
  await uploadTwo(fileInputPage, 'files');
});

// protects=upload through a button whose click opens a hidden input's chooser is caught by the debugger, so no dialog shows
// fails_when=the button opens no chooser, the page shows other names, or a top-level window appears
// no_claim=the direct file input case
test('M8-49d upload through a button that opens a chooser', options, async () => {
  await uploadTwo(chooserPage, 'Choose files');
});

// protects=a pipe call to browser.upload with no approved row for these paths sends nothing
// fails_when=the call is not -32030, or the page shows a file
// no_claim=the core's approval path
test('M8-49 a direct upload call without an approval sends nothing', options, async () => {
  const h: Harness = await boot();
  const srv = await served(fileInputPage);
  try {
    const [a] = projectFiles(h);
    const s = await h.session(srv.url, 'debug', srv.port);
    await h.openWorkbench();
    const snap = await s.job([['snap', 'browser.snapshot', { pane_id: s.pane }]]);
    const ref = refOf(String(snap.steps.snap.reply.result?.text ?? ''), 'files');
    const expect = { name: '', automation_id: '', origin: new URL(srv.url).origin, hidden: false, password: false };
    const r = await s.job([
      ['made', 'browser.upload', { pane_id: s.pane, ref, paths: [a], expect, approval_id: 'ap_made_up' }],
      ['none', 'browser.upload', { pane_id: s.pane, ref, paths: [a], expect }],
      outText(s),
    ]);
    assert.equal(r.steps.made.reply.error?.code, -32030, JSON.stringify(r.steps.made.reply));
    assert.equal(r.steps.none.reply.error?.code, -32030, JSON.stringify(r.steps.none.reply));
    assert.match(JSON.stringify(r.steps.out.reply), /out=\[\]/, 'a file reached the page');
  } finally {
    srv.close();
    await h.done();
  }
});

// protects=a direct browser.upload that names no control, or one from another origin, is refused and sends nothing, even with a valid approval
// fails_when=the call is not -32030 with must name the control, or the page shows a file
// no_claim=a wrong control name (panes.ts compares it with the live control)
test('M8-49 a direct upload without the control it was approved for sends nothing', options, async () => {
  const h: Harness = await boot();
  const srv = await served(fileInputPage);
  try {
    const [a] = projectFiles(h);
    const s = await h.session(srv.url, 'debug', srv.port);
    await h.openWorkbench();
    const snap = await s.job([['snap', 'browser.snapshot', { pane_id: s.pane }]]);
    const ref = refOf(String(snap.steps.snap.reply.result?.text ?? ''), 'files');
    const { result, asked } = await approveUntilDone(h, s.sid, s.job([['up', 'mcp.call', { name: 'upload', arguments: { pane_id: s.pane, ref, paths: [a] } }]]));
    assert.notEqual(result.steps.up.reply.result.isError, true);
    const id = asked[0].id;
    const db = new DatabaseSync(join(h.iso.home, 'troop.db'));
    try { db.prepare('DELETE FROM meta WHERE key = ?').run(`upload_used:${id}`); } finally { db.close(); }
    const clear: Step = ['clear', 'browser.evaluate', { pane_id: s.pane, expression: `(document.getElementById('out').textContent = '', 'cleared')` }];
    const r = await s.job([
      clear,
      ['none', 'browser.upload', { pane_id: s.pane, ref, paths: [a], approval_id: id }],
      ['other', 'browser.upload', { pane_id: s.pane, ref, paths: [a], approval_id: id, expect: { name: '', automation_id: '', origin: 'http://example.test', hidden: false, password: false } }],
      outText(s),
    ]);
    for (const k of ['none', 'other']) {
      assert.equal(r.steps[k].reply.error?.code, -32030, JSON.stringify(r.steps[k].reply));
      assert.match(String(r.steps[k].reply.error?.message), /must name the control/);
    }
    assert.match(JSON.stringify(r.steps.out.reply), /out=\[\]/, 'a file reached the page');
  } finally {
    srv.close();
    await h.done();
  }
});

// protects=an upload with a path outside the project folder is refused before any approval and sends nothing
// fails_when=an approval row is written, the call succeeds, or the page shows a file
// no_claim=the size and count limits (core test)
test('M8-49e upload outside the project returns an error and sends nothing', options, async () => {
  const h: Harness = await boot();
  const srv = await served(fileInputPage);
  try {
    projectFiles(h);
    const outside = join(h.iso.home, 'outside.txt');
    writeFileSync(outside, 'secret');
    const s = await h.session(srv.url, 'debug', srv.port);
    await h.openWorkbench();
    const snap = await s.job([['snap', 'browser.snapshot', { pane_id: s.pane }]]);
    const ref = refOf(String(snap.steps.snap.reply.result?.text ?? ''), 'files');
    const r = await s.job([['up', 'mcp.call', { name: 'upload', arguments: { pane_id: s.pane, ref, paths: [outside] } }], outText(s)]);
    const reply = r.steps.up.reply.result;
    assert.equal(reply.isError, true, JSON.stringify(reply));
    assert.match(String(reply.content[0].text), /outside the project folder/);
    for (const status of ['waiting', 'approved', 'rejected', 'expired']) assert.equal(h.approvals(s.sid, status).length, 0, `an approval row is ${status}`);
    assert.match(JSON.stringify(r.steps.out.reply), /out=\[\]/, 'a file reached the page');
  } finally {
    srv.close();
    await h.done();
  }
});

const readerPage = `<!doctype html><html><head><title>reader</title></head><body>
<input id="f" type="file" multiple aria-label="files">
<div id="out"></div><div id="res"></div>
<script>document.getElementById('f').addEventListener('change', (e) => { document.getElementById('out').textContent = Array.from(e.target.files).map((x) => x.name).join('|'); });</script>
</body></html>`;

// protects=a project file swapped for a link to an outside file after the card shows is not sent
// fails_when=the call succeeds or the page shows a file
// no_claim=the page-level copy (later tests)
test('M8-49 a project file swapped for a link after the card shows sends nothing', options, async (t) => {
  const h: Harness = await boot();
  const srv = await served(fileInputPage);
  try {
    const [a] = projectFiles(h);
    const outside = join(h.iso.home, 'outside.txt');
    writeFileSync(outside, 'secret');
    const s = await h.session(srv.url, 'debug', srv.port);
    await h.openWorkbench();
    const snap = await s.job([['snap', 'browser.snapshot', { pane_id: s.pane }]]);
    const ref = refOf(String(snap.steps.snap.reply.result?.text ?? ''), 'files');
    const pending = s.job([['up', 'mcp.call', { name: 'upload', arguments: { pane_id: s.pane, ref, paths: [a] } }], outText(s)]);
    pending.catch(() => {});
    let row: { id: string } | undefined;
    for (let i = 0; i < 600 && !row; i++) { row = h.approvals(s.sid, 'waiting')[0]; if (!row) await sleep(100); }
    assert.ok(row, 'no card');
    rmSync(a);
    let kind = 'symlink';
    try { symlinkSync(outside, a, 'file'); } catch { kind = 'hard link'; try { linkSync(outside, a); } catch { t.skip('no symlink or hard link here'); return; } }
    assert.ok((await h.pipe.request('approval.resolve', { approval_id: row.id, decision: 'approve' })).result);
    const r = await pending;
    const reply = r.steps.up.reply.result;
    assert.equal(reply.isError, true, `${kind}: ${JSON.stringify(reply)}`);
    assert.match(JSON.stringify(r.steps.out.reply), /out=\[\]/, 'a file reached the page');
  } finally {
    srv.close();
    await h.done();
  }
});

// protects=an approval spent once is refused again because the database row says so, not only memory
// fails_when=the meta row upload_used:<id> is missing, the replay reaches the page, or it still fails with the row removed (the refusal was something else)
// no_claim=a workbench restart (the row is read from the database on each call)
test('M8-49 a used upload approval is recorded in the database and refused a second time', options, async () => {
  const h: Harness = await boot();
  const srv = await served(fileInputPage);
  try {
    const [a, b] = projectFiles(h);
    const s = await h.session(srv.url, 'debug', srv.port);
    await h.openWorkbench();
    const snap = await s.job([['snap', 'browser.snapshot', { pane_id: s.pane }]]);
    const ref = refOf(String(snap.steps.snap.reply.result?.text ?? ''), 'files');
    const { result, asked } = await approveUntilDone(h, s.sid, s.job([['up', 'mcp.call', { name: 'upload', arguments: { pane_id: s.pane, ref, paths: [a, b] } }], outText(s)]));
    assert.notEqual(result.steps.up.reply.result.isError, true);
    const id = asked[0].id;
    const meta = () => {
      const db = new DatabaseSync(join(h.iso.home, 'troop.db'));
      try { return db.prepare('SELECT key FROM meta WHERE key = ?').all(`upload_used:${id}`).length; } finally { db.close(); }
    };
    assert.equal(meta(), 1, 'the used approval is not in the database');
    // the control as the core stored it, so the replay hashes exactly like the approved call
    const cdb = new DatabaseSync(join(h.iso.home, 'troop.db'));
    let control: object;
    try { control = JSON.parse(String((cdb.prepare('SELECT control FROM approval WHERE id = ?').get(id) as { control: string }).control)); } finally { cdb.close(); }
    const expect = { ...control, origin: new URL(srv.url).origin, hidden: false, password: false };
    const replay = { pane_id: s.pane, ref, paths: [a, b], expect, approval_id: id };
    const clear: Step = ['clear', 'browser.evaluate', { pane_id: s.pane, expression: `(document.getElementById('out').textContent = '', 'cleared')` }];
    const r = await s.job([clear, ['again', 'browser.upload', replay], outText(s)]);
    assert.equal(r.steps.again.reply.error?.code, -32030, JSON.stringify(r.steps.again.reply));
    assert.match(JSON.stringify(r.steps.out.reply), /out=\[\]/, 'the replay reached the page');
    // positive control: with the row gone the same call is accepted, so the refusal above was the row
    const db = new DatabaseSync(join(h.iso.home, 'troop.db'));
    try { db.prepare('DELETE FROM meta WHERE key = ?').run(`upload_used:${id}`); } finally { db.close(); }
    const ok = await s.job([['again', 'browser.upload', replay], outText(s)]);
    assert.equal(ok.steps.again.reply.error, undefined, JSON.stringify(ok.steps.again.reply));
    assert.match(JSON.stringify(ok.steps.out.reply), /out=\[alpha\.txt\|beta\.txt\]/);
  } finally {
    srv.close();
    await h.done();
  }
});

// protects=the page gets a copy: same name and content, still readable after the project file is rewritten
// fails_when=the page cannot read the file after the original changes (it holds the original), or name or content differ
// no_claim=the path given to DOM.setFileInputFiles is not visible to the page; the rewrite is the observable proxy
test('M8-49 the page reads a copy of the approved file', options, async () => {
  const h: Harness = await boot();
  const srv = await served(readerPage);
  try {
    const [a] = projectFiles(h);
    const s = await h.session(srv.url, 'debug', srv.port);
    await h.openWorkbench();
    const snap = await s.job([['snap', 'browser.snapshot', { pane_id: s.pane }]]);
    const ref = refOf(String(snap.steps.snap.reply.result?.text ?? ''), 'files');
    const { result } = await approveUntilDone(h, s.sid, s.job([['up', 'mcp.call', { name: 'upload', arguments: { pane_id: s.pane, ref, paths: [a] } }], outText(s)]));
    assert.notEqual(result.steps.up.reply.result.isError, true);
    assert.match(JSON.stringify(result.steps.out.reply), /out=\[alpha\.txt\]/);
    writeFileSync(a, 'rewritten after the approval, longer than before');
    const read = `(document.getElementById('f').files[0].text().then((t) => { document.getElementById('res').textContent = 'res=[' + t + ']'; }, (e) => { document.getElementById('res').textContent = 'res=[err ' + e.name + ']'; }), 'started')`;
    await s.job([['read', 'browser.evaluate', { pane_id: s.pane, expression: read }]]);
    let text = '';
    for (let i = 0; i < 20 && !/res=\[.+\]/.test(text); i++) {
      await sleep(250);
      text = JSON.stringify((await s.job([['res', 'browser.evaluate', { pane_id: s.pane, expression: `'got:' + document.getElementById('res').textContent` }]])).steps.res.reply);
    }
    assert.match(text, /got:res=\[alpha\]/, text);
  } finally {
    srv.close();
    await h.done();
  }
});
