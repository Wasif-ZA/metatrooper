import type { DatabaseSync } from 'node:sqlite';
import { nowIso, ulid } from './time.ts';
import { E, RpcError } from './pipe/errors.ts';
import { getEngine } from './engines/registry.ts';
import { launchSession } from './sessions/launch.ts';
import { finishedOk } from './sessions/finished.ts';
import { settings } from './settings.ts';
import { tx } from './store/db.ts';
import * as term from './terminal/index.ts';

export type Reviewed = { session_id: string; project_id: string; cwd: string | null; prompt: string | null; started_at: string; path: string; name: string };
export type ReviewDeps = {
  launch: (row: Reviewed, engineId: string, prompt: string) => string;
  readLines: (sessionId: string) => Promise<string[] | null>;
};

function names(v: unknown, key: string): string[] {
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x.trim().length > 0)) throw new RpcError(E.INVALID_PARAMS, `${key} must be an array of non-empty strings`);
  return [...new Set(v.map((x: string) => x.trim()))];
}

/** Replaces the session's reviewers and approvers; a (kind, who) already set keeps its state. */
export function setReviewers(db: DatabaseSync, sessionId: string, reviewers: unknown, approvers: unknown): { ok: true } {
  const engines = names(reviewers, 'reviewers');
  const people = names(approvers, 'approvers');
  for (const id of engines) if (!getEngine(db, id)) throw new RpcError(E.INVALID_PARAMS, `unknown engine ${id}`);
  for (const who of people) if (who !== 'you') throw new RpcError(E.INVALID_PARAMS, 'the only approver is "you"');
  if (!db.prepare('SELECT 1 FROM session WHERE id = ?').get(sessionId)) throw new RpcError(E.NOT_FOUND, 'session not found');
  const wanted = [...engines.map((who) => ['reviewer', who]), ...people.map((who) => ['approver', who])];
  tx(db, () => {
    const rows = db.prepare('SELECT kind, who FROM session_review WHERE session_id = ?').all(sessionId) as Array<{ kind: string; who: string }>;
    const drop = db.prepare('DELETE FROM session_review WHERE session_id = ? AND kind = ? AND who = ?');
    for (const r of rows) if (!wanted.some(([k, w]) => k === r.kind && w === r.who)) drop.run(sessionId, r.kind, r.who);
    const add = db.prepare('INSERT OR IGNORE INTO session_review (session_id, kind, who, at) VALUES (?, ?, ?, ?)');
    for (const [kind, who] of wanted) add.run(sessionId, kind, who, nowIso());
  });
  return { ok: true };
}

function settle(db: DatabaseSync, sessionId: string, kind: string, who: string, passed: boolean, note: string | null): void {
  db.prepare('UPDATE session_review SET state = ?, note = ?, at = ? WHERE session_id = ? AND kind = ? AND who = ?').run(passed ? 'passed' : 'failed', note, nowIso(), sessionId, kind, who);
  if (!passed) {
    const what = kind === 'approver' ? 'You rejected this' : `${who} review failed`;
    db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'failed', ?, ?)").run(ulid(), nowIso(), sessionId, note ? `${what}: ${note}` : what);
  }
}

/** session.approve / session.reject: the person's verdict on a session they approve. */
export function decide(db: DatabaseSync, sessionId: string, passed: boolean, note: unknown): { ok: true } {
  if (note !== undefined && note !== null && typeof note !== 'string') throw new RpcError(E.INVALID_PARAMS, 'note must be a string');
  const text = typeof note === 'string' ? note.trim() : '';
  if (!passed && !text) throw new RpcError(E.INVALID_PARAMS, 'note is required to reject');
  if (text.length > 2000) throw new RpcError(E.INVALID_PARAMS, 'note must be at most 2000 characters');
  if (!db.prepare("SELECT 1 FROM session_review WHERE session_id = ? AND kind = 'approver' AND who = 'you'").get(sessionId)) throw new RpcError(E.NOT_FOUND, 'the session has no approver');
  settle(db, sessionId, 'approver', 'you', passed, text || null);
  return { ok: true };
}

/** The last "VERDICT: PASS|FAIL <note>" in the lines; engines may prefix the line with a glyph. */
export function parseVerdict(lines: string[]): { passed: boolean; note: string | null } | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /VERDICT:\s*(PASS|FAIL)\b[\s:.,;-]*(.*)$/i.exec(lines[i]);
    if (m) return { passed: m[1].toUpperCase() === 'PASS', note: m[2].trim() || null };
  }
  return null;
}

export function reviewPrompt(r: Pick<Reviewed, 'prompt' | 'started_at'>): string {
  const task = (r.prompt ?? 'not recorded').replace(/\s+/g, ' ').trim().slice(0, 1000);
  return `Review the work another agent did in this folder. Its task was: "${task}". It started at ${r.started_at}; see its changes with git status, git diff, and git log -p --since="${r.started_at}". Check the changes do the task, are correct, and break nothing else. Do not edit any files. End your reply with a final line made of the word VERDICT and a colon, then PASS or FAIL, then a one-sentence note.`;
}

let busy = false;

/** Launches a review child for each reviewer of a session that exited ok, and records each child's verdict once it has one or has exited. */
export async function reviewTick(db: DatabaseSync, deps: ReviewDeps): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const due = (db.prepare(
      `SELECT r.who, s.id AS session_id, s.project_id, s.cwd, s.prompt, s.started_at, p.path, p.name
       FROM session_review r JOIN session s ON s.id = r.session_id JOIN project p ON p.id = s.project_id
       WHERE r.kind = 'reviewer' AND r.state = 'pending' AND r.review_session_id IS NULL AND s.state = 'exited' AND s.outcome IN ('succeeded', 'cancelled')`,
    ).all() as Array<Reviewed & { who: string }>).filter((r) => finishedOk(db, r.session_id));
    for (const row of due) {
      try {
        const child = deps.launch(row, row.who, reviewPrompt(row));
        db.prepare("UPDATE session_review SET review_session_id = ?, at = ? WHERE session_id = ? AND kind = 'reviewer' AND who = ?").run(child, nowIso(), row.session_id, row.who);
      } catch (e) {
        settle(db, row.session_id, 'reviewer', row.who, false, `could not launch: ${(e as Error).message}`);
      }
    }
    const open = db.prepare(
      `SELECT r.session_id, r.who, r.review_session_id, c.state FROM session_review r JOIN session c ON c.id = r.review_session_id
       WHERE r.kind = 'reviewer' AND r.state = 'pending' AND c.state IN ('done', 'idle', 'exited')`,
    ).all() as Array<{ session_id: string; who: string; review_session_id: string; state: string }>;
    for (const r of open) {
      const v = parseVerdict((await deps.readLines(r.review_session_id)) ?? []);
      if (v) settle(db, r.session_id, 'reviewer', r.who, v.passed, v.note);
      else if (r.state === 'exited') settle(db, r.session_id, 'reviewer', r.who, false, 'no verdict');
    }
  } finally {
    busy = false;
  }
}

export function realReviewDeps(db: DatabaseSync): ReviewDeps {
  return {
    launch: (row, engineId, prompt) => {
      const engine = getEngine(db, engineId);
      if (!engine) throw new Error(`engine ${engineId} not found`);
      const fallback = settings().sessions.approval;
      const approval = fallback !== 'isolated' && (fallback === 'ask' || engine.approval_profiles?.[fallback]) ? fallback : 'ask';
      return launchSession(db, { projectId: row.project_id, projectPath: row.path, projectName: row.name, engine, prompt, cwd: row.cwd ?? row.path, parentId: row.session_id, approval }).session_id;
    },
    readLines: (id) => term.readLines(id, 200),
  };
}
