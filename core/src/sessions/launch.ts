import { spawn } from 'node:child_process';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { coreDir } from '../paths.ts';
import { nowIso, ulid } from '../time.ts';
import type { EngineSpec } from '../engines/registry.ts';

export interface LaunchPlan {
  argv: string[];
  promptDelivered: boolean;
}

export function planArgs(engine: EngineSpec, prompt?: string): LaunchPlan {
  const argv = [engine.command, ...(engine.args ?? [])];
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
  opts: { projectId: string; projectPath: string; projectName: string; engine: EngineSpec; prompt?: string },
): { session_id: string; prompt_delivered: boolean } {
  const id = ulid();
  const plan = planArgs(opts.engine, opts.prompt);
  const b64 = Buffer.from(JSON.stringify(plan.argv)).toString('base64');
  const launcher = path.join(coreDir, 'launch.js');
  const win = windowName(id);
  db.prepare(
    `INSERT INTO session (id, project_id, engine_id, host, window_name, state, state_at, started_at)
     VALUES (?, ?, ?, 'wt', ?, 'starting', ?, ?)`,
  ).run(id, opts.projectId, opts.engine.id, win, nowIso(), nowIso());
  const nodeArgs = ['--no-warnings', launcher, '--session', id, '--engine', opts.engine.id, '--args-b64', b64];
  if ((process.env.TROOP_LAUNCHER || 'wt') === 'spawn') {
    const child = spawn(process.execPath, nodeArgs, { cwd: opts.projectPath, detached: true, stdio: 'ignore', windowsHide: true });
    child.on('error', () => {});
    child.unref();
  } else {
    const title = `${opts.engine.id} ${opts.projectName}`;
    const child = spawn('wt.exe', ['-w', win, 'new-tab', '--title', title, '-d', opts.projectPath, process.execPath, ...nodeArgs], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false,
    });
    child.on('error', () => {});
    child.unref();
  }
  return { session_id: id, prompt_delivered: plan.promptDelivered };
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
