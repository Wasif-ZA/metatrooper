import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export type ManifestAction = { id: string; run: string[]; timeout_seconds?: number };
export type Manifest = { schema: 1; id: string; version: string; name: string; permissions?: string[]; actions?: ManifestAction[] };
export type ActionResult = { ok: true; outputs: Record<string, unknown> } | { ok: false; error: { message: string; retryable: boolean } };

const PASSED_ENV = ['PATH', 'PATHEXT', 'COMSPEC', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'];
const STDERR_CAP = 1024 * 1024;

export function readManifest(pluginDir: string): Manifest {
  const m = JSON.parse(fs.readFileSync(path.join(pluginDir, 'troop-plugin.json'), 'utf8')) as Manifest;
  if (m.schema !== 1 || !/^[a-z0-9][a-z0-9-]{1,40}$/.test(m.id)) throw new Error(`invalid manifest in ${pluginDir}`);
  return m;
}

export function actionEnv(
  parent: NodeJS.ProcessEnv,
  ctx: { runDir: string; projectDir: string; pluginDir: string },
  secrets: Record<string, string> = {},
): Record<string, string> {
  const env: Record<string, string> = {};
  const lower = new Map(Object.keys(parent).map((k) => [k.toUpperCase(), k]));
  for (const name of PASSED_ENV) {
    const key = lower.get(name);
    if (key && parent[key] !== undefined) env[name] = parent[key]!;
  }
  env.TROOP_RUN_DIR = ctx.runDir;
  env.TROOP_PROJECT_DIR = ctx.projectDir;
  env.TROOP_PLUGIN_DIR = ctx.pluginDir;
  return { ...env, ...secrets };
}

export function parseActionStdout(stdout: string): ActionResult {
  const text = stdout.trim();
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('action wrote invalid output');
  }
  const v = value as Record<string, unknown>;
  if (v && v.ok === true && v.outputs && typeof v.outputs === 'object') return v as ActionResult;
  if (v && v.ok === false && v.error && typeof (v.error as { message?: unknown }).message === 'string') return v as ActionResult;
  throw new Error('action wrote invalid output');
}

function killTree(pid: number): void {
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
  else process.kill(-pid, 'SIGKILL');
}

export function runAction(opts: {
  pluginDir: string;
  actionId: string;
  input: unknown;
  projectDir: string;
  run: { id: string; dir: string };
  secrets?: Record<string, string>;
}): Promise<ActionResult> {
  const manifest = readManifest(opts.pluginDir);
  const action = manifest.actions?.find((a) => a.id === opts.actionId);
  if (!action) return Promise.reject(new Error(`plugin ${manifest.id} has no action ${opts.actionId}`));
  fs.mkdirSync(opts.run.dir, { recursive: true });
  const logFile = path.join(opts.run.dir, 'log.jsonl');
  let logged = fs.existsSync(logFile) ? fs.statSync(logFile).size : 0;
  const env = actionEnv(process.env, { runDir: opts.run.dir, projectDir: opts.projectDir, pluginDir: opts.pluginDir }, opts.secrets);
  const [cmd, ...args] = action.run;
  const argv0 = cmd === 'node' ? process.execPath : cmd;

  return new Promise((resolve, reject) => {
    const child = spawn(argv0, args, { cwd: opts.pluginDir, env, windowsHide: true, detached: process.platform !== 'win32' });
    let stdout = '';
    let errBuf = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killTree(child.pid);
    }, (action.timeout_seconds ?? 600) * 1000);

    const logLine = (line: string) => {
      const rec = JSON.stringify({ ts: new Date().toISOString(), plugin: manifest.id, action: action.id, stderr: line }) + '\n';
      if (logged + rec.length > STDERR_CAP) return;
      logged += rec.length;
      fs.appendFileSync(logFile, rec);
    };
    child.stdout.on('data', (d: Buffer) => (stdout += d.toString('utf8')));
    child.stderr.on('data', (d: Buffer) => {
      errBuf += d.toString('utf8');
      const lines = errBuf.split(/\r?\n/);
      errBuf = lines.pop() ?? '';
      for (const l of lines) if (l) logLine(l);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (errBuf) logLine(errBuf);
      if (timedOut) return resolve({ ok: false, error: { message: `action timed out after ${action.timeout_seconds ?? 600} s`, retryable: true } });
      let result: ActionResult;
      try {
        result = parseActionStdout(stdout);
      } catch (e) {
        return resolve({ ok: false, error: { message: (e as Error).message, retryable: false } });
      }
      if (result.ok && code !== 0) return resolve({ ok: false, error: { message: `action exited with code ${code}`, retryable: false } });
      resolve(result);
    });
    child.stdin.end(JSON.stringify({ schema: 1, action: action.id, input: opts.input, project: opts.projectDir, run: opts.run }));
  });
}
