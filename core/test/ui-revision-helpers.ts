import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { connect } from 'node:net';
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, pipePath, root, startCore, teardownCore, uiHello, until } from './helpers.ts';

export const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe', windowsHide: true }).trim();

export async function revisionHarness(fixture?: string, fakeWrapper?: string) {
  await buildGenerated();
  const iso = isolation();
  const project = join(iso.home, 'project');
  if (fixture) cpSync(join(root, 'tests/fixtures', fixture), project, { recursive: true });
  else mkdirSync(project);
  git(project, 'init', '-q', '-b', 'main');
  git(project, 'config', 'user.email', 'fixture@example.com');
  git(project, 'config', 'user.name', 'fixture');
  writeFileSync(join(project, 'seed.txt'), 'seed\n');
  git(project, 'add', '-A'); git(project, 'commit', '-qm', 'fixture');
  const origin = join(iso.home, 'origin.git');
  git(iso.home, 'init', '-q', '--bare', origin);
  git(project, 'remote', 'add', 'origin', origin); git(project, 'push', '-q', 'origin', 'main');
  const bin = join(iso.home, 'bin'); mkdirSync(bin);
  writeFileSync(join(bin, process.platform === 'win32' ? 'gh.cmd' : 'gh'), process.platform === 'win32'
    ? '@echo off\r\necho https://github.com/fake/repo/pull/7\r\n'
    : '#!/bin/sh\necho https://github.com/fake/repo/pull/7\n', { mode: 0o755 });
  const registry = join(iso.home, 'engines.json');
  const fakeEngine = fakeWrapper ? join(iso.home, 'fake-wrapper.mjs') : join(root, 'core/test/fake-engine.js');
  if (fakeWrapper) writeFileSync(fakeEngine, fakeWrapper);
  const engineSettings = join(iso.home, 'engine-settings.json');
  writeFileSync(engineSettings, JSON.stringify({ keep: 'original', enable: false }));
  const ticker = join(iso.home, 'ticker.cjs');
  writeFileSync(ticker, 'let n=0; setInterval(()=>console.log("revision-line-"+ ++n),100);');
  writeFileSync(registry, JSON.stringify([
    { id: 'fake', command: process.execPath, args: [fakeEngine], prompt_arg: 'positional', state_source: 'hooks', roles: ['plan','worker','review','verify','visual-check','research'], cost_rank: 1, version_cmd: [process.execPath, '--version'], settings: { file: engineSettings, set: { enable: true } } },
    { id: 'ticker', command: process.execPath, args: [ticker], prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 2, version_cmd: [process.execPath, '--version'] },
  ]));
  const env = { ...iso.env, METATROOPER_ENGINES: registry, METATROOPER_CLAUDE_SETTINGS: join(iso.home, 'claude-settings.json'), METATROOPER_CODEX_CONFIG: join(iso.home, 'codex-config.toml'), PATH: `${bin}${delimiter}${process.env.PATH}` };
  const core = await startCore({ ...iso, env });
  const db = new DatabaseSync(join(iso.home, 'troop.db')); db.exec('PRAGMA busy_timeout = 5000');
  const pipe = await client(iso.prefix); await uiHello(pipe, iso.home);
  const projectId = (await pipe.request('project.open', { path: project })).result.project_id;
  return { iso, env, core, db, pipe, project, projectId, engineSettings,
    async close() { pipe.close(); db.close(); await teardownCore(core, iso); },
    async launch(engine_id = 'ticker') {
      const r = await pipe.request('session.launch', { project_id: projectId, engine_id });
      assert.ok(r.result?.session_id, JSON.stringify(r)); return r.result;
    },
    async pipeline(def: any, inputs = {}) {
      const dir = join(project, '.troop/pipelines'); mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, `${def.id}.json`), JSON.stringify(def));
      const r = await pipe.request('run.start', { pipeline_id: def.id, project_id: projectId, inputs }, { timeout: 10000 });
      assert.ok(r.result?.run_id, JSON.stringify(r)); return r.result.run_id as string;
    },
  };
}

export function panePipeline() {
  return { schema: 1, id: 'revision-panes', title: 'Revision panes', steps: [
    ['items', { items: 'items.json' }], ['document', { document: 'report.md', score: 'score.json', sources: 'sources.json' }],
    ['table', { table: 'table.json' }], ['findings', { findings: 'findings.json' }],
  ].map(([view, outputs]) => ({ id: view, kind: 'agent', engine: 'fake', role: 'worker', view, outputs: Object.keys(outputs), prompt: `FAKE ${JSON.stringify({ outputs })}\nRead the fixture.` })) };
}

export async function runDone(h: Awaited<ReturnType<typeof revisionHarness>>, id: string) {
  return until(() => {
    const row = h.db.prepare('SELECT status FROM run WHERE id = ?').get(id);
    if (row?.status === 'failed') throw new Error(`run failed: ${JSON.stringify(h.db.prepare('SELECT * FROM run_step WHERE run_id = ?').all(id))}`);
    return row?.status === 'done';
  }, 60000);
}

export async function terminalViewer(prefix: string, home: string, session: string, resize = true) {
  const socket = connect(pipePath(`${prefix}-term`));
  await new Promise<void>((res, rej) => { socket.once('connect', res); socket.once('error', rej); });
  const messages: any[] = []; let buffer = '';
  socket.setEncoding('utf8'); socket.on('data', chunk => {
    buffer += chunk; for (let end; (end = buffer.indexOf('\n')) >= 0;) {
      const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); if (line) messages.push(JSON.parse(line));
    }
  });
  socket.on('error', () => {});
  socket.write(JSON.stringify({ op: 'attach', session, ...(resize ? { cols: 120, rows: 40 } : {}), ui_key: readFileSync(join(home, 'ui.key'), 'utf8').trim() }) + '\n');
  return { socket, messages };
}
