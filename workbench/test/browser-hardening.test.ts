import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, openSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, sleep, startCore, teardownCore, until, uiHello } from '../../core/test/helpers.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const xvfb = spawnSync('which', ['xvfb-run']).status === 0;
const runnable = process.env.METATROOPER_BROWSER_E2E === '1' && existsSync(electron) && (process.platform === 'win32' || (process.platform === 'linux' && xvfb));

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; port: number }> {
  return new Promise((resolveListen) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => resolveListen({ server, port: (server.address() as { port: number }).port }));
  });
}

function containsFileNamed(root: string, name: string): boolean {
  if (!existsSync(root)) return false;
  return readdirSync(root, { withFileTypes: true }).some((entry) =>
    entry.isDirectory() ? containsFileNamed(join(root, entry.name), name) : entry.name === name,
  );
}

test('browser hardening contract', { skip: !runnable && 'set METATROOPER_BROWSER_E2E=1 (Windows, or Linux with xvfb)', timeout: 150_000 }, async (t) => {
  await buildGenerated();
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  const engineFile = join(iso.home, 'browser-engine.cjs');
  writeFileSync(registry, JSON.stringify([{ id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 1, version_cmd: [process.execPath, '--version'] }]));
  writeFileSync(engineFile, readFileSync(join(workbench, 'test', 'fixtures', 'browser-engine.cjs')));
  const env = { ...iso.env, METATROOPER_ENGINES: registry };
  let downloads = 0;
  const server = await listen((req, res) => {
    res.setHeader('content-type', 'text/html');
    if (req.url === '/cookie') { res.setHeader('set-cookie', 'user_secret=private; Path=/'); res.end('<title>cookie</title>'); return; }
    if (req.url === '/actions') { res.end(`<!doctype html><title>actions</title><button id="alert" aria-label="alert" onclick="alert('hello')">alert</button><button id="confirm" aria-label="confirm" onclick="document.body.dataset.confirm=String(confirm('sure?'))">confirm</button><button id="prompt" aria-label="prompt" onclick="prompt('name?')">prompt</button><span style="position:relative;display:inline-block"><button id="overlay-target" aria-label="overlay-target" onclick="document.body.dataset.overlayHit='1'">covered</button><div id="cover" style="position:absolute;inset:0;z-index:9;background:transparent"></div></span><button id="disabled" aria-label="disabled" disabled>disabled</button><input id="hidden-check" type="checkbox" style="position:absolute;left:-10000px"><label for="hidden-check" aria-label="toggle">toggle</label><input id="replace" aria-label="replace" value="old"><input id="empty" aria-label="empty" value="old"><button id="remove" aria-label="remove" onclick="document.querySelector('#stale').remove()">remove</button><button id="stale" aria-label="stale">stale node</button><a id="blank" aria-label="blank" href="/blank" target="_blank">blank</a><a id="download" aria-label="download" href="/file" download>download</a><script>window.addEventListener('load',()=>{const b=document.createElement('button');b.textContent='raise';b.setAttribute('aria-label','raise');b.onclick=()=>{throw new Error('uncaught test exception')};document.body.append(b)})</script>`); return; }
    if (req.url === '/blank') { res.end('<title>blank target</title>'); return; }
    if (req.url === '/file') { downloads++; res.setHeader('content-type', 'application/octet-stream'); res.end('file'); return; }
    if (req.url === '/agent') { res.end('<!doctype html><title>agent</title><script>document.cookie="agent_seen=yes; Path=/"</script><a id="blank" href="/blank" target="_blank">blank</a><a id="download" href="/file" download>download</a><div>agent page</div>'); return; }
    res.end('<!doctype html><title>home</title>');
  });
  const unowned = await listen((_req, res) => res.end('should not be reached'));
  const core = await startCore({ ...iso, env });
  let wb: ChildProcess | null = null;
  try {
    const pipe = await client(iso.prefix);
    await uiHello(pipe, iso.home);
    const project = join(iso.home, 'project'); mkdirSync(project);
    const projectId = (await pipe.request('project.open', { path: project })).result.project_id as string;
    const session = await pipe.request('session.launch', { project_id: projectId, engine_id: 'fake', prompt: engineFile });
    const sid = session.result.session_id as string;
    const pane = await pipe.request('pane.open', { project_id: projectId, session_id: sid, url: `http://127.0.0.1:${server.port}/cookie` });
    const userPaneId = pane.result.pane_id as string;
    assert.equal((await pipe.request('pane.open', { project_id: projectId, agent: true })).error?.code, -32602);
    pipe.close();
    await until(() => { const db = new DatabaseSync(join(iso.home, 'troop.db')); try { return db.prepare('SELECT pid FROM session WHERE id = ?').get(sid)?.pid; } finally { db.close(); } }, 15000);
    const db = new DatabaseSync(join(iso.home, 'troop.db'));
    db.prepare('UPDATE browser_pane SET dev_port = ? WHERE id = ?').run(server.port, userPaneId);
    db.close();
    const args: [string,string[]] = process.platform === 'win32' ? [electron,[workbench]] : ['xvfb-run',['-a','-s','-screen 0 1400x900x24',electron,'--no-sandbox','--disable-gpu','--disable-dev-shm-usage',workbench]];
    wb = spawn(args[0],args[1],{env,stdio:['ignore','ignore',openSync(join(iso.home,'workbench.err'),'w')],detached:process.platform!=='win32'});

    const session2 = await (await client(iso.prefix)).request('session.launch', { project_id: projectId, engine_id: 'fake', prompt: engineFile });
    const sid2 = session2.result.session_id as string;
    writeFileSync(join(iso.home, `browser-job-${sid2}.json`), JSON.stringify({steps:[['panes','browser.panes',{}],['nav','browser.navigate',{url:`http://127.0.0.1:${server.port}/agent`}],['snapshot','browser.snapshot',{}],['cookies','browser.evaluate',{expression:'document.cookie'}],['blank','browser.click',{ref:'@blank'}],['afterBlank','browser.panes',{}],['backToAgent','browser.navigate',{url:`http://127.0.0.1:${server.port}/agent`}],['snapshot2','browser.snapshot',{}],['download','browser.click',{ref:'@download'}]]}));
    const steps: Array<[string,string,object]> = [
      ['nav','browser.navigate',{pane_id:userPaneId,url:`http://127.0.0.1:${server.port}/actions`}],['snapshot','browser.snapshot',{pane_id:userPaneId}],
      ['alert','browser.click',{pane_id:userPaneId,ref:'@alert'}],['blocked','browser.snapshot',{pane_id:userPaneId}],['accept','browser.dialog',{pane_id:userPaneId,accept:true}],['resume','browser.snapshot',{pane_id:userPaneId}],
      ['snapConfirm','browser.snapshot',{pane_id:userPaneId}],['confirm','browser.click',{pane_id:userPaneId,ref:'@confirm'}],['dismiss','browser.dialog',{pane_id:userPaneId,accept:false}],['confirmValue','browser.evaluate',{pane_id:userPaneId,expression:'document.body.dataset.confirm'}],
      ['snapPrompt','browser.snapshot',{pane_id:userPaneId}],['prompt','browser.click',{pane_id:userPaneId,ref:'@prompt'}],['promptNoDialog','browser.dialog',{pane_id:userPaneId,accept:true}],
      ['snapCovered','browser.snapshot',{pane_id:userPaneId}],['covered','browser.click',{pane_id:userPaneId,ref:'@overlay-target'}],['coveredHandler','browser.evaluate',{pane_id:userPaneId,expression:'document.body.dataset.overlayHit'}],['snapDisabled','browser.snapshot',{pane_id:userPaneId}],['disabled','browser.click',{pane_id:userPaneId,ref:'@disabled'}],['snapLabel','browser.snapshot',{pane_id:userPaneId}],['label','browser.click',{pane_id:userPaneId,ref:'@toggle'}],
      ['snapReplace','browser.snapshot',{pane_id:userPaneId}],['typeReplace','browser.type',{pane_id:userPaneId,ref:'@replace',text:'new'}],['replaceValue','browser.evaluate',{pane_id:userPaneId,expression:"document.querySelector('#replace').value"}],['snapEmpty','browser.snapshot',{pane_id:userPaneId}],['typeEmpty','browser.type',{pane_id:userPaneId,ref:'@empty',text:''}],['emptyValue','browser.evaluate',{pane_id:userPaneId,expression:"document.querySelector('#empty').value"}],
      ['snapRemove','browser.snapshot',{pane_id:userPaneId}],['remove','browser.click',{pane_id:userPaneId,ref:'@remove'}],['stale','browser.click',{pane_id:userPaneId,ref:'@stale'}],['snapRaise','browser.snapshot',{pane_id:userPaneId}],['raise','browser.click',{pane_id:userPaneId,ref:'@raise'}],['console','browser.console',{pane_id:userPaneId}],
      ['fetch','browser.evaluate',{pane_id:userPaneId,expression:`fetch('http://127.0.0.1:${unowned.port}/').catch(e=>e.name)`}],['network','browser.network',{pane_id:userPaneId}],
    ];
    writeFileSync(join(iso.home,`browser-job-${sid}.json`),JSON.stringify({steps}));
    const outFile = join(iso.home,`browser-out-${sid}.json`);
    const out = await until(()=>existsSync(outFile)?JSON.parse(readFileSync(outFile,'utf8')):null,40000);
    assert.equal(out.hello.result?.bound,'session');
    assert.equal(out.steps.nav.result?.title,'actions');
    assert.equal(out.steps.alert.result?.ok,true);
    assert.equal(out.steps.alert.result?.dialog?.type,'alert');
    assert.ok(out.steps.blocked.error?.code === -32032);
    assert.equal(out.steps.accept.result?.ok,true);
    assert.ok(out.steps.resume.result?.text);
    assert.equal(out.steps.dismiss.result?.ok,true);
    assert.equal(out.steps.confirmValue.result?.value,'false');
    assert.equal(out.steps.prompt.result?.ok,true);
    assert.equal(out.steps.prompt.result?.dialog,undefined);
    assert.equal(out.steps.promptNoDialog.error?.code,-32002);
    assert.match(out.steps.promptNoDialog.error?.message??'',/no dialog is open/);
    assert.equal(out.steps.covered.error?.code,-32033);
    assert.equal(out.steps.coveredHandler.result?.value,null);
    assert.equal(out.steps.disabled.error?.code,-32033);
    assert.equal(out.steps.label.result?.ok,true);
    assert.equal(out.steps.typeReplace.result?.ok,true);
    assert.equal(out.steps.replaceValue.result?.value,'new');
    assert.equal(out.steps.typeEmpty.result?.ok,true);
    assert.equal(out.steps.emptyValue.result?.value,'');
    assert.match(out.steps.stale.error?.message??'',/no longer on the page/);
    assert.ok(out.steps.console.result?.some((e:any)=>e.level==='error'&&e.text.includes('uncaught test exception')));
    assert.ok(out.steps.network.result?.some((e:any)=>e.url?.includes(`:${unowned.port}/`)&&typeof e.error==='string'&&e.error.length>0));

    const agentFile=join(iso.home,`browser-out-${sid2}.json`);
    const agent=await until(()=>existsSync(agentFile)?JSON.parse(readFileSync(agentFile,'utf8')):null,40000);
    const rowsDb=new DatabaseSync(join(iso.home,'troop.db'));
    const rows=rowsDb.prepare('SELECT id, session_id FROM browser_pane').all() as Array<{id:string;session_id:string|null}>;
    rowsDb.close();
    assert.ok(rows.some(r=>r.id.startsWith('bp_agent_')&&r.session_id===sid2));
    assert.equal(agent.steps.nav.result?.title,'agent');
    assert.equal(agent.steps.cookies.result?.value,'agent_seen=yes');
    assert.ok(!String(agent.steps.cookies.result?.value ?? '').includes('user_secret=private'));
    assert.equal(agent.steps.blank.result?.ok,true);
    assert.equal(agent.steps.afterBlank.result?.length,1);
    assert.equal(agent.steps.download.result?.ok,true);
    assert.ok(rows.some(r=>r.id===userPaneId));
    assert.equal(containsFileNamed(join(iso.home, 'Downloads'), 'file'),false);
    assert.match(agent.steps.nav.result?.url??'',/agent/);
  } finally {
    if(wb?.pid)try{if(process.platform==='win32')spawnSync('taskkill',['/T','/F','/PID',String(wb.pid)]);else process.kill(-wb.pid,'SIGKILL');}catch{}
    server.server.close(); unowned.server.close(); await sleep(300); await teardownCore(core,iso);
  }
});
