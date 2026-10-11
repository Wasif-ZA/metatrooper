import fs from 'node:fs';
import { execFile, spawnSync } from 'node:child_process';

export const MAX_LEVELS = 8;

const PS_ARGS = ['-NoProfile', '-NonInteractive', '-Command', 'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }'];
const PS_OPTS = { encoding: 'utf8' as const, windowsHide: true, timeout: 15_000 };

function parsePs(out: string): Map<number, number> {
  const table = new Map<number, number>();
  for (const line of out.split(/\r?\n/)) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid) table.set(pid, ppid);
  }
  return table;
}

/** Parent pid of every process: one `Get-CimInstance Win32_Process` on Windows, /proc elsewhere. */
export function parentTable(): Map<number, number> {
  const table = new Map<number, number>();
  if (process.platform === 'win32') return parsePs(spawnSync('powershell', PS_ARGS, PS_OPTS).stdout || '');
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

/** parentTable without blocking the event loop; /proc reads stay sync, they take milliseconds. */
export function parentTableAsync(): Promise<Map<number, number>> {
  if (process.platform !== 'win32') return Promise.resolve(parentTable());
  return new Promise((resolve) => execFile('powershell', PS_ARGS, PS_OPTS, (_e, out) => resolve(parsePs(out || ''))));
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
