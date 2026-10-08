import { spawn, spawnSync } from 'node:child_process';

/** Ends a process and its children: `taskkill /T /F` on Windows, the process group elsewhere. */
export function killTree(pid: number | undefined): void {
  if (!pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
  else try { process.kill(-pid, 'SIGKILL'); } catch {}
}

/** `killTree` without blocking, resolved once taskkill exits. */
export function killTreeAsync(pid: number | undefined): Promise<void> {
  if (!pid) return Promise.resolve();
  if (process.platform !== 'win32') { killTree(pid); return Promise.resolve(); }
  return new Promise(resolve => {
    const killer = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    killer.once('error', () => resolve());
    killer.once('exit', () => resolve());
  });
}
