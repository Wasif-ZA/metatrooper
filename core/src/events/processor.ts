import type { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { nowIso, ulid } from '../time.ts';
import { nextState } from './state.ts';
import { noteTranscript } from '../meter.ts';
import { removeSessionFiles } from '../plugins/mcp.ts';
import { claimTurn, labelOf, notice, owners, projectFor, repoOf } from '../sessions/owners.ts';
import { liveText } from '../terminal/events.ts';

interface EventRow {
  seq: number;
  at: string;
  session_id: string | null;
  kind: string;
  payload: string;
}

interface SessionRow {
  host: string;
  state: string;
  engine_id: string;
  native_id: string | null;
  pid: number | null;
  run_id: string | null;
}

/** Applies unprocessed events in seq order: links sessions, records pids, and moves session state. */
export function processEvents(db: DatabaseSync, limit = 500): number {
  const rows = db
    .prepare('SELECT seq, at, session_id, kind, payload FROM event WHERE processed = 0 ORDER BY seq LIMIT ?')
    .all(limit) as unknown as EventRow[];
  if (rows.length === 0) return 0;
  const getSession = db.prepare('SELECT host, state, engine_id, native_id, pid, run_id FROM session WHERE id = ?');
  const byNative = db.prepare("SELECT id FROM session WHERE native_id = ? AND NOT (host = 'external' AND state = 'exited') ORDER BY julianday(started_at) DESC LIMIT 1");
  const setEventSession = db.prepare('UPDATE event SET session_id = ? WHERE seq = ?');
  const projects = db.prepare('SELECT id, path FROM project');
  const hasClaude = Boolean(db.prepare("SELECT 1 FROM engine WHERE id = 'claude'").get());
  const adopt = db.prepare("INSERT INTO session (id, project_id, engine_id, host, native_id, cwd, state, state_at, started_at) VALUES (?, ?, 'claude', 'external', ?, ?, 'idle', ?, ?)");
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
  const turnEnds: Array<[string, number]> = [];
  const exits: string[] = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const ev of rows) {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(ev.payload); } catch {}
      if (!ev.session_id && ev.kind.startsWith('claude.') && typeof payload.session_id === 'string') {
        const known = byNative.get(payload.session_id) as { id: string } | undefined;
        const project = !known && hasClaude && ev.kind !== 'claude.SessionEnd' && typeof payload.cwd === 'string' ? projectFor(projects.all() as Array<{ id: string; path: string }>, payload.cwd) : null;
        if (project) {
          const id = ulid();
          adopt.run(id, project.id, payload.session_id, payload.cwd as string, ev.at, ev.at);
          ev.session_id = id;
        } else if (known) ev.session_id = known.id;
        if (ev.session_id) setEventSession.run(ev.session_id, ev.seq);
      }
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
        const next = ev.kind === 'launch' || foreign ? null : s.host === 'external' && ev.kind === 'claude.SessionEnd' ? 'exited' : nextState(s.state, { kind: ev.kind, payload });
        if (!foreign && (ev.kind === 'claude.Stop' || ev.kind === 'claude.SessionEnd')) turnEnds.push([ev.session_id, ev.seq]);
        if (next && next !== s.state) {
          setState.run(next, nowIso(), ev.session_id);
          if (next === 'exited') { setEnded.run(nowIso(), ev.session_id); removeSessionFiles(ev.session_id); exits.push(ev.session_id); }
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
  if (turnEnds.length || exits.length) {
    const titles = Object.fromEntries(Object.entries(liveText()).map(([id, t]) => [id, t.title]));
    for (const [id, seq] of turnEnds) try { claimTurn(db, id, seq, titles); } catch {}
    for (const id of new Set([...exits, ...turnEnds.filter(([id]) => (getSession.get(id) as SessionRow | undefined)?.state === 'idle').map(([id]) => id)])) try { leftBehind(db, id, titles); } catch {}
    for (const id of new Set(exits)) try { handBack(db, id, titles); } catch {}
  }
  return rows.length;
}

/** Paths in the session's repository that it still owns uncommitted. */
function ownedBy(db: DatabaseSync, sessionId: string, titles: Record<string, string | undefined>): { repo: string; paths: string[] } | null {
  const row = db.prepare('SELECT cwd FROM session WHERE id = ?').get(sessionId) as { cwd: string | null } | undefined;
  const repo = repoOf(row?.cwd ?? null);
  if (!repo) return null;
  return { repo, paths: owners(db, repo, titles).filter((o) => o.owners.some((x) => x.id === sessionId)).map((o) => o.path) };
}

/** A Needs you row when an ended session leaves files it owns uncommitted. */
function leftBehind(db: DatabaseSync, sessionId: string, titles: Record<string, string | undefined>): void {
  const owned = ownedBy(db, sessionId, titles);
  if (!owned?.paths.length) return;
  const n = owned.paths.length;
  db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) SELECT ?, ?, 'uncommitted', ?, ? WHERE NOT EXISTS (SELECT 1 FROM needs_you WHERE ref = ? AND kind = 'uncommitted' AND resolved_at IS NULL)")
    .run(ulid(), nowIso(), sessionId, `${labelOf(db, sessionId, titles)} left ${n} file${n === 1 ? '' : 's'} uncommitted`, sessionId);
}

/** One notice to the parent of an exited session: its owned paths, whether each is committed, its last line and transcript. */
function handBack(db: DatabaseSync, sessionId: string, titles: Record<string, string | undefined>): void {
  const row = db.prepare('SELECT parent_id, cwd FROM session WHERE id = ?').get(sessionId) as { parent_id: string | null; cwd: string | null } | undefined;
  if (!row?.parent_id) return;
  const repo = repoOf(row.cwd);
  const claimed = new Set<string>();
  for (const r of db.prepare("SELECT payload FROM event WHERE kind = 'core.claim' AND session_id = ?").all(sessionId) as Array<{ payload: string }>) {
    try { for (const f of JSON.parse(r.payload).files) claimed.add(f.path); } catch {}
  }
  let dirty = new Set<string>();
  try { if (repo) dirty = new Set(owners(db, repo, titles).map((o) => o.path)); } catch {}
  const transcript = (db.prepare("SELECT json_extract(payload, '$.transcript_path') AS t FROM event WHERE session_id = ? AND json_extract(payload, '$.transcript_path') IS NOT NULL ORDER BY seq DESC LIMIT 1").get(sessionId) as { t: string } | undefined)?.t;
  const last = liveText()[sessionId]?.line;
  const files = [...claimed].sort().map((f) => `${f} (${dirty.has(f) ? 'uncommitted' : 'committed'})`);
  const lines = [`Session ${labelOf(db, sessionId, titles)}, launched from this session, has ended.`, `Files: ${files.length ? files.join(', ') : 'none changed'}.`];
  if (last) lines.push(`Its last line: ${last}`);
  if (transcript) lines.push(`Transcript: ${transcript}`);
  notice(db, row.parent_id, `child:${sessionId}`, lines.join('\n'));
}

/** Resolves an open uncommitted row once its session owns no uncommitted path. */
export function resolveUncommitted(db: DatabaseSync): void {
  const rows = db.prepare("SELECT id, ref FROM needs_you WHERE kind = 'uncommitted' AND resolved_at IS NULL").all() as Array<{ id: string; ref: string }>;
  for (const r of rows) {
    try {
      const owned = ownedBy(db, r.ref, {});
      if (!owned || !owned.paths.length) db.prepare('UPDATE needs_you SET resolved_at = ? WHERE id = ?').run(nowIso(), r.id);
    } catch {}
  }
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
