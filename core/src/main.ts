import type net from 'node:net';
import { openCoreDb } from './store/db.ts';
import { corePipe } from './paths.ts';
import { nowIso } from './time.ts';
import { rotateUiKey } from './uikey.ts';
import { CommandRunner } from './pipe/commands.ts';
import { startPipeServer } from './pipe/server.ts';
import { buildMethods } from './methods.ts';
import { activeEngines, loadEngines, syncEngines } from './engines/registry.ts';
import { checkAll } from './engines/health.ts';
import { processEvents } from './events/processor.ts';
import { checkActivity, checkPids } from './sessions/watch.ts';
import { tickSchedules } from './schedules.ts';
import { Runner } from './pipelines/runner.ts';
import { syncBuiltinPlugins, syncPipelines } from './pipelines/store.ts';
import { ulid } from './time.ts';

process.removeAllListeners('warning');
process.on('warning', () => {});

async function main(): Promise<void> {
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
  let server: net.Server | null = null;
  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    for (const t of timers) clearInterval(t);
    server?.close();
    try { runner.shutdown(); } catch {}
    try { db.exec('PRAGMA wal_checkpoint(PASSIVE)'); } catch {}
    db.close();
    process.exit(0);
  };

  const uiKey = rotateUiKey();
  const commands = new CommandRunner(db, buildMethods(db, { engines: () => activeEngines(db), stop, runner, uiKey }));
  await commands.recover();
  processEvents(db);
  runner.recover();

  server = await startPipeServer(corePipe(), commands, uiKey);

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
  every(500, () => runner.tick());
  every(1000, () => checkActivity(db));
  every(2000, () => setMeta.run('core_heartbeat', nowIso()));
  every(5000, () => checkPids(db));
  every(30_000, () => db.exec('PRAGMA wal_checkpoint(PASSIVE)'));
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
}

main().catch((e) => {
  console.error(`metatrooper core failed to start: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
