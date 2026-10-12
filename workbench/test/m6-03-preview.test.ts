import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, sleep, startCore, teardownCore, uiHello, until } from '../../core/test/helpers.ts';
import { killTree } from '../../tests/helpers/kill-tree.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const xvfb = spawnSync('which', ['xvfb-run']).status === 0;
// Opt-in (needs Electron + xvfb; slow): set METATROOPER_BROWSER_E2E=1.
const runnable = process.env.METATROOPER_BROWSER_E2E === '1' && existsSync(electron) && (process.platform === 'win32' || (process.platform === 'linux' && xvfb));

test('M6-03a a dev server in a session terminal gets an ancestry row, the tile shows Open preview, and the session\'s agent pane loads it; an outside port stays blocked', { skip: !runnable, timeout: 120_000 }, async () => {
  await buildGenerated();
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{ id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 1, version_cmd: [process.execPath, '--version'] }]));
  const probeFile = join(iso.home, 'probe.log');
  const env = { ...iso.env, METATROOPER_ENGINES: registry, METATROOPER_WORKBENCH_PROBE: probeFile };
  let outsideHits = 0;
  const outside = createServer((_q, r) => { outsideHits++; r.end('outside'); });
  await new Promise<void>((r) => outside.listen(0, '127.0.0.1', () => r()));
  const outsidePort = (outside.address() as { port: number }).port;

  const core = await startCore({ ...iso, env });
  let wb: ChildProcess | null = null;
  const db = () => new DatabaseSync(join(iso.home, 'troop.db'), { readOnly: true });
  try {
    const pipe = await client(iso.prefix);
    await uiHello(pipe, iso.home);
    const project = join(iso.home, 'project');
    mkdirSync(project);
    const projectId = (await pipe.request('project.open', { path: project })).result.project_id as string;

    const wbArgs: [string, string[]] = process.platform === 'win32'
      ? [electron, [workbench]]
      : ['xvfb-run', ['-a', '-s', '-screen 0 1400x900x24', electron, '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', workbench]];
    wb = spawn(wbArgs[0], wbArgs[1], { env, stdio: ['ignore', 'ignore', openSync(join(iso.home, 'workbench.err'), 'w')], detached: process.platform !== 'win32' });

    const sessionId = (await pipe.request('session.launch', { project_id: projectId, engine_id: 'fake', prompt: join(workbench, 'test', 'fixtures', 'dev-engine.cjs') }, { timeout: 15_000 })).result.session_id as string;
    const row = await until(() => {
      const d = db();
      try { return d.prepare("SELECT port, url, matched_by, status FROM session_dev_server WHERE session_id = ?").get(sessionId) as { port: number; url: string; matched_by: string; status: string } | undefined; } finally { d.close(); }
    }, 20_000);
    assert.equal(row.matched_by, 'ancestry');
    assert.equal(row.status, 'ready');
    assert.equal(row.url, `http://localhost:${row.port}/`);

    const chip = await until(() => {
      if (!existsSync(probeFile)) return null;
      const states = readFileSync(probeFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).state);
      return states.reverse().find((s) => s.previews?.some((p: { session: string }) => p.session === sessionId))?.previews.find((p: { session: string }) => p.session === sessionId);
    }, 30_000).catch((e) => { throw new Error(`${e.message}; wb: ${existsSync(join(iso.home, 'workbench.err')) ? readFileSync(join(iso.home, 'workbench.err'), 'utf8').slice(-1500) : ''}`); });
    assert.equal(chip.text, 'Open preview');
    assert.equal(chip.url, row.url);

    // What the chip does: an agent pane of that session opened at the preview URL.
    const hits = join(iso.home, `dev-hits-${sessionId}.log`);
    const opened = await pipe.request('pane.open', { project_id: projectId, session_id: sessionId, agent: true, url: `${row.url}?from=chip` });
    assert.ok(opened.result?.pane_id?.startsWith('bp_agent_'), JSON.stringify(opened));
    await until(() => existsSync(hits) && readFileSync(hits, 'utf8').includes('/?from=chip'), 20_000);
    pipe.close();

    writeFileSync(join(iso.home, `browser-job-${sessionId}.json`), JSON.stringify({ session_id: sessionId, steps: [
      ['nav', 'browser.navigate', { url: `${row.url}?from=agent` }],
      ['read', 'browser.read', {}],
      ['outside', 'browser.navigate', { url: `http://localhost:${outsidePort}/` }],
      ['fetch', 'browser.evaluate', { expression: `fetch('http://127.0.0.1:${outsidePort}/', { mode: 'no-cors' }).then(() => 'reached', () => 'blocked')` }],
    ] }));
    const outFile = join(iso.home, `browser-out-${sessionId}.json`);
    const out = await until(() => (existsSync(outFile) ? JSON.parse(readFileSync(outFile, 'utf8')) : null), 40_000);
    assert.equal(out.hello.result?.bound, 'session', JSON.stringify(out.hello));
    assert.ok(out.steps.nav.result, JSON.stringify(out.steps.nav));
    assert.match(JSON.stringify(out.steps.read.result), /preview-ok/);
    assert.equal(out.steps.outside.error?.code, -32031, JSON.stringify(out.steps.outside));
    assert.equal(out.steps.fetch.result?.value, 'blocked', JSON.stringify(out.steps.fetch));
    assert.match(readFileSync(hits, 'utf8'), /\/\?from=agent/);
    await sleep(300);
    assert.equal(outsideHits, 0, 'the outside port was contacted');
  } finally {
    killTree(wb?.pid);
    outside.close();
    await sleep(300);
    await teardownCore(core, iso);
  }
});
