import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { dbFile, homeDir, schemaFile } from '../paths.ts';

export type Db = DatabaseSync;

function pragmas(db: DatabaseSync, busyMs: number): void {
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = ${busyMs}; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;`);
}

export function openCoreDb(): DatabaseSync {
  fs.mkdirSync(homeDir(), { recursive: true });
  const db = new DatabaseSync(dbFile());
  pragmas(db, 200);
  const v = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (v === 0) {
    db.exec('BEGIN');
    try {
      db.exec(fs.readFileSync(schemaFile, 'utf8'));
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '1')").run();
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } else if (v !== 1) {
    throw new Error(`troop.db schema version ${v} is not supported`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS usage_session_idx ON usage (session_id)');
  return db;
}


export function openReaderDb(): DatabaseSync | null {
  const file = dbFile();
  if (!fs.existsSync(file)) return null;
  return new DatabaseSync(file, { readOnly: true });
}

export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function ensureDir(p: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
}
