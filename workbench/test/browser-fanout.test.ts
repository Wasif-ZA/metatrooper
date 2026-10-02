import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, sleep, startCore, teardownCore, until, uiHello } from '../../core/test/helpers.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const xvfb = spawnSync('which', ['xvfb-run']).status === 0;
const runnable = process.env.METATROOPER_BROWSER_E2E === '1' && existsSync(electron) && (process.platform === 'win32' || (process.platform === 'linux' && xvfb));

function listen(body: string): Promise<{ server: Server; port: number }> {
  return new Promise((res) => {
    const server = createServer((_req, r) => { r.setHeader('content-type', 'text/html'); r.end(`<!doctype html><title>${body}</title><body>${body}</body>`); });
    server.listen(0, '127.0.0.1', () => res({ server, port: (server.address() as { port: number }).port }));
  });
}

test('M1-22 three panes from three sessions: each session drives only its own pane, found through its own process ancestry', { skip: !runnable && 'set METATROOPER_BROWSER_E2E=1 (Windows, or Linux with xvfb)', timeout: 150_000 }, async () => {
  await buildGenerated();
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify(['fake-a', 'fake-b', 'fake-c'].map((id) => ({ id, command: process.execPath, prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 1, version_cmd: [process.execPath, '--version'] }))));
  const env = { ...iso.env, METATROOPER_ENGINES: registry };
  const sites = await Promise.all(['site-0', 'site-1', 'site-2'].map(listen));

  const core = await startCore({ ...iso, env });
  let wb: ChildProcess | null = null;
  try {
    const pipe = await client(iso.prefix);
    await uiHello(pipe, iso.home);
    const project = join(iso.home, 'project');
    mkdirSync(project);
    const projectId = (await pipe.request('project.open', { path: project })).result.project_id as string;
    const sessions: string[] = [];
    const panes: string[] = [];
    for (const [i, engine] of ['fake-a', 'fake-b', 'fake-c'].entries()) {
      const launched = await pipe.request('session.launch', { project_id: projectId, engine_id: engine, prompt: join(workbench, 'test', 'fixtures', 'browser-engine.cjs') });
      sessions.push(launched.result.session_id);
      const pane = await pipe.request('pane.open', { project_id: projectId, session_id: launched.result.session_id, url: `http://127.0.0.1:${sites[i].port}/` });
      panes.push(pane.result.pane_id);
    }
    pipe.close();
    const db = new DatabaseSync(join(iso.home, 'troop.db'));
    db.exec('PRAGMA busy_timeout = 5000');
    sites.forEach((s, i) => db.prepare('UPDATE browser_pane SET dev_port = ? WHERE id = ?').run(s.port, panes[i]));
    await until(() => sessions.every((id) => (db.prepare('SELECT pid FROM session WHERE id = ?').get(id) as { pid: number | null }).pid), 15_000);
    assert.deepEqual((db.prepare('SELECT engine_id FROM session ORDER BY started_at').all() as Array<{ engine_id: string }>).map((r) => r.engine_id), ['fake-a', 'fake-b', 'fake-c']);
    db.close();

    const wbArgs: [string, string[]] = process.platform === 'win32'
      ? [electron, [workbench]]
      : ['xvfb-run', ['-a', '-s', '-screen 0 1400x900x24', electron, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', workbench]];
    wb = spawn(wbArgs[0], wbArgs[1], { env, stdio: ['ignore', 'ignore', openSync(join(iso.home, 'workbench.err'), 'w')], detached: process.platform !== 'win32' });

    sessions.forEach((sid, i) => {
      const other = (i + 1) % 3;
      writeFileSync(join(iso.home, `browser-job-${sid}.json`), JSON.stringify({ steps: [
        ['list', 'browser.panes', {}],
        ['mine', 'browser.wait_for', { pane_id: panes[i], text: `site-${i}`, timeout_ms: 20000 }],
        ['theirs', 'browser.evaluate', { pane_id: panes[other], expression: 'document.title' }],
        ['spoof', 'browser.hello', { session_id: sessions[other], pid: '__PID__' }],
        ['after', 'browser.evaluate', { pane_id: panes[other], expression: 'document.title' }],
      ] }));
    });
    const outs = await Promise.all(sessions.map((sid) => {
      const f = join(iso.home, `browser-out-${sid}.json`);
      return until(() => (existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null), 60_000);
    }));

    outs.forEach((out, i) => {
      const other = (i + 1) % 3;
      assert.equal(out.hello.result?.bound, 'session', JSON.stringify(out.hello));
      assert.deepEqual(out.steps.list.result.map((p: { pane_id: string }) => p.pane_id), [panes[i]], `session ${i} lists only its pane`);
      assert.equal(out.steps.mine.result?.found, true, JSON.stringify(out.steps.mine));
      assert.ok(out.steps.theirs.error, `session ${i} drove pane ${other}: ${JSON.stringify(out.steps.theirs)}`);
      assert.equal(out.steps.spoof.error?.code, -32030, `session ${i} bound as session ${other}: ${JSON.stringify(out.steps.spoof)}`);
      assert.ok(out.steps.after.error, `after a refused hello, session ${i} drove pane ${other}: ${JSON.stringify(out.steps.after)}`);
    });
  } finally {
    if (wb?.pid) try { if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(wb.pid)]); else process.kill(-wb.pid, 'SIGKILL'); } catch {}
    for (const s of sites) s.server.close();
    await sleep(300);
    await teardownCore(core, iso);
  }
});
