import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { root, sleep, until } from '../../core/test/helpers.ts';

// Load the production layout scripts like layout-rules.test.ts does, without a DOM.
globalThis.runLayouts = {};
await import(pathToFileURL(fileURLToPath(new URL('../renderer/layouts/artifact-columns.js', import.meta.url))));
await import(pathToFileURL(fileURLToPath(new URL('../renderer/layouts/pr-first.js', import.meta.url))));

const h = {
  esc: (s: unknown) => String(s ?? ''),
  inputs: (m: any) => m.detail && !m.detail.error ? Object.entries(m.detail.inputs || {}).map(([k, v]) => `<div>${k}: ${v}</div>`).join('') : '',
  spec: (m: any) => m.detail?.docs?.spec ? `<div>${m.detail.docs.spec}</div>` : '',
  pr: (m: any) => m.detail?.pr ? `<a class="prl">PR #${m.detail.pr.number}</a>` : '',
  status: (m: any) => m.run.status,
  sums: () => null, glyph: () => '', label: (s: any) => s.status, who: (s: any) => s.role || s.kind, took: () => '', gateCard: () => '', detail: () => '', files: () => '', fmt: () => '',
};
const model = (detail: any) => ({
  title: 'Example', run: { id: '12345678', status: 'running' }, detail, elapsed: 0, tokens: 0, usd: 0, done: 0,
  list: [{ id: 'plan', title: 'Plan', role: 'plan', kind: 'agent', status: 'done' }], meta: { inputs: {} },
});

test('artifact-columns omits Asked for when runDetail is null or an error', () => {
  for (const detail of [null, { error: 'unavailable' }]) {
    assert.doesNotMatch(globalThis.runLayouts['artifact-columns'].render(model(detail), h), /Asked for/);
  }
});

test('pr-first omits spec, Asked for, and PR link when runDetail is null or an error', () => {
  for (const detail of [null, { error: 'unavailable' }]) {
    assert.doesNotMatch(globalThis.runLayouts['pr-first'].render(model(detail), h), /spec\.md|Asked for|class="prl"/);
  }
});

test('artifact-columns renders Asked for only when runDetail contains inputs', () => {
  const layout = globalThis.runLayouts['artifact-columns'];
  assert.doesNotMatch(layout.render(model({ inputs: {} }), h), /Asked for/);
  assert.match(layout.render(model({ inputs: { idea: 'Build a greeting' } }), h), /Asked for/);
});

test('pr-first renders a PR link only when runDetail contains a PR', () => {
  const layout = globalThis.runLayouts['pr-first'];
  assert.doesNotMatch(layout.render(model({}), h), /class="prl"/);
  assert.match(layout.render(model({ pr: { number: 42, url: 'https://example.test/pr/42' } }), h), /PR #42/);
});

test('production artifact-columns and pr-first renderers load without a DOM', () => {
  assert.equal(typeof globalThis.runLayouts['artifact-columns'].render, 'function');
  assert.equal(typeof globalThis.runLayouts['pr-first'].render, 'function');
});

// The following cases exercise run.js's closed-over helpers in a real renderer context.
// They are opt-in; this suite intentionally does not launch Electron by default.
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { revisionHarness } from '../../core/test/ui-revision-helpers.ts';
import { killTree } from '../../tests/helpers/kill-tree.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const enabled = process.env.METATROOPER_UI_REVISION_E2E === '1';
const options = { skip: !enabled && 'set METATROOPER_UI_REVISION_E2E=1 for real Electron tests', timeout: 150000 };

async function windowFor(harness: Awaited<ReturnType<typeof revisionHarness>>) {
  assert.ok(existsSync(electron), 'Electron binary is required');
  const server = createServer(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port; await new Promise<void>(r => server.close(() => r()));
  const args = ['--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, workbench];
  const errorLog = join(harness.iso.home, 'electron-stderr.log'); const output = openSync(errorLog, 'w');
  const wb = process.platform === 'linux' && !process.env.DISPLAY
    ? spawn('xvfb-run', ['-a', electron, '--no-sandbox', ...args], { env: harness.env, stdio: 'ignore', detached: true })
    : spawn(electron, args, { env: harness.env, stdio: ['ignore', 'ignore', output], windowsHide: true, detached: process.platform !== 'win32' });
  const stop = async () => {
    if (!wb.pid) return;
    killTree(wb.pid);
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
    const wait = (expression: string, timeout = 10000) => until(() => evaluate(expression), timeout);
    return { evaluate, click, key, wait, async close() { ws?.send(JSON.stringify({ id: ++seq, method: 'Browser.close' })); await sleep(300); ws?.close(); await stop(); } };
  } catch (e) { ws?.close(); await stop(); throw e; }
}

test('Electron: spec frontmatter is stripped and spec renders under plan and at its approval gate', options, async () => {
  const harness = await revisionHarness('spec-to-pr'); let w;
  try {
    const def = JSON.parse(readFileSync(join(root, 'pipelines/spec-to-pr.json'), 'utf8'));
    for (const s of def.steps) if (s.kind === 'agent') { s.engine = 'fake'; s.prompt = `FAKE ${JSON.stringify({ outputs: { title: 'Run detail test' } })}\n${s.prompt}`; }
    const run = await harness.pipeline(def, { idea: 'Run detail test', repo: 'fake/repo' });
    await until(() => harness.db.prepare("SELECT 1 FROM gate WHERE run_id = ? AND step_id = 'approve-spec' AND status = 'waiting'").get(run), 60000);
    w = await windowFor(harness); await w.wait('document.querySelector(\'[data-action="tab"][data-tab="runs"]\')'); await w.click('[data-action="tab"][data-tab="runs"]');
    await until(() => w!.evaluate(`Boolean(document.querySelector('#runbox [data-action="run-open"][data-id=${JSON.stringify(run)}]'))`), 10000);
    await w.click(`#runbox [data-action="run-open"][data-id="${run}"]`);
    await until(() => w!.evaluate('Boolean(document.querySelector("#runscreen .rsv"))'), 15000);
    await w.key('1', 'Digit1');
    await until(() => w!.evaluate('Boolean(document.querySelector("#runscreen .rsv [data-step=\\"approve-spec\\"]"))'), 10000);
    await w.click('#runscreen .rsv [data-step="approve-spec"]');
    await until(() => w!.evaluate('document.querySelector("#runscreen .rsv .rlog .rb")?.textContent.toLowerCase().includes("what you are approving")'), 10000);
    const content = await w.evaluate('document.querySelector("#runscreen .rsv .rlog .rb")?.textContent || ""');
    assert.match(content, /what you are approving/i);
    assert.match(content, /fake engine attempt 1/);
    assert.doesNotMatch(content, /^\s*(?:status|title):/im);
    assert.doesNotMatch(content, /^---$/m);
  } finally { await w?.close(); await harness.close(); }
});

test('Electron: run detail hunk preview stops at 300 lines and reports remaining lines', options, async () => {
  const harness = await revisionHarness('spec-to-pr'); let w;
  try {
    const def = JSON.parse(readFileSync(join(root, 'pipelines/spec-to-pr.json'), 'utf8'));
    for (const s of def.steps) if (s.kind === 'agent') {
      s.engine = 'fake';
      s.prompt = `FAKE ${JSON.stringify(s.id === 'build' ? { files: { 'many.txt': Array.from({ length: 350 }, (_, i) => `line ${i}`).join('\n') }, commit: 'Add many lines' } : { outputs: { title: 'Hunk test' } })}\n${s.prompt}`;
    }
    const run = await harness.pipeline(def, { idea: 'Hunk test', repo: 'fake/repo' });
    await until(() => harness.db.prepare("SELECT 1 FROM gate WHERE run_id = ? AND step_id = 'approve-spec' AND status = 'waiting'").get(run), 60000);
    const gate = harness.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve-spec'").get(run);
    await harness.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined });
    await until(() => harness.db.prepare("SELECT 1 FROM gate WHERE run_id = ? AND step_id = 'approve-pr' AND status = 'waiting'").get(run), 60000);
    w = await windowFor(harness); await w.wait('document.querySelector(\'[data-action="tab"][data-tab="runs"]\')'); await w.click('[data-action="tab"][data-tab="runs"]');
    await until(() => w!.evaluate(`Boolean(document.querySelector('#runbox [data-action="run-open"][data-id=${JSON.stringify(run)}]'))`), 10000);
    await w.click(`#runbox [data-action="run-open"][data-id="${run}"]`); await w.key('3', 'Digit3');
    await until(() => w!.evaluate('document.querySelector("#runscreen .rsv")?.innerText.includes("more lines in the Diff tab")'), 15000);
    const content = await w.evaluate('document.querySelector("#runscreen .rsv")?.innerText || ""');
    const writtenContent = Array.from({ length: 350 }, (_, i) => `line ${i}`).join('\n');
    const totalLines = writtenContent.split('\n').length + 1 + (writtenContent.endsWith('\n') ? 0 : 1);
    const expectedRemaining = totalLines - 300;
    assert.match(content, new RegExp(`${expectedRemaining} more lines in the Diff tab`));
  } finally { await w?.close(); await harness.close(); }
});
