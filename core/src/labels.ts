import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

const PALETTE = ['#d73a4a', '#0075ca', '#a2eeef', '#7057ff', '#008672', '#e4e669', '#d876e3', '#fbca04', '#0e8a16', '#c5def5'];

/** Default label colour: a palette entry picked by the sha256 of the name, so the same name always gets the same colour. */
export function labelColour(name: string): string {
  return PALETTE[createHash('sha256').update(name).digest()[0]! % PALETTE.length]!;
}

/** Gives every label name used by a session or an automation a `label` row; existing colours are kept. */
export function ensureLabels(db: DatabaseSync, names?: string[]): void {
  const list = names ?? (db.prepare('SELECT name FROM session_label UNION SELECT name FROM automation_label').all() as Array<{ name: string }>).map((r) => r.name);
  const insert = db.prepare('INSERT OR IGNORE INTO label (name, colour) VALUES (?, ?)');
  for (const name of list) insert.run(name, labelColour(name));
}

/** Validates a label list the way session.labels-set does: trimmed, unique, 1-32 characters each, at most 8. */
export function labelList(raw: unknown): string[] {
  if (!Array.isArray(raw) || !raw.every((l) => typeof l === 'string')) throw new Error('labels must be an array of strings');
  const labels = [...new Set((raw as string[]).map((l) => l.trim()))];
  if (labels.some((l) => l.length < 1 || l.length > 32)) throw new Error('each label must be 1 to 32 characters');
  if (labels.length > 8) throw new Error('at most 8 labels');
  return labels;
}
