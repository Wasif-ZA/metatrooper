import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { resolveCommand } from '../hook/resolve.ts';
import { validate } from '../jsonschema.ts';
import { nowIso } from '../time.ts';
import { insideDir, type ActionSpec } from './manifest.ts';
import type { InstalledPlugin } from './store.ts';

export const BASE_ENV = ['PATH', 'PATHEXT', 'COMSPEC', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];
export const LOG_CAP_BYTES = 1024 * 1024;
const STDOUT_CAP_BYTES = 16 * 1024 * 1024;

export type ActionResult =
  | { ok: true; outputs: Record<string, unknown> }
  | { ok: false; error: { message: string; retryable: boolean } };

export interface ActionRequest {
  plugin: InstalledPlugin;
  actionId: string;
  input: Record<string, unknown>;
  projectDir: string;
  run: { id: string; dir: string };
  secret: (name: string) => string | null;
}

/** The environment an action gets: the base variables that are set, the TROOP_ paths, and approved secrets only. */
export function actionEnv(req: ActionRequest): { env: Record<string, string>; missing: string[] } {
  const env: Record<string, string> = {};
  for (const name of BASE_ENV) {
    const v = process.env[name];
    if (v !== undefined) env[name] = v;
  }
  env.TROOP_RUN_DIR = req.run.dir;
  env.TROOP_PROJECT_DIR = req.projectDir;
  env.TROOP_PLUGIN_DIR = req.plugin.path;
  const missing: string[] = [];
  for (const p of req.plugin.permissions) {
    if (!p.startsWith('secrets:')) continue;
    const name = p.slice(8);
    const value = req.secret(name);
    if (value === null) missing.push(name);
    else env[name] = value;
  }
  return { env, missing };
}

function onEnvPath(name: string, env: Record<string, string>): string | null {
  const exts = process.platform !== 'win32' || path.extname(name) ? [''] : (env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase());
  for (const dir of (env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
  }
  return null;
}

/** Turns an action's argv into something spawnable with no shell; `.cmd` and `.bat` files that are not npm shims go through COMSPEC. */
export function planCommand(run: string[], pluginDir: string, env: Record<string, string>): { file: string; args: string[]; verbatim: boolean } | null {
  const [first, ...rest] = run;
  const pathLike = first.includes('/') || first.includes(String.fromCharCode(92));
  const found = pathLike ? insideDir(pluginDir, first) : onEnvPath(first, env);
  if (!found || !fs.existsSync(found)) return null;
  if (process.platform !== 'win32' || !/\.(cmd|bat)$/i.test(found)) {
    if (/\.(m?js|cjs)$/i.test(found)) return { file: process.execPath, args: [found, ...rest], verbatim: false };
    return { file: found, args: rest, verbatim: false };
  }
  const unwrapped = resolveCommand(found);
  if (unwrapped) return { file: unwrapped[0], args: [...unwrapped.slice(1), ...rest], verbatim: false };
  const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
  return { file: env.COMSPEC || 'cmd.exe', args: ['/d', '/s', '/c', `"${[found, ...rest].map(quote).join(' ')}"`], verbatim: true };
}

export function killTree(child: ChildProcess): void {
  if (!child.pid) return;
  killPid(child.pid);
  if (process.platform !== 'win32') {
    try { child.kill('SIGKILL'); } catch {}
  }
}

/** Kills a process and its descendants: `taskkill /T /F` on Windows, the process group elsewhere. */
export function killPid(pid: number): void {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch {}
  try { process.kill(pid, 'SIGKILL'); } catch {}
}

class RunLog {
  private file: string;
  private size: number;
  private capped = false;

  constructor(runDir: string) {
    this.file = path.join(runDir, 'log.jsonl');
    fs.mkdirSync(runDir, { recursive: true });
    this.size = fs.existsSync(this.file) ? fs.statSync(this.file).size : 0;
  }

  write(entry: Record<string, unknown>): void {
    if (this.capped) return;
    let line = JSON.stringify({ at: nowIso(), ...entry }) + '\n';
    if (this.size + Buffer.byteLength(line) > LOG_CAP_BYTES) {
      this.capped = true;
      line = JSON.stringify({ at: nowIso(), stream: 'core', line: 'log capped at 1 MB for this run' }) + '\n';
    }
    fs.appendFileSync(this.file, line);
    this.size += Buffer.byteLength(line);
  }
}

function fail(message: string, retryable = false): ActionResult {
  return { ok: false, error: { message, retryable } };
}

/** Runs one plugin action by the process contract in plugins.md; resolves with its parsed result, never rejects. */
export function runAction(req: ActionRequest, onStderr?: (line: string) => void): Promise<ActionResult> {
  const action = (req.plugin.manifest.actions ?? []).find((a) => a.id === req.actionId) as ActionSpec | undefined;
  if (!action) return Promise.resolve(fail(`action ${req.actionId} not found in ${req.plugin.id}`));
  if (action.input_schema) {
    const errors = validate(action.input_schema, req.input);
    if (errors.length) return Promise.resolve(fail(`action input is invalid: ${errors.join('; ')}`));
  }
  const { env, missing } = actionEnv(req);
  if (missing.length) return Promise.resolve(fail(`secret ${missing.join(', ')} is not set for ${req.plugin.id}`));
  const plan = planCommand(action.run, req.plugin.path, env);
  if (!plan) return Promise.resolve(fail(`command not found: ${action.run[0]}`));
  const log = new RunLog(req.run.dir);
  const timeoutMs = (action.timeout_seconds ?? 600) * 1000;

  return new Promise((resolve) => {
    let child: ChildProcess;
    try {
      child = spawn(plan.file, plan.args, {
        cwd: req.projectDir,
        env,
        windowsHide: true,
        windowsVerbatimArguments: plan.verbatim,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve(fail(`could not start ${action.run[0]}: ${(e as Error).message}`));
      return;
    }
    let settled = false;
    let timedOut = false;
    const chunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrTail = '';
    const finish = (r: ActionResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      log.write({ stream: 'core', plugin: req.plugin.id, action: action.id, line: `timed out after ${action.timeout_seconds ?? 600} s; process tree killed` });
      killTree(child);
    }, timeoutMs);

    child.stdout!.on('data', (c: Buffer) => {
      stdoutBytes += c.length;
      if (stdoutBytes <= STDOUT_CAP_BYTES) chunks.push(c);
    });
    child.stderr!.setEncoding('utf8');
    child.stderr!.on('data', (c: string) => {
      stderrTail += c;
      const lines = stderrTail.split(/\r?\n/);
      stderrTail = lines.pop() ?? '';
      for (const line of lines) {
        log.write({ stream: 'stderr', plugin: req.plugin.id, action: action.id, line });
        onStderr?.(line);
      }
    });
    child.on('error', (e) => finish(fail(`could not start ${action.run[0]}: ${e.message}`)));
    child.on('close', (code) => {
      if (stderrTail) {
        log.write({ stream: 'stderr', plugin: req.plugin.id, action: action.id, line: stderrTail });
        onStderr?.(stderrTail);
      }
      if (timedOut) return finish(fail(`action timed out after ${action.timeout_seconds ?? 600} s`, true));
      if (stdoutBytes > STDOUT_CAP_BYTES) return finish(fail('action wrote invalid output'));
      let out: Record<string, unknown>;
      try {
        out = JSON.parse(Buffer.concat(chunks).toString('utf8').trim());
      } catch {
        return finish(fail('action wrote invalid output'));
      }
      if (out?.ok === true && out.outputs && typeof out.outputs === 'object' && !Array.isArray(out.outputs)) {
        if (code !== 0) return finish(fail(`action exited with code ${code}`));
        if (action.output_schema) {
          const errors = validate(action.output_schema, out.outputs);
          if (errors.length) return finish(fail(`action outputs are invalid: ${errors.join('; ')}`));
        }
        return finish({ ok: true, outputs: out.outputs as Record<string, unknown> });
      }
      const err = out?.error as { message?: unknown; retryable?: unknown } | undefined;
      if (out?.ok === false && err && typeof err.message === 'string') return finish(fail(err.message, err.retryable === true));
      return finish(fail('action wrote invalid output'));
    });

    child.stdin!.on('error', () => {});
    child.stdin!.end(JSON.stringify({ schema: 1, action: action.id, input: req.input, project: req.projectDir, run: { id: req.run.id, dir: req.run.dir } }));
  });
}
