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
const xvfb = spawnSync('which', ['xvfb-run']).status === 0;
const runnable = process.env.METATROOPER_BROWSER_E2E === '1' && existsSync(electron) && (process.platform === 'win32' || (process.platform === 'linux' && xvfb));
const options = { skip: !runnable, timeout: 240_000 };

type Step = [string, string, Record<string, unknown>];
type Reply = { result?: any; error?: { code: number; message: string } };
type Out = { hello?: Reply; steps: Record<string, { reply: Reply; ms: number; at: number }> };

const dataUrl = (html: string) => 'data:text/html,' + encodeURIComponent(html);

// The login page: user and pass fields and a Sign in button. With removeOnType, typing in user removes pass.
// The page never writes the literal path segment, so a wait for url_includes "/done" can only match the click's hash.
const login = (removeOnType: boolean) => dataUrl(`<!doctype html><html><head><title>login</title></head><body>
<input id="user" aria-label="user">
<input id="pass" type="password" aria-label="pass">
<button id="go" onclick="location.hash = ['', 'done'].join('/')">Sign in</button>
<script>${removeOnType ? "document.getElementById('user').addEventListener('input', () => document.getElementById('pass').remove());" : ''}</script>
</body></html>`);

// The same login page served over loopback: Sign in navigates to /done, so url_includes sees a real URL change.
async function servedLogin(port: number) {
  const srv = createHttp((req, res) => {
    if (req.url === '/done') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>done</title><p>done</p>'); return; }
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><html><head><title>login</title></head><body>
<input id="user" aria-label="user">
<input id="pass" type="password" aria-label="pass">
<button id="go" onclick="location.href = '/done'">Sign in</button>
</body></html>`);
  });
  await new Promise<void>((r) => srv.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${port}/login`, close: () => { srv.close(); } };
}

const riskyPage = dataUrl(`<!doctype html><html><head><title>risky</title></head><body>
<input id="user" aria-label="user">
<button id="del" onclick="document.body.dataset.deleted = '1'">Delete account</button>
</body></html>`);

const clickPage = dataUrl(`<!doctype html><html><head><title>go</title></head><body>
<button id="go" onclick="document.body.dataset.clicked = '1'">Go</button>
</body></html>`);

// Ten buttons: c1 to c4 under a fixed overlay, v1 to v3 visible and uncovered, o1 to o3 at 3000 px (below the fold).
const tagPage = dataUrl(`<!doctype html><html><head><title>tags</title><style>
body { margin: 0; height: 3200px } button { position: absolute; width: 120px; height: 40px }
</style></head><body>
<button style="left: 10px; top: 20px">c1</button>
<button style="left: 140px; top: 20px">c2</button>
<button style="left: 270px; top: 20px">c3</button>
<button style="left: 400px; top: 20px">c4</button>
<button style="left: 10px; top: 200px">v1</button>
<button style="left: 140px; top: 200px">v2</button>
<button style="left: 270px; top: 200px">v3</button>
<button style="left: 10px; top: 3000px">o1</button>
<button style="left: 140px; top: 3000px">o2</button>
<button style="left: 270px; top: 3000px">o3</button>
<div id="modal" style="position: fixed; left: 0; top: 0; width: 600px; height: 80px; background: rgba(255, 255, 255, 0.9); z-index: 10"></div>
</body></html>`);

const manyPage = dataUrl(`<!doctype html><html><head><title>many</title></head><body>${Array.from({ length: 400 }, (_, i) => `<button>b${i}</button>`).join('')}</body></html>`);

// The ref of the snapshot line for this label. A label is the quoted accessible name.
function refOf(text: string, label: string): string {
  const line = text.split(/\r?\n/).find((l) => l.includes(`"${label}"`));
  const ref = line?.match(/\[ref=((?:f\d+)?e\d+)\]/)?.[1];
  assert.ok(ref, `no ref for "${label}" in the snapshot: ${text}`);
  return ref;
}

const probe = (url: string) => `fetch(${JSON.stringify(url)}, { mode: 'no-cors' }).then(() => 'reached', () => 'blocked')`;

async function freePort(): Promise<number> {
  const s = createNet();
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r));
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((r) => s.close(() => r()));
  return port;
}

// A loopback server the policy blocks: the page's requests to it must not reach it.
async function hitCounter() {
  let hits = 0;
  const srv = createHttp((_req, res) => { hits++; res.end('hit'); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/blocked`, hits: () => hits, close: () => { srv.close(); } };
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
  let wb: { paneEvents: () => Promise<any[]>; paneAct: (pane: string) => Promise<unknown>; close: () => Promise<void> } | null = null;

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
      paneEvents: async () => JSON.parse(await evaluate('JSON.stringify(window.__m701 || [])')),
      paneAct: (pane: string) => evaluate(`window.troop.paneAct(${JSON.stringify(pane)}, 'test-detach')`),
      close: async () => {
        ws.close();
        killTree(proc.pid);
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

// protects=batch runs its steps in order on the refs of one earlier snapshot and answers one text item with 4 ok results
// fails_when=a step is not ok, the steps are out of order, the wait_for does not find the url, or the answer is not one text item
// no_claim=the approval path (the D61 test), the browser.tool rows (the next tests), and whether the typed values reached the page
test('M7-01c batch on a login page: type, type, click, wait_for returns 4 ok steps', options, async () => {
  const h: Harness = await boot();
  const port = await freePort();
  const page = await servedLogin(port);
  try {
    const s = await h.session(page.url, 'act', port);
    await h.openWorkbench();
    const snap = await s.job([['snap', 'browser.snapshot', { pane_id: s.pane }]]);
    const text = String(snap.steps.snap.reply.result?.text ?? '');
    const pending = s.job([['batch', 'mcp.call', {
      name: 'batch',
      arguments: {
        pane_id: s.pane,
        steps: [
          { tool: 'type', args: { ref: refOf(text, 'user'), text: 'alice' } },
          { tool: 'type', args: { ref: refOf(text, 'pass'), text: 'hunter2' } },
          { tool: 'click', args: { ref: refOf(text, 'Sign in') } },
          { tool: 'wait_for', args: { url_includes: '/done', timeout_ms: 5000 } },
        ],
      },
    }]]);
    // A step on the password field waits for a D61 approval ("password field"), and a new origin asks too.
    // Answer every waiting approval for this session until the batch settles, so the steps run as a user would let them.
    pending.catch(() => {});
    let settled = false;
    pending.then(() => { settled = true; }, () => { settled = true; });
    const reasons: string[] = [];
    while (!settled) {
      for (const row of h.approvals(s.sid, 'waiting')) {
        reasons.push(row.reason);
        const resolved = await h.pipe.request('approval.resolve', { approval_id: row.id, decision: 'approve' });
        assert.ok(resolved.result, JSON.stringify(resolved));
      }
      await sleep(100);
    }
    assert.ok(reasons.some((r) => /password field/.test(r)), `no password-field approval was asked: ${JSON.stringify(reasons)}`);
    const batch = await pending;
    const reply = batch.steps.batch.reply.result;
    assert.notEqual(reply.isError, true, JSON.stringify(reply));
    assert.equal(reply.content.length, 2, 'the batch answer is one text item plus the screen data label');
    assert.match(reply.content[1].text, /untrusted screen data/);
    const answer = JSON.parse(reply.content[0].text);
    assert.deepEqual(answer.steps.map((x: any) => [x.step, x.tool, x.status]), [[1, 'type', 'ok'], [2, 'type', 'ok'], [3, 'click', 'ok'], [4, 'wait_for', 'ok']], JSON.stringify(answer));
    assert.equal(JSON.parse(answer.steps[3].text).found, true, 'wait_for url_includes /done did not find the url');
  } finally {
    page.close();
    await h.done();
  }
});

// protects=a step on a ref that left the page fails, the steps after it read skipped, and the batch writes exactly 2 browser.tool rows
// fails_when=a step after the failed one runs, a skipped step carries text, the failed step is not the error on the removed ref, or the row count is not 2
// no_claim=the approval path, and the look session (the next test)
test('M7-01c a batch whose step 2 is on a removed ref skips steps 3 and 4 and writes 2 browser.tool rows', options, async () => {
  const h: Harness = await boot();
  try {
    const s = await h.session(login(true), 'act');
    await h.openWorkbench();
    const snap = await s.job([['snap', 'browser.snapshot', { pane_id: s.pane }]]);
    const text = String(snap.steps.snap.reply.result?.text ?? '');
    const rowsBefore = (await h.toolRows()).length;
    const batch = await s.job([['batch', 'mcp.call', {
      name: 'batch',
      arguments: {
        pane_id: s.pane,
        steps: [
          { tool: 'type', args: { ref: refOf(text, 'user'), text: 'alice' } },
          { tool: 'type', args: { ref: refOf(text, 'pass'), text: 'hunter2' } },
          { tool: 'click', args: { ref: refOf(text, 'Sign in') } },
          { tool: 'wait_for', args: { url_includes: '/done', timeout_ms: 2000 } },
        ],
      },
    }]]);
    const reply = batch.steps.batch.reply.result;
    assert.notEqual(reply.isError, true, JSON.stringify(reply));
    const answer = JSON.parse(reply.content[0].text);
    assert.deepEqual(answer.steps.map((x: any) => x.status), ['ok', 'error', 'skipped', 'skipped'], JSON.stringify(answer));
    assert.match(answer.steps[1].text, /no longer on the page/);
    assert.equal('text' in answer.steps[2], false, 'a skipped step carries no text');
    assert.equal('text' in answer.steps[3], false, 'a skipped step carries no text');
    const rowsAfter = await h.toolRows();
    assert.equal(rowsAfter.length - rowsBefore, 2, `browser.tool rows from the batch: ${JSON.stringify(rowsAfter)}`);
  } finally {
    await h.done();
  }
});

// protects=a look session cannot run a batch holding click: the whole batch is refused with -32039 before any step, and no browser.tool row is written
// fails_when=the batch runs, the refusal is not -32039 naming act, or a browser.tool row appears
// no_claim=the MCP tools/list for a look session (the MCP side only lists tools)
test('M7-01c a look session batch holding click fails -32039 before any step runs, with 0 browser.tool rows', options, async () => {
  const h: Harness = await boot();
  try {
    const s = await h.session(login(false), 'look');
    await h.openWorkbench();
    const snap = await s.job([['snap', 'browser.snapshot', { pane_id: s.pane }]]);
    const text = String(snap.steps.snap.reply.result?.text ?? '');
    const rowsBefore = (await h.toolRows()).length;
    const batch = await s.job([['batch', 'mcp.call', {
      name: 'batch',
      arguments: { pane_id: s.pane, steps: [{ tool: 'click', args: { ref: refOf(text, 'Sign in') } }] },
    }]]);
    const reply = batch.steps.batch.reply.result;
    assert.equal(reply.isError, true, JSON.stringify(reply));
    const message = String(reply.content[0].text);
    assert.match(message, /^-32039 /, message);
    assert.match(message, /needs grant act/);
    assert.equal((await h.toolRows()).length - rowsBefore, 0, 'a refused batch wrote a browser.tool row');
  } finally {
    await h.done();
  }
});

// protects=a batch step on a risky button waits for its approval, and a rejection makes the steps after it skipped
// fails_when=the batch runs the risky click without an approval row, the rejection does not stop the batch, or the step after it runs
// no_claim=the approve answer (not tested here), and the approval card text
test('M7-01c a batch step on a risky button waits for approval; a rejection skips the steps after it', options, async () => {
  const h: Harness = await boot();
  try {
    const s = await h.session(riskyPage, 'act');
    await h.openWorkbench();
    const snap = await s.job([['snap', 'browser.snapshot', { pane_id: s.pane }]]);
    const text = String(snap.steps.snap.reply.result?.text ?? '');
    const pending = s.job([['batch', 'mcp.call', {
      name: 'batch',
      arguments: {
        pane_id: s.pane,
        steps: [
          { tool: 'type', args: { ref: refOf(text, 'user'), text: 'alice' } },
          { tool: 'click', args: { ref: refOf(text, 'Delete account') } },
          { tool: 'type', args: { ref: refOf(text, 'user'), text: 'bob' } },
        ],
      },
    }]]);
    // A failure before the await below must not leak the batch's rejection past the test.
    pending.catch(() => {});
    const row = await until(() => h.approvals(s.sid, 'waiting')[0] ?? null, 30_000);
    assert.match(row.reason, /risky control: Delete account/);
    const resolved = await h.pipe.request('approval.resolve', { approval_id: row.id, decision: 'reject' });
    assert.ok(resolved.result, JSON.stringify(resolved));
    const batch = await pending;
    const answer = JSON.parse(batch.steps.batch.reply.result.content[0].text);
    assert.deepEqual(answer.steps.map((x: any) => x.status), ['ok', 'error', 'skipped'], JSON.stringify(answer));
    assert.equal(h.approvals(s.sid, 'rejected').length, 1, 'the approval row is not rejected');
  } finally {
    await h.done();
  }
});

// protects=a snapshot tags the 4 refs under an overlay [covered] and the 3 below the fold [offscreen], and the page does not scroll
// fails_when=a covered count other than 4, an offscreen count other than 3, a tag on the wrong button, or window.scrollY changes across the snapshot
// no_claim=the 400-ref cap and the timing (the timing test measures only)
test('M7-01e a 10-button page tags exactly 4 covered and 3 offscreen, and window.scrollY is unchanged', options, async () => {
  const h: Harness = await boot();
  try {
    const s = await h.session(tagPage, undefined);
    await h.openWorkbench();
    const job = await s.job([
      ['ready', 'browser.wait_for', { pane_id: s.pane, text: 'v3', timeout_ms: 20000 }],
      ['y0', 'browser.evaluate', { pane_id: s.pane, expression: 'window.scrollY' }],
      ['snap', 'browser.snapshot', { pane_id: s.pane, max_tokens: 100000 }],
      ['y1', 'browser.evaluate', { pane_id: s.pane, expression: 'window.scrollY' }],
    ]);
    assert.equal(job.steps.ready.reply.result?.found, true, JSON.stringify(job.steps.ready));
    const lines = String(job.steps.snap.reply.result?.text ?? '').split(/\r?\n/);
    const covered = lines.filter((l) => l.includes(' [covered]'));
    const offscreen = lines.filter((l) => l.includes(' [offscreen]'));
    assert.equal(covered.length, 4, `covered lines: ${covered.join(' | ')}`);
    assert.equal(offscreen.length, 3, `offscreen lines: ${offscreen.join(' | ')}`);
    assert.ok(covered.every((l) => /"c\d"/.test(l)), `a covered tag is on a button other than c1 to c4: ${covered.join(' | ')}`);
    assert.ok(offscreen.every((l) => /"o\d"/.test(l)), `an offscreen tag is on a button other than o1 to o3: ${offscreen.join(' | ')}`);
    assert.equal(job.steps.y1.reply.result?.value, job.steps.y0.reply.result?.value, 'the snapshot scrolled the page');
  } finally {
    await h.done();
  }
});

// protects=nothing is asserted: the cost of tags on a 400-ref snapshot is measured and reported (tags cannot be switched off without editing source)
// fails_when=the snapshot itself fails, or fewer than 400 refs come back
// no_claim=the 1.2x bound: with no baseline the number is only reported
test('M7-01e measures a 400-ref snapshot with tags (reported, not asserted)', options, async (t) => {
  const h: Harness = await boot();
  try {
    const s = await h.session(manyPage, undefined);
    await h.openWorkbench();
    const job = await s.job([
      ['ready', 'browser.wait_for', { pane_id: s.pane, text: 'b399', timeout_ms: 20000 }],
      ...[1, 2, 3, 4, 5].map((i): Step => [`snap${i}`, 'browser.snapshot', { pane_id: s.pane, max_tokens: 100000 }]),
    ]);
    const times = [1, 2, 3, 4, 5].map((i) => {
      const step = job.steps[`snap${i}`];
      assert.ok(step.reply.result?.text, JSON.stringify(step.reply));
      assert.ok(String(step.reply.result.text).split(/\r?\n/).filter((l) => l.includes('[ref=')).length >= 400, 'fewer than 400 refs in the snapshot');
      return step.ms;
    }).sort((a, b) => a - b);
    t.diagnostic(`400-ref snapshot with tags, ms over 5 runs: ${times.join(', ')} (median ${times[2]}); no untagged baseline, not asserted`);
  } finally {
    await h.done();
  }
});

// protects=after a forced detach a click completes within 1 s, a request the policy blocks is still blocked, and the next state event carries reconnected true, once
// fails_when=the click fails or completes more than 1 s after the detach, the blocked loopback server is reached, or no state event carries reconnected, or more than one does
// no_claim=the parked viewport width, and a second detach (the next test)
test('M7-01f after a forced detach a click works within 1 s, a blocked request stays blocked, and reconnected arrives once', options, async () => {
  const h: Harness = await boot();
  const blocked = await hitCounter();
  try {
    const s = await h.session(clickPage, undefined);
    await h.openWorkbench();
    const snap = await s.job([
      ['ready', 'browser.wait_for', { pane_id: s.pane, text: 'Go', timeout_ms: 20000 }],
      ['snap', 'browser.snapshot', { pane_id: s.pane }],
    ]);
    const go = refOf(String(snap.steps.snap.reply.result?.text ?? ''), 'Go');
    // No-detach control: the same click and hash check before any detach. If this fails, the fixture or the hash check is wrong.
    const control = await s.job([
      ['click', 'browser.click', { pane_id: s.pane, ref: go }],
      ['marker', 'browser.evaluate', { pane_id: s.pane, expression: 'document.body.dataset.clicked' }],
    ]);
    assert.equal(control.steps.click.reply.error, undefined, `control click: ${JSON.stringify(control.steps.click.reply)}`);
    assert.equal(control.steps.marker.reply.result?.value, '1', 'control: the click without a detach did not run the onclick');
    await s.job([['reset', 'browser.evaluate', { pane_id: s.pane, expression: "document.body.dataset.clicked = ''; true" }]]);
    const before = (await h.wb.paneEvents()).length;
    const detachedAt = Date.now();
    await h.wb.paneAct(s.pane);
    const click = await s.job([['click', 'browser.click', { pane_id: s.pane, ref: go }]]);
    assert.equal(click.steps.click.reply.error, undefined, JSON.stringify(click.steps.click.reply));
    const clickMs = click.steps.click.at - detachedAt;
    assert.ok(clickMs <= 1000, `the click finished ${clickMs} ms after the detach`);
    const after = await s.job([
      ['marker', 'browser.evaluate', { pane_id: s.pane, expression: 'document.body.dataset.clicked' }],
      ['probe', 'browser.evaluate', { pane_id: s.pane, expression: probe(blocked.url) }],
    ]);
    assert.equal(after.steps.marker.reply.result?.value, '1', 'the post-detach click did not run the onclick');
    assert.equal(after.steps.probe.reply.result?.value, 'blocked', 'the policy-blocked request was not refused');
    await sleep(500);
    assert.equal(blocked.hits(), 0, 'the policy-blocked loopback server was reached after the detach');
    await until(async () => (await h.wb.paneEvents()).slice(before).some((e) => e.pane_id === s.pane && e.reconnected === true), 5000);
    await sleep(1000);
    const flagged = (await h.wb.paneEvents()).slice(before).filter((e) => e.pane_id === s.pane && e.reconnected === true);
    assert.equal(flagged.length, 1, `state events with reconnected true: ${JSON.stringify(flagged)}`);
    assert.equal(flagged[0].kind, 'state');
  } finally {
    blocked.close();
    await h.done();
  }
});

// protects=two forced detaches within 5 s leave the pane crashed: its tools fail -32034 with "the page's debugger keeps detaching"
// fails_when=a tool succeeds after the second detach, or the error is not -32034 with that text
// no_claim=whether the pane retries between the detaches, and the single detach (the test before)
test('M7-01f two forced detaches within 5 s leave tools failing -32034 "the page\'s debugger keeps detaching"', options, async () => {
  const h: Harness = await boot();
  try {
    const s = await h.session(clickPage, undefined);
    await h.openWorkbench();
    await s.job([['ready', 'browser.wait_for', { pane_id: s.pane, text: 'Go', timeout_ms: 20000 }]]);
    await h.wb.paneAct(s.pane);
    await sleep(300);
    await h.wb.paneAct(s.pane);
    await sleep(1500);
    const job = await s.job([
      ['ev', 'browser.evaluate', { pane_id: s.pane, expression: '1 + 1' }],
      ['snap', 'browser.snapshot', { pane_id: s.pane }],
    ]);
    for (const name of ['ev', 'snap']) {
      const error = job.steps[name].reply.error;
      assert.equal(error?.code, -32034, `${name}: ${JSON.stringify(job.steps[name].reply)}`);
      assert.ok(error.message.includes("the page's debugger keeps detaching"), `${name}: ${error.message}`);
    }
  } finally {
    await h.done();
  }
});
