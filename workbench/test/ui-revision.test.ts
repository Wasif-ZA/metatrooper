import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { root, runNode, sleep, until } from '../../core/test/helpers.ts';
import { git, panePipeline, revisionHarness, runDone, terminalViewer } from '../../core/test/ui-revision-helpers.ts';
import { killTree } from '../../tests/helpers/kill-tree.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const enabled = process.env.METATROOPER_UI_REVISION_E2E === '1';
const options = { skip: !enabled && 'set METATROOPER_UI_REVISION_E2E=1 for real Electron tests', timeout: 150000 };

async function windowFor(h: Awaited<ReturnType<typeof revisionHarness>>) {
  assert.ok(existsSync(electron), 'Electron binary is required');
  const server = createServer(); await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as any).port; await new Promise<void>(r => server.close(() => r()));
  const args = ['--no-sandbox', '--disable-gpu', `--remote-debugging-port=${port}`, workbench];
  const errorLog = join(h.iso.home, 'electron-stderr.log');
  const output = openSync(errorLog, 'w');
  const wb = process.platform === 'linux' && !process.env.DISPLAY
    ? spawn('xvfb-run', ['-a', electron, '--no-sandbox', ...args], { env: h.env, stdio: 'ignore', detached: true })
    : spawn(electron, args, { env: h.env, stdio: ['ignore', 'ignore', output], windowsHide: true, detached: process.platform !== 'win32' });
  const stopWindow = async () => {
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
    let seq = 0; const pending = new Map(); const received: any[] = [];
    ws.addEventListener('message', e => { const m = JSON.parse(String(e.data)); received.push(m); if (pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); } });
    const send = (method: string, params = {}): Promise<any> => new Promise((resolve, reject) => {
      const id = ++seq; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out; CDP ${JSON.stringify(received.slice(-3))}; stderr ${readFileSync(errorLog, 'utf8').slice(-3000)}`)); }, 10000);
      pending.set(id, { resolve, reject, timer }); ws!.send(JSON.stringify({ id, method, params }));
    });
    const evaluate = async (expression: string) => {
      const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
      assert.ok(!r.exceptionDetails, JSON.stringify(r.exceptionDetails)); return r.result.value;
    };
    const click = async (selector: string) => {
      const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); if(!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      assert.ok(point, `missing ${selector}`);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    };
    const key = async (key: string, code: string, modifiers = 0) => {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code, modifiers });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
    };
    const wait = async (expression: string, timeout = 15000) => {
      try { return await until(() => evaluate(expression), timeout); }
      catch (error) { throw new Error(`${(error as Error).message}; waiting for ${expression}; view: ${await evaluate('document.querySelector("#view")?.innerText')}; toasts: ${await evaluate('document.querySelector("#toasts")?.innerText')}`); }
    };
    await wait('typeof ui !== "undefined" && ui.snap && ui.snap.core.online');
    return { send, evaluate, click, key, wait, async close() {
      ws?.send(JSON.stringify({ id: ++seq, method: 'Browser.close' }));
      await sleep(300);
      ws?.close();
      await stopWindow();
      await sleep(300);
    } };
  } catch (e) {
    ws?.close(); await stopWindow(); throw e;
  }
}

async function select(h: Awaited<ReturnType<typeof revisionHarness>>, w: Awaited<ReturnType<typeof windowFor>>, id: string) {
  assert.deepEqual((await h.pipe.request('session.focus', { session_id: id })).result, { focused: true });
  await w.wait(`termView.state()?.session === ${JSON.stringify(id)}`);
}

test('UI-03 a live terminal survives closing and reopening the window with matching snapshot rows', options, async () => {
  const h = await revisionHarness(); let w; let viewer;
  try {
    const { session_id } = await h.launch();
    assert.equal((await runNode(['core/event.js', 'claude.UserPromptSubmit'], { ...h.env, TROOP_SESSION_ID: session_id }, '{}')).code, 0);
    w = await windowFor(h); await select(h, w, session_id);
    await w.wait('termView.state()?.attach_ms !== null');
    await w.wait('termView.state(200)?.tail.filter(x=>/^revision-line-[0-9]+$/.test(x)).length >= 200', 35000);
    const old = await w.evaluate('termView.state().tail'); await w.close(); w = undefined;
    await sleep(3000);
    assert.equal(h.db.prepare('SELECT state FROM session WHERE id = ?').get(session_id).state, 'working');
    w = await windowFor(h); await select(h, w, session_id);
    await w.wait('termView.state()?.attach_ms !== null');
    const rows = await w.evaluate('termView.state(200).tail');
    const dimensions = await w.evaluate(`(()=>{const screen=document.querySelector('.xterm-screen'),lines=document.querySelector('.xterm-rows'),canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),style=getComputedStyle(lines);ctx.font=style.font;return {rows:lines.childElementCount,cols:Math.round(screen.getBoundingClientRect().width/ctx.measureText('W').width)}})()`);
    assert.equal(rows.length, 200); assert.notEqual(rows.at(-1), old.at(-1));
    viewer = await terminalViewer(h.iso.prefix, h.iso.home, session_id, false);
    const snapshot = await until(() => viewer.messages.find(m => m.op === 'snapshot'), 10000);
    const require = createRequire(join(root, 'core/package.json'));
    const { Terminal } = require('@xterm/headless'); const term = new Terminal({ ...dimensions, scrollback: 10000, allowProposedApi: true });
    try {
      await new Promise<void>(r => term.write(snapshot.data, r));
      const all = Array.from({ length: term.buffer.active.length }, (_, i) => term.buffer.active.getLine(i)?.translateToString(true)).filter(x => x?.trim());
      const end = all.lastIndexOf(rows.at(-1)); assert.ok(end >= 199, 'window last row is present in core snapshot');
      assert.deepEqual(rows, all.slice(end - 199, end + 1));
    } finally { term.dispose(); }
  } finally { viewer?.socket.destroy(); await w?.close(); await h.close(); }
});

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

test('UI-08 spec-to-pr shows every step status and the approve-pr gate inline', options, async () => {
  const h = await revisionHarness('spec-to-pr'); let w;
  try {
    const run = await specRun(h);
    const gate = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve-pr' AND status = 'waiting'").get(run), 60000);
    const session = h.db.prepare("SELECT session_id FROM run_step WHERE run_id = ? AND session_id IS NOT NULL ORDER BY started_at DESC LIMIT 1").get(run).session_id;
    w = await windowFor(h); await select(h, w, session);
    await w.wait(`document.querySelector('.steps [data-step="approve-pr"]')`);
    const statuses = await w.evaluate(`Array.from(document.querySelectorAll('.steps [data-step]'), e=>({id:e.dataset.step,text:e.textContent.trim()}))`);
    assert.deepEqual(statuses.map(s => s.id), ['spec','approve-spec','build','verify','approve-pr','open-pr']);
    for (const s of statuses) {
      const row = h.db.prepare('SELECT status FROM run_step WHERE run_id = ? AND step_id = ? ORDER BY iteration DESC LIMIT 1').get(run, s.id);
      assert.ok(s.text.includes(row?.status ?? 'pending'), `${s.id}: ${s.text}`);
    }
    assert.ok(await w.evaluate(`(()=>{const e=document.querySelector('.steps [data-step="approve-pr"]').nextElementSibling;return e.classList.contains('step-gate') && [...e.querySelectorAll('button')].map(b=>b.textContent).join(',')==='Approve,Reject' && e.querySelector('[data-id="${gate.id}"]')!==null})()`));
  } finally { await w?.close(); await h.close(); }
});

test('UI-08 failed build displays its error under the failed step without a click', options, async () => {
  const h = await revisionHarness('spec-to-pr'); let w;
  try {
    const run = await specRun(h, true);
    await until(() => h.db.prepare("SELECT 1 FROM run_step WHERE run_id = ? AND step_id = 'build' AND status = 'failed'").get(run), 60000);
    const session = h.db.prepare("SELECT session_id FROM run_step WHERE run_id = ? AND step_id = 'build'").get(run).session_id;
    w = await windowFor(h); await select(h, w, session);
    const error = await w.wait(`(()=>{const e=document.querySelector('.steps [data-step="build"]');const err=e?.nextElementSibling;return e?.classList.contains('s-failed') && err?.classList.contains('step-err') && err.getBoundingClientRect().height>0 && err.textContent})()`);
    const runDir = h.db.prepare('SELECT run_dir FROM run WHERE id = ?').get(run).run_dir as string;
    const failures = readFileSync(join(runDir, 'log.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(e => e.event === 'step failed' && e.step === 'build');
    assert.ok(failures.length > 0); assert.equal(error, failures.at(-1).why);
    assert.match(error, /failed/);
  } finally { await w?.close(); await h.close(); }
});

test('#37 editor drag saves reordered steps and JSON shows the same pipeline', options, async () => {
  const h = await revisionHarness(); let w;
  try {
    const def = { schema: 1, id: 'revision-editor', title: 'Revision editor', steps: ['first','second'].map(id => ({ id, kind: 'agent', role: 'worker', engine: 'fake', prompt: 'work', outputs: ['summary'] })) };
    await h.pipeline(def); w = await windowFor(h);
    await w.click('[data-action="tab"][data-tab="pipelines"]');
    await w.wait('document.querySelector(\'[data-action="edit-pipeline"][data-id="revision-editor"]\')');
    await w.click('[data-action="edit-pipeline"][data-id="revision-editor"]');
    await w.wait('document.querySelectorAll("[data-drag-step]").length === 2');
    await w.evaluate(`(()=>{const a=document.querySelector('[data-drag-step="0"]'),b=document.querySelector('[data-drag-step="1"]'),dt=new DataTransfer();a.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:dt}));b.dispatchEvent(new DragEvent('dragover',{bubbles:true,cancelable:true,dataTransfer:dt}));b.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt}));a.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:dt}));})()`);
    await w.click('[data-action="save-pipeline"]');
    const file = join(h.project, '.troop/pipelines/revision-editor.json');
    await until(() => JSON.parse(readFileSync(file, 'utf8')).steps[0].id === 'second');
    const saved = JSON.parse(readFileSync(file, 'utf8')); assert.deepEqual(saved.steps.map(s => s.id), ['second','first']);
    await w.click('[data-action="toggle-raw"]');
    assert.deepEqual(JSON.parse(await w.evaluate('document.querySelector("[data-action=raw]").value')), saved);
  } finally { await w?.close(); await h.close(); }
});

test('#37 editor refuses a schema-invalid pipeline and preserves the saved file', options, async () => {
  const h = await revisionHarness(); let w;
  try {
    const saved = { schema: 1, id: 'revision-invalid', title: 'Invalid save fixture', steps: [{ id: 'work', kind: 'agent', role: 'worker', engine: 'fake', prompt: 'work', outputs: ['summary'] }] };
    await h.pipeline(saved); w = await windowFor(h);
    await w.click('[data-action="tab"][data-tab="pipelines"]');
    await w.wait('document.querySelector(\'[data-action="edit-pipeline"][data-id="revision-invalid"]\')');
    await w.click('[data-action="edit-pipeline"][data-id="revision-invalid"]');
    await w.click('[data-action="toggle-raw"]');
    const file = join(h.project, '.troop/pipelines/revision-invalid.json');
    const before = readFileSync(file, 'utf8');
    const invalid = JSON.stringify({ ...saved, steps: [{ ...saved.steps[0], kind: 'invalid-kind' }] });
    await w.evaluate(`(()=>{const e=document.querySelector('[data-action="raw"]');e.value=${JSON.stringify(invalid)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await w.wait('ui.editor.errors?.length > 0'); await w.click('[data-action="save-pipeline"]');
    await until(async () => readFileSync(file, 'utf8') !== before || await w.evaluate('document.querySelector("#toasts .error")?.textContent'), 10000);
    assert.equal(readFileSync(file, 'utf8'), before, 'saving a schema-invalid pipeline must leave the saved JSON unchanged');
    const message = await w.evaluate('document.querySelector("#toasts .error")?.textContent');
    assert.match(message, /kind|enum|invalid/i);
  } finally { await w?.close(); await h.close(); }
});

test('UI-09 all four result panes render fixture details and Approve updates clip-1', options, async () => {
  const h = await revisionHarness('result-panes'); let w;
  try {
    const run = await h.pipeline(panePipeline()); await runDone(h, run);
    const session = h.db.prepare('SELECT session_id FROM run_step WHERE run_id = ? AND step_id = ?').get(run, 'findings').session_id;
    w = await windowFor(h); await select(h, w, session);
    const cases = [
      ['items', ['Opening hook, 0:00 to 0:28','82','Strong question in the first 3 seconds','audio peaks above 0 dB']],
      ['document', ['Score 78','needs 70','citations','90','coverage','70','clarity','75','Local bakery websites','Order ahead','Bakery site survey','https://example.com/survey','Menu design notes']],
      ['table', ['fetch','extract','check','row-1','200','12 fields','row-2','running','row-3','timeout after 30 s']],
      ['findings', ['Critical','Secret in client bundle','src/config.ts:12','The Stripe key is imported by a browser module.','High','Unvalidated redirect','fixed by build-2','Low','Missing lang attribute']],
    ];
    for (const [step, texts] of cases) {
      const selector = `[data-action="tab"][data-tab="pane:${run}:${step}"]`;
      await w.wait(`document.querySelector(${JSON.stringify(selector)})`); await w.click(selector);
      const text = await w.wait(`(()=>{const e=document.querySelector('#view');return e?.innerText.includes(${JSON.stringify(texts[0])}) && e.innerText})()`);
      for (const expected of texts) assert.ok(text.includes(expected), `${step}: missing ${expected}`);
      if (step === 'document') assert.equal(await w.evaluate('document.querySelector(".doc b").textContent'), 'Order ahead');
    }
    await w.click(`[data-action="tab"][data-tab="pane:${run}:items"]`);
    await w.wait('document.querySelector(\'[data-action="item-set"][data-id="clip-1"][data-status="approved"]\')');
    const file = join(h.project, 'items.json'); const expected = JSON.parse(readFileSync(file, 'utf8')); expected[0].status = 'approved';
    await w.click('[data-action="item-set"][data-id="clip-1"][data-status="approved"]');
    await until(() => JSON.parse(readFileSync(file, 'utf8'))[0].status === 'approved');
    assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), expected);
  } finally { await w?.close(); await h.close(); }
});

test('#36 Ctrl+K lists project pipelines, filters them and starts the selected run', options, async () => {
  const h = await revisionHarness(); let w;
  try {
    const def = { schema: 1, id: 'revision-palette', title: 'Unique palette fixture', steps: [{ id: 'hold', kind: 'gate', gate: 'approve', gate_summary: 'Hold here' }] };
    await h.pipeline(def); w = await windowFor(h);
    await w.key('k', 'KeyK', 2);
    await w.wait('!document.querySelector("#palette").hidden');
    const text = await w.evaluate('document.querySelector("#palette-list").innerText'); assert.ok(text.includes('Run Unique palette fixture'));
    await w.send('Input.insertText', { text: 'Unique palette fixture' });
    assert.deepEqual(await w.evaluate('[...document.querySelectorAll("#palette-list [data-palette]")].filter(e=>e.textContent.startsWith("Run ")).map(e=>e.textContent)'), ['Run Unique palette fixturerevision-palette']);
    const before = h.db.prepare('SELECT COUNT(*) n FROM run WHERE pipeline_id = ?').get(def.id).n;
    await w.key('Enter', 'Enter');
    await until(() => h.db.prepare('SELECT COUNT(*) n FROM run WHERE pipeline_id = ?').get(def.id).n === Number(before) + 1, 10000);
    assert.equal(await w.evaluate('document.querySelector("#palette").hidden'), true);
  } finally { await w?.close(); await h.close(); }
});

test('D15 Diff scope toggles show last turn, uncommitted and whole branch file sets', options, async () => {
  const h = await revisionHarness(); let w;
  try {
    for (const file of ['committed.txt','older.txt','turn.txt']) writeFileSync(join(h.project, file), 'base\n');
    git(h.project, 'add', '-A'); git(h.project, 'commit', '-qm', 'base files'); git(h.project, 'push', '-q', 'origin', 'main');
    git(h.project, 'checkout', '-qb', 'revision-diff');
    writeFileSync(join(h.project, 'committed.txt'), 'branch change\n'); git(h.project, 'add', 'committed.txt'); git(h.project, 'commit', '-qm', 'branch change');
    writeFileSync(join(h.project, 'older.txt'), 'older dirty\n');
    const { session_id } = await h.launch();
    assert.equal((await runNode(['core/event.js', 'claude.UserPromptSubmit'], { ...h.env, TROOP_SESSION_ID: session_id }, '{}')).code, 0);
    await until(() => h.db.prepare('SELECT turn_base FROM session WHERE id = ?').get(session_id)?.turn_base, 10000);
    writeFileSync(join(h.project, 'turn.txt'), 'new turn change\n');
    w = await windowFor(h); await select(h, w, session_id); await w.click('[data-action="tab"][data-tab="diff"]');
    for (const [scope, expected] of [['turn',['turn.txt']],['uncommitted',['older.txt','turn.txt']],['branch',['committed.txt','older.txt','turn.txt']]]) {
      await w.wait(`document.querySelector('[data-action="diff-scope"][data-scope="${scope}"]')`);
      await w.click(`[data-action="diff-scope"][data-scope="${scope}"]`);
      await w.wait(`ui.sdiff?.key.endsWith(':${scope}') && ui.sdiff.data`);
      assert.deepEqual(await w.evaluate('[...document.querySelectorAll("[data-action=sd-file]")].map(e=>e.dataset.file).sort()'), expected);
    }
  } finally { await w?.close(); await h.close(); }
});

test('UI-10 six live grid terminals echo input under 50 ms at median and p90', options, async (t) => {
  const fake = `process.stdin.resume(); let n=0; setInterval(()=>process.stdout.write('load-'+(++n)+'\\r\\n'),5); process.stdin.on('data',d=>process.stdout.write('ECHO:'+d.toString()));`;
  const h = await revisionHarness(undefined, fake); let w;
  try {
    const ids=[];
    for(let i=0;i<6;i++) ids.push((await h.launch('fake')).session_id);
    w=await windowFor(h);
    await w.key('g','KeyG',2); await w.wait('ui.mode === "grid"');
    await w.wait('document.querySelectorAll(".tile").length === 6');
    await w.wait('document.querySelector(".tile .xterm-screen")');
    await w.wait('[...document.querySelectorAll(".tile")].every(e=>e.querySelector(".xterm-rows")?.innerText.includes("load-"))');
    const durations:number[]=[];
    for(let i=0;i<30;i++){
      const value=`sample-${i}`;
      await w.evaluate('document.querySelector(".tile .xterm-helper-textarea").focus()');
      const baselineTail=await w.evaluate('termView.state(200).tail.join("\\n")');
      const elapsed=await w.evaluate(`termView.timeEcho(${JSON.stringify(ids[0])},${JSON.stringify(value+'\r')},${JSON.stringify('ECHO:'+value)})`);
      assert.notEqual(elapsed,null,`xterm parsed ${value}`);
      assert.ok(baselineTail.length>0);
      durations.push(elapsed);
    }
    durations.sort((a,b)=>a-b);
    const median=durations[Math.floor(durations.length/2)], p90=durations[Math.ceil(durations.length*.9)-1];
    t.diagnostic(`echo samples=${durations.length}, median=${median.toFixed(1)} ms, p90=${p90.toFixed(1)} ms`);
    assert.ok(median<50,`echo median ${median.toFixed(1)} ms`); assert.ok(p90<50,`echo p90 ${p90.toFixed(1)} ms`);
  } catch (error) { console.error(error); throw error; } finally { await w?.close(); await h.close(); }
});

test('UI-10 a 10,000-row terminal snapshot is parsed in the window under 500 ms', options, async (t) => {
  const fake = `process.stdin.resume(); process.stdout.write(Array.from({length:10000},(_,i)=>'scrollback-row-'+String(i).padStart(5,'0')).join('\\r\\n')+'\\r\\n'); setInterval(()=>{},1000);`;
  const h=await revisionHarness(undefined,fake);let w;
  try {
    const {session_id}=await h.launch('fake');
    w=await windowFor(h);await select(h,w,session_id);
    await w.wait('termView.state()?.attach_ms !== null',10000);
    const result=await w.evaluate('({elapsed:termView.state()?.attach_ms,tail:termView.state(200)?.tail})');
    t.diagnostic(`10,000-row window attach: ${result.elapsed} ms`);
    assert.ok(result.tail.includes('scrollback-row-09999'),'xterm parsed the final scrollback row');
    assert.ok(result.elapsed<500,`window attach took ${result.elapsed} ms`);
  } catch(error){console.error(error);throw error} finally {await w?.close();await h.close()}
});

test('UI-04 home jobs meet click baselines and improve at least three', options, async (t) => {
  const h=await revisionHarness(undefined, `process.stdout.write('click fixture ready\\r\\n'); setTimeout(()=>process.exit(0),100);`); let w;
  try {
    const {session_id}=await h.launch();
    const event=await runNode(['core/event.js','claude.UserPromptSubmit'],{...h.env,TROOP_SESSION_ID:session_id},'{}');assert.equal(event.code,0,event.stderr);
    await until(()=>h.db.prepare('SELECT turn_base FROM session WHERE id=?').get(session_id)?.turn_base,10000);
    writeFileSync(join(h.project,'seed.txt'),'click fixture change\n');
    git(h.project,'add','seed.txt');
    const pane=(await h.pipe.request('pane.open',{project_id:h.projectId})).result.pane_id;
    w=await windowFor(h); await select(h,w,session_id);
    const counts:{job:string;count:number;baseline:number}[]=[];
    const perform=async(job:string,baseline:number,action:(click:(selector:string)=>Promise<void>)=>Promise<void>,check:()=>Promise<any>)=>{let count=0;const click=async(selector:string)=>{count++;await w!.click(selector)};await action(click);assert.ok(await check(),`${job} completed`);counts.push({job,count,baseline});};
    await perform('start agent',1,async click=>{await click('[data-action="launch"][data-engine="fake"]')},async()=>!!await until(()=>h.db.prepare('SELECT id FROM session WHERE id != ?').get(session_id),5000));
    const pipe=h.pipeline;
    const def={schema:1,id:'ui04-clicks',title:'Click gate',steps:[{id:'hold',kind:'gate',gate:'approve',gate_summary:'Approve fixture'}]};
    const run=await pipe(def); const gate=await until(()=>h.db.prepare('SELECT * FROM gate WHERE run_id=? AND status=\'waiting\'').get(run),30000);
    await perform('approve gate',1,async click=>{await w!.wait(`document.querySelector(${JSON.stringify(`[data-action="gate"][data-id="${gate.id}"][data-decision="approve"]`)})`);await click(`[data-action="gate"][data-id="${gate.id}"][data-decision="approve"]`)},async()=>await until(()=>h.db.prepare('SELECT status FROM gate WHERE id=?').get(gate.id)?.status==='approved',5000));
    await perform('see diff',2,async()=>{await w!.wait('document.querySelector("#view")?.innerText.includes("seed.txt")')},async()=>await w!.evaluate('document.querySelector("#view")?.innerText.includes("seed.txt")'));
    await perform('hand back',2,async click=>{await click('[data-action="tab"][data-tab="handback"]');await w!.wait('document.querySelector("[data-action=handback-copy]")')},async()=>await w!.evaluate('document.querySelector("[data-action=handback-copy]") !== null'));
    await perform('open browser',2,async click=>{await click('[data-action="tab"][data-tab="browser"]');await w!.wait('document.querySelector(".browser")')},async()=>await w!.evaluate(`ui.snap.panes.some(p=>p.id===${JSON.stringify(pane)}) && document.querySelector(".browser")`));
    for(const x of counts) assert.ok(x.count<=x.baseline,`${x.job}: ${x.count} > ${x.baseline}`);
    assert.ok(counts.filter(x=>x.count<x.baseline).length>=3,JSON.stringify(counts));
    t.diagnostic(`click counts: ${counts.map(x=>`${x.job}=${x.count}/${x.baseline}`).join(', ')}`);
    await h.pipe.request('pane.close',{pane_id:pane});
  } catch (error) { console.error(error); throw error; } finally {try{await w?.close();await sleep(1500)}catch(error){console.error('window cleanup failed',error);throw error}try{await h.close()}catch(error){console.error('harness cleanup failed',error);throw error}}
});
