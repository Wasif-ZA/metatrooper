import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { coreDir } from '../paths.ts';
import { nowIso, ulid } from '../time.ts';

// The block list ships with cc and changes only by release (Wasif #29): [{id, versions?, reason}]; no versions means every version.
export interface Block { id: string; versions?: string[]; reason: string }
export const BLOCK_FILE = path.join(coreDir, 'src', 'plugins', 'blocked.json');

export function readBlocks(file = BLOCK_FILE): Block[] {
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(list) ? list.filter((b) => b && typeof b.id === 'string' && typeof b.reason === 'string') : [];
  } catch { return []; }
}

/** The reason a plugin version is blocked, or null. */
export function blockReason(id: string, version: string, blocks = readBlocks()): string | null {
  return blocks.find((b) => b.id === id && (!Array.isArray(b.versions) || b.versions.includes(version)))?.reason ?? null;
}

/** Turns off every installed plugin the list blocks and raises one needs-you row saying why; returns the ids it turned off. */
export function applyBlocks(db: DatabaseSync, blocks = readBlocks()): string[] {
  const off: string[] = [];
  for (const p of db.prepare("SELECT id, version FROM plugin WHERE enabled = 1 AND source != 'builtin'").all() as Array<{ id: string; version: string }>) {
    const why = blockReason(p.id, p.version, blocks);
    if (!why) continue;
    db.prepare('UPDATE plugin SET enabled = 0 WHERE id = ?').run(p.id);
    const text = `Plugin ${p.id} ${p.version} was turned off: it is on cc's block list. ${why}`;
    if (!db.prepare("SELECT 1 FROM needs_you WHERE kind = 'other' AND ref = ? AND text = ? AND resolved_at IS NULL").get(p.id, text)) {
      db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'other', ?, ?)").run(ulid(), nowIso(), p.id, text);
    }
    off.push(p.id);
  }
  return off;
}
