import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { nowIso } from './time.ts';

const TAIL_BYTES = 512 * 1024;

interface Window { used_percent?: number; window_minutes?: number; resets_at?: number }

export function windowName(minutes: number): string {
  if (minutes === 300) return '5h';
  if (minutes === 1440) return 'daily';
  if (minutes === 10080) return 'weekly';
  return `${minutes}m`;
}

function newest(dir: string, depth: number): string | null {
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  if (depth === 0) {
    const files = entries.filter((e) => e.isFile() && e.name.endsWith('.jsonl')).map((e) => path.join(dir, e.name));
    return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] ?? null;
  }
  for (const d of entries.filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse()) {
    const hit = newest(path.join(dir, d), depth - 1);
    if (hit) return hit;
  }
  return null;
}

/** The last rate_limits reading in the newest Codex session file under <home>/.codex/sessions/YYYY/MM/DD. */
export function lastCodexLimits(home = os.homedir()): { at: string; plan: string | null; windows: Window[] } | null {
  const file = newest(path.join(home, '.codex', 'sessions'), 3);
  if (!file) return null;
  const size = fs.statSync(file).size;
  const fd = fs.openSync(file, 'r');
  let text: string;
  try {
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    text = buf.toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"rate_limits"')) continue;
    let rec: any;
    try { rec = JSON.parse(lines[i]); } catch { continue; }
    const rl = rec?.payload?.rate_limits;
    if (rec?.payload?.type !== 'token_count' || !rl) continue;
    return { at: String(rec.timestamp ?? ''), plan: typeof rl.plan_type === 'string' ? rl.plan_type : null, windows: [rl.primary, rl.secondary].filter(Boolean) };
  }
  return null;
}

/** Writes limit_reading rows: Codex from its session files, Claude as unavailable (no local source). */
export function readLimits(db: DatabaseSync, home = os.homedir()): void {
  const now = nowIso();
  const put = db.prepare(
    `INSERT INTO limit_reading (provider, account, window, used_pct, resets_at, read_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, account, window) DO UPDATE SET used_pct = excluded.used_pct, resets_at = excluded.resets_at, read_at = excluded.read_at, status = excluded.status`,
  );
  put.run('claude', 'default', '5h', null, null, now, 'unavailable');
  let codex: ReturnType<typeof lastCodexLimits> = null;
  try { codex = lastCodexLimits(home); } catch {}
  db.prepare("DELETE FROM limit_reading WHERE provider = 'codex'").run();
  if (!codex || !codex.windows.length) {
    put.run('codex', 'default', '5h', null, null, now, 'unavailable');
    return;
  }
  for (const w of codex.windows) {
    if (typeof w.window_minutes !== 'number' || typeof w.used_percent !== 'number') continue;
    const resets = typeof w.resets_at === 'number' ? nowIso(new Date(w.resets_at * 1000)) : null;
    put.run('codex', codex.plan ?? 'default', windowName(w.window_minutes), w.used_percent, resets, codex.at || now, 'ok');
  }
}
