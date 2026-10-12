import './log-core.ts';
import type { Server } from 'node:net';
import { openCoreDb } from './store/db.ts';
import { corePipe, termPipe } from './paths.ts';
import { startTermServer } from './terminal/pipe.ts';
import { wireTermEvents } from './terminal/events.ts';
import * as term from './terminal/index.ts';
import { deliverPrompts } from './sessions/launch.ts';
import { nowIso } from './time.ts';
import { rotateUiKey } from './uikey.ts';
import { CommandRunner } from './pipe/commands.ts';
import { startPipeServer, type PipeReady } from './pipe/server.ts';
import { PipeClient } from './pipe/client.ts';
import { buildMethods } from './methods.ts';
import { activeEngines, loadEngines, syncEngines } from './engines/registry.ts';
import { checkAll } from './engines/health.ts';
import { processEvents, resolveSpentNotices, resolveUncommitted, turnJobsIdle } from './events/processor.ts';
import { checkActivity, checkPids, checkStalled } from './sessions/watch.ts';
import { ingestSpools } from './sandbox/spool.ts';
import { readMeters } from './meter.ts';
import { readLimits } from './limits.ts';
import { earlyEnd, recordReadings, resumeAtReset } from './sessions/limit-resume.ts';
import { syncBuiltinPlugins } from './plugins/store.ts';
import { clearSettingsTemps, settings } from './settings.ts';
import { notifyTick } from './notify.ts';
import { pollDevServers, sweepDevServers } from './devservers.ts';
import { sweepWorktrees } from './worktree.ts';
import { coreResumer, liveAtStart, markGone } from './sessions/resume-all.ts';

process.removeAllListeners('warning');
process.on('warning', () => {});

/** The pid the running core reports through `core.ping`, or null when it does not answer within 3 s. */
async function runningPid(): Promise<number | null> {
  try {
    const client = await PipeClient.connect(corePipe(), 1000);
    try {
      const reply = await Promise.race([client.send('core.ping').reply, new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
      const pid = (reply?.result as { pid?: unknown } | undefined)?.pid;
      return typeof pid === 'number' ? pid : null;
    } finally {
      client.close();
    }
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  let ready!: (r: PipeReady) => void;
  const pipeReady = new Promise<PipeReady>((resolve) => { ready = resolve; });
  let server: Server;
  try {
    server = await startPipeServer(corePipe(), pipeReady);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw e;
    const pid = await runningPid();
    console.error(`core already running${pid === null ? '' : ` (pid ${pid})`}`);
    process.exit(1);
  }
  clearSettingsTemps();
  const db = openCoreDb();
  const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  setMeta.run('core_pid', String(process.pid));
  setMeta.run('core_heartbeat', nowIso());
  const wereLive = liveAtStart(db);
  term.pruneScreens();

  const engines = loadEngines();
  syncEngines(db, engines);
  syncBuiltinPlugins(db);

  const timers: NodeJS.Timeout[] = [];
  let termServer: Server | null = null;
  let stopping = false;
  const stop = async (why = 'core.stop') => {
    if (stopping) return;
    stopping = true;
    console.error(`core stopping: ${why}`);
    for (const t of timers) clearInterval(t);
    server.close();
    termServer?.close();
    await Promise.race([term.saveAllScreens(), new Promise((r) => setTimeout(r, 2000))]);
    term.killAll();
    await Promise.race([turnJobsIdle(), new Promise((r) => setTimeout(r, 5000))]);
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    db.close();
    process.exit(0);
  };

  const uiKey = rotateUiKey();
  const methods = buildMethods(db, { engines: () => activeEngines(db), stop, uiKey });
  const commands = new CommandRunner(db, methods);
  const home = settings().projects.default;
  if (home) try { methods.get('project.open')!.handler({ path: home }); } catch (e) { console.error(`projects.default not opened: ${(e as Error).message}`); }
  await commands.recover();
  markGone(db, wereLive);
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  processEvents(db);
  resolveSpentNotices(db);

  wireTermEvents(db);
  ready({ runner: commands, uiKey });
  termServer = await startTermServer(termPipe(), uiKey);

  const every = (ms: number, fn: () => unknown) => {
    const t = setInterval(() => {
      try {
        const r = fn();
        if (r instanceof Promise) r.catch(() => {});
      } catch {}
    }, ms);
    timers.push(t);
  };

  every(50, () => processEvents(db));
  every(250, () => commands.drainQueued());
  every(250, () => ingestSpools(db));
  every(500, () => deliverPrompts(db));
  every(1000, () => checkActivity(db));
  every(1000, () => pollDevServers(db));
  every(5000, () => sweepDevServers(db));
  every(2000, () => setMeta.run('core_heartbeat', nowIso()));
  every(2000, () => readMeters(db));
  const limits = () => { readLimits(db); recordReadings(db); earlyEnd(db); };
  try { limits(); } catch {}
  every(60_000, limits);
  every(5000, () => resumeAtReset(db));
  every(2000, () => notifyTick(db));
  every(5000, () => checkPids(db));
  every(5000, () => checkStalled(db));
  every(5000, () => resolveSpentNotices(db));
  every(10_000, () => resolveUncommitted(db));
  every(30_000, () => db.exec('PRAGMA wal_checkpoint(TRUNCATE)'));
  every(600_000, () => checkAll(db, activeEngines(db)));
  let sweeping = false;
  const sweep = () => {
    if (sweeping) return;
    sweeping = true;
    void sweepWorktrees(db, activeEngines(db)).catch(() => {}).finally(() => { sweeping = false; });
  };
  sweep();
  every(3_600_000, sweep);
  const resumer = coreResumer(db, wereLive, async (id) => (await methods.get('session.resume')!.handler({ session_id: id })) as { session_id: string });
  const resuming = setInterval(() => { if (resumer.done()) clearInterval(resuming); else void resumer.tick().catch(() => {}); }, 250);
  timers.push(resuming);
  checkPids(db);
  void checkAll(db, activeEngines(db)).catch(() => {});

  for (const sig of ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] as const) process.on(sig, () => stop(sig));
  process.on('exit', (code) => console.error(`core exit ${code}`));
  console.log(`metatrooper core running (pid ${process.pid}) on ${corePipe()}. Press Ctrl+C to stop.`);
}

main().catch((e) => {
  console.error(`metatrooper core failed to start: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
