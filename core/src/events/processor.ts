import type { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { nowIso, ulid } from '../time.ts';
import { nextState } from './state.ts';
import { noteTranscript } from '../meter.ts';
import { removeSessionFiles } from '../plugins/mcp.ts';

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
  run_id: string | null;
}

/** Applies unprocessed events in seq order: links sessions, records pids, and moves session state. */
export function processEvents(db: DatabaseSync, limit = 500): number {
  const rows = db
    .prepare('SELECT seq, session_id, kind, payload FROM event WHERE processed = 0 ORDER BY seq LIMIT ?')
    .all(limit) as unknown as EventRow[];
  if (rows.length === 0) return 0;
  const getSession = db.prepare('SELECT state, engine_id, native_id, pid, run_id FROM session WHERE id = ?');
  const setState = db.prepare('UPDATE session SET state = ?, state_at = ? WHERE id = ?');
  const setPid = db.prepare('UPDATE session SET pid = ? WHERE id = ?');
  const setNative = db.prepare('UPDATE session SET native_id = ? WHERE id = ? AND native_id IS NULL');
  const relinkNative = db.prepare('UPDATE session SET native_id = ? WHERE id = ?');
  const convEnded = db.prepare("SELECT 1 FROM event WHERE kind = 'claude.SessionEnd' AND session_id = ? AND json_extract(payload, '$.session_id') = ? AND seq < ? LIMIT 1");
  const setTool = db.prepare('UPDATE session SET last_tool = ? WHERE id = ?');
  const setEnded = db.prepare('UPDATE session SET ended_at = ? WHERE id = ? AND ended_at IS NULL');
  const done = db.prepare('UPDATE event SET processed = 1 WHERE seq = ?');
  const inbox = db.prepare('INSERT INTO needs_you (id, at, kind, ref, text) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM needs_you WHERE ref = ? AND kind = ? AND resolved_at IS NULL AND read_at IS NULL)');
  const note = (kind: 'done' | 'failed', sessionId: string, engine: string, text: string) => inbox.run(ulid(), nowIso(), kind, sessionId, `${engine} ${text}`, sessionId, kind);
  const turnStarts: string[] = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const ev of rows) {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(ev.payload); } catch {}
      const s = ev.session_id ? (getSession.get(ev.session_id) as SessionRow | undefined) : undefined;
      if (s && ev.session_id && s.state !== 'exited') {
        const conv = ev.kind.startsWith('claude.') ? payload.session_id : ev.kind === 'codex.turn' ? payload['thread-id'] : undefined;
        let foreign = s.native_id !== null && typeof conv === 'string' && conv !== s.native_id;
        if (foreign && ev.kind.startsWith('claude.') && ev.kind !== 'claude.SessionEnd' && convEnded.get(ev.session_id, s.native_id, ev.seq)) {
          relinkNative.run(conv, ev.session_id);
          foreign = false;
        }
        if (ev.kind === 'launch' && typeof payload.pid === 'number') setPid.run(payload.pid, ev.session_id);
        if (!foreign) {
          if (typeof conv === 'string' && ev.kind !== 'claude.SessionEnd') setNative.run(conv, ev.session_id);
          if (ev.kind.startsWith('claude.') && typeof payload.transcript_path === 'string') noteTranscript(ev.session_id, payload.transcript_path);
          if (ev.kind === 'claude.PreToolUse' && typeof payload.tool_name === 'string') setTool.run(payload.tool_name, ev.session_id);
        }
        const next = ev.kind === 'launch' || foreign ? null : nextState(s.state, { kind: ev.kind, payload });
        if (next && next !== s.state) {
          setState.run(next, nowIso(), ev.session_id);
          if (next === 'exited') { setEnded.run(nowIso(), ev.session_id); removeSessionFiles(ev.session_id); }
          if (next === 'done' && s.run_id === null) note('done', ev.session_id, s.engine_id, 'finished');
          if (next === 'working') turnStarts.push(ev.session_id);
          if (next === 'exited' && typeof payload.code === 'number' && payload.code !== 0) note('failed', ev.session_id, s.engine_id, `exited with code ${payload.code}`);
        }
      }
      done.run(ev.seq);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  for (const id of new Set(turnStarts)) markTurnBase(db, id);
  return rows.length;
}

/** Clears session notices that are spent: "finished" once the session exits, is gone or starts another turn; "failed" once read and the session is gone. */
export function resolveSpentNotices(db: DatabaseSync): void {
  db.prepare(
    `UPDATE needs_you SET resolved_at = ? WHERE resolved_at IS NULL AND kind IN ('done', 'failed') AND (
       (NOT EXISTS (SELECT 1 FROM session s WHERE s.id = needs_you.ref AND s.ended_at IS NULL) AND (kind = 'done' OR read_at IS NOT NULL))
       OR (kind = 'done' AND EXISTS (SELECT 1 FROM session s WHERE s.id = needs_you.ref AND s.state = 'working')))`,
  ).run(nowIso());
}

/** Records what the session's folder looked like when a turn started, so the Diff tab can show only that turn. */
export function markTurnBase(db: DatabaseSync, sessionId: string): void {
  const row = db.prepare('SELECT cwd FROM session WHERE id = ?').get(sessionId) as { cwd: string | null } | undefined;
  if (!row?.cwd) return;
  const git = (args: string[]) => execFileSync('git', args, { cwd: row.cwd!, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 5000 }).trim();
  try {
    const base = git(['stash', 'create']) || git(['rev-parse', 'HEAD']);
    db.prepare('UPDATE session SET turn_base = ? WHERE id = ?').run(base, sessionId);
  } catch {}
}
