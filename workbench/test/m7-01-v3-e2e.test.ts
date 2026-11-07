import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, openSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import net from 'node:net';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, sleep, startCore, teardownCore, until, uiHello } from '../../core/test/helpers.ts';
import { killTree } from '../../tests/helpers/kill-tree.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const xvfb = spawnSync('which', ['xvfb-run']).status === 0;
const runnable = process.env.METATROOPER_BROWSER_E2E === '1' && existsSync(electron) && (process.platform === 'win32' || (process.platform === 'linux' && xvfb));

type Iso = ReturnType<typeof isolation>;
type Step = [name: string, method: string, params: Record<string, unknown>];
type Entry = { result?: any; error?: { code: number; message: string }; t0: number; t1: number };
type Out = { hello: unknown; steps: Record<string, Entry> };

// Starts core, a session whose fake engine drives the panes, and one pane per URL. The engine is the copied fixture that stamps each step.
// A loopback port is loadable only when the session has a ready dev server on it, so devPort registers the fixture site that way.
async function openSession(iso: Iso, paneUrls: string[], devPort?: number) {
  const registry = join(iso.home, 'engines.json');
  const engineFile = join(iso.home, 'browser-engine.cjs');
  writeFileSync(registry, JSON.stringify([{ id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 1, version_cmd: [process.execPath, '--version'] }]));
  writeFileSync(engineFile, readFileSync(join(workbench, 'test', 'fixtures', 'm7-01-v3-engine.cjs')));
  const env = { ...iso.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...iso, env });
  const pipe = await client(iso.prefix);
  await uiHello(pipe, iso.home);
  const project = join(iso.home, 'project');
  mkdirSync(project);
  const projectId = (await pipe.request('project.open', { path: project })).result.project_id as string;
  const session = await pipe.request('session.launch', { project_id: projectId, engine_id: 'fake', prompt: engineFile });
  const sid = session.result.session_id as string;
  if (devPort) {
    const db = new DatabaseSync(join(iso.home, 'troop.db'));
    try {
      db.prepare("INSERT INTO session_dev_server (id, session_id, project_id, port, url, pid, matched_by, status, seen_at) VALUES (?, ?, ?, ?, ?, ?, 'printed', 'ready', ?)")
        .run('ds_m7_fixture_site', sid, projectId, devPort, `http://127.0.0.1:${devPort}/`, process.pid, new Date().toISOString());
    } finally {
      db.close();
    }
  }
  const paneIds: string[] = [];
  for (const url of paneUrls) {
    paneIds.push((await pipe.request('pane.open', { project_id: projectId, session_id: sid, url })).result.pane_id as string);
  }
  pipe.close();
  await until(() => {
    const db = new DatabaseSync(join(iso.home, 'troop.db'));
    try {
      return (db.prepare('SELECT pid FROM session WHERE id = ?').get(sid) as { pid: number | null } | undefined)?.pid;
    } finally {
      db.close();
    }
  }, 15000);
  return { core, env, sid, paneIds };
}

// Starts the workbench; a remote debugging port is opened only when asked, so a test can watch CDP events.
function startWorkbench(iso: Iso, env: Record<string, string>, debugPort?: number): ChildProcess {
  const extra = debugPort ? [`--remote-debugging-port=${debugPort}`] : [];
  const args: [string, string[]] = process.platform === 'win32'
    ? [electron, [...extra, workbench]]
    : ['xvfb-run', ['-a', '-s', '-screen 0 1400x900x24', electron, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', ...extra, workbench]];
  return spawn(args[0], args[1], { env, stdio: ['ignore', 'ignore', openSync(join(iso.home, 'workbench.err'), 'w')], detached: process.platform !== 'win32' });
}

// Writes the job for the session, then waits for the engine to write its timed results.
async function runJob(iso: Iso, sid: string, steps: Step[], timeoutMs: number): Promise<Out> {
  writeFileSync(join(iso.home, `browser-job-${sid}.json`), JSON.stringify({ steps }));
  const outFile = join(iso.home, `browser-out-${sid}.json`);
  return until(() => (existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) as Out : null), timeoutMs);
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const srv = net.createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => ok(port));
    });
  });
}

// Fixture site on localhost. Each page is served once per request; `marks` keeps the server-side arrival time of the first request for a name.
async function startSite() {
  const marks = new Map<string, number>();
  const slowDone: number[] = [];
  const pages: Record<string, string> = {
    '/blank': '<!doctype html><title>blank</title><p>blank</p>',
    '/loading': '<!doctype html><title>loading</title><div id="status">Loading</div><script>setTimeout(() => { document.getElementById("status").remove(); fetch("/mark?name=gone", { keepalive: true }); }, 1500);</script>',
    '/ready': '<!doctype html><title>ready</title><p>Ready</p>',
    '/start': '<!doctype html><title>start</title><p>start</p><script>setTimeout(() => location.replace("/done"), 1000);</script>',
    '/done': '<!doctype html><title>done</title><p>done</p>',
    '/idle': '<!doctype html><title>idle</title><p>idle</p><script>fetch("/slow?ms=2000");</script>',
  };
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/slow') {
      res.on('finish', () => slowDone.push(Date.now()));
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('slow');
      }, Number(url.searchParams.get('ms') ?? 0));
      return;
    }
    if (url.pathname === '/mark') {
      const name = url.searchParams.get('name') ?? '';
      if (!marks.has(name)) marks.set(name, Date.now());
      res.writeHead(204).end();
      return;
    }
    const page = pages[url.pathname];
    if (page === undefined) {
      res.writeHead(404).end();
      return;
    }
    if (!marks.has(`arrive:${url.pathname}`)) marks.set(`arrive:${url.pathname}`, Date.now());
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(page);
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    base: `http://127.0.0.1:${port}`,
    marks,
    slowDone,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((ok) => server.close(() => ok()));
    },
  };
}

// Connects a second CDP client to the pane's page target and records the time each isolated world context is created.
async function watchIsolatedWorlds(port: number, pageUrl: string) {
  const created: number[] = [];
  let target: { webSocketDebuggerUrl: string } | undefined;
  let last = 'no answer from the debugging port';
  const deadline = Date.now() + 20000;
  while (!target && Date.now() < deadline) {
    try {
      const list = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as Array<{ type: string; url: string; webSocketDebuggerUrl?: string }>;
      last = JSON.stringify(list.map((t) => ({ type: t.type, url: t.url })));
      const found = list.find((t) => t.type === 'page' && t.url === pageUrl && t.webSocketDebuggerUrl);
      target = found?.webSocketDebuggerUrl ? { webSocketDebuggerUrl: found.webSocketDebuggerUrl } : undefined;
    } catch (err) {
      last = String(err);
      target = undefined;
    }
    if (!target) await sleep(200);
  }
  assert.ok(target, `pane page target is listed on the remote debugging port; last list: ${last}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise<void>((ok, fail) => {
    ws.onopen = () => ok();
    ws.onerror = () => fail(new Error('CDP websocket failed'));
  });
  // Electron also makes an "Electron Isolated Context" for each document; only the workbench's own world (worldName 'metatrooper') is counted.
  ws.onmessage = (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.method === 'Runtime.executionContextCreated' && m.params?.context?.name === 'metatrooper') created.push(Date.now());
  };
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.enable' }));
  return { created, close: () => ws.close() };
}

// protects=an annotated screenshot numbers exactly the refs in view (12 of 20), leaves no overlay node in the page, and does not move the page.
// fails_when=the legend lists the 8 below-the-fold refs, the overlay is still in the DOM after the call, window.scrollY changes, or a pane with no snapshot is annotated instead of refused.
// no_claim=does not check the picture's pixels, the text item the MCP server adds, or child-frame refs.
test('M7-01b numbered screenshot: legend of 12, overlay removed, page not scrolled, refused with no snapshot', { skip: !runnable }, async () => {
  await buildGenerated();
  const iso = isolation();

  // Buttons are absolutely placed in document coordinates: 12 at y 400 to 500 (in view at scroll 400), 8 at y 3000 (below the fold).
  const annotateHtml = `<!doctype html><html><head><title>annotate</title></head><body>
<div style="height:4000px"></div>
<script>
  const place = (label, left, top) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'position:absolute;width:100px;height:30px;padding:0;border:0;margin:0;left:' + left + 'px;top:' + top + 'px';
    document.body.appendChild(b);
  };
  for (let i = 0; i < 12; i++) place('in' + i, 20 + (i % 4) * 120, 400 + Math.floor(i / 4) * 50);
  for (let i = 0; i < 8; i++) place('out' + i, 20 + (i % 4) * 120, 3000 + Math.floor(i / 4) * 50);
  window.scrollTo(0, 400);
</script></body></html>`;
  const annotateUrl = 'data:text/html,' + encodeURIComponent(annotateHtml);
  const freshUrl = 'data:text/html,' + encodeURIComponent('<!doctype html><title>fresh</title><p>fresh</p>');

  const session = await openSession(iso, [annotateUrl, freshUrl]);
  const [paneA, paneB] = session.paneIds;
  let wb: ChildProcess | null = null;
  try {
    wb = startWorkbench(iso, session.env);
    const out = await runJob(iso, session.sid, [
      ['ready', 'browser.wait_for', { pane_id: paneA, text: 'in11', timeout_ms: 15000 }],
      ['scrollBefore', 'browser.evaluate', { pane_id: paneA, expression: 'window.scrollY' }],
      ['snap', 'browser.snapshot', { pane_id: paneA }],
      ['annot', 'browser.screenshot', { pane_id: paneA, annotate: true }],
      ['overlays', 'browser.evaluate', { pane_id: paneA, expression: "document.querySelectorAll('#mt-annotate-overlay').length" }],
      ['scrollAfter', 'browser.evaluate', { pane_id: paneA, expression: 'window.scrollY' }],
      ['freshAnnot', 'browser.screenshot', { pane_id: paneB, annotate: true }],
    ], 90000);

    // Fixture sanity: the page starts scrolled to 400, and the snapshot holds all 20 buttons.
    assert.equal(out.steps.scrollBefore.result?.value, 400);
    const snapText = String(out.steps.snap.result?.text ?? '');
    const refOf = new Map<string, string>();
    for (const m of snapText.matchAll(/button "((?:in|out)\d+)" \[ref=((?:f\d+)?e\d+)\]/g)) refOf.set(m[1], m[2]);
    assert.equal(refOf.size, 20, 'snapshot lists the 20 buttons');

    // The annotated screenshot has exactly 12 legend lines, numbered 1 to 12.
    const shot = out.steps.annot;
    assert.equal(shot.error, undefined, JSON.stringify(shot.error));
    const legend = shot.result?.legend as string[];
    assert.ok(Array.isArray(legend), 'screenshot result has a legend array');
    assert.equal(legend.length, 12);
    const parsed = legend.map((line) => {
      const m = line.match(/^(\d+) -> ((?:f\d+)?e\d+), (-?\d+),(-?\d+),(\d+),(\d+)$/);
      assert.ok(m, `legend line has the n -> ref, x,y,w,h shape: ${line}`);
      return { n: Number(m[1]), ref: m[2], x: Number(m[3]), y: Number(m[4]), w: Number(m[5]), h: Number(m[6]) };
    });
    assert.deepEqual(parsed.map((p) => p.n), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

    // Each in-view button is in the legend once, at its CSS box measured from the picture's top-left (page scrolled to 400).
    const byRef = new Map(parsed.map((p) => [p.ref, p]));
    for (let i = 0; i < 12; i++) {
      const p = byRef.get(refOf.get(`in${i}`) ?? '');
      assert.ok(p, `in${i} is in the legend`);
      const col = i % 4;
      const row = Math.floor(i / 4);
      assert.ok(Math.abs(p.x - (20 + col * 120)) <= 1, `in${i} x`);
      assert.ok(Math.abs(p.y - row * 50) <= 1, `in${i} y`);
      assert.ok(Math.abs(p.w - 100) <= 1 && Math.abs(p.h - 30) <= 1, `in${i} size`);
    }
    for (let i = 0; i < 8; i++) assert.equal(byRef.has(refOf.get(`out${i}`) ?? ''), false, `out${i} is not numbered`);

    // The overlay is gone and the page did not move.
    assert.equal(out.steps.overlays.result?.value, 0);
    assert.equal(out.steps.scrollAfter.result?.value, out.steps.scrollBefore.result?.value);

    // A pane with no snapshot refuses annotation.
    assert.equal(out.steps.freshAnnot.error?.code, -32602);
    assert.match(out.steps.freshAnnot.error?.message ?? '', /snapshot/i);
  } finally {
    killTree(wb?.pid);
    await sleep(300);
    await teardownCore(session.core, iso);
  }
});

// protects=text_gone, timeout clamping, url_includes and idle_ms resolve within their stated windows, and a long wait makes at most one isolated world while a navigate then evaluate makes exactly one.
// fails_when=text_gone waits past 2 s after the text is removed, timeout_ms 60000 is not clamped to 30000, url_includes lags more than 500 ms after the redirect, idle_ms resolves before 500 ms or more than 700 ms after the last finished request, or the world cache is not kept (a second metatrooper world is made for one document).
// no_claim=the world counts are read from Runtime.executionContextCreated events of a second CDP client, filtered to the workbench's world name (metatrooper), not from Page.createIsolatedWorld itself; the idle upper bound carries slack beyond the spec's 700 ms; the redirect time is the fixture server's arrival time at /done. Does not test the MCP layer.
test('M7-01d wider waits: text_gone, clamp, url_includes, idle_ms, and isolated world counts', { skip: !runnable }, async () => {
  await buildGenerated();
  const iso = isolation();
  const site = await startSite();
  let wb: ChildProcess | null = null;
  const pageUrl = `${site.base}/blank`;
  const session = await openSession(iso, [pageUrl], site.port);
  const paneId = session.paneIds[0];
  try {
    const debugPort = await freePort();
    wb = startWorkbench(iso, session.env, debugPort);
    const watch = await watchIsolatedWorlds(debugPort, pageUrl);
    try {
      const out = await runJob(iso, session.sid, [
        ['loadingNav', 'browser.navigate', { pane_id: paneId, url: `${site.base}/loading` }],
        ['gone', 'browser.wait_for', { pane_id: paneId, text_gone: 'Loading', timeout_ms: 5000 }],
        ['readyNav', 'browser.navigate', { pane_id: paneId, url: `${site.base}/ready` }],
        ['clamp', 'browser.wait_for', { pane_id: paneId, text: 'Ready', timeout_ms: 60000 }],
        ['startNav', 'browser.navigate', { pane_id: paneId, url: `${site.base}/start` }],
        ['urlWait', 'browser.wait_for', { pane_id: paneId, url_includes: '/done', timeout_ms: 5000 }],
        ['idleNav', 'browser.navigate', { pane_id: paneId, url: `${site.base}/idle` }],
        ['idleWait', 'browser.wait_for', { pane_id: paneId, idle_ms: 500, timeout_ms: 10000 }],
        ['worldWait', 'browser.wait_for', { pane_id: paneId, text: 'never-appears-on-this-page', timeout_ms: 10000 }],
        ['navWorld', 'browser.navigate', { pane_id: paneId, url: `${site.base}/ready` }],
        ['evalWorld', 'browser.evaluate', { pane_id: paneId, expression: 'document.title' }],
      ], 120000);
      const step = (name: string) => {
        const s = out.steps[name];
        assert.ok(s, `step ${name} ran`);
        return s;
      };

      // text_gone: the text leaves at about 1.5 s; the wait must have started before that and resolve within 2 s of it.
      const gone = step('gone');
      const removedAt = site.marks.get('gone');
      assert.ok(removedAt !== undefined, 'the fixture page reported its removal');
      assert.equal(gone.result?.found, true);
      assert.ok(gone.t0 < removedAt, 'the wait started before the text was removed');
      assert.ok(gone.t1 - removedAt <= 2000, `text_gone resolved ${gone.t1 - removedAt} ms after removal`);
      assert.ok(gone.t1 - gone.t0 <= 2000, `text_gone resolved ${gone.t1 - gone.t0} ms after the call began`);

      // timeout_ms above the cap: the condition holds, and the result says it was clamped to 30000.
      const clamp = step('clamp');
      assert.equal(clamp.result?.found, true);
      assert.equal(clamp.result?.clamped_to_ms, 30000);

      // url_includes: the redirect lands on /done; the wait must resolve within 500 ms of that arrival.
      const urlWait = step('urlWait');
      const redirectAt = site.marks.get('arrive:/done');
      assert.ok(redirectAt !== undefined, 'the redirect target was requested');
      assert.equal(urlWait.result?.found, true);
      assert.ok(urlWait.t0 < redirectAt, 'the wait started before the redirect');
      assert.ok(urlWait.t1 - redirectAt <= 500, `url_includes resolved ${urlWait.t1 - redirectAt} ms after the redirect`);

      // idle_ms: the page's one slow request finishes at the last finish time; the wait must end 500 to 700 ms after it.
      const idleWait = step('idleWait');
      assert.equal(idleWait.result?.found, true);
      assert.ok(site.slowDone.length >= 1, 'the slow fixture request finished');
      const lastFinish = Math.max(...site.slowDone);
      assert.ok(idleWait.t0 < lastFinish, 'the wait started while the request was still open');
      const idleGap = idleWait.t1 - lastFinish;
      assert.ok(idleGap >= 500 && idleGap <= 700, `idle_ms resolved ${idleGap} ms after the last request finished`);

      // Worlds: the 10 s wait makes at most one isolated world; a navigation then an evaluate makes exactly one.
      assert.ok(watch.created.length >= 1, 'the CDP watcher saw isolated world creation at all');
      const worldWait = step('worldWait');
      assert.equal(worldWait.result?.found, false);
      assert.ok(worldWait.t1 - worldWait.t0 >= 9500, 'the 10 s wait ran for its full length');
      const inWait = watch.created.filter((t) => t >= worldWait.t0 && t <= worldWait.t1).length;
      assert.ok(inWait <= 1, `at most 1 isolated world in the 10 s wait, saw ${inWait}`);
      const navWorld = step('navWorld');
      const evalWorld = step('evalWorld');
      const inNav = watch.created.filter((t) => t >= navWorld.t0 && t <= evalWorld.t1).length;
      assert.equal(inNav, 1, `navigate then evaluate made exactly one isolated world, saw ${inNav}`);
    } finally {
      watch.close();
    }
  } finally {
    killTree(wb?.pid);
    await sleep(300);
    await teardownCore(session.core, iso);
    await site.close();
  }
});
