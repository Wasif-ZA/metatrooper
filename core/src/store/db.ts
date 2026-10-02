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
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '2')").run();
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  } else if (v === 1) {
    migrateToV2(db);
  } else if (v !== 2) {
    throw new Error(`troop.db schema version ${v} is not supported`);
  }
  db.exec('CREATE INDEX IF NOT EXISTS usage_session_idx ON usage (session_id)');
  return db;
}

const V2_TABLES = ['session', 'event', 'comment', 'needs_you'];

function schemaBlock(schema: string, re: RegExp): string[] {
  return [...schema.matchAll(re)].map((m) => m[0]);
}

/** Version 1 to 2: in-app terminals. Rebuilds the four tables whose CHECKs or columns changed, in one transaction. */
export function migrateToV2(db: DatabaseSync): void {
  const schema = fs.readFileSync(schemaFile, 'utf8');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const t of V2_TABLES) {
      const create = schemaBlock(schema, new RegExp(`CREATE TABLE ${t} \\([\\s\\S]*?\\n\\);`, 'g'))[0];
      db.exec(create.replace(`CREATE TABLE ${t} (`, `CREATE TABLE ${t}_v2 (`));
      const cols = (db.prepare(`PRAGMA table_info(${t}_v2)`).all() as Array<{ name: string }>).map((c) => c.name);
      const old = new Set((db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string }>).map((c) => c.name));
      const keep = cols.filter((c) => old.has(c));
      const sel = keep.map((c) => (t === 'session' && c === 'host' ? "'pty'" : t === 'event' && c === 'source' ? "CASE WHEN source IN ('claude-hook','launch','codex-notify') THEN source ELSE 'core' END" : c));
      db.exec(`INSERT INTO ${t}_v2 (${keep.join(', ')}) SELECT ${sel.join(', ')} FROM ${t}`);
      db.exec(`DROP TABLE ${t}`);
      db.exec(`ALTER TABLE ${t}_v2 RENAME TO ${t}`);
      for (const idx of schemaBlock(schema, new RegExp(`CREATE INDEX \\w+\\s+ON ${t} \\([^)]*\\);`, 'g'))) db.exec(idx);
    }
    db.exec(schemaBlock(schema, /CREATE TABLE ui_selection \([\s\S]*?\n\);/g)[0]);
    if ((db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length) throw new Error('foreign key check failed after migration');
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '2')").run();
    db.exec('PRAGMA user_version = 2');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
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
