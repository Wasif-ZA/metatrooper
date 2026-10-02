import type { DatabaseSync } from 'node:sqlite';
import { nowIso } from '../time.ts';
import { nextState } from './state.ts';
import { noteTranscript } from '../meter.ts';

interface EventRow {
  seq: number;
  session_id: string | null;
  kind: string;
  payload: string;
}

interface SessionRow {
  state: string;
  engine_id: string;
  native_id: string | null;
  pid: number | null;
}

/** Applies unprocessed events in seq order: links sessions, records pids, and moves session state. */
export function processEvents(db: DatabaseSync, limit = 500): number {
  const rows = db
    .prepare('SELECT seq, session_id, kind, payload FROM event WHERE processed = 0 ORDER BY seq LIMIT ?')
    .all(limit) as unknown as EventRow[];
  if (rows.length === 0) return 0;
  const getSession = db.prepare('SELECT state, engine_id, native_id, pid FROM session WHERE id = ?');
  const setState = db.prepare('UPDATE session SET state = ?, state_at = ? WHERE id = ?');
  const setPid = db.prepare('UPDATE session SET pid = ? WHERE id = ?');
  const setNative = db.prepare('UPDATE session SET native_id = ? WHERE id = ? AND native_id IS NULL');
  const setTool = db.prepare('UPDATE session SET last_tool = ? WHERE id = ?');
  const setTitle = db.prepare('UPDATE session SET title = ? WHERE id = ?');
  const setEnded = db.prepare('UPDATE session SET ended_at = ? WHERE id = ? AND ended_at IS NULL');
  const done = db.prepare('UPDATE event SET processed = 1 WHERE seq = ?');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const ev of rows) {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(ev.payload); } catch {}
      const s = ev.session_id ? (getSession.get(ev.session_id) as SessionRow | undefined) : undefined;
      if (s && ev.session_id) {
        if (ev.kind === 'launch' && typeof payload.pid === 'number') setPid.run(payload.pid, ev.session_id);
        if (ev.kind.startsWith('claude.') && typeof payload.session_id === 'string') setNative.run(payload.session_id, ev.session_id);
        if (ev.kind === 'codex.turn' && typeof payload['thread-id'] === 'string') setNative.run(payload['thread-id'], ev.session_id);
        if (ev.kind.startsWith('claude.') && typeof payload.transcript_path === 'string') noteTranscript(ev.session_id, payload.transcript_path);
        if (ev.kind === 'claude.PreToolUse' && typeof payload.tool_name === 'string') setTool.run(payload.tool_name, ev.session_id);
        if (ev.kind === 'term.title' && typeof payload.title === 'string') setTitle.run(payload.title, ev.session_id);
        const thread = payload['thread-id'];
        const otherThread = ev.kind === 'codex.turn' && s.native_id !== null && typeof thread === 'string' && thread !== s.native_id;
        const next = ev.kind === 'launch' || otherThread ? null : nextState(s.state, { kind: ev.kind, payload });
        if (next && next !== s.state) {
          setState.run(next, nowIso(), ev.session_id);
          if (next === 'exited') setEnded.run(nowIso(), ev.session_id);
        }
      }
      done.run(ev.seq);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return rows.length;
}
