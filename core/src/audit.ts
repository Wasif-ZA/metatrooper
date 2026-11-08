import type { DatabaseSync } from 'node:sqlite';
import { scrub } from './redact.ts';

export interface AuditRow { at: string; session_id: string; agent: string; action: string; detail: string; source: 'system' | 'agent' }

const CAP = 300;

// Lists one project's approvals and events as newest-first "who did what, when and why" rows, secrets scrubbed.
export function auditRows(db: DatabaseSync, projectId: string, opts: { limit?: number; before?: string }, secrets: string[]): AuditRow[] {
  const limit = Math.min(500, Math.max(1, Math.trunc(opts.limit ?? 100)));
  const before = opts.before ?? '';
  const rows = db.prepare(
    `SELECT at, session_id, agent, action, detail, source FROM (
       SELECT a.created_at AS at, a.session_id AS session_id, s.engine_id AS agent,
              'asked to ' || a.action || ' on ' || a.surface || ' ' || a.target AS action, a.summary AS detail, 'agent' AS source
         FROM approval a JOIN session s ON s.id = a.session_id WHERE s.project_id = ?
       UNION ALL
       SELECT a.decided_at, a.session_id, s.engine_id, 'gate ' || a.status, COALESCE(a.reason, ''), 'system'
         FROM approval a JOIN session s ON s.id = a.session_id WHERE s.project_id = ? AND a.decided_at IS NOT NULL
       UNION ALL
       SELECT e.at, e.session_id, s.engine_id, e.kind, substr(e.payload, 1, 2000),
              CASE WHEN e.source IN ('claude-hook', 'codex-notify') THEN 'agent' ELSE 'system' END
         FROM event e JOIN session s ON s.id = e.session_id
        WHERE s.project_id = ? AND e.kind NOT IN ('term.output', 'term.bell', 'core.activity', 'core.title-state', 'core.seen')
     ) WHERE (? = '' OR julianday(at) < julianday(?)) ORDER BY julianday(at) DESC LIMIT ?`,
  ).all(projectId, projectId, projectId, before, before, limit) as unknown as AuditRow[];
  return rows.map((r) => ({
    ...r,
    action: scrub(r.action, secrets).slice(0, CAP),
    detail: scrub(r.detail, secrets).slice(0, CAP),
  }));
}
