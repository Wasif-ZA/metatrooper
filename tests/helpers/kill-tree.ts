import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A process to end. A ChildProcess is ended only while Node has not seen it exit: until then Node holds its handle,
 * so Windows cannot have given its pid to another process. A bare pid needs `born`, its start time in ms from
 * `startOf` when it was found, and is ended only while the process on that pid still has that start time.
 */
export type KillTarget = ChildProcess | { pid: number; born: number; slack?: number } | undefined | null;

const CREATED = '([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds()';

/** The start time in ms of the process on `pid` now, from the same Win32_Process field `killTree` checks; undefined when none. */
export function startOf(pid: number): number | undefined {
  if (process.platform !== 'win32') return Date.now();
  const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}"; if ($p) { ${CREATED} }`], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }).stdout?.trim();
  return out ? Number(out) : undefined;
}

type Owned = { pid: number; born: number; slack?: number };

/** The targets whose process still runs with the recorded start time, from one Win32_Process query; off Windows, a signal-0 probe. */
export function stillRunning(targets: Owned[]): Owned[] {
  if (!targets.length) return [];
  if (process.platform !== 'win32') return targets.filter((t) => { try { process.kill(t.pid, 0); return true; } catch { return false; } });
  const filter = [...new Set(targets.map((t) => `ProcessId=${Number(t.pid)}`))].join(' OR ');
  const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process -Filter "${filter}" | ForEach-Object { $p = $_; "$($p.ProcessId) $(${CREATED})" }`], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }).stdout ?? '';
  const born = new Map(out.split(/\r?\n/).filter(Boolean).map((l) => l.trim().split(' ').map(Number) as [number, number]));
  return targets.filter((t) => born.has(t.pid) && Math.abs(born.get(t.pid)! - t.born) <= (t.slack ?? 2));
}

/** Processes started at or after `since` whose command line contains `text`, a path unique to one test, so they are its own. */
export function runningWith(text: string, since: number): Owned[] {
  if (process.platform !== 'win32' || !text) return [];
  const out = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($env:KILL_TREE_TEXT) } | ForEach-Object { $p = $_; "$($p.ProcessId) $(${CREATED})" }`], { encoding: 'utf8', windowsHide: true, timeout: 15_000, env: { ...process.env, KILL_TREE_TEXT: text } }).stdout ?? '';
  return out.split(/\r?\n/).filter(Boolean).map((l) => l.trim().split(' ').map(Number)).filter(([pid, born]) => pid && born >= since).map(([pid, born]) => ({ pid, born }));
}

/** The taskkill command for a target still owned, or null when it has exited or its pid now names another process. */
function command(target: KillTarget): [string, string[]] | null {
  if (!target?.pid) return null;
  if (!('born' in target)) {
    if (target.exitCode !== null || target.signalCode !== null) return null;
    return ['taskkill', ['/PID', String(target.pid), '/T', '/F']];
  }
  // ponytail: the check and the kill are one script, a gap of milliseconds; a handle-based kill would close it
  const script = `$p = Get-CimInstance Win32_Process -Filter "ProcessId=${Number(target.pid)}"; if ($p -and [Math]::Abs(${CREATED} - ${Number(target.born)}) -le ${Number(target.slack ?? 2)}) { taskkill /PID ${Number(target.pid)} /T /F | Out-Null }`;
  return ['powershell', ['-NoProfile', '-NonInteractive', '-Command', script]];
}

function posixKill(target: KillTarget): void {
  if (!target?.pid || (!('born' in target) && (target.exitCode !== null || target.signalCode !== null))) return;
  try { process.kill(-target.pid, 'SIGKILL'); } catch { try { process.kill(target.pid, 'SIGKILL'); } catch {} }
}

/** With METATROOPER_TEST_KILL_LOG set to a folder, appends one JSON line naming the killer and every process in the target's tree. */
export function noteKill(pid: number, via: string): void {
  const dir = process.env.METATROOPER_TEST_KILL_LOG;
  if (!dir || process.platform !== 'win32') return;
  const script = `$all = Get-CimInstance Win32_Process; $q = @(${Number(pid)}); $seen = @{}; while ($q.Count) { $p, $q = $q; if ($seen[$p]) { continue }; $seen[$p] = 1; $all | Where-Object { $_.ParentProcessId -eq $p -and $_.ProcessId -ne $p } | ForEach-Object { $q += $_.ProcessId } }; $all | Where-Object { $seen[$_.ProcessId] } | ForEach-Object { "$($_.ProcessId) $($_.CommandLine)" }`;
  const tree = (spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15_000 }).stdout ?? '').split(/\r?\n/).filter(Boolean);
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, 'kills.jsonl'), JSON.stringify({ at: new Date().toISOString(), via, pid, killer: process.argv.slice(1).join(' '), tree }) + '\n');
}

/** Ends a process and its children: `taskkill /T /F` on Windows, the process group elsewhere. */
export function killTree(target: KillTarget): void {
  if (process.platform !== 'win32') return posixKill(target);
  const c = command(target);
  if (c) { noteKill(target!.pid!, 'killTree'); spawnSync(c[0], c[1], { stdio: 'ignore', windowsHide: true }); }
}

/** `killTree` without blocking, resolved once the kill exits. */
export function killTreeAsync(target: KillTarget): Promise<void> {
  if (process.platform !== 'win32') { posixKill(target); return Promise.resolve(); }
  const c = command(target);
  if (!c) return Promise.resolve();
  noteKill(target!.pid!, 'killTreeAsync');
  return new Promise(resolve => {
    const killer = spawn(c[0], c[1], { stdio: 'ignore', windowsHide: true });
    killer.once('error', () => resolve());
    killer.once('exit', () => resolve());
  });
}
