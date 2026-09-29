import type { DatabaseSync } from 'node:sqlite';
import { nowIso, ulid } from './time.ts';

function field(spec: string, value: number, min: number, max: number): boolean {
  for (const part of spec.split(',')) {
    const [range, stepStr] = part.split('/');
    const step = stepStr ? Number(stepStr) : 1;
    let lo = min;
    let hi = max;
    if (range !== '*') {
      const [a, b] = range.split('-').map(Number);
      lo = a;
      hi = b === undefined ? a : b;
    }
    if (value >= lo && value <= hi && (value - lo) % step === 0) return true;
  }
  return false;
}

/** True when a 5-field cron expression (local time) matches the given minute. */
export function cronMatches(cron: string, d: Date): boolean {
  const f = cron.trim().split(/\s+/);
  if (f.length !== 5) throw new Error(`cron needs 5 fields: ${cron}`);
  const dow = d.getDay();
  return (
    field(f[0], d.getMinutes(), 0, 59) &&
    field(f[1], d.getHours(), 0, 23) &&
    field(f[2], d.getDate(), 1, 31) &&
    field(f[3], d.getMonth() + 1, 1, 12) &&
    (field(f[4], dow, 0, 6) || (dow === 0 && field(f[4], 7, 0, 7)))
  );
}

function minuteKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}T${d.getHours()}:${d.getMinutes()}`;
}

/**
 * Checks schedules; fires those due this minute. A fire time that passed while the core was down is recorded
 * as missed with a needs-you item and never back-filled.
 */
export function tickSchedules(db: DatabaseSync, startRun: (pipelineId: string, projectId: string, inputs: unknown) => void, now = new Date()): void {
  const rows = db
    .prepare('SELECT id, pipeline_id, project_id, cron, inputs, last_fired FROM schedule WHERE enabled = 1')
    .all() as Array<{ id: string; pipeline_id: string; project_id: string; cron: string; inputs: string; last_fired: string | null }>;
  for (const s of rows) {
    const last = s.last_fired ? new Date(Date.parse(s.last_fired)) : null;
    if (last && minuteKey(last) === minuteKey(now)) continue;
    if (last) {
      const gap = new Date(last.getTime() + 60_000);
      gap.setSeconds(0, 0);
      const current = new Date(now);
      current.setSeconds(0, 0);
      for (let t = gap; t < current && current.getTime() - t.getTime() < 7 * 24 * 3600_000; t = new Date(t.getTime() + 60_000)) {
        if (cronMatches(s.cron, t)) {
          db.prepare('UPDATE schedule SET last_missed = ? WHERE id = ?').run(nowIso(t), s.id);
          db.prepare('INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, ?, ?, ?)')
            .run(ulid(), nowIso(), 'missed-schedule', s.id, `Schedule for ${s.pipeline_id} was due at ${nowIso(t)} while the core was down; it was not run`);
          break;
        }
      }
    }
    if (cronMatches(s.cron, now)) {
      db.prepare('UPDATE schedule SET last_fired = ? WHERE id = ?').run(nowIso(now), s.id);
      startRun(s.pipeline_id, s.project_id, JSON.parse(s.inputs || '{}'));
    } else if (!last) {
      db.prepare('UPDATE schedule SET last_fired = ? WHERE id = ?').run(nowIso(now), s.id);
    }
  }
}
