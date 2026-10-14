import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { nowIso, ulid } from '../time.ts';
import { nextState, stateChanged } from './state.ts';
import { noteTranscript } from '../meter.ts';
import { removeSessionFiles } from '../plugins/mcp.ts';
import { claimTurn, gitAsync, labelOf, notice, ownersAsync, projectFor, repoOfAsync, type OwnedPath } from '../sessions/owners.ts';
import { liveText } from '../terminal/events.ts';
import { limitHit } from '../sessions/limit-resume.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  state_at: string;
}

/** Applies unprocessed events in seq order: links sessions, records pids, and moves session state. */
export function processEvents(db: DatabaseSync, limit = 500): number {
  const rows = db
    .prepare('SELECT seq, at, session_id, kind, payload FROM event WHERE processed = 0 ORDER BY seq LIMIT ?')
    .all(limit) as unknown as EventRow[];
  if (rows.length === 0) return 0;
  const getSession = db.prepare('SELECT host, state, engine_id, native_id, pid, run_id, state_at FROM session WHERE id = ?');
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
  // The tool lookups keep to one conversation (the last `?`), so a side conversation's events, ignored in processing, are ignored here too.
  const pendingToolId = db.prepare("SELECT json_extract(payload, '$.tool_use_id') AS id FROM event WHERE session_id = ? AND kind = 'claude.PreToolUse' AND seq < ? AND coalesce(json_extract(payload, '$.session_id') = ?, 1) ORDER BY seq DESC LIMIT 1");
  // A wait with no tool_use_id of its own is on the last call still open before the ask, with the ask's tool_name when it gives one.
  const openToolId = db.prepare("SELECT json_extract(p.payload, '$.tool_use_id') AS id FROM event p WHERE p.session_id = ?1 AND p.kind = 'claude.PreToolUse' AND p.seq < ?2 AND coalesce(json_extract(p.payload, '$.session_id') = ?3, 1) AND (?4 IS NULL OR json_extract(p.payload, '$.tool_name') = ?4) AND NOT EXISTS (SELECT 1 FROM event f WHERE f.session_id = ?1 AND f.kind IN ('claude.PostToolUse', 'claude.PostToolUseFailure') AND f.seq > p.seq AND f.seq < ?2 AND json_extract(f.payload, '$.tool_use_id') = json_extract(p.payload, '$.tool_use_id') AND coalesce(json_extract(f.payload, '$.session_id') = ?3, 1)) ORDER BY p.seq DESC LIMIT 1");
  const lastAsk = db.prepare("SELECT seq, kind, json_extract(payload, '$.tool_use_id') AS id, json_extract(payload, '$.tool_name') AS tool FROM event WHERE session_id = ? AND seq < ? AND kind IN ('claude.PermissionRequest', 'claude.UserPromptSubmit', 'claude.Stop', 'claude.StopFailure') AND coalesce(json_extract(payload, '$.session_id') = ?, 1) ORDER BY seq DESC LIMIT 1");
  const lastPermissionNote = db.prepare("SELECT seq FROM event WHERE session_id = ? AND seq > ? AND seq < ? AND kind = 'claude.Notification' AND json_extract(payload, '$.class') = 'permission' AND coalesce(json_extract(payload, '$.session_id') = ?, 1) ORDER BY seq DESC LIMIT 1");
  // A hook ask (approval, permission or input prompt) written at or after the current wait began (state_at): terminal output is not an answer to it.
  const askInWait = db.prepare("SELECT 1 FROM event WHERE session_id = ?1 AND seq < ?2 AND julianday(at) >= julianday(?4) AND (kind IN ('codex.PermissionRequest', 'gemini.Notification', 'claude.PermissionRequest') OR (kind = 'claude.Notification' AND json_extract(payload, '$.class') IN ('permission', 'input'))) AND coalesce(json_extract(payload, '$.session_id') = ?3, 1) LIMIT 1");
  const setStateAt = db.prepare('UPDATE session SET state_at = ? WHERE id = ?');
  const setEnded = db.prepare('UPDATE session SET ended_at = ? WHERE id = ? AND ended_at IS NULL');
  const done = db.prepare('UPDATE event SET processed = 1 WHERE seq = ?');
  const inbox = db.prepare('INSERT INTO needs_you (id, at, kind, ref, text) SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM needs_you WHERE ref = ? AND kind = ? AND resolved_at IS NULL AND read_at IS NULL)');
  const note = (kind: 'done' | 'failed', sessionId: string, engine: string, text: string) => inbox.run(ulid(), nowIso(), kind, sessionId, `${engine} ${text}`, sessionId, kind);
  const toolFinished = db.prepare("SELECT seq FROM event WHERE session_id = ? AND kind IN ('claude.PostToolUse', 'claude.PostToolUseFailure') AND json_extract(payload, '$.tool_use_id') = ? AND seq > ? AND seq < ? AND coalesce(json_extract(payload, '$.session_id') = ?, 1) ORDER BY seq LIMIT 1");
  /** The tool_use_id the session's permission wait is on: the last PermissionRequest's own, else the last call still open before that PermissionRequest (with its tool_name); once that call has finished, or with no PermissionRequest since the last prompt or Stop, the last call still open before a later permission Notification; null when there is no such wait or that call has finished. */
  const permissionWait = (sessionId: string, seq: number, conv: string | null): string | null => {
    const ask = lastAsk.get(sessionId, seq, conv) as { seq: number; kind: string; id: unknown; tool: unknown } | undefined;
    let from = ask?.seq ?? 0;
    if (ask?.kind === 'claude.PermissionRequest') {
      const id = typeof ask.id === 'string' ? ask.id : (openToolId.get(sessionId, from, conv, typeof ask.tool === 'string' ? ask.tool : null) as { id: unknown } | undefined)?.id;
      if (typeof id !== 'string') return null;
      const end = toolFinished.get(sessionId, id, from, seq, conv) as { seq: number } | undefined;
      if (!end) return id;
      from = end.seq;
    }
    const noteRow = lastPermissionNote.get(sessionId, from, seq, conv) as { seq: number } | undefined;
    if (!noteRow) return null;
    const id = (openToolId.get(sessionId, noteRow.seq, conv, null) as { id: unknown } | undefined)?.id;
    return typeof id === 'string' && !toolFinished.get(sessionId, id, noteRow.seq, seq, conv) ? id : null;
  };
  const turns: TurnJob[] = [];
  const changed: Array<[string, string]> = [];
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const ev of rows) {
      let payload: Record<string, unknown> = {};
      try { payload = JSON.parse(ev.payload); } catch {}
      if (!ev.session_id && ev.kind.startsWith('claude.') && typeof payload.session_id === 'string') {
        const known = byNative.get(payload.session_id) as { id: string } | undefined;
        const project = !known && hasClaude && ev.kind !== 'claude.SessionEnd' && UUID.test(payload.session_id) && typeof payload.cwd === 'string' ? projectFor(projects.all() as Array<{ id: string; path: string }>, payload.cwd) : null;
        if (project) {
          const id = ulid();
          adopt.run(id, project.id, payload.session_id, payload.cwd as string, ev.at, ev.at);
          ev.session_id = id;
        } else if (known) ev.session_id = known.id;
        if (ev.session_id) setEventSession.run(ev.session_id, ev.seq);
      }
      const s = ev.session_id ? (getSession.get(ev.session_id) as SessionRow | undefined) : undefined;
      if (s && ev.session_id && s.state !== 'exited') {
        const conv = ev.kind === 'codex.turn' ? payload['thread-id'] : /^(claude\.|codex\.|gemini\.|core\.activity$)/.test(ev.kind) ? payload.session_id : undefined;
        let foreign = s.native_id !== null && typeof conv === 'string' && conv !== s.native_id;
        // A Codex or Gemini SessionStart (resume, clear) names the conversation the session now holds.
        if (foreign && /^(codex|gemini)\.SessionStart$/.test(ev.kind)) {
          relinkNative.run(conv, ev.session_id);
          foreign = false;
        }
        if (foreign && ev.kind.startsWith('claude.') && ev.kind !== 'claude.SessionEnd' && convEnded.get(ev.session_id, s.native_id, ev.seq)) {
          relinkNative.run(conv, ev.session_id);
          foreign = false;
        }
        if (ev.kind === 'launch' && typeof payload.pid === 'number') setPid.run(payload.pid, ev.session_id);
        const own = typeof conv === 'string' && !foreign ? conv : s.native_id;
        const waited = s.state === 'waiting_for_you' && /^claude\.(PreToolUse|PostToolUse|PostToolUseFailure)$/.test(ev.kind) ? permissionWait(ev.session_id, ev.seq, own) : null;
        if (!foreign) {
          if (typeof conv === 'string' && ev.kind !== 'claude.SessionEnd') setNative.run(conv, ev.session_id);
          if (ev.kind.startsWith('claude.') && typeof payload.transcript_path === 'string') noteTranscript(ev.session_id, payload.transcript_path);
          // last_tool names a tool asked for and not yet finished, so a later bell, stall or input wait is not shown as its permission prompt.
          if (ev.kind === 'claude.PreToolUse' && typeof payload.tool_name === 'string' && s.state !== 'done' && s.state !== 'idle' && waited === null) setTool.run(payload.tool_name, ev.session_id);
          // A PermissionRequest names the call it waits on, which with overlapping calls need not be the last PreToolUse.
          if (ev.kind === 'claude.PermissionRequest' && typeof payload.tool_name === 'string') setTool.run(payload.tool_name, ev.session_id);
          // A PostToolUse clears it only when it finishes the tool last asked for (in a permission wait, the waited one), so overlapping tools keep the one still pending.
          const finished = /^claude\.PostToolUse(Failure)?$/.test(ev.kind);
          const pending = waited ?? (finished && typeof payload.tool_use_id === 'string' ? (pendingToolId.get(ev.session_id, ev.seq, own) as { id: unknown } | undefined)?.id : undefined);
          if ((finished && (typeof pending !== 'string' || pending === payload.tool_use_id)) || ev.kind === 'claude.Stop' || ev.kind === 'claude.StopFailure' || ev.kind === 'claude.UserPromptSubmit') setTool.run(null, ev.session_id);
          if (ev.kind === 'claude.StopFailure' && payload.error_type === 'rate_limit') limitHit(db, ev.session_id, ev.seq);
        }
        // File growth written before a wait began (the turn that led up to the ask) does not answer it, and neither does terminal output when a hook asked during the wait.
        const stale = s.state === 'waiting_for_you' && (ev.kind === 'core.activity' ? typeof payload.changed_at === 'number' && payload.changed_at <= Date.parse(s.state_at) : ev.kind === 'term.output' && Boolean(askInWait.get(ev.session_id, ev.seq, own, s.state_at)));
        const next = ev.kind === 'launch' || foreign || stale ? null : s.host === 'external' && ev.kind === 'claude.SessionEnd' ? 'exited' : nextState(s.state, { kind: ev.kind, payload }, waited);
        if (!foreign && (ev.kind === 'claude.Stop' || ev.kind === 'claude.SessionEnd')) turns.push({ kind: 'end', id: ev.session_id, seq: ev.seq });
        // A wait starts when its event was written, not when it is processed; a hook ask during a wait moves its start to the ask.
        const writtenAt = Date.parse(ev.at) <= Date.now() ? ev.at : nowIso();
        const hookAsk = /^(codex\.PermissionRequest|gemini\.Notification|claude\.PermissionRequest)$/.test(ev.kind) || (ev.kind === 'claude.Notification' && (payload.class === 'permission' || payload.class === 'input'));
        if (s.state === 'waiting_for_you' && (!next || next === s.state) && !foreign && hookAsk && !(Date.parse(writtenAt) <= Date.parse(s.state_at))) setStateAt.run(writtenAt, ev.session_id);
        if (next && next !== s.state) {
          setState.run(next, next === 'waiting_for_you' ? writtenAt : nowIso(), ev.session_id);
          changed.push([ev.session_id, next]);
          if (next === 'exited') { setEnded.run(nowIso(), ev.session_id); removeSessionFiles(ev.session_id); turns.push({ kind: 'exit', id: ev.session_id, seq: ev.seq }); }
          if (next === 'done' && s.run_id === null) note('done', ev.session_id, s.engine_id, 'finished');
          if (next === 'working') turns.push({ kind: 'start', id: ev.session_id, seq: ev.seq });
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
  for (const [id, state] of changed) stateChanged(id, state);
  for (const job of turns) {
    if (job.kind === 'start') {
      const snapshot = turnSnapshot(db, job.id);
      chain(job.id, async () => setTurnBase(db, job.id, await snapshot));
      continue;
    }
    const idle = job.kind === 'end' && (getSession.get(job.id) as SessionRow | undefined)?.state === 'idle';
    chain(job.id, async () => {
      const titles = Object.fromEntries(Object.entries(liveText()).map(([id, t]) => [id, t.title]));
      if (job.kind === 'end') try { await claimTurn(db, job.id, job.seq, titles); } catch {}
      if (job.kind === 'exit' || idle) try { await leftBehind(db, job.id, titles); } catch {}
      if (job.kind === 'exit') try { await handBack(db, job.id, titles); } catch {}
    });
  }
  return rows.length;
}

interface TurnJob { kind: 'start' | 'end' | 'exit'; id: string; seq: number }

const chains = new Map<string, Promise<void>>();

/** Runs a session's turn jobs one after another in event order; different sessions run side by side. */
function chain(sessionId: string, job: () => Promise<unknown>): void {
  const tail = (chains.get(sessionId) ?? Promise.resolve()).then(job).then(() => {}, () => {});
  chains.set(sessionId, tail);
  void tail.then(() => { if (chains.get(sessionId) === tail) chains.delete(sessionId); });
}

/** Resolves once every queued turn job has finished. */
export async function turnJobsIdle(): Promise<void> {
  while (chains.size) await Promise.all(chains.values());
}

/** Paths in the session's repository that it still owns uncommitted. */
async function ownedBy(db: DatabaseSync, sessionId: string, titles: Record<string, string | undefined>): Promise<{ repo: string; paths: string[] } | null> {
  const row = db.prepare('SELECT cwd FROM session WHERE id = ?').get(sessionId) as { cwd: string | null } | undefined;
  const repo = await repoOfAsync(row?.cwd ?? null);
  if (!repo) return null;
  return { repo, paths: (await ownersAsync(db, repo, titles)).filter((o) => o.owners.some((x) => x.id === sessionId)).map((o) => o.path) };
}

/** A Needs you row when an ended session leaves files it owns uncommitted. */
async function leftBehind(db: DatabaseSync, sessionId: string, titles: Record<string, string | undefined>): Promise<void> {
  const owned = await ownedBy(db, sessionId, titles);
  if (!owned?.paths.length) return;
  const n = owned.paths.length;
  db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) SELECT ?, ?, 'uncommitted', ?, ? WHERE NOT EXISTS (SELECT 1 FROM needs_you WHERE ref = ? AND kind = 'uncommitted' AND resolved_at IS NULL)")
    .run(ulid(), nowIso(), sessionId, `${labelOf(db, sessionId, titles)} left ${n} file${n === 1 ? '' : 's'} uncommitted`, sessionId);
}

/** One notice to the parent of an exited session: its owned paths, whether each is committed, its last line and transcript. */
async function handBack(db: DatabaseSync, sessionId: string, titles: Record<string, string | undefined>): Promise<void> {
  const row = db.prepare('SELECT parent_id, cwd FROM session WHERE id = ?').get(sessionId) as { parent_id: string | null; cwd: string | null } | undefined;
  if (!row?.parent_id) return;
  const repo = await repoOfAsync(row.cwd);
  const claimed = new Set<string>();
  for (const r of db.prepare("SELECT payload FROM event WHERE kind = 'core.claim' AND session_id = ?").all(sessionId) as Array<{ payload: string }>) {
    try { for (const f of JSON.parse(r.payload).files) claimed.add(f.path); } catch {}
  }
  let dirty = new Set<string>();
  try { if (repo) dirty = new Set((await ownersAsync(db, repo, titles)).map((o) => o.path)); } catch {}
  const transcript = (db.prepare("SELECT json_extract(payload, '$.transcript_path') AS t FROM event WHERE session_id = ? AND json_extract(payload, '$.transcript_path') IS NOT NULL ORDER BY seq DESC LIMIT 1").get(sessionId) as { t: string } | undefined)?.t;
  const last = liveText()[sessionId]?.line;
  const files = [...claimed].sort().map((f) => `${f} (${dirty.has(f) ? 'uncommitted' : 'committed'})`);
  const lines = [`Session ${labelOf(db, sessionId, titles)}, launched from this session, has ended.`, `Files: ${files.length ? files.join(', ') : 'none changed'}.`];
  if (last) lines.push(`Its last line: ${last}`);
  if (transcript) lines.push(`Transcript: ${transcript}`);
  notice(db, row.parent_id, `child:${sessionId}`, lines.join('\n'));
}

let resolving = false;

/** Resolves an open uncommitted row once its session owns no uncommitted path; git runs off the event loop, one pass at a time, each repo once per pass. */
export async function resolveUncommitted(db: DatabaseSync): Promise<void> {
  if (resolving) return;
  resolving = true;
  try {
    const watermark = (db.prepare('SELECT max(seq) AS m FROM event').get() as { m: number | null }).m ?? 0;
    const rows = db.prepare("SELECT id, ref FROM needs_you WHERE kind = 'uncommitted' AND resolved_at IS NULL").all() as Array<{ id: string; ref: string }>;
    const repos = new Map<string, Promise<string | null>>();
    const owned = new Map<string, Promise<OwnedPath[]>>();
    const claimedSince = db.prepare("SELECT 1 FROM event WHERE kind = 'core.claim' AND session_id = ? AND seq > ? LIMIT 1");
    const resolve = db.prepare('UPDATE needs_you SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL');
    for (const r of rows) {
      try {
        const cwd = (db.prepare('SELECT cwd FROM session WHERE id = ?').get(r.ref) as { cwd: string | null } | undefined)?.cwd ?? null;
        if (!repos.has(cwd ?? '')) repos.set(cwd ?? '', repoOfAsync(cwd));
        const repo = await repos.get(cwd ?? '')!;
        if (repo && !owned.has(repo)) owned.set(repo, ownersAsync(db, repo));
        const paths = repo ? await owned.get(repo)! : [];
        if (!paths.some((o) => o.owners.some((x) => x.id === r.ref)) && !claimedSince.get(r.ref, watermark)) resolve.run(nowIso(), r.id);
      } catch {}
    }
  } finally {
    resolving = false;
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
export async function markTurnBase(db: DatabaseSync, sessionId: string): Promise<void> {
  setTurnBase(db, sessionId, await turnSnapshot(db, sessionId));
}

function setTurnBase(db: DatabaseSync, sessionId: string, base: string | null): void {
  if (base) db.prepare('UPDATE session SET turn_base = ? WHERE id = ?').run(base, sessionId);
}

/** A commit of the session's folder as it is now, from a copy of the index so the user's index.lock is never taken; null outside a repository. */
async function turnSnapshot(db: DatabaseSync, sessionId: string): Promise<string | null> {
  const row = db.prepare('SELECT cwd FROM session WHERE id = ?').get(sessionId) as { cwd: string | null } | undefined;
  if (!row?.cwd) return null;
  const git = async (args: string[], env: Record<string, string> = {}) => (await gitAsync(row.cwd!, args, 5000, env, false)).trim();
  const index = path.join(os.tmpdir(), `troop-index-${ulid()}`);
  try {
    await fs.promises.copyFile(path.resolve(row.cwd, await git(['rev-parse', '--git-path', 'index'])), index);
    return (await git(['stash', 'create'], { GIT_INDEX_FILE: index })) || (await git(['rev-parse', 'HEAD']));
  } catch {
    return null;
  } finally {
    await fs.promises.rm(index, { force: true }).catch(() => {});
  }
}
