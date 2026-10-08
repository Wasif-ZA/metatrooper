import type { DatabaseSync } from 'node:sqlite';
import { appendEvent } from '../events/append.ts';
import { lastLine, setTermHooks } from './index.ts';
import { settings } from '../settings.ts';

/** True when the session has had no event from any source but the terminal for terminal.bell_silent_ms. */
export function silent(db: DatabaseSync, sessionId: string, now = Date.now()): boolean {
  const r = db.prepare("SELECT max(at) AS at FROM event WHERE session_id = ? AND kind NOT LIKE 'term.%'").get(sessionId) as { at: string | null };
  return !r.at || now - Date.parse(r.at) >= settings().terminal.bell_silent_ms;
}

export function wireTermEvents(db: DatabaseSync): void {
  const belled = new Set<string>();
  const titles = new Map<string, string>();
  const lineTimers = new Map<string, NodeJS.Timeout>();
  const setLine = db.prepare('UPDATE session SET last_line = ? WHERE id = ?');
  const safe = (fn: () => void) => { try { fn(); } catch {} };
  setTermHooks({
    onBell: (id) => safe(() => {
      if (!silent(db, id)) return;
      appendEvent('term.bell', id, {}, db);
      belled.add(id);
    }),
    onOutput: (id) => {
      if (!lineTimers.has(id)) {
        lineTimers.set(id, setTimeout(() => {
          lineTimers.delete(id);
          void lastLine(id, settings().terminal.last_line_chars).then((line) => safe(() => { if (line !== null) setLine.run(line, id); }));
        }, settings().terminal.last_line_every_ms));
      }
      if (!belled.delete(id)) return;
      safe(() => appendEvent('term.output', id, {}, db));
    },
    onTitle: (id, title) => {
      const key = title.replace(/^[◐◑◒◓]/u, '◐');
      if (titles.get(id) === key) return;
      titles.set(id, key);
      safe(() => appendEvent('term.title', id, { title }, db));
    },
    onExit: (id, code) => {
      belled.delete(id);
      titles.delete(id);
      clearTimeout(lineTimers.get(id));
      lineTimers.delete(id);
      safe(() => appendEvent('core.process-gone', id, { pid: null, code }, db));
    },
  });
}
