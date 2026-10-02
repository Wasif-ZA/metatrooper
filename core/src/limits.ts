import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { nowIso } from './time.ts';
import { homeDir } from './paths.ts';

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

const CLAUDE_WINDOWS: Record<string, string> = { five_hour: '5h', seven_day: 'weekly' };

/** The rate_limits Claude Code last passed to the statusline wrapper (core/statusline.js), or null. */
export function lastClaudeLimits(troopHome: string): { at: string; windows: Array<{ window: string; used: number; resets_at: number | null }> } | null {
  let saved: any;
  try { saved = JSON.parse(fs.readFileSync(path.join(troopHome, 'claude-limits.json'), 'utf8')); } catch { return null; }
  const rl = saved?.rate_limits;
  if (!rl || typeof rl !== 'object') return null;
  const windows = Object.entries(rl)
    .filter(([, w]: [string, any]) => typeof w?.used_percentage === 'number')
    .map(([k, w]: [string, any]) => ({ window: CLAUDE_WINDOWS[k] ?? k, used: w.used_percentage, resets_at: typeof w.resets_at === 'number' ? w.resets_at : null }));
  return windows.length ? { at: String(saved.at ?? ''), windows } : null;
}

/** Writes limit_reading rows: Codex from its session files, Claude from the statusline wrapper's file; unavailable when there is none. */
export function readLimits(db: DatabaseSync, home = os.homedir(), troopHome = homeDir()): void {
  const now = nowIso();
  const put = db.prepare(
    `INSERT INTO limit_reading (provider, account, window, used_pct, resets_at, read_at, status) VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider, account, window) DO UPDATE SET used_pct = excluded.used_pct, resets_at = excluded.resets_at, read_at = excluded.read_at, status = excluded.status`,
  );
  db.prepare("DELETE FROM limit_reading WHERE provider = 'claude'").run();
  const claude = lastClaudeLimits(troopHome);
  if (!claude) put.run('claude', 'default', '5h', null, null, now, 'unavailable');
  else for (const w of claude.windows) put.run('claude', 'default', w.window, w.used, w.resets_at === null ? null : nowIso(new Date(w.resets_at * 1000)), claude.at || now, 'ok');
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
