import type { DatabaseSync } from 'node:sqlite';
import { appendEvent } from '../events/append.ts';
import { lastLine, setTermHooks } from './index.ts';
import { settings } from '../settings.ts';

export interface LiveText { line?: string; title?: string }

const live = new Map<string, LiveText>();

/** The last screen line and title of each terminal session this core has run; held in memory only, never stored (M1-05). */
export function liveText(): Record<string, LiveText> {
  return Object.fromEntries(live);
}

function put(id: string, field: keyof LiveText, value: string): void {
  live.set(id, { ...live.get(id), [field]: value });
}

/** True when the session has had no event from any source but the terminal for terminal.bell_silent_ms. */
export function silent(db: DatabaseSync, sessionId: string, now = Date.now()): boolean {
  const r = db.prepare("SELECT at FROM event WHERE session_id = ? AND kind NOT LIKE 'term.%' ORDER BY julianday(at) DESC LIMIT 1").get(sessionId) as { at: string } | undefined;
  return !r || now - Date.parse(r.at) >= settings().terminal.bell_silent_ms;
}

export function wireTermEvents(db: DatabaseSync): void {
  db.exec("UPDATE session SET last_line = NULL, title = NULL WHERE last_line IS NOT NULL OR title IS NOT NULL; DELETE FROM event WHERE kind = 'term.title'");
  const belled = new Set<string>();
  const titleKeys = new Map<string, string>();
  const lineTimers = new Map<string, NodeJS.Timeout>();
  const safe = (fn: () => void) => { try { fn(); } catch {} };
  const readLine = (id: string) => lastLine(id, settings().terminal.last_line_chars).then((line) => { if (line !== null) put(id, 'line', line); });
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
          void readLine(id);
        }, settings().terminal.last_line_every_ms));
      }
      if (!belled.delete(id)) return;
      safe(() => appendEvent('term.output', id, {}, db));
    },
    onTitle: (id, title) => {
      const key = title.replace(/^[\p{S}\p{P}\s]+/u, '');
      if (titleKeys.get(id) === key) return;
      titleKeys.set(id, key);
      put(id, 'title', title);
    },
    onExit: (id, code, killed) => {
      belled.delete(id);
      titleKeys.delete(id);
      clearTimeout(lineTimers.get(id));
      lineTimers.delete(id);
      void readLine(id).then(() => {
        safe(() => appendEvent('core.process-gone', id, killed ? { pid: null } : { pid: null, code }, db));
      });
    },
  });
}
