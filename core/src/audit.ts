import type { DatabaseSync } from 'node:sqlite';
import { scrub, scrubDeep } from './redact.ts';

export interface AuditRow { at: string; session_id: string; agent: string; action: string; detail: string; source: 'system' | 'agent' }

const CAP = 300;

// Lists one project's approvals and events as newest-first "who did what, when and why" rows, secrets scrubbed.
export function auditRows(db: DatabaseSync, projectId: string, opts: { limit?: number; before?: string }, secrets: string[]): AuditRow[] {
  const limit = Math.min(500, Math.max(1, Math.trunc(opts.limit ?? 100)));
  const before = opts.before ?? '';
  const rows = db.prepare(
    `SELECT at, session_id, agent, action, detail, source, origin FROM (
       SELECT a.created_at AS at, a.session_id AS session_id, s.engine_id AS agent,
              'asked to ' || a.action || ' on ' || a.surface || ' ' || a.target AS action, a.summary AS detail, 'agent' AS source, 'approval' AS origin
         FROM approval a JOIN session s ON s.id = a.session_id WHERE s.project_id = ?
       UNION ALL
       SELECT a.decided_at, a.session_id, s.engine_id, 'gate ' || a.status, COALESCE(a.reason, ''), 'system', 'approval'
         FROM approval a JOIN session s ON s.id = a.session_id WHERE s.project_id = ? AND a.decided_at IS NOT NULL
       UNION ALL
       SELECT e.at, e.session_id, s.engine_id, e.kind, e.payload,
              CASE WHEN e.source IN ('claude-hook', 'codex-notify') THEN 'agent' ELSE 'system' END, 'event'
         FROM event e JOIN session s ON s.id = e.session_id
        WHERE s.project_id = ? AND e.kind NOT IN ('term.output', 'term.bell', 'core.activity', 'core.title-state', 'core.seen')
     ) WHERE (? = '' OR julianday(at) < julianday(?)) ORDER BY julianday(at) DESC LIMIT ?`,
  ).all(projectId, projectId, projectId, before, before, limit) as unknown as (AuditRow & { origin: string })[];
  return rows.map(({ origin, ...r }) => {
    let detail = r.detail;
    // Scrubs the parsed event JSON values, then the serialized text.
    if (origin === 'event') { try { detail = JSON.stringify(scrubDeep(JSON.parse(detail), secrets)); } catch { /* raw string */ } }
    return { ...r, action: scrub(r.action, secrets).slice(0, CAP), detail: scrub(detail, secrets).slice(0, CAP) };
  });
}
