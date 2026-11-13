import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { cronNext, nowIso, ulid } from './time.ts';

export type CheckResult = { code: number | null; timedOut?: boolean; error?: string; output?: string };
export type AutomationDeps = {
  now: () => number;
  runCheck: (argv: string[], cwd: string, timeoutMs: number) => Promise<CheckResult>;
  launch: (a: { project_id: string; engine_id: string; prompt: string; approval: string }) => Promise<{ session_id: string }> | { session_id: string };
  readFile: (absPath: string) => Buffer;
  send?: (session_id: string, text: string) => void;
  followUp?: (a: { project_id: string; engine_id: string; cwd: string | null; parent_id: string; prompt: string }) => Promise<{ session_id: string }> | { session_id: string };
};
export const LATE_MS = 120_000;

type Row = { id: string; project_id: string; name: string; every_min: number; cron: string | null; runner: string; script: string; script_sha256: string; timeout_ms: number; engine_id: string; prompt: string; next_due: string; path: string; approval: string | null };
export type RunResult = { run_id: string; outcome: string; session_id: string | null; detail: string | null };

const running = new Set<string>();

// Hex sha256 of a file's bytes.
export function sha256File(absPath: string): string {
  return createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

/** The next run after `now`: the cron's next local match when set, else the next every_min slot counted from `due` (or from now). */
export function nextDue(a: { cron: string | null; every_min: number }, now: number, due = now): number {
  if (a.cron) {
    const t = cronNext(a.cron, new Date(now));
    if (!t) throw new Error(`cron "${a.cron}" never matches`);
    return t.getTime();
  }
  const step = a.every_min * 60_000;
  return due + (Math.floor((now - due) / step) + 1) * step;
}

const SELECT = 'SELECT a.*, p.path FROM automation a JOIN project p ON p.id = a.project_id';

// Runs every due automation: the check script when it has one, then the agent on exit 1, or the agent straight away when it has none.
export async function automationTick(db: DatabaseSync, deps: AutomationDeps): Promise<void> {
  const now = deps.now();
  const rows = db.prepare(`${SELECT} WHERE a.enabled = 1 AND julianday(a.next_due) <= julianday(?)`).all(nowIso(new Date(now))) as Row[];
  for (const a of rows) {
    if (running.has(a.id)) continue;
    running.add(a.id);
    try { await scheduled(db, deps, a, now); } finally { running.delete(a.id); }
  }
}

/** Runs one automation now, outside its schedule; next_due is left alone. Null when it is already running. */
export async function runAutomationNow(db: DatabaseSync, deps: AutomationDeps, id: string): Promise<RunResult | null> {
  const a = db.prepare(`${SELECT} WHERE a.id = ?`).get(id) as Row | undefined;
  if (!a) throw new Error('automation not found');
  if (running.has(a.id)) return null;
  running.add(a.id);
  try { return await runOne(db, deps, a, deps.now(), nowIso(new Date(deps.now()))); } finally { running.delete(a.id); }
}

// Moves the schedule on, records a missed slot, else runs it.
async function scheduled(db: DatabaseSync, deps: AutomationDeps, a: Row, now: number): Promise<void> {
  const due = Date.parse(a.next_due);
  let next: number | null = null;
  try { next = nextDue(a, now, due); } catch {}
  if (next === null) db.prepare('UPDATE automation SET enabled = 0 WHERE id = ?').run(a.id);
  else db.prepare('UPDATE automation SET next_due = ? WHERE id = ?').run(nowIso(new Date(next)), a.id);
  if (now - due > LATE_MS) {
    record(db, a, a.next_due, nowIso(new Date(now)), 'missed', null, 'missed while the core was off', null);
    needs(db, a, nowIso(new Date(now)), 'missed-schedule', `Automation "${a.name}" did not run: the core was off at its scheduled time`);
    return;
  }
  await runOne(db, deps, a, now, a.next_due);
}

function record(db: DatabaseSync, a: Row, dueAt: string, at: string, outcome: string, exit: number | null, detail: string | null, session: string | null): string {
  const id = ulid();
  db.prepare('INSERT INTO automation_run (id, automation_id, due_at, at, outcome, exit_code, detail, session_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, a.id, dueAt, at, outcome, exit, detail, session);
  return id;
}

function needs(db: DatabaseSync, a: Row, at: string, kind: string, text: string): void {
  db.prepare('INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, ?, ?, ?)').run(ulid(), at, kind, a.id, text);
}

// Pin check, check script, optional launch, one automation_run row.
async function runOne(db: DatabaseSync, deps: AutomationDeps, a: Row, now: number, dueAt: string): Promise<RunResult> {
  const at = nowIso(new Date(now));
  let output = '';
  const run = async (outcome: string, exit: number | null, detail: string | null, session: string | null): Promise<RunResult> => {
    const id = record(db, a, dueAt, at, outcome, exit, detail, session);
    if (a.script && (outcome === 'woke' || outcome === 'failed')) await deliverMonitor(db, deps, a, id, (detail ?? `check exited ${exit}`) + (output ? `. Output: ${output}` : ''));
    return { run_id: id, outcome, session_id: session, detail };
  };
  const launch = async (exit: number | null) => {
    try {
      const { session_id } = await deps.launch({ project_id: a.project_id, engine_id: a.engine_id, prompt: a.prompt, approval: a.approval || 'ask' });
      return await run('woke', exit, null, session_id);
    } catch (e) { return await run('failed', exit, `launch failed: ${(e as Error).message}`, null); }
  };
  if (!a.script) return launch(null);
  const abs = path.resolve(a.path, a.script);
  let bad = '';
  try {
    if (createHash('sha256').update(deps.readFile(abs)).digest('hex') !== a.script_sha256) {
      bad = 'check script changed since it was saved; save the automation again in the workbench to approve it';
    }
  } catch (e) { bad = `check script not readable: ${(e as Error).message}`; }
  if (bad) {
    const r = await run('failed', null, bad, null);
    needs(db, a, at, 'other', `Automation "${a.name}" was not run: ${bad}`);
    return r;
  }
  const r = await deps.runCheck([...(JSON.parse(a.runner) as string[]), abs], a.path, a.timeout_ms);
  const clean = !r.timedOut && !r.error;
  output = r.output?.trim() ?? '';
  if (clean && r.code === 0) return run('skip', 0, null, null);
  if (clean && r.code === 1) return launch(1);
  const detail = r.timedOut ? `check timed out after ${a.timeout_ms} ms` : r.error ? `check failed to start: ${r.error}` : `check exited ${r.code}`;
  return run('failed', clean ? r.code : null, detail, null);
}

// Sends one failed run of a linked check into each monitoring session, or launches a follow-up child once the session has exited.
export async function deliverMonitor(db: DatabaseSync, deps: AutomationDeps, a: { id: string; name: string }, runId: string, detail: string): Promise<void> {
  if (!deps.send || !deps.followUp) return;
  const links = db.prepare('SELECT s.id, s.state, s.engine_id, s.cwd, s.project_id FROM session_monitor m JOIN session s ON s.id = m.session_id WHERE m.automation_id = ?')
    .all(a.id) as Array<{ id: string; state: string; engine_id: string; cwd: string | null; project_id: string }>;
  for (const s of links) {
    if (!db.prepare('UPDATE session_monitor SET last_run_id = ? WHERE session_id = ? AND last_run_id IS NOT ?').run(runId, s.id, runId).changes) continue;
    const text = `Check "${a.name}" failed: ${detail}`.replace(/[\s\x00-\x1f\x7f-\x9f]+/g, ' ').slice(0, 4000);
    try {
      if (s.state !== 'exited') deps.send(s.id, text);
      else await deps.followUp({ project_id: s.project_id, engine_id: s.engine_id, cwd: s.cwd, parent_id: s.id, prompt: `${text}. This check watches session ${s.id}, which has ended. Find the cause and fix it.` });
    } catch (e) {
      db.prepare('INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, ?, ?, ?)')
        .run(ulid(), nowIso(new Date(deps.now())), 'other', s.id, `Check "${a.name}" failed but could not reach session ${s.id}: ${(e as Error).message}`);
    }
  }
}

// Real dependencies: spawns the check without a shell, keeps the last 2000 characters it prints, and kills it on timeout.
export function realDeps(launch: AutomationDeps['launch']): AutomationDeps {
  return {
    now: () => Date.now(),
    launch,
    readFile: (p) => fs.readFileSync(p),
    runCheck: (argv, cwd, timeoutMs) => new Promise((resolve) => {
      let done = false;
      const fin = (r: CheckResult) => { if (!done) { done = true; clearTimeout(t); resolve(r); } };
      let output = '';
      const keep = (b: Buffer) => { output = (output + b.toString('utf8')).slice(-2000); };
      const child = spawn(argv[0]!, argv.slice(1), { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.stdout.on('data', keep);
      child.stderr.on('data', keep);
      const t = setTimeout(() => { child.kill(); fin({ code: null, timedOut: true, output }); }, timeoutMs);
      child.on('error', (e) => fin({ code: null, error: e.message }));
      child.on('close', (code) => fin({ code, output }));
    }),
  };
}
