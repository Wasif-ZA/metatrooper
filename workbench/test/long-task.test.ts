import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildGenerated, client, isolation, runNode, sleep, startCore, teardownCore } from '../../core/test/helpers.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const xvfb = process.platform === 'linux' && spawnSync('which', ['xvfb-run']).status === 0;
const runnable = existsSync(electron) && (process.platform !== 'linux' || xvfb || Boolean(process.env.DISPLAY));
// Full spec run is 600 s; the default is a shorter scripted session with the same two core kills.
const seconds = Number(process.env.METATROOPER_M1_07_SECONDS ?? 40);

function startWorkbench(env: NodeJS.ProcessEnv): ChildProcess {
  const args = process.platform === 'linux' ? ['--no-sandbox', workbench] : [workbench];
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    return spawn('xvfb-run', ['-a', '-s', '-screen 0 1400x900x24', electron, ...args], { env, stdio: 'ignore', detached: true });
  }
  return spawn(electron, args, { env, stdio: 'ignore', detached: process.platform !== 'win32' });
}

function stopWorkbench(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else try { process.kill(-child.pid, 'SIGKILL'); } catch {}
}

test(`M1-07 the renderer has no main-thread task over 50 ms across a ${seconds} s scripted session with two core kills`, { skip: !runnable && 'needs the Electron binary and a display (xvfb-run on Linux)', timeout: (seconds + 90) * 1000 }, async () => {
  await buildGenerated();
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{ id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 1, version_cmd: [process.execPath, '--version'] }]));
  const longLog = join(iso.home, 'longtask.jsonl');
  const probeFile = join(iso.home, 'probe.jsonl');
  const env = { ...iso.env, METATROOPER_ENGINES: registry, METATROOPER_LONGTASK_LOG: longLog, METATROOPER_WORKBENCH_PROBE: probeFile };
  let core = await startCore({ ...iso, env });
  const wb = startWorkbench(env);
  try {
    const project = join(iso.home, 'project');
    mkdirSync(project);
    const pipe = await client(iso.prefix);
    const opened = await pipe.request('project.open', { path: project });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id: 'fake', prompt: join(workbench, 'test', 'fixtures', 'long-engine.js') });
      ids.push(r.result.session_id);
    }
    pipe.close();
    const kills = [seconds * 0.3, seconds * 0.65];
    const start = Date.now();
    let killed = 0;
    let n = 0;
    while ((Date.now() - start) / 1000 < seconds) {
      if (killed < 2 && (Date.now() - start) / 1000 >= kills[killed]) {
        core.kill('SIGKILL');
        await sleep(1500);
        core = await startCore({ ...iso, env });
        killed++;
      }
      const kind = n % 3 === 0 ? 'PostToolUse' : n % 3 === 1 ? 'Notification' : 'Stop';
      const body = kind === 'Notification' ? { class: 'permission', message: 'needs permission' } : { tool_name: 'Read', tool_input: { file_path: '/x' } };
      const r = await runNode(['core/event.js', `claude.${kind}`], { ...env, TROOP_SESSION_ID: ids[n % 3] }, JSON.stringify({ session_id: `n${n % 3}`, cwd: project, ...body }));
      assert.equal(r.code, 0);
      n++;
      await sleep(250);
    }
    assert.equal(killed, 2);
    await sleep(6500); // renderer flushes long-task batches every 5 s
    assert.ok(existsSync(probeFile), 'the workbench never reported a probe, so it was not rendering');
    const entries = existsSync(longLog)
      ? readFileSync(longLog, 'utf8').trim().split('\n').filter(Boolean).flatMap((l) => JSON.parse(l).entries as Array<{ duration: number }>)
      : [];
    assert.deepEqual(entries.filter((e) => e.duration > 50), [], `long tasks: ${JSON.stringify(entries)}`);
  } finally {
    stopWorkbench(wb);
    await sleep(300);
    await teardownCore(core, iso);
  }
});
