import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { root, runNode, sleep, until } from '../../core/test/helpers.ts';
import { git, revisionHarness, terminalViewer } from '../../core/test/ui-revision-helpers.ts';
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

test('M6-07a a 50 MB print in one tile keeps another tile echoing under 100 ms', options, async (t) => {
  const fake = `process.stdin.resume(); process.stdin.on('data',d=>{const s=d.toString(); if(!s.includes('FLOOD')) return process.stdout.write('ECHO:'+s); const l='f'.repeat(1023)+'\\r\\n'; let n=0; const go=()=>{while(n<51200){n++; if(!process.stdout.write(l)) return process.stdout.once('drain',go);} process.stdout.write('FLOOD-DONE\\r\\n');}; go();});`;
  const h = await revisionHarness(undefined, fake); let w;
  try {
    const ids=[(await h.launch('fake')).session_id,(await h.launch('fake')).session_id];
    w=await windowFor(h);
    await w.key('g','KeyG',2); await w.wait('ui.mode === "grid"');
    await w.wait('document.querySelectorAll(".tile .xterm-screen").length === 2');
    await w.evaluate(`window.troop.termInput(${JSON.stringify(ids[1])},'FLOOD\\r')`);
    const durations:number[]=[];
    for(let i=0;i<20;i++){
      const value=`flood-${i}`;
      const elapsed=await w.evaluate(`termView.timeEcho(${JSON.stringify(ids[0])},${JSON.stringify(value+'\r')},${JSON.stringify('ECHO:'+value)})`);
      assert.notEqual(elapsed,null,`xterm parsed ${value}`);
      durations.push(elapsed);
    }
    const flooding=await w.evaluate(`!(termView.ids().includes(${JSON.stringify(ids[1])}) && document.querySelector('.tile[data-id=${JSON.stringify(ids[1])}] .xterm-rows')?.innerText.includes('FLOOD-DONE'))`);
    durations.sort((a,b)=>a-b);
    t.diagnostic(`echo during flood: median=${durations[10].toFixed(1)} ms, max=${durations[19].toFixed(1)} ms, still flooding at the end: ${flooding}`);
    assert.ok(durations[19]<100,`echo max ${durations[19].toFixed(1)} ms`);
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
    await perform('see diff',2,async()=>{await w!.wait('document.querySelector("#view")?.innerText.includes("seed.txt")')},async()=>await w!.evaluate('document.querySelector("#view")?.innerText.includes("seed.txt")'));
    await perform('hand back',2,async click=>{await click('[data-action="tab"][data-tab="handback"]');await w!.wait('document.querySelector("[data-action=handback-copy]")')},async()=>await w!.evaluate('document.querySelector("[data-action=handback-copy]") !== null'));
    await perform('open browser',2,async click=>{await click('[data-action="tab"][data-tab="browser"]');await w!.wait('document.querySelector(".browser")')},async()=>await w!.evaluate(`ui.snap.panes.some(p=>p.id===${JSON.stringify(pane)}) && document.querySelector(".browser")`));
    for(const x of counts) assert.ok(x.count<=x.baseline,`${x.job}: ${x.count} > ${x.baseline}`);
    assert.ok(counts.filter(x=>x.count<x.baseline).length>=3,JSON.stringify(counts));
    t.diagnostic(`click counts: ${counts.map(x=>`${x.job}=${x.count}/${x.baseline}`).join(', ')}`);
    await h.pipe.request('pane.close',{pane_id:pane});
  } catch (error) { console.error(error); throw error; } finally {try{await w?.close();await sleep(1500)}catch(error){console.error('window cleanup failed',error);throw error}try{await h.close()}catch(error){console.error('harness cleanup failed',error);throw error}}
});
