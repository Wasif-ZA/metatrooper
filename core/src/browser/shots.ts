import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export const SHOT_LABEL = /^[a-z0-9][a-z0-9-]{0,31}$/;
export const SHOT_NAME = /^([a-z0-9][a-z0-9-]{0,63})-(\d{1,3})-([a-z0-9][a-z0-9-]{0,31})\.png$/;

/** Where a pipeline step's screenshot is saved: `<run_dir>/shots/<step>-<round>-<label>.png`, round counted from 1. */
export function shotFile(db: DatabaseSync, sessionId: string | null, label: unknown): string {
  if (typeof label !== 'string' || !SHOT_LABEL.test(label)) throw new Error('save_as must be 1 to 32 lowercase letters, digits or dashes, such as 1280');
  const row = sessionId
    ? (db.prepare('SELECT rs.step_id, rs.iteration, r.run_dir FROM run_step rs JOIN run r ON r.id = rs.run_id WHERE rs.session_id = ? ORDER BY rs.iteration DESC LIMIT 1').get(sessionId) as
      | { step_id: string; iteration: number; run_dir: string } | undefined)
    : undefined;
  if (!row) throw new Error('save_as works only in a pipeline step');
  const step = row.step_id.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').slice(0, 64) || 'step';
  return path.join(row.run_dir, 'shots', `${step}-${row.iteration + 1}-${label}.png`);
}

export function saveShot(file: string, pngBase64: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(pngBase64, 'base64'));
}

/** The shot files in a run folder, oldest round first. */
export function listShots(runDir: string): string[] {
  try {
    return fs.readdirSync(path.join(runDir, 'shots')).filter((n) => SHOT_NAME.test(n)).sort((a, b) => {
      const [, sa, ra, la] = SHOT_NAME.exec(a)!;
      const [, sb, rb, lb] = SHOT_NAME.exec(b)!;
      return sa.localeCompare(sb) || Number(ra) - Number(rb) || la.localeCompare(lb);
    });
  } catch {
    return [];
  }
}
