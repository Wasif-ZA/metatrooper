import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { coreDir, dbFile, homeDir, schemaFile } from '../paths.ts';
import { nowIso } from '../time.ts';

export type Db = DatabaseSync;

function pragmas(db: DatabaseSync, busyMs: number): void {
  db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = ${busyMs}; PRAGMA foreign_keys = ON; PRAGMA secure_delete = ON;`);
}

export function openCoreDb(): DatabaseSync {
  fs.mkdirSync(homeDir(), { recursive: true });
  const db = new DatabaseSync(dbFile());
  pragmas(db, 200);
  const version = () => (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  const v = version();
  if (v === 0) {
    db.exec('BEGIN IMMEDIATE');
    try {
      if (version() === 0) {
        db.exec(fs.readFileSync(schemaFile, 'utf8'));
        db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', '2')").run();
      }
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
  allowSandbox(db);
  const schemaText = fs.readFileSync(schemaFile, 'utf8');
  tx(db, () => {
    const addColumn = (table: string, column: string, type: string) => {
      if (!(db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
    };
    addColumn('session', 'driven_engine', 'TEXT');
    addColumn('session', 'parent_id', 'TEXT REFERENCES session(id)');
    db.exec('CREATE INDEX IF NOT EXISTS event_kind_idx ON event (kind, seq)');
    db.exec('CREATE INDEX IF NOT EXISTS event_session_idx ON event (session_id, seq)');
    addColumn('run', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
    addColumn('gate', 'scan', 'TEXT');
    addColumn('gate', 'override_reason', 'TEXT');
    addColumn('needs_you', 'notified_at', 'TEXT');
    addColumn('session', 'limit_resume', 'INTEGER NOT NULL DEFAULT 1');
    addColumn('project', 'hidden', 'INTEGER NOT NULL DEFAULT 0');
    addColumn('project', 'older', 'INTEGER NOT NULL DEFAULT 0');
    for (const table of ['notify_sink', 'notify_delivery', 'limit_history']) db.exec(schemaBlock(schemaText, new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`, 'g'))[0].replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'));
  });
  migrate(db);
  return db;
}

export const migrationsDir = path.join(coreDir, 'src', 'store', 'migrations');

/** Applies each `NNN-<name>.sql` in `dir` not yet in `schema_migration`, in id order, one transaction each. */
export function migrate(db: DatabaseSync, dir = migrationsDir): number[] {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migration (id INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((db.prepare('SELECT id FROM schema_migration').all() as Array<{ id: number }>).map((r) => Number(r.id)));
  const applied: number[] = [];
  for (const file of fs.readdirSync(dir).filter((f) => /^\d{3}-[\w-]+\.sql$/.test(f)).sort()) {
    const id = Number(file.slice(0, 3));
    if (done.has(id)) continue;
    const ran = tx(db, () => {
      if (db.prepare('SELECT 1 FROM schema_migration WHERE id = ?').get(id)) return false;
      db.exec(fs.readFileSync(path.join(dir, file), 'utf8'));
      db.prepare('INSERT INTO schema_migration (id, applied_at) VALUES (?, ?)').run(id, nowIso());
      return true;
    });
    if (ran) applied.push(id);
  }
  return applied;
}

const V2_TABLES = ['session', 'event', 'comment', 'needs_you'];
const V1_DROPPED = ['window_name', 'herdr_pane', 'herdr_at'];

function schemaBlock(schema: string, re: RegExp): string[] {
  return [...schema.matchAll(re)].map((m) => m[0]);
}

/** Recreates table `t` from its schema.sql definition, copying every old column through `select`; old columns schema.sql lacks are added back without constraints unless named in `drop`. */
function rebuildTable(db: DatabaseSync, schema: string, t: string, select: (col: string) => string = (c) => c, drop: string[] = []): void {
  const create = schemaBlock(schema, new RegExp(`CREATE TABLE ${t} \\([\\s\\S]*?\\n\\);`, 'g'))[0];
  db.exec(create.replace(`CREATE TABLE ${t} (`, `CREATE TABLE ${t}_v2 (`));
  const fresh = new Set((db.prepare(`PRAGMA table_info(${t}_v2)`).all() as Array<{ name: string }>).map((c) => c.name));
  const old = db.prepare(`PRAGMA table_info(${t})`).all() as Array<{ name: string; type: string }>;
  for (const c of old.filter((o) => !fresh.has(o.name) && !drop.includes(o.name))) {
    try {
      db.exec(`ALTER TABLE ${t}_v2 ADD COLUMN "${c.name.replace(/"/g, '""')}" ${c.type}`);
    } catch (e) {
      const used = db.prepare(`SELECT 1 FROM ${t} WHERE "${c.name.replace(/"/g, '""')}" IS NOT NULL LIMIT 1`).get();
      if (used) throw new Error(`troop.db: rebuilding ${t} would lose column ${c.name}, which holds data (${(e as Error).message})`);
    }
  }
  const cols = (db.prepare(`PRAGMA table_info(${t}_v2)`).all() as Array<{ name: string }>).map((c) => c.name);
  const oldNames = new Set(old.map((c) => c.name));
  const keep = cols.filter((c) => oldNames.has(c)).map((c) => (/^\w+$/.test(c) ? c : `"${c.replace(/"/g, '""')}"`));
  db.exec(`INSERT INTO ${t}_v2 (${keep.join(', ')}) SELECT ${keep.map(select).join(', ')} FROM ${t}`);
  db.exec(`DROP TABLE ${t}`);
  db.exec(`ALTER TABLE ${t}_v2 RENAME TO ${t}`);
  for (const idx of schemaBlock(schema, new RegExp(`CREATE INDEX \\w+\\s+ON ${t} \\([^)]*\\);`, 'g'))) db.exec(idx);
}

/** Rebuilds session, comment, needs_you and plugin once when their CHECKs predate a host or kind schema.sql now allows. */
export function allowSandbox(db: DatabaseSync): void {
  const sql = (t: string) => (db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(t) as { sql: string } | undefined)?.sql ?? '';
  const stale = [['session', "'external'"], ['comment', "'notice'"], ['needs_you', "'uncommitted'"], ['plugin', "'registry-import'"]].filter(([t, v]) => sql(t) && !sql(t).includes(v)).map(([t]) => t);
  if (!stale.length) return;
  const schema = fs.readFileSync(schemaFile, 'utf8');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const t of stale) rebuildTable(db, schema, t);
    if ((db.prepare('PRAGMA foreign_key_check').all() as unknown[]).length) throw new Error('foreign key check failed after rebuild');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

/** Version 1 to 2: in-app terminals. Rebuilds the four tables whose CHECKs or columns changed, in one transaction. */
export function migrateToV2(db: DatabaseSync): void {
  const schema = fs.readFileSync(schemaFile, 'utf8');
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('BEGIN IMMEDIATE');
  try {
    if ((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version !== 1) {
      db.exec('COMMIT');
      return;
    }
    for (const t of V2_TABLES) {
      rebuildTable(db, schema, t, (c) => (t === 'session' && c === 'host' ? "'pty'" : t === 'event' && c === 'source' ? "CASE WHEN source IN ('claude-hook','launch','codex-notify') THEN source ELSE 'core' END" : c), V1_DROPPED);
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
