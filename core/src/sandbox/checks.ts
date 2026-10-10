import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { EngineSpec } from '../engines/registry.ts';
import { coreDir, homeDir } from '../paths.ts';
import { canonicalPath, isAskPath } from '../project.ts';
import { settings } from '../settings.ts';

const LOGIN_MARGIN_MS = 60 * 60 * 1000;

export function imageTag(): string {
  const version = JSON.parse(fs.readFileSync(path.join(coreDir, 'package.json'), 'utf8')).version as string;
  return `metatrooper-trooper:${version}`;
}

/** The first of docker or podman that answers, or null. */
export function containerRuntime(): string | null {
  for (const cmd of ['docker', 'podman']) {
    const r = spawnSync(cmd, ['version', '--format', '{{.Server.Version}}'], { stdio: 'pipe', timeout: 15_000, windowsHide: true });
    if (r.status === 0) return cmd;
  }
  return null;
}

function claudeLoginRefusal(now: number): string | null {
  let expiresAt = 0;
  try {
    const creds = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8'));
    expiresAt = Number(creds?.claudeAiOauth?.expiresAt) || 0;
  } catch {}
  return expiresAt - now < LOGIN_MARGIN_MS ? 'run claude once on the host to refresh its login' : null;
}

function authCmdRefusal(engine: EngineSpec): string | null {
  if (!engine.auth_cmd) return null;
  const [cmd, ...args] = engine.auth_cmd;
  const r = spawnSync(cmd, args, { stdio: 'pipe', timeout: 30_000, windowsHide: true, shell: process.platform === 'win32' });
  return r.status === (engine.auth_ok?.exit_code ?? 0) ? null : `${engine.id} is not logged in on the host; run ${engine.auth_cmd.join(' ')}`;
}

/** Why an isolated launch of this engine in this folder must not start, or null when every check passes. */
export function sandboxRefusal(engine: EngineSpec, cwd: string, deps = { runtime: containerRuntime, now: Date.now }): string | null {
  if (!engine.sandbox || !engine.approval_profiles?.isolated) return `${engine.id} has no sandbox setup`;
  const dir = canonicalPath(cwd);
  if (isAskPath(dir, settings().sessions.ask_paths)) return 'isolated never runs on an ask path';
  const worktrees = canonicalPath(path.join(homeDir(), 'worktrees')).toLowerCase() + '/';
  if (!dir.toLowerCase().startsWith(worktrees)) return 'isolated runs only in a MetaTrooper worktree';
  const runtime = deps.runtime();
  if (!runtime) return 'no container runtime answers; start Docker Desktop';
  const image = spawnSync(runtime, ['image', 'inspect', imageTag()], { stdio: 'pipe', timeout: 15_000, windowsHide: true });
  if (image.status !== 0) return `the sandbox image ${imageTag()} is not built; run troop sandbox build`;
  if (engine.id === 'claude') return claudeLoginRefusal(deps.now());
  return authCmdRefusal(engine);
}
