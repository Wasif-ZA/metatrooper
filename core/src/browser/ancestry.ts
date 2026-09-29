import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

export const MAX_LEVELS = 8;

/** Parent pid of every process: one `Get-CimInstance Win32_Process` on Windows, /proc elsewhere. */
export function parentTable(): Map<number, number> {
  const table = new Map<number, number>();
  if (process.platform === 'win32') {
    const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'], { encoding: 'utf8', windowsHide: true, timeout: 15_000 });
    for (const line of (r.stdout || '').split(/\r?\n/)) {
      const [pid, ppid] = line.trim().split(/\s+/).map(Number);
      if (pid) table.set(pid, ppid);
    }
    return table;
  }
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    try {
      const stat = fs.readFileSync(`/proc/${name}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      table.set(Number(name), ppid);
    } catch {}
  }
  return table;
}

/** The pid itself and up to MAX_LEVELS parents above it. */
export function ancestors(pid: number, table: Map<number, number> = parentTable()): number[] {
  const chain = [pid];
  let current = pid;
  for (let i = 0; i < MAX_LEVELS; i++) {
    const parent = table.get(current);
    if (!parent || parent === current || chain.includes(parent)) break;
    chain.push(parent);
    current = parent;
  }
  return chain;
}
