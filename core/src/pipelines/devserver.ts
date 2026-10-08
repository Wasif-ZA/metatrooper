import http from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { nowIso } from '../time.ts';
import { killPid } from '../plugins/actions.ts';
import { releasePorts } from '../ports.ts';

const READY_TIMEOUT_MS = 90_000;
const POLL_MS = 250;
const TAIL_LINES = 50;

interface Running {
  child: ChildProcess;
  tail: string[];
}

const servers = new Map<string, Running>();

function key(runId: string, idx: number): string {
  return `${runId}/${idx}`;
}

function answers(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

/** Starts a project's dev command through the system shell with the user's environment, and records it in `dev_server`. */
export function startDevServer(db: DatabaseSync, runId: string, idx: number, port: number, command: string, cwd: string): void {
  const old = servers.get(key(runId, idx));
  if (old?.child.pid && old.child.exitCode === null) killPid(old.child.pid);
  const shell = process.platform === 'win32'
    ? { file: process.env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', `"${command}"`], verbatim: true }
    : { file: '/bin/sh', args: ['-c', command], verbatim: false };
  const child = spawn(shell.file, shell.args, {
    cwd,
    env: process.env,
    windowsHide: true,
    windowsVerbatimArguments: shell.verbatim,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const run: Running = { child, tail: [] };
  const collect = (chunk: Buffer) => {
    run.tail.push(...chunk.toString('utf8').split(/\r?\n/).filter(Boolean));
    if (run.tail.length > TAIL_LINES) run.tail.splice(0, run.tail.length - TAIL_LINES);
  };
  child.stdout?.on('data', collect);
  child.stderr?.on('data', collect);
  child.on('error', (e) => run.tail.push(`could not start: ${e.message}`));
  servers.set(key(runId, idx), run);
  db.prepare(
    `INSERT INTO dev_server (run_id, idx, port, pid, status, started_at) VALUES (?, ?, ?, ?, 'starting', ?)
     ON CONFLICT(run_id, idx) DO UPDATE SET port = excluded.port, pid = excluded.pid, status = 'starting', started_at = excluded.started_at`,
  ).run(runId, idx, port, child.pid ?? null, nowIso());
}

/** Polls the port until any HTTP response arrives; on timeout stops the server and returns its last output lines. */
export async function waitReady(db: DatabaseSync, runId: string, idx: number, port: number, cancelled: () => boolean): Promise<{ ok: true } | { ok: false; tail: string }> {
  const end = Date.now() + READY_TIMEOUT_MS;
  const run = servers.get(key(runId, idx));
  while (Date.now() < end && !cancelled()) {
    if (await answers(port)) {
      db.prepare("UPDATE dev_server SET status = 'ready' WHERE run_id = ? AND idx = ?").run(runId, idx);
      return { ok: true };
    }
    if (run && run.child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  const tail = run?.tail.join('\n') ?? '';
  stopDevServer(db, runId, idx);
  return { ok: false, tail };
}

/** Kills a dev server's process tree, removes its `dev_server` row and releases its port lease. */
export function stopDevServer(db: DatabaseSync, runId: string, idx: number): void {
  const row = db.prepare('SELECT pid FROM dev_server WHERE run_id = ? AND idx = ?').get(runId, idx) as { pid: number | null } | undefined;
  const run = servers.get(key(runId, idx));
  const pid = run?.child.pid ?? row?.pid ?? null;
  if (pid) killPid(pid);
  servers.delete(key(runId, idx));
  if (row) db.prepare('DELETE FROM dev_server WHERE run_id = ? AND idx = ?').run(runId, idx);
  releasePorts(db, runId, idx);
}

export function stopRunServers(db: DatabaseSync, runId: string): void {
  const rows = db.prepare('SELECT idx FROM dev_server WHERE run_id = ?').all(runId) as Array<{ idx: number }>;
  for (const r of rows) stopDevServer(db, runId, r.idx);
  releasePorts(db, runId);
}

export function stopAllServers(db: DatabaseSync): void {
  const rows = db.prepare("SELECT run_id, idx FROM dev_server WHERE status IN ('starting','ready')").all() as Array<{ run_id: string; idx: number }>;
  for (const r of rows) stopDevServer(db, r.run_id, r.idx);
}
