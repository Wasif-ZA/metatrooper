import { spawn } from 'node:child_process';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { coreDir } from '../paths.ts';
import { nowIso, ulid } from '../time.ts';
import type { EngineSpec } from '../engines/registry.ts';
import { mcpAttachArgs } from '../plugins/mcp.ts';
import { appendEvent } from '../events/append.ts';

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

export function windowName(sessionId: string): string {
  return `troop-${sessionId.slice(-8).toLowerCase()}`;
}

export function launchSession(
  db: DatabaseSync,
  opts: { projectId: string; projectPath: string; projectName: string; engine: EngineSpec; prompt?: string; cwd?: string; runId?: string; stepId?: string; approval?: string },
): { session_id: string; prompt_delivered: boolean; approval: string } {
  const id = ulid();
  const approval = opts.approval ?? 'ask';
  const plan = planArgs(opts.engine, opts.prompt, approval, mcpAttachArgs(db, opts.engine, id));
  const b64 = Buffer.from(JSON.stringify(plan.argv)).toString('base64');
  const launcher = path.join(coreDir, 'launch.js');
  const win = windowName(id);
  db.prepare(
    `INSERT INTO session (id, project_id, engine_id, host, window_name, run_id, step_id, state, state_at, started_at)
     VALUES (?, ?, ?, 'wt', ?, ?, ?, 'starting', ?, ?)`,
  ).run(id, opts.projectId, opts.engine.id, win, opts.runId ?? null, opts.stepId ?? null, nowIso(), nowIso());
  const cwd = opts.cwd ?? opts.projectPath;
  const nodeArgs = ['--no-warnings', launcher, '--session', id, '--engine', opts.engine.id, '--args-b64', b64];
  const failed = () => {
    try { appendEvent('core.process-gone', id, { pid: null }, db); } catch {}
  };
  if ((process.env.TROOP_LAUNCHER || 'wt') === 'spawn') {
    const child = spawn(process.execPath, nodeArgs, { cwd, detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', failed);
    child.unref();
  } else {
    const title = `${opts.engine.id} ${opts.projectName}`;
    const child = spawn('wt.exe', ['-w', win, 'new-tab', '--title', title, '-d', cwd, process.execPath, ...nodeArgs], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.on('error', failed);
    child.unref();
  }
  return { session_id: id, prompt_delivered: plan.promptDelivered, approval };
}

export function focusSession(windowName: string): boolean {
  try {
    const child = spawn('wt.exe', ['-w', windowName, 'focus-tab', '-t', '0'], { detached: true, stdio: 'ignore' });
    child.on('error', () => {});
    child.unref();
    return true;
  } catch {
    return false;
  }
}
