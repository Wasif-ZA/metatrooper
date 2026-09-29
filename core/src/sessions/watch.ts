import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { appendEvent } from '../events/append.ts';

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Every 5 s: sessions whose launcher pid is gone get a core.process-gone event. */
export function checkPids(db: DatabaseSync): void {
  const rows = db
    .prepare("SELECT id, pid FROM session WHERE state != 'exited' AND pid IS NOT NULL")
    .all() as Array<{ id: string; pid: number }>;
  for (const r of rows) if (!pidAlive(r.pid)) appendEvent('core.process-gone', r.id, { pid: r.pid }, db);
}

interface Activity {
  file: string | null;
  size: number;
  mtime: number;
  lastChange: number;
  working: boolean;
}

const activity = new Map<string, Activity>();

function codexHome(): string {
  return path.join(os.homedir(), '.codex', 'sessions');
}

function agyBrain(): string {
  return path.join(os.homedir(), '.gemini', 'antigravity-cli', 'brain');
}

function walkNewest(dir: string, test: (p: string) => boolean, sinceMs: number, out: string[] = [], depth = 0): string[] {
  if (depth > 4 || !fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkNewest(p, test, sinceMs, out, depth + 1);
    else if (test(p)) {
      try {
        if (fs.statSync(p).birthtimeMs >= sinceMs) out.push(p);
      } catch {}
    }
  }
  return out;
}

function firstLine(file: string): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    return buf.subarray(0, n).toString('utf8').split('\n')[0];
  } finally {
    fs.closeSync(fd);
  }
}

function sameDir(a: string, b: string): boolean {
  const norm = (p: string) => p.split(String.fromCharCode(92)).join('/').replace(/\/+$/, '').toLowerCase();
  return norm(a) === norm(b);
}

function linkCodex(db: DatabaseSync, s: SessionRow): string | null {
  const startMs = Date.parse(s.started_at);
  if (s.native_id) {
    const hit = walkNewest(codexHome(), (p) => p.endsWith(`${s.native_id}.jsonl`), startMs - 60_000);
    return hit[0] ?? null;
  }
  const candidates = walkNewest(codexHome(), (p) => /rollout-.*\.jsonl$/.test(p), startMs - 1000).filter((p) => {
    try {
      const meta = JSON.parse(firstLine(p));
      const cwd = meta?.payload?.cwd ?? meta?.cwd;
      return typeof cwd === 'string' && sameDir(cwd, s.project_path) && fs.statSync(p).birthtimeMs <= startMs + 30_000;
    } catch {
      return false;
    }
  });
  candidates.sort((a, b) => fs.statSync(b).birthtimeMs - fs.statSync(a).birthtimeMs);
  return candidates[0] ?? null;
}

function linkAgy(db: DatabaseSync, s: SessionRow): string | null {
  const startMs = Date.parse(s.started_at);
  const agyStarts = db.prepare("SELECT started_at FROM session WHERE engine_id = 'agy'").all() as Array<{ started_at: string }>;
  const siblings = agyStarts.filter((r) => Math.abs(Date.parse(r.started_at) - startMs) <= 30_000).length;
  if (siblings > 1) return null;
  const brain = agyBrain();
  if (!fs.existsSync(brain)) return null;
  const dirs = fs
    .readdirSync(brain, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(brain, e.name))
    .filter((d) => {
      const b = fs.statSync(d).birthtimeMs;
      return b >= startMs - 1000 && b <= startMs + 30_000;
    });
  if (dirs.length !== 1) return null;
  if (!s.native_id) db.prepare('UPDATE session SET native_id = ? WHERE id = ? AND native_id IS NULL').run(path.basename(dirs[0]), s.id);
  return path.join(dirs[0], '.system_generated', 'logs');
}

function measure(p: string): { size: number; mtime: number } {
  try {
    const st = fs.statSync(p);
    if (!st.isDirectory()) return { size: st.size, mtime: st.mtimeMs };
    let size = 0;
    let mtime = st.mtimeMs;
    for (const e of fs.readdirSync(p)) {
      const s2 = fs.statSync(path.join(p, e));
      size += s2.size;
      mtime = Math.max(mtime, s2.mtimeMs);
    }
    return { size, mtime };
  } catch {
    return { size: -1, mtime: 0 };
  }
}

interface SessionRow {
  id: string;
  engine_id: string;
  native_id: string | null;
  started_at: string;
  project_path: string;
  state: string;
}

/** Every 1 s: codex and agy sessions get core.activity working/quiet from their session files. */
export function checkActivity(db: DatabaseSync, now = Date.now()): void {
  const rows = db
    .prepare(
      `SELECT s.id, s.engine_id, s.native_id, s.started_at, p.path AS project_path, s.state
       FROM session s JOIN project p ON p.id = s.project_id
       WHERE s.state != 'exited' AND s.engine_id IN ('codex','agy')`,
    )
    .all() as unknown as SessionRow[];
  for (const s of rows) {
    let a = activity.get(s.id);
    if (!a || !a.file) {
      const file = s.engine_id === 'codex' ? linkCodex(db, s) : linkAgy(db, s);
      if (!file) continue;
      const m = measure(file);
      a = { file, size: m.size, mtime: m.mtime, lastChange: 0, working: false };
      activity.set(s.id, a);
      continue;
    }
    const m = measure(a.file!);
    if (m.size !== a.size || m.mtime !== a.mtime) {
      a.size = m.size;
      a.mtime = m.mtime;
      a.lastChange = now;
      if (!a.working) {
        a.working = true;
        appendEvent('core.activity', s.id, { state: 'working' }, db);
      }
    } else if (a.working && now - a.lastChange >= 20_000) {
      a.working = false;
      appendEvent('core.activity', s.id, { state: 'quiet' }, db);
    }
  }
}
