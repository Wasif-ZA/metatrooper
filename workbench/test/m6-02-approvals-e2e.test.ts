import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, sleep, startCore, teardownCore, uiHello, until } from '../../core/test/helpers.ts';
import { killTree } from '../../tests/helpers/kill-tree.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const xvfb = spawnSync('which', ['xvfb-run']).status === 0;

// Opt-in gate: requires METATROOPER_BROWSER_E2E=1 and Electron
const runnable = process.env.METATROOPER_BROWSER_E2E === '1' && existsSync(electron) && (process.platform === 'win32' || (process.platform === 'linux' && xvfb));

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  return new Promise((res) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => res({ server, port: (server.address() as { port: number }).port }));
  });
}

test('M6-02a / M6-02b / M6-02c / M6-02d through a real pane: Send, Enter, credential text, session scope, rename, password, 120 s expiry', { skip: !runnable && 'needs METATROOPER_BROWSER_E2E=1 and Electron', timeout: 300_000 }, paneApprovalsE2e);

async function paneApprovalsE2e() {
  await buildGenerated();
  const iso = isolation();

  // Create fake engine registry using m6-02-engine fixture
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{
    id: 'fake',
    command: process.execPath,
    prompt_arg: 'positional',
    state_source: 'hooks',
    roles: ['worker'],
    cost_rank: 1,
    version_cmd: [process.execPath, '--version'],
  }]));

  // Fixture page with Send button, password field, and plain Notes field
  const fixtureHtml = `<!doctype html>
<html>
<head><title>Approvals Fixture</title></head>
<body>
  <div>Counter: <span id="counter">0</span></div>
  <button id="sendBtn" onclick="window.count = (window.count || 0) + 1; document.getElementById('counter').textContent = window.count;">Send</button>
  <label for="pw">Password</label>
  <input id="pw" type="password" />
  <label for="plain">Notes</label>
  <input id="plain" type="text" />
  <send-box></send-box>
  <iframe id="frame" srcdoc="<button id='frameSend'>Send</button>"></iframe>
  <div id="closedHost"></div>
  <button id="focusClosed">Focus hidden</button>
  <button id="glide" style="margin-top: 3000px" onclick="this.dataset.hits = (+this.dataset.hits || 0) + 1">Next</button>
  <script>
    window.count = 0;
    customElements.define('send-box', class extends HTMLElement {
      constructor() { super(); this.attachShadow({ mode: 'open' }).innerHTML = '<button id="shadowSend">Send</button>'; }
    });
    const closed = document.getElementById('closedHost').attachShadow({ mode: 'closed' });
    closed.innerHTML = '<button>Go</button>';
    document.getElementById('focusClosed').onclick = () => closed.querySelector('button').focus();
  </script>
</body>
</html>`;

  const fixtureServer = await listen((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(fixtureHtml);
  });

  const env = { ...iso.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...iso, env });
  let wb: ChildProcess | null = null;
  const pipes: Array<{ close?: () => void; destroy?: () => void }> = [];
  let db: DatabaseSync | null = null;
  let stepIndex = 0;

  try {
    const initPipe = await client(iso.prefix);
    pipes.push(initPipe);
    await uiHello(initPipe, iso.home);

    const project = join(iso.home, 'project');
    mkdirSync(project);
    // The project allows 127.0.0.1, so the fixture page loads before M6-3 session ports exist
    mkdirSync(join(project, '.troop'));
    writeFileSync(join(project, '.troop', 'config.json'), JSON.stringify({ allow_hosts: ['127.0.0.1'] }));
    const opened = await initPipe.request('project.open', { path: project });
    const projectId = opened.result.project_id as string;

    const enginePrompt = join(workbench, 'test', 'fixtures', 'm6-02-engine.cjs');
    const launched = await initPipe.request('session.launch', {
      project_id: projectId,
      engine_id: 'fake',
      prompt: enginePrompt,
    });
    const sessionId = launched.result.session_id as string;

    const pane = await initPipe.request('pane.open', {
      project_id: projectId,
      session_id: sessionId,
      url: `http://127.0.0.1:${fixtureServer.port}/fixture`,
    });
    const paneId = pane.result.pane_id as string;

    // Database connection for querying approval rows
    db = new DatabaseSync(join(iso.home, 'troop.db'));
    db.exec('PRAGMA busy_timeout = 5000');
    await until(() => (db!.prepare('SELECT pid FROM session WHERE id = ?').get(sessionId) as { pid: number | null }).pid, 15_000);

    // Spawn Electron workbench
    const wbArgs: [string, string[]] = process.platform === 'win32'
      ? [electron, [workbench]]
      : ['xvfb-run', ['-a', '-s', '-screen 0 1400x900x24', electron, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', workbench]];
    wb = spawn(wbArgs[0], wbArgs[1], { env, stdio: ['ignore', 'ignore', openSync(join(iso.home, 'workbench.err'), 'w')], detached: process.platform !== 'win32' });

    // Wait until m6-02-engine completes MCP initialization
    await until(() => existsSync(join(iso.home, 'm602-ready.json')), 20_000).catch((e) => {
      const errLog = existsSync(join(iso.home, 'm602-engine.log')) ? readFileSync(join(iso.home, 'm602-engine.log'), 'utf8') : 'no engine log';
      const mcpErr = existsSync(join(iso.home, 'mcp-stderr.log')) ? readFileSync(join(iso.home, 'mcp-stderr.log'), 'utf8') : 'no mcp stderr';
      const wbErr = existsSync(join(iso.home, 'workbench.err')) ? readFileSync(join(iso.home, 'workbench.err'), 'utf8').slice(-1500) : 'no wb err';
      throw new Error(`${e.message}; engine: ${errLog}; mcp stderr: ${mcpErr}; wb: ${wbErr}`);
    });

    function sendStep(name: string, args: Record<string, unknown> = {}) {
      const step = ++stepIndex;
      const stepFile = join(iso.home, `m602-step-${step}.json`);
      const outFile = join(iso.home, `m602-out-${step}.json`);
      writeFileSync(stepFile, JSON.stringify({ name, arguments: args }));
      return {
        step,
        waitResult: (timeoutMs = 30_000) => until(() => {
          if (existsSync(outFile)) {
            try {
              return JSON.parse(readFileSync(outFile, 'utf8'));
            } catch {}
          }
          return null;
        }, timeoutMs),
      };
    }

    async function callTool(name: string, args: Record<string, unknown> = {}) {
      const s = sendStep(name, args);
      return s.waitResult();
    }

    // Pipe for resolving approvals
    const uiPipe = await client(iso.prefix);
    pipes.push(uiPipe);
    await uiHello(uiPipe, iso.home);

    // Wait for pane ready and fetch snapshot lines
    let sendRef = 'e1';
    let pwRef = 'e2';
    let plainRef = 'e3';

    await until(async () => {
      const snap = await callTool('snapshot', { pane_id: paneId });
      const text = snap.result?.content?.[0]?.text ?? '';
      if (!text.includes('"Send"')) return false;
      const lines = text.split(/\r?\n/);
      sendRef = lines.find((l: string) => l.includes('"Send"'))?.match(/\[ref=(e\d+)\]/)?.[1] ?? 'e1';
      pwRef = lines.find((l: string) => l.includes('"Password"'))?.match(/\[ref=(e\d+)\]/)?.[1] ?? 'e2';
      plainRef = lines.find((l: string) => l.includes('"Notes"'))?.match(/\[ref=(e\d+)\]/)?.[1] ?? 'e3';
      return true;
    }, 20_000);

    // M6-02a: click Send leaves waiting approval row; reject resolves it with tool error and counter stays 0
    const clickStepA = sendStep('click', { pane_id: paneId, ref: sendRef });

    const approvalA = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 15_000);
    assert.ok(approvalA);

    await uiPipe.request('approval.resolve', { approval_id: approvalA.id, decision: 'reject' });
    const clickResultA = await clickStepA.waitResult();
    assert.equal(clickResultA.result?.isError, true);
    assert.ok(clickResultA.result?.content?.[0]?.text?.includes('rejected'));

    const countEvalA = await callTool('evaluate', { pane_id: paneId, expression: 'document.getElementById("counter").textContent' });
    assert.equal(JSON.parse(countEvalA.result?.content?.[0]?.text).value, '0');

    // M6-02b: focus Send then key Enter creates approval row
    await callTool('evaluate', { pane_id: paneId, expression: 'document.getElementById("sendBtn").focus(); "focused"' });
    const keyStep = sendStep('key', { pane_id: paneId, keys: 'Enter' });

    const keyApproval = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 15_000);
    assert.ok(keyApproval);
    await uiPipe.request('approval.resolve', { approval_id: keyApproval.id, decision: 'reject' });
    await keyStep.waitResult();

    // M6-02b: typing a ghp_ token into plain field creates approval row
    const token = 'ghp_' + 'B'.repeat(36);
    const tokenStep = sendStep('type', { pane_id: paneId, ref: plainRef, text: token });

    const tokenApproval = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 15_000);
    assert.ok(tokenApproval);
    assert.equal(tokenApproval.reason, 'credential text');
    await uiPipe.request('approval.resolve', { approval_id: tokenApproval.id, decision: 'approve' });
    await tokenStep.waitResult();

    // M6-02d: approve Send for session
    const click1Step = sendStep('click', { pane_id: paneId, ref: sendRef });
    const click1Approval = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 15_000);
    assert.ok(click1Approval);
    await uiPipe.request('approval.resolve', { approval_id: click1Approval.id, decision: 'approve', scope: 'session' });
    await click1Step.waitResult();

    // Count approval rows before second click
    const totalApprovalsBefore = (db!.prepare('SELECT count(*) as c FROM approval').get() as any).c;

    // Second Send click uses session scope with no new row and increments counter to 2
    const click2Result = await callTool('click', { pane_id: paneId, ref: sendRef });
    assert.equal(click2Result.result?.isError, undefined);

    const totalApprovalsAfter = (db!.prepare('SELECT count(*) as c FROM approval').get() as any).c;
    assert.equal(totalApprovalsAfter, totalApprovalsBefore);

    const countEval2 = await callTool('evaluate', { pane_id: paneId, expression: 'document.getElementById("counter").textContent' });
    assert.equal(JSON.parse(countEval2.result?.content?.[0]?.text).value, '2');

    // M6-02d: renaming the button in the page asks again
    await callTool('evaluate', { pane_id: paneId, expression: 'document.getElementById("sendBtn").textContent = "Submit"; "renamed"' });

    const snapSubmit = await callTool('snapshot', { pane_id: paneId });
    const submitLines = (snapSubmit.result?.content?.[0]?.text ?? '').split(/\r?\n/);
    const submitRef = submitLines.find((l: string) => l.includes('"Submit"'))?.match(/\[ref=(e\d+)\]/)?.[1] ?? sendRef;

    const renamedClickStep = sendStep('click', { pane_id: paneId, ref: submitRef });
    const renamedApproval = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 15_000);
    assert.ok(renamedApproval);
    await uiPipe.request('approval.resolve', { approval_id: renamedApproval.id, decision: 'approve' });
    await renamedClickStep.waitResult();

    // M6-02d: typing into password field asks every time even with session scope
    const pw1Step = sendStep('type', { pane_id: paneId, ref: pwRef, text: 'secret1' });
    const pw1Approval = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 15_000);
    assert.ok(pw1Approval);
    const resolvePw1 = await uiPipe.request('approval.resolve', { approval_id: pw1Approval.id, decision: 'approve', scope: 'session' });
    assert.deepEqual(resolvePw1.result, { status: 'approved', scope: 'once' });
    await pw1Step.waitResult();

    const pw2Step = sendStep('type', { pane_id: paneId, ref: pwRef, text: 'secret2' });
    const pw2Approval = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 15_000);
    assert.ok(pw2Approval);
    await uiPipe.request('approval.resolve', { approval_id: pw2Approval.id, decision: 'approve' });
    await pw2Step.waitResult();

    // Enter asks when focus is on a Send button inside an open shadow root or a same-origin frame
    async function keyAsks(focus: string, reason: string) {
      await callTool('evaluate', { pane_id: paneId, expression: `${focus}; "focused"` });
      const step = sendStep('key', { pane_id: paneId, keys: 'Enter' });
      const row = await until(() => db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any, 15_000);
      assert.equal(row.reason, reason);
      await uiPipe.request('approval.resolve', { approval_id: row.id, decision: 'reject' });
      assert.equal((await step.waitResult()).result?.isError, true);
    }
    await keyAsks('document.querySelector("send-box").shadowRoot.getElementById("shadowSend").focus()', 'risky control: Send');
    await keyAsks('document.getElementById("frame").contentDocument.getElementById("frameSend").focus()', 'risky control: Send');

    // Enter asks every time when focus is in a closed shadow root, whose control cannot be named
    const focusClosedRef = (await callTool('snapshot', { pane_id: paneId })).result?.content?.[0]?.text.split(/\r?\n/).find((l: string) => l.includes('"Focus hidden"'))?.match(/\[ref=(e\d+)\]/)?.[1];
    assert.equal((await callTool('click', { pane_id: paneId, ref: focusClosedRef })).result?.isError, undefined);
    await keyAsks('"already focused"', 'hidden control');

    // A rename during the cursor glide asks: scrolling Next into view renames it to Send before the click lands
    const glideRef = (await callTool('snapshot', { pane_id: paneId })).result?.content?.[0]?.text.split(/\r?\n/).find((l: string) => l.includes('"Next"'))?.match(/\[ref=(e\d+)\]/)?.[1];
    await callTool('evaluate', { pane_id: paneId, expression: 'window.scrollTo(0, 0); "top"' });
    await sleep(300);
    await callTool('evaluate', { pane_id: paneId, expression: 'document.addEventListener("scroll", () => { document.getElementById("glide").textContent = "Send"; }, { once: true }); "armed"' });
    const glideStep = sendStep('click', { pane_id: paneId, ref: glideRef });
    const glideRow = await until(() => db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any, 15_000);
    assert.equal(glideRow.reason, 'risky control: Send');
    await uiPipe.request('approval.resolve', { approval_id: glideRow.id, decision: 'reject' });
    assert.equal((await glideStep.waitResult()).result?.isError, true);
    const glideHits = await callTool('evaluate', { pane_id: paneId, expression: 'document.getElementById("glide").dataset.hits || "0"' });
    assert.equal(JSON.parse(glideHits.result?.content?.[0]?.text).value, '0');

    // M6-02c: a click left waiting for the real 120 s returns "not approved in time" and the row reads expired
    const expireStart = Date.now();
    const expireStep = sendStep('click', { pane_id: paneId, ref: submitRef });
    const expireApproval = await until(() => db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any, 15_000);
    const expireResult = await expireStep.waitResult(150_000);
    assert.ok(Date.now() - expireStart >= 119_000);
    assert.equal(expireResult.result?.isError, true);
    assert.match(expireResult.result?.content?.[0]?.text, /not approved in time/);
    assert.equal((db!.prepare('SELECT status FROM approval WHERE id = ?').get(expireApproval.id) as any).status, 'expired');

    // Tell engine to exit cleanly
    const finalStep = ++stepIndex;
    writeFileSync(join(iso.home, `m602-step-${finalStep}.json`), JSON.stringify({ done: true }));
  } finally {
    for (const p of pipes) {
      try { p.close?.(); } catch {}
      try { p.destroy?.(); } catch {}
    }
    try { db?.close(); } catch {}
    killTree(wb?.pid);
    fixtureServer.server.close();
    await sleep(300);
    await teardownCore(core, iso);
  }
}
