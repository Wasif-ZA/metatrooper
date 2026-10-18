import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbFile } from '../paths.ts';
import { nowIso } from '../time.ts';

export function sourceOf(kind: string): string {
  if (kind.startsWith('claude.')) return 'claude-hook';
  if (kind === 'launch') return 'launch';
  if (kind === 'codex.turn') return 'codex-notify';
  return 'core';
}

/** Opens troop.db for queue inserts; null when the core has never created it. */
export function openWriterDb(busyMs = 200): DatabaseSync | null {
  const file = dbFile();
  if (!fs.existsSync(file)) return null;
  const db = new DatabaseSync(file);
  db.exec(`PRAGMA busy_timeout = ${busyMs}; PRAGMA synchronous = NORMAL;`);
  return db;
}

export function appendEvent(kind: string, sessionId: string | null, payload: object, db?: DatabaseSync, busyMs = 200): DatabaseSync | null {
  const spool = process.env.METATROOPER_SPOOL;
  if (spool && !db) {
    fs.appendFileSync(path.join(spool, 'events.ndjson'), JSON.stringify({ kind, at: nowIso(), payload }) + '\n');
    return null;
  }
  const conn = db ?? openWriterDb(busyMs);
  if (!conn) return null;
  conn
    .prepare('INSERT INTO event (at, source, session_id, kind, payload) VALUES (?, ?, ?, ?, ?)')
    .run(nowIso(), sourceOf(kind), sessionId, kind, JSON.stringify(payload));
  return conn;
}

export const AUDIT_DAYS = 30;

/** Deletes `browser.tool` audit rows older than 30 days. */
export function pruneBrowserAudit(db: DatabaseSync, now = Date.now()): number {
  return Number(db.prepare("DELETE FROM event WHERE kind = 'browser.tool' AND at < ?").run(nowIso(new Date(now - AUDIT_DAYS * 86_400_000))).changes);
}