import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildGenerated, client, isolation, runNode, sleep, startCore, teardownCore, until } from '../../core/test/helpers.ts';
import { killTree } from '../../tests/helpers/kill-tree.ts';

const workbench = resolve(import.meta.dirname, '..');
const electron = join(workbench, 'node_modules', 'electron', 'dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
const xvfb = process.platform === 'linux' && spawnSync('which', ['xvfb-run']).status === 0;
const runnable = existsSync(electron) && (process.platform !== 'linux' || xvfb || Boolean(process.env.DISPLAY));

function startWorkbench(env: NodeJS.ProcessEnv): ChildProcess {
  const args = process.platform === 'linux' ? ['--no-sandbox', workbench] : [workbench];
  if (process.platform === 'linux' && !process.env.DISPLAY) {
    return spawn('xvfb-run', ['-a', '-s', '-screen 0 1400x900x24', electron, ...args], { env, stdio: 'ignore', detached: true });
  }
  return spawn(electron, args, { env, stdio: 'ignore', detached: process.platform !== 'win32' });
}

function stopWorkbench(child: ChildProcess): void {
  if (!child.pid) return;
  killTree(child.pid);
}

interface Probe { at: number; state: { sessions: Array<{ id: string; state: string }>; online: boolean } }

function probes(file: string): Probe[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

async function shown(file: string, since: number, check: (p: Probe) => boolean, timeout: number): Promise<number> {
  const hit = await until(() => probes(file).find((p) => p.at >= since && check(p)), timeout);
  return hit.at - since;
}

test('M1-11 the workbench shows waiting_for_you and done within 2 s of the hook, idle after the card is opened, and the offline badge when the core dies', { skip: !runnable && 'needs the Electron binary and a display (xvfb-run on Linux)', timeout: 120_000 }, async () => {
  await buildGenerated();
  const iso = isolation();
  const registry = join(iso.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{ id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks', roles: ['worker'], cost_rank: 1, version_cmd: [process.execPath, '--version'] }]));
  const probeFile = join(iso.home, 'probe.jsonl');
  const env = { ...iso.env, METATROOPER_ENGINES: registry, METATROOPER_WORKBENCH_PROBE: probeFile };
  let core = await startCore({ ...iso, env });
  const wb = startWorkbench(env);
  try {
    const project = join(iso.home, 'project');
    mkdirSync(project);
    const pipe = await client(iso.prefix);
    const opened = await pipe.request('project.open', { path: project });
    const launched = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id: 'fake', prompt: join(workbench, 'test', 'fixtures', 'long-engine.js') });
    pipe.close();
    const id = launched.result.session_id as string;
    const stateOf = (p: Probe) => p.state.sessions.find((x) => x.id === id)?.state;
    await shown(probeFile, 0, (p) => Boolean(stateOf(p)), 30_000);

    const hook = async (kind: string, body: object) => {
      const t = Date.now();
      const r = await runNode(['core/event.js', `claude.${kind}`], { ...env, TROOP_SESSION_ID: id }, JSON.stringify({ session_id: 'native-1', cwd: project, ...body }));
      assert.equal(r.code, 0);
      return t;
    };
    const t1 = await hook('Notification', { class: 'permission', message: 'Claude needs your permission to use Bash' });
    const waitMs = await shown(probeFile, t1, (p) => stateOf(p) === 'waiting_for_you', 5000);
    assert.ok(waitMs <= 2000, `waiting_for_you shown after ${waitMs} ms`);
    const t2 = await hook('Stop', { stop_hook_active: false });
    const doneMs = await shown(probeFile, t2, (p) => stateOf(p) === 'done', 5000);
    assert.ok(doneMs <= 2000, `done shown after ${doneMs} ms`);

    const seen = await client(iso.prefix);
    const t3 = Date.now();
    assert.deepEqual((await seen.request('session.seen', { session_id: id })).result, {});
    seen.close();
    await shown(probeFile, t3, (p) => stateOf(p) === 'idle', 5000);

    const t4 = Date.now();
    core.kill('SIGKILL');
    const offlineMs = await shown(probeFile, t4, (p) => !p.state.online, 12_000);
    assert.ok(offlineMs <= 8000, `offline badge after ${offlineMs} ms`);
    core = await startCore({ ...iso, env });
    const t5 = Date.now();
    await shown(probeFile, t5, (p) => p.state.online, 8000);
  } finally {
    stopWorkbench(wb);
    await sleep(300);
    await teardownCore(core, iso);
  }
});
