import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

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
  try { process.kill(-target.pid, 'SIGKILL'); } catch {}
}

/** Ends a process and its children: `taskkill /T /F` on Windows, the process group elsewhere. */
export function killTree(target: KillTarget): void {
  if (process.platform !== 'win32') return posixKill(target);
  const c = command(target);
  if (c) spawnSync(c[0], c[1], { stdio: 'ignore', windowsHide: true });
}

/** `killTree` without blocking, resolved once the kill exits. */
export function killTreeAsync(target: KillTarget): Promise<void> {
  if (process.platform !== 'win32') { posixKill(target); return Promise.resolve(); }
  const c = command(target);
  if (!c) return Promise.resolve();
  return new Promise(resolve => {
    const killer = spawn(c[0], c[1], { stdio: 'ignore', windowsHide: true });
    killer.once('error', () => resolve());
    killer.once('exit', () => resolve());
  });
}
