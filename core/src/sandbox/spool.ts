import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { homeDir } from '../paths.ts';
import { nowIso, ulid } from '../time.ts';
import { rebuildPayload, spoolKind } from '../redact.ts';
import { sourceOf } from '../events/append.ts';
import { removeContainer } from './launch.ts';

const MAX_LINE = 64 * 1024;
const MAX_SPOOL = 10 * 1024 * 1024;

export function spoolDir(sessionId: string): string {
  return path.join(homeDir(), 'spool', sessionId);
}

function ingestOne(db: DatabaseSync, id: string, exited: boolean): void {
  const dir = spoolDir(id);
  const file = path.join(dir, 'events.ndjson');
  const key = `spool_offset:${id}`;
  const getOffset = () => Number((db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? 0);
  const size = fs.existsSync(file) ? fs.statSync(file).size : 0;
  if (size > MAX_SPOOL) {
    if (!db.prepare("SELECT 1 FROM needs_you WHERE kind = 'spool-too-large' AND ref = ?").get(id)) {
      db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'spool-too-large', ?, ?)")
        .run(ulid(), nowIso(), id, `Sandboxed session ${id.slice(0, 8)} wrote more than 10 MiB of events; MetaTrooper stopped reading them.`);
    }
    return;
  }
  const offset = getOffset();
  if (size > offset) {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(size - offset);
    try { fs.readSync(fd, buf, 0, buf.length, offset); } finally { fs.closeSync(fd); }
    const end = buf.lastIndexOf(10);
    if (end >= 0) {
      const insert = db.prepare('INSERT INTO event (at, source, session_id, kind, payload) VALUES (?, ?, ?, ?, ?)');
      db.exec('BEGIN IMMEDIATE');
      try {
        let start = 0;
        while (start <= end) {
          const nl = buf.indexOf(10, start);
          const line = buf.subarray(start, nl);
          start = nl + 1;
          if (line.length > MAX_LINE) continue;
          let o: { kind?: unknown; payload?: unknown };
          try { o = JSON.parse(line.toString('utf8')); } catch { continue; }
          if (typeof o?.kind !== 'string' || !spoolKind(o.kind)) continue;
          insert.run(nowIso(), sourceOf(o.kind), id, o.kind, JSON.stringify(rebuildPayload(o.kind, (o.payload ?? {}) as object)));
        }
        db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(key, String(offset + end + 1));
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }
  }
  if (exited) {
    removeContainer(id);
    fs.rmSync(dir, { recursive: true, force: true });
    db.prepare('DELETE FROM meta WHERE key = ?').run(key);
  }
}

/** Moves whole spooled lines of every sandboxed session into `event`; once its session has exited, a last read drops any unfinished line and deletes the spool. */
export function ingestSpools(db: DatabaseSync): void {
  const rows = db.prepare("SELECT id, state FROM session WHERE host = 'sandbox'").all() as Array<{ id: string; state: string }>;
  for (const r of rows) {
    if (r.state === 'exited' && !fs.existsSync(spoolDir(r.id))) continue;
    try { ingestOne(db, r.id, r.state === 'exited'); } catch {}
  }
}
