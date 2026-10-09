import { connect as netConnect, type Server } from 'node:net';
import { openCoreDb } from './store/db.ts';
import { corePipe, termPipe } from './paths.ts';
import { startTermServer } from './terminal/pipe.ts';
import { wireTermEvents } from './terminal/events.ts';
import * as term from './terminal/index.ts';
import { deliverPrompts } from './sessions/launch.ts';
import { nowIso } from './time.ts';
import { rotateUiKey } from './uikey.ts';
import { CommandRunner } from './pipe/commands.ts';
import { startPipeServer } from './pipe/server.ts';
import { buildMethods } from './methods.ts';
import { activeEngines, loadEngines, syncEngines } from './engines/registry.ts';
import { checkAll } from './engines/health.ts';
import { processEvents, resolveSpentNotices, resolveUncommitted } from './events/processor.ts';
import { checkActivity, checkPids, checkStalled } from './sessions/watch.ts';
import { tickSchedules } from './schedules.ts';
import { ingestSpools } from './sandbox/spool.ts';
import { readMeters } from './meter.ts';
import { readLimits } from './limits.ts';
import { Runner } from './pipelines/runner.ts';
import { browserCall } from './browser/client.ts';
import { syncBuiltinPlugins, syncPipelines } from './pipelines/store.ts';
import { ulid } from './time.ts';
import { settings } from './settings.ts';
import { notifyTick } from './notify.ts';

process.removeAllListeners('warning');
process.on('warning', () => {});

function coreAlreadyRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = netConnect(corePipe());
    const done = (v: boolean) => { socket.destroy(); resolve(v); };
    socket.setTimeout(500, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function main(): Promise<void> {
  if (await coreAlreadyRunning()) {
    console.error(`metatrooper core is already running on ${corePipe()}`);
    process.exit(1);
  }
  const db = openCoreDb();
  const setMeta = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  setMeta.run('core_pid', String(process.pid));
  setMeta.run('core_heartbeat', nowIso());

  const engines = loadEngines();
  syncEngines(db, engines);
  syncBuiltinPlugins(db);
  syncPipelines(db);
  const runner = new Runner(db);

  const timers: NodeJS.Timeout[] = [];
  let server: Server | null = null;
  let termServer: Server | null = null;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const t of timers) clearInterval(t);
    server?.close();
    termServer?.close();
    term.killAll();
    try { runner.shutdown(); } catch {}
    try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
    db.close();
    process.exit(0);
  };

  const uiKey = rotateUiKey();
  runner.setBoardCapture((req) => browserCall(uiKey, 'browser.board_capture', req, 60_000));
  runner.setPaneCapture((pane_id, label) => browserCall(uiKey, 'browser.capture', { pane_id, label }, 60_000) as Promise<{ w1280_path: string }>);
  const methods = buildMethods(db, { engines: () => activeEngines(db), stop, runner, uiKey });
  const commands = new CommandRunner(db, methods);
  const home = settings().projects.default;
  if (home) try { methods.get('project.open')!.handler({ path: home }); } catch (e) { console.error(`projects.default not opened: ${(e as Error).message}`); }
  await commands.recover();
  try { db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); } catch {}
  processEvents(db);
  resolveSpentNotices(db);
  runner.recover();

  wireTermEvents(db);
  server = await startPipeServer(corePipe(), commands, uiKey);
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
  every(500, () => runner.tick());
  every(500, () => deliverPrompts(db));
  every(1000, () => checkActivity(db));
  every(2000, () => setMeta.run('core_heartbeat', nowIso()));
  every(2000, () => readMeters(db));
  try { readLimits(db); } catch {}
  every(60_000, () => readLimits(db));
  every(2000, () => notifyTick(db));
  every(5000, () => checkPids(db));
  every(5000, () => checkStalled(db));
  every(5000, () => resolveSpentNotices(db));
  every(10_000, () => resolveUncommitted(db));
  every(30_000, () => db.exec('PRAGMA wal_checkpoint(TRUNCATE)'));
  every(30_000, () => tickSchedules(db, (pipelineId, projectId, inputs) => {
    try {
      runner.start({ pipeline_id: pipelineId, project_id: projectId, inputs: (inputs ?? {}) as Record<string, unknown>, trigger: 'schedule' });
    } catch (e) {
      db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'run-failed', ?, ?)")
        .run(ulid(), nowIso(), pipelineId, `Scheduled run of ${pipelineId} could not start: ${(e as Error).message}`);
    }
  }));
  every(600_000, () => checkAll(db, activeEngines(db)));
  checkPids(db);
  void checkAll(db, activeEngines(db)).catch(() => {});

  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGBREAK', stop);
  console.log(`metatrooper core running (pid ${process.pid}) on ${corePipe()}. Press Ctrl+C to stop.`);
}

main().catch((e) => {
  console.error(`metatrooper core failed to start: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
