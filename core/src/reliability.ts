import type { DatabaseSync } from 'node:sqlite';
import { createLoopAlarm, NUDGE_OPTIONS, type LoopAlarm, type NudgeChoice } from './loop-alarm.ts';
import { budgetFooter, budgetStep } from './run-health.ts';
import { doneResult, runCheck } from './done-proof.ts';
import { appendEvent } from './events/append.ts';
import { E, RpcError } from './pipe/errors.ts';
import { settings } from './settings.ts';
import * as term from './terminal/index.ts';
import { nowIso, ulid } from './time.ts';

const FRESH_MS = 60_000;
const TRY_ANOTHER = 'You have made the same call several times and got the same result each time. Stop repeating it and try a different way.';

interface Watch { key: string; alarm: LoopAlarm; open: Map<string, { tool: string; input: string }> }
const watches = new Map<string, Watch>();

const loopRef = (sessionId: string) => `loop:${sessionId}`;

function watchOf(sessionId: string): Watch {
  const r = settings().reliability;
  const nudgeAt = Math.max(1, Math.trunc(r.loop_nudge_at));
  const stopAt = Math.max(nudgeAt + 1, Math.trunc(r.loop_stop_at));
  const key = `${nudgeAt}/${stopAt}`;
  let w = watches.get(sessionId);
  if (!w || w.key !== key) {
    w = { key, alarm: createLoopAlarm({ nudgeAt, stopAt }), open: new Map() };
    watches.set(sessionId, w);
  }
  return w;
}

/** Feeds one Claude transcript record to the session's loop alarm: a tool_use is held until its tool_result arrives, then the pair is observed. A nudge raises one Needs you row; a stop also interrupts the agent. Records older than a minute are counted but raise nothing. */
export function watchRecord(db: DatabaseSync, sessionId: string, rec: any): void {
  if (!settings().reliability.loop_alarm) return;
  const parts = rec?.message?.content;
  if (!Array.isArray(parts)) return;
  const w = watchOf(sessionId);
  for (const p of parts) {
    if (p?.type === 'tool_use' && typeof p.id === 'string') {
      w.open.set(p.id, { tool: String(p.name), input: JSON.stringify(p.input ?? null) });
    } else if (p?.type === 'tool_result' && w.open.has(p.tool_use_id)) {
      const call = w.open.get(p.tool_use_id)!;
      w.open.delete(p.tool_use_id);
      const verdict = w.alarm.observe({ ...call, output: JSON.stringify(p.content ?? null) });
      if (verdict === 'ok' || !(Date.now() - Date.parse(rec.timestamp) < FRESH_MS)) continue;
      const n = w.alarm.streak;
      appendEvent('core.loop', sessionId, { verdict, streak: n, tool: call.tool }, db);
      const text = verdict === 'stop' ? `Stopped: ${call.tool} ran ${n} times with the same result` : `${call.tool} ran ${n} times with the same result`;
      const ref = loopRef(sessionId);
      const open = db.prepare("UPDATE needs_you SET text = ?, read_at = NULL WHERE ref = ? AND kind = 'other' AND resolved_at IS NULL").run(text, ref);
      if (Number(open.changes) === 0) db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'other', ?, ?)").run(ulid(), nowIso(), ref, text);
      if (verdict === 'stop') term.write(sessionId, '\x1b');
    }
  }
}

/** Applies the user's answer to a loop nudge and resolves its Needs you row. Rewind is refused: nothing restores files yet. */
export function chooseLoop(db: DatabaseSync, sessionId: string, choice: string): { false_alarms: number } {
  if (!(NUDGE_OPTIONS as readonly string[]).includes(choice)) throw new RpcError(E.INVALID_PARAMS, `choice must be one of ${NUDGE_OPTIONS.join(', ')}`);
  if (choice === 'rewind') throw new RpcError(E.INVALID_PARAMS, 'rewind is not built yet');
  if (!db.prepare('SELECT 1 FROM session WHERE id = ?').get(sessionId)) throw new RpcError(E.NOT_FOUND, 'session not found');
  if (choice === 'pause') term.write(sessionId, '\x1b');
  if (choice === 'try-another-way' && term.paste(sessionId, TRY_ANOTHER)) term.write(sessionId, '\r');
  watches.get(sessionId)?.alarm.choose(choice as NudgeChoice);
  if (choice === 'not-a-loop') db.prepare("INSERT INTO meta (key, value) VALUES ('loop_false_alarms', '1') ON CONFLICT (key) DO UPDATE SET value = CAST(value AS INTEGER) + 1").run();
  db.prepare("UPDATE needs_you SET resolved_at = ? WHERE ref = ? AND kind = 'other' AND resolved_at IS NULL").run(nowIso(), loopRef(sessionId));
  return { false_alarms: falseAlarms(db) };
}

export function falseAlarms(db: DatabaseSync): number {
  return Number((db.prepare("SELECT value FROM meta WHERE key = 'loop_false_alarms'").get() as { value: string } | undefined)?.value ?? 0);
}

const budgetSeen = new Map<string, 'log' | 'gate'>();

/** Compares each working session's tokens (in, out and cache writes) with reliability.token_limit: one log event at 80%, and at 100% one interrupt and one Needs you row per session. A limit of 0 turns it off. */
export function checkBudgets(db: DatabaseSync): void {
  const cap = settings().reliability.token_limit;
  if (!(cap > 0)) return;
  // ponytail: one gate per session for its whole life; a per-turn budget needs a turn id on usage rows.
  const rows = db.prepare(
    `SELECT s.id, s.engine_id, COALESCE(SUM(u.tokens_in + u.tokens_out + u.cache_write), 0) AS used
     FROM session s JOIN usage u ON u.session_id = s.id WHERE s.ended_at IS NULL AND s.state = 'working' GROUP BY s.id`,
  ).all() as Array<{ id: string; engine_id: string; used: number }>;
  for (const r of rows) {
    const step = budgetStep(r.used, cap);
    if (step === 'ok' || budgetSeen.get(r.id) === step) continue;
    budgetSeen.set(r.id, step);
    if (step === 'gate' && db.prepare("SELECT 1 FROM needs_you WHERE ref = ? AND kind = 'budget'").get(r.id)) continue;
    appendEvent('core.budget', r.id, { step, used: r.used, cap }, db);
    if (step !== 'gate') continue;
    db.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, 'budget', ?, ?)").run(ulid(), nowIso(), r.id, `${r.engine_id} paused at its token limit: ${budgetFooter(r.used, cap)}`);
    term.write(r.id, '\x1b');
  }
}

/** When a session reaches done: runs the project's check command if the user set one, then rewrites the open "finished" row to say whether a check passed on the files as they are now. */
export async function proveDone(db: DatabaseSync, sessionId: string): Promise<void> {
  const r = settings().reliability;
  if (!r.done_needs_check) return;
  const s = db.prepare('SELECT project_id, engine_id, run_id, cwd FROM session WHERE id = ?').get(sessionId) as { project_id: string; engine_id: string; run_id: string | null; cwd: string | null } | undefined;
  if (!s || s.run_id !== null || !s.cwd) return;
  const command = (r.checks as Record<string, unknown>)[s.project_id];
  const has = typeof command === 'string' && command.trim() !== '';
  const passed = has ? (await runCheck(db, sessionId, command)).exit_code === 0 : (await doneResult(db, sessionId)).result !== 'needs_review';
  const label = !passed ? `needs your review (${has ? 'the check failed' : 'no check is set for this project'})` : 'checks passed';
  db.prepare("UPDATE needs_you SET text = ? WHERE ref = ? AND kind = 'done' AND resolved_at IS NULL").run(`${s.engine_id} finished: ${label}`, sessionId);
}
