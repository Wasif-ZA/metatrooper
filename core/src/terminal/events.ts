import type { DatabaseSync } from 'node:sqlite';
import { appendEvent } from '../events/append.ts';
import { setTermHooks } from './index.ts';

export const SILENT_MS = 30_000;

/** True when the session has had no event from any source but the terminal for SILENT_MS. */
export function silent(db: DatabaseSync, sessionId: string, now = Date.now()): boolean {
  const r = db.prepare("SELECT max(at) AS at FROM event WHERE session_id = ? AND kind NOT LIKE 'term.%'").get(sessionId) as { at: string | null };
  return !r.at || now - Date.parse(r.at) >= SILENT_MS;
}

export function wireTermEvents(db: DatabaseSync): void {
  const belled = new Set<string>();
  const titles = new Map<string, string>();
  const safe = (fn: () => void) => { try { fn(); } catch {} };
  setTermHooks({
    onBell: (id) => safe(() => {
      if (!silent(db, id)) return;
      appendEvent('term.bell', id, {}, db);
      belled.add(id);
    }),
    onOutput: (id) => {
      if (!belled.delete(id)) return;
      safe(() => appendEvent('term.output', id, {}, db));
    },
    onTitle: (id, title) => {
      if (titles.get(id) === title) return;
      titles.set(id, title);
      safe(() => appendEvent('term.title', id, { title }, db));
    },
    onExit: (id, code) => {
      belled.delete(id);
      titles.delete(id);
      safe(() => appendEvent('core.process-gone', id, { pid: null, code }, db));
    },
  });
}
