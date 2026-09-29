import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, sleep, startCore, teardownCore } from '../../core/test/helpers.ts';

const repo = resolve(import.meta.dirname, '..', '..');
const workbench = join(repo, 'workbench');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const keepAt = process.argv.indexOf('--keep');
const keep = keepAt > 0 ? process.argv[keepAt + 1] : null;
const briefFile = process.argv[process.argv.indexOf('--brief-file') + 1] || join(repo, 'tests', 'fixtures', 'design-variants', 'brief.md');

function startWorkbench(env: NodeJS.ProcessEnv): ChildProcess {
  const args = process.platform === 'linux' ? ['--no-sandbox', workbench] : [workbench];
  if (process.platform === 'linux' && !process.env.DISPLAY) return spawn('xvfb-run', ['-a', '-s', '-screen 0 1400x900x24', electron, ...args], { env, stdio: 'ignore', detached: true });
  return spawn(electron, args, { env, stdio: 'ignore', detached: process.platform !== 'win32' });
}

function stop(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

if (!existsSync(electron)) {
  console.error('needs the Electron binary: cd workbench && npm install');
  process.exit(2);
}

await buildGenerated();
const base = isolation();
const iso = { ...base, env: { ...base.env, USERPROFILE: process.env.USERPROFILE, HOME: process.env.HOME } };
const core = await startCore(iso);
const wb = startWorkbench(iso.env);
let code = 1;
try {
  const project = join(iso.home, 'project');
  mkdirSync(project);
  const pipe = await client(iso.prefix);
  const opened = await pipe.request('project.open', { path: project });
  pipe.close();
  const brief = readFileSync(briefFile, 'utf8').trim();
  await sleep(3000);
  const runPipe = await client(iso.prefix);
  const started = await runPipe.request('run.start', { pipeline_id: 'inspiration-board', project_id: opened.result.project_id, inputs: { brief } }, { timeout: 10_000 });
  runPipe.close();
  if (!started.result) throw new Error(`run.start failed: ${JSON.stringify(started.error)}`);
  const runId = started.result.run_id as string;
  const db = new DatabaseSync(join(iso.home, 'troop.db'), { readOnly: true });
  const end = Date.now() + 10 * 60_000;
  let status = 'running';
  while (Date.now() < end) {
    status = (db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as { status: string }).status;
    if (status !== 'running') break;
    await sleep(1000);
  }
  const items = db.prepare('SELECT source_url, capture_path, reason FROM board_item WHERE run_id = ? ORDER BY rowid').all(runId) as Array<{ source_url: string; capture_path: string | null; reason: string }>;
  for (const i of items) console.log(`${i.capture_path && existsSync(i.capture_path) ? 'ok  ' : 'FAIL'} ${i.source_url}`);
  const captured = items.filter((i) => i.capture_path && existsSync(i.capture_path)).length;
  const log = join(String((db.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId) as { run_dir: string }).run_dir), 'log.jsonl');
  if (existsSync(log)) for (const l of readFileSync(log, 'utf8').trim().split('\n')) if (l.includes('"board"')) console.log(JSON.parse(l).board);
  console.log(`run ${status}: ${items.length} references, ${captured} captured`);
  db.close();
  if (keep) cpSync(join(iso.home, 'boards'), keep, { recursive: true });
  code = status === 'done' && captured >= 8 ? 0 : 1;
} finally {
  stop(wb);
  await sleep(300);
  await teardownCore(core, iso);
}
process.exit(code);
