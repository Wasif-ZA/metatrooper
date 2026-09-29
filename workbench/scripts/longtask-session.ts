import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildGenerated, client, isolation, runNode, sleep, startCore, teardownCore } from '../../core/test/helpers.ts';

const minutes = Number(process.argv[process.argv.indexOf('--minutes') + 1]) || 10;
const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');

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

await buildGenerated();
const iso = isolation();
const registry = join(iso.home, 'engines.json');
writeFileSync(registry, JSON.stringify([{ id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 1, version_cmd: [process.execPath, '--version'] }]));
const log = join(iso.home, 'longtasks.jsonl');
const env = { ...iso.env, METATROOPER_ENGINES: registry, TROOP_LAUNCHER: 'spawn', METATROOPER_LONGTASK_LOG: log };
let core = await startCore({ ...iso, env });
const wb = startWorkbench(env);
const sessions: string[] = [];
try {
  const project = join(iso.home, 'project');
  mkdirSync(project);
  const pipe = await client(iso.prefix);
  const opened = await pipe.request('project.open', { path: project });
  for (let i = 0; i < 3; i++) {
    const r = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id: 'fake', prompt: join(workbench, 'test', 'fixtures', 'long-engine.js') });
    sessions.push(r.result.session_id);
  }
  pipe.close();
  const end = Date.now() + minutes * 60_000;
  const kills = [Date.now() + (minutes * 60_000) / 3, Date.now() + (2 * minutes * 60_000) / 3];
  const kinds = [['PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls' } }], ['Notification', { class: 'permission' }], ['Stop', { stop_hook_active: false }]] as const;
  let n = 0;
  while (Date.now() < end) {
    if (kills.length && Date.now() >= kills[0]) {
      kills.shift();
      core.kill('SIGKILL');
      console.log(`${new Date().toISOString()} core killed`);
      await sleep(8000);
      core = await startCore({ ...iso, env });
      console.log(`${new Date().toISOString()} core restarted`);
    }
    const [kind, body] = kinds[n % kinds.length];
    const id = sessions[n % sessions.length];
    await runNode(['core/event.js', `claude.${kind}`], { ...env, TROOP_SESSION_ID: id }, JSON.stringify({ session_id: `native-${id}`, cwd: project, ...body }));
    n++;
    await sleep(250);
  }
  await sleep(6000);
  const entries = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).flatMap((l) => JSON.parse(l).entries as Array<{ duration: number }>) : [];
  const over = entries.filter((e) => e.duration > 50);
  console.log(JSON.stringify({ minutes, events: n, long_tasks: entries.length, over_50ms: over.length, max_ms: Math.max(0, ...entries.map((e) => e.duration)) }));
  process.exitCode = over.length ? 1 : 0;
} finally {
  stop(wb);
  await sleep(300);
  await teardownCore(core, iso);
  rmSync(iso.home, { recursive: true, force: true });
}
