import type { DatabaseSync } from 'node:sqlite';
import { appendEvent } from '../events/append.ts';
import { lastLine, setTermHooks } from './index.ts';
import { settings } from '../settings.ts';
import { devServersGone, scanOutput } from '../devservers.ts';
import { getEngine, titlePatterns, type TitleState } from '../engines/registry.ts';

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

const ESCAPES = new Set(['\x1b', '\x1b[27u', '\x1b[27;1u']);
const INTERRUPT_MS = 5000;

export function wireTermEvents(db: DatabaseSync): void {
  db.exec("UPDATE session SET last_line = NULL, title = NULL WHERE last_line IS NOT NULL OR title IS NOT NULL; DELETE FROM event WHERE kind = 'term.title'");
  const belled = new Set<string>();
  const titleKeys = new Map<string, string>();
  const sessionRow = db.prepare('SELECT state, state_at, engine_id FROM session WHERE id = ?');
  const lastSeq = db.prepare("SELECT max(seq) AS seq FROM event WHERE session_id = ? AND kind NOT LIKE 'term.%'");
  const engines = new Map<string, { process: boolean; titles: Partial<Record<TitleState, RegExp>> }>();
  const engineOf = (id: string, engineId: string) => {
    if (!engines.has(id)) {
      const e = getEngine(db, engineId);
      engines.set(id, { process: e?.state_source === 'process', titles: e ? titlePatterns(e) : {} });
    }
    return engines.get(id)!;
  };
  const titleStates = new Map<string, TitleState>();
  const escapes = new Map<string, { at: number; state_at: string; seq: number | null }>();
  const onEscape = (id: string) => {
    const s = sessionRow.get(id) as { state: string; state_at: string; engine_id: string } | undefined;
    if (s?.state !== 'working' || !engineOf(id, s.engine_id).titles.idle) return;
    escapes.set(id, { at: Date.now(), state_at: s.state_at, seq: (lastSeq.get(id) as { seq: number | null }).seq });
  };
  const onRawTitle = (id: string, title: string) => {
    const s = sessionRow.get(id) as { state: string; state_at: string; engine_id: string } | undefined;
    if (!s) return;
    const e = engineOf(id, s.engine_id);
    const esc = escapes.get(id);
    if (esc && Date.now() - esc.at > INTERRUPT_MS) escapes.delete(id);
    else if (esc && e.titles.idle?.test(title)) {
      escapes.delete(id);
      if (s.state === 'working' && s.state_at === esc.state_at && (lastSeq.get(id) as { seq: number | null }).seq === esc.seq) appendEvent('core.interrupted', id, {}, db);
    }
    if (!e.process) return;
    const state = (['working', 'waiting', 'idle'] as const).find((k) => e.titles[k]?.test(title));
    if (!state || titleStates.get(id) === state) return;
    titleStates.set(id, state);
    appendEvent('core.title-state', id, { state }, db);
  };
  const lineTimers = new Map<string, NodeJS.Timeout>();
  const safe = (fn: () => void) => { try { fn(); } catch {} };
  const readLine = (id: string) => lastLine(id, settings().terminal.last_line_chars).then((line) => { if (line !== null) put(id, 'line', line); });
  setTermHooks({
    onBell: (id) => safe(() => {
      if (!silent(db, id)) return;
      appendEvent('term.bell', id, {}, db);
      belled.add(id);
    }),
    onOutput: (id, data) => {
      safe(() => scanOutput(db, id, data));
      if (!lineTimers.has(id)) {
        lineTimers.set(id, setTimeout(() => {
          lineTimers.delete(id);
          void readLine(id);
        }, settings().terminal.last_line_every_ms));
      }
      if (!belled.delete(id)) return;
      safe(() => appendEvent('term.output', id, {}, db));
    },
    onInput: (id, data) => { if (ESCAPES.has(data)) safe(() => onEscape(id)); },
    onTitle: (id, title) => {
      safe(() => onRawTitle(id, title));
      const key = title.replace(/^[\p{S}\p{P}\s]+/u, '');
      if (titleKeys.get(id) === key) return;
      titleKeys.set(id, key);
      put(id, 'title', title);
    },
    onExit: (id, code, killed) => {
      belled.delete(id);
      titleKeys.delete(id);
      engines.delete(id);
      titleStates.delete(id);
      escapes.delete(id);
      safe(() => devServersGone(db, id));
      clearTimeout(lineTimers.get(id));
      lineTimers.delete(id);
      void readLine(id).then(() => {
        safe(() => appendEvent('core.process-gone', id, killed ? { pid: null } : { pid: null, code }, db));
      });
    },
  });
}
