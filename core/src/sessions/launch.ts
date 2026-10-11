import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { coreDir, repoDir } from '../paths.ts';
import { nowIso, ulid } from '../time.ts';
import type { EngineSpec } from '../engines/registry.ts';
import { mcpAttachArgs, mcpAttachEnv, sweepSessionFiles } from '../plugins/mcp.ts';
import { appendEvent } from '../events/append.ts';
import * as term from '../terminal/index.ts';
import { settings } from '../settings.ts';
import { ensureEngineSetup, sessionHookArgs } from '../hooks/install.ts';
import { canonicalPath, isAskPath, nearAskPath } from '../project.ts';
import { E, RpcError } from '../pipe/errors.ts';
import { dockerArgv, ensureProxy, gitLayout, sandboxHookArgs } from '../sandbox/launch.ts';
import { spoolDir } from '../sandbox/spool.ts';
import fs from 'node:fs';

export interface LaunchPlan {
  argv: string[];
  promptDelivered: boolean;
}

export function planArgs(engine: EngineSpec, prompt?: string, approval = 'ask', extra: string[] = [], host = 'pty'): LaunchPlan {
  if (approval === 'isolated' && host !== 'sandbox') throw new RpcError(E.VALIDATION, 'isolated runs only on the sandbox host');
  const argv = [engine.command, ...(engine.args ?? []), ...(engine.approval_profiles?.[approval] ?? []), ...extra];
  if (!prompt) return { argv, promptDelivered: true };
  if (engine.prompt_arg === 'positional') return { argv: [...argv, prompt], promptDelivered: true };
  if (engine.prompt_arg && engine.prompt_arg.startsWith('-')) return { argv: [...argv, engine.prompt_arg, prompt], promptDelivered: true };
  return { argv, promptDelivered: false };
}

/** The approval a session in this folder starts with: ask in or around a `sessions.ask_paths` folder for every engine (D46), and anywhere under a tree holding one for engines with ask_near_paths (D48). */
export function folderApproval(dir: string, approval?: string, engine?: EngineSpec, askPaths: unknown[] = settings().sessions.ask_paths): string {
  if (isAskPath(dir, askPaths)) return 'ask';
  if (engine?.ask_near_paths && nearAskPath(dir, askPaths)) return 'ask';
  return approval ?? 'ask';
}

export const METAROUTER_BLOCK = `## Tools
Run shell commands through metarouter.
- Look for a saved recipe first: \`metarouter search <words>\`, then \`metarouter run <recipe> ...\`.
- Anything else: \`metarouter exec -- "<command>"\`. Read the short result; it names the full log.
- A command that worked and will be needed again: \`metarouter add <name> -- '<command, {1} for arguments>'\`.
- If metarouter is missing or errors, run the plain command.`;

/** With `sessions.metarouter` on: router/bin first on PATH, so `metarouter` is the bundled copy, and the engine's instructions arg carrying METAROUTER_BLOCK. */
export function metarouterLaunch(engine: EngineSpec, on = settings().sessions.metarouter, base: NodeJS.ProcessEnv = process.env): { args: string[]; env: Record<string, string> } {
  if (!on) return { args: [], env: {} };
  const key = Object.keys(base).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const bin = path.join(repoDir, 'router', 'bin');
  return {
    args: engine.instructions_arg ? [engine.instructions_arg, METAROUTER_BLOCK] : [],
    env: { [key]: base[key] ? `${bin}${path.delimiter}${base[key]}` : bin },
  };
}

const pendingPrompts = new Map<string, { prompt: string; at: number }>();

/** The engine's extra args for reading AGENTS.md, when `dir` has one and none of the engine's own instruction files. */
export function agentsMdArgs(engine: EngineSpec, dir: string): string[] {
  const a = engine.agents_md;
  if (!a || !fs.existsSync(path.join(dir, 'AGENTS.md'))) return [];
  return a.unless.some((f) => fs.existsSync(path.join(dir, f))) ? [] : a.args;
}

export function launchSession(
  db: DatabaseSync,
  opts: { projectId: string; projectPath: string; projectName: string; engine: EngineSpec; prompt?: string; cwd?: string; runId?: string; stepId?: string; approval?: string; extraArgs?: string[]; browser?: boolean; host?: 'pty' | 'sandbox'; parentId?: string },
): { session_id: string; prompt_delivered: boolean; approval: string; setup?: string[] } {
  const id = ulid();
  const host = opts.host ?? 'pty';
  const dir = canonicalPath(opts.cwd ?? opts.projectPath);
  const approval = folderApproval(dir, opts.approval, opts.engine);
  let setup: string[] | null = null;
  let argv: string[];
  let promptDelivered: boolean;
  let env: Record<string, string> = {};
  if (host === 'sandbox') {
    const layout = gitLayout(opts.cwd ?? opts.projectPath);
    if ('refusal' in layout) throw new RpcError(E.VALIDATION, layout.refusal);
    const proxy = ensureProxy();
    if (proxy) throw new RpcError(E.VALIDATION, proxy);
    fs.mkdirSync(spoolDir(id), { recursive: true });
    const plan = planArgs(opts.engine, opts.prompt, approval, [...(opts.extraArgs ?? []), ...agentsMdArgs(opts.engine, dir), ...sandboxHookArgs(opts.engine, id)], 'sandbox');
    argv = dockerArgv(id, opts.engine, opts.cwd ?? opts.projectPath, layout, plan.argv);
    promptDelivered = plan.promptDelivered;
  } else {
    try { setup = ensureEngineSetup(opts.engine, nowIso()); } catch {}
    try { sweepSessionFiles(db); } catch {}
    const router = metarouterLaunch(opts.engine);
    const plan = planArgs(opts.engine, opts.prompt, approval, [...(opts.extraArgs ?? []), ...agentsMdArgs(opts.engine, dir), ...router.args, ...sessionHookArgs(opts.engine, id), ...mcpAttachArgs(db, opts.engine, id, opts.browser, { pipeline: Boolean(opts.runId), approval })]);
    argv = plan.argv;
    promptDelivered = plan.promptDelivered;
    env = { ...router.env, ...mcpAttachEnv(db, opts.engine, id, opts.browser, { pipeline: Boolean(opts.runId), approval }) };
  }
  const plan = { argv, promptDelivered };
  const b64 = Buffer.from(JSON.stringify(plan.argv)).toString('base64');
  const launcher = path.join(coreDir, 'launch.js');
  db.prepare(
    `INSERT INTO session (id, project_id, engine_id, host, cwd, run_id, step_id, parent_id, state, state_at, started_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'starting', ?, ?)`,
  ).run(id, opts.projectId, opts.engine.id, host, opts.cwd ?? opts.projectPath, opts.runId ?? null, opts.stepId ?? null, opts.parentId ?? null, nowIso(), nowIso());
  const cwd = opts.cwd ?? opts.projectPath;
  try {
    term.open(id, [process.execPath, '--no-warnings', launcher, '--session', id, '--engine', opts.engine.id, '--args-b64', b64], cwd, { ...process.env, ...env });
  } catch {
    try { appendEvent('core.process-gone', id, { pid: null }, db); } catch {}
  }
  if (!plan.promptDelivered && opts.prompt) pendingPrompts.set(id, { prompt: opts.prompt, at: Date.now() });
  return { session_id: id, prompt_delivered: plan.promptDelivered, approval, ...(setup && setup.length ? { setup } : {}) };
}

/** Types a held prompt into the session's terminal once; later calls report it was already written. */
export function writePrompt(db: DatabaseSync, sessionId: string): { written: boolean; reason?: string } {
  const done = db.prepare("SELECT 1 FROM event WHERE session_id = ? AND kind = 'core.prompt-written' LIMIT 1").get(sessionId);
  if (done) return { written: false, reason: 'already written' };
  const held = pendingPrompts.get(sessionId);
  if (!held) return { written: false, reason: 'no prompt held' };
  if (!term.paste(sessionId, held.prompt) || !term.write(sessionId, '\r')) return { written: false, reason: 'terminal closed' };
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
