import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { coreDir } from '../paths.ts';
import { nowIso, ulid } from '../time.ts';
import type { EngineSpec } from '../engines/registry.ts';
import { mcpAttachArgs } from '../plugins/mcp.ts';
import { appendEvent } from '../events/append.ts';
import * as term from '../terminal/index.ts';
import { settings } from '../settings.ts';

export interface LaunchPlan {
  argv: string[];
  promptDelivered: boolean;
}

export function planArgs(engine: EngineSpec, prompt?: string, approval = 'ask', extra: string[] = []): LaunchPlan {
  const argv = [engine.command, ...(engine.args ?? []), ...(engine.approval_profiles?.[approval] ?? []), ...extra];
  if (!prompt) return { argv, promptDelivered: true };
  if (engine.prompt_arg === 'positional') return { argv: [...argv, prompt], promptDelivered: true };
  if (engine.prompt_arg && engine.prompt_arg.startsWith('-')) return { argv: [...argv, engine.prompt_arg, prompt], promptDelivered: true };
  return { argv, promptDelivered: false };
}

const pendingPrompts = new Map<string, { prompt: string; at: number }>();

export function launchSession(
  db: DatabaseSync,
  opts: { projectId: string; projectPath: string; projectName: string; engine: EngineSpec; prompt?: string; cwd?: string; runId?: string; stepId?: string; approval?: string; extraArgs?: string[] },
): { session_id: string; prompt_delivered: boolean; approval: string } {
  const id = ulid();
  const approval = opts.approval ?? 'ask';
  const plan = planArgs(opts.engine, opts.prompt, approval, [...(opts.extraArgs ?? []), ...mcpAttachArgs(db, opts.engine, id)]);
  const b64 = Buffer.from(JSON.stringify(plan.argv)).toString('base64');
  const launcher = path.join(coreDir, 'launch.js');
  db.prepare(
    `INSERT INTO session (id, project_id, engine_id, host, cwd, run_id, step_id, state, state_at, started_at)
     VALUES (?, ?, ?, 'pty', ?, ?, ?, 'starting', ?, ?)`,
  ).run(id, opts.projectId, opts.engine.id, opts.cwd ?? opts.projectPath, opts.runId ?? null, opts.stepId ?? null, nowIso(), nowIso());
  const cwd = opts.cwd ?? opts.projectPath;
  try {
    term.open(id, [process.execPath, '--no-warnings', launcher, '--session', id, '--engine', opts.engine.id, '--args-b64', b64], cwd, process.env);
  } catch {
    try { appendEvent('core.process-gone', id, { pid: null }, db); } catch {}
  }
  if (!plan.promptDelivered && opts.prompt) pendingPrompts.set(id, { prompt: opts.prompt, at: Date.now() });
  return { session_id: id, prompt_delivered: plan.promptDelivered, approval };
}

/** Types a held prompt into the session's terminal once; later calls report it was already written. */
export function writePrompt(db: DatabaseSync, sessionId: string): { written: boolean; reason?: string } {
  const done = db.prepare("SELECT 1 FROM event WHERE session_id = ? AND kind = 'core.prompt-written' LIMIT 1").get(sessionId);
  if (done) return { written: false, reason: 'already written' };
  const held = pendingPrompts.get(sessionId);
  if (!held) return { written: false, reason: 'no prompt held' };
  const text = term.bracketedPaste(sessionId) ? `\x1b[200~${held.prompt}\x1b[201~` : held.prompt;
  if (!term.write(sessionId, text + '\r')) return { written: false, reason: 'terminal closed' };
  pendingPrompts.delete(sessionId);
  appendEvent('core.prompt-written', sessionId, {}, db);
  return { written: true };
}

/** Every tick: a held prompt is typed when its session first reaches idle or waiting_for_you within terminal.prompt_wait_ms. */
export function deliverPrompts(db: DatabaseSync): void {
  const get = db.prepare('SELECT state FROM session WHERE id = ?');
  for (const [id, held] of pendingPrompts) {
    const s = get.get(id) as { state: string } | undefined;
    if (!s || s.state === 'exited') { pendingPrompts.delete(id); continue; }
    if (Date.now() - held.at > settings().terminal.prompt_wait_ms) continue;
    if (s.state === 'idle' || s.state === 'waiting_for_you') writePrompt(db, id);
  }
}

export function promptHeld(sessionId: string): boolean {
  return pendingPrompts.has(sessionId);
}
