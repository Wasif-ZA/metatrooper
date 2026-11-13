import type { DatabaseSync } from 'node:sqlite';
import type { SessionState } from './events/state.ts';
import { E, RpcError } from './pipe/errors.ts';

type StatsOpts = { project_id?: string; days?: number; now?: Date };

function dayBuckets({ days = 14, now = new Date() }: StatsOpts) {
  if (!Number.isInteger(days) || days < 1 || days > 90) throw new RpcError(E.INVALID_PARAMS, 'days must be a whole number from 1 to 90');
  return Array.from({ length: days }, (_, i) => {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days + 1 + i);
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    const day = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    return { day, start: start.toISOString(), end: end.toISOString() };
  });
}

/** Daily session outcomes and starts by current state, including hidden sessions. */
export function sessionStats(db: DatabaseSync, o: StatsOpts = {}) {
  const buckets = dayBuckets(o);
  const project = o.project_id === undefined ? '' : ' AND s.project_id = ?';
  const args = o.project_id === undefined ? [] : [o.project_id];
  const outcomes = db.prepare(`SELECT CASE WHEN p.id IS NULL THEN 'unchecked' WHEN p.exit_code = 0 THEN 'succeeded' ELSE 'failed' END AS outcome, COUNT(*) AS n
    FROM session s LEFT JOIN done_proof p ON p.id = (SELECT id FROM done_proof WHERE session_id = s.id ORDER BY julianday(at) DESC, id DESC LIMIT 1)
    WHERE s.ended_at >= ? AND s.ended_at < ?${project} GROUP BY 1`);
  const starts = db.prepare(`SELECT s.state, COUNT(*) AS n FROM session s WHERE s.started_at >= ? AND s.started_at < ?${project} GROUP BY s.state`);
  return { days: buckets.map(({ day, start, end }) => {
    const row = { day, succeeded: 0, failed: 0, unchecked: 0, started: { starting: 0, working: 0, waiting_for_you: 0, done: 0, idle: 0, unknown: 0, exited: 0 } };
    for (const r of outcomes.all(start, end, ...args) as { outcome: 'succeeded' | 'failed' | 'unchecked'; n: number }[]) row[r.outcome] = r.n;
    for (const r of starts.all(start, end, ...args) as { state: SessionState; n: number }[]) row.started[r.state] = r.n;
    return row;
  }) };
}

/** Daily done-check runs, passes, and pass rates. */
export function checkStats(db: DatabaseSync, o: StatsOpts = {}) {
  const buckets = dayBuckets(o);
  const project = o.project_id === undefined ? '' : ' AND s.project_id = ?';
  const args = o.project_id === undefined ? [] : [o.project_id];
  const checks = db.prepare(`SELECT COUNT(*) AS runs, COALESCE(SUM(CASE WHEN p.exit_code = 0 THEN 1 ELSE 0 END), 0) AS passed
    FROM done_proof p JOIN session s ON s.id = p.session_id
    WHERE p.at >= ? AND p.at < ?${project}`);
  return { days: buckets.map(({ day, start, end }) => {
    const { runs, passed } = checks.get(start, end, ...args) as { runs: number; passed: number };
    return { day, runs, passed, rate: runs === 0 ? null : passed / runs };
  }) };
}
