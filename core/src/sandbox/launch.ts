import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import type { EngineSpec } from '../engines/registry.ts';
import { imageTag, containerRuntime } from './checks.ts';
import { NETWORK, PROXY } from './build.ts';
import { spoolDir } from './spool.ts';

const fwd = (p: string) => p.split(String.fromCharCode(92)).join('/');

/** `C:\a\b` to `/host/c/a/b`; a posix path gets the same prefix. */
export function mapPath(p: string): string {
  const s = fwd(path.resolve(p));
  const m = /^([A-Za-z]):\/?(.*)$/.exec(s);
  return m ? `/host/${m[1].toLowerCase()}/${m[2]}`.replace(/\/$/, '') : `/host${s}`;
}

export function containerName(sessionId: string): string {
  return `troop-${sessionId.slice(-8).toLowerCase()}`;
}

const inside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** The worktree's gitdir and the main repo's .git, or a reason the worktree cannot be mounted safely. */
export function gitLayout(worktree: string): { gitdir: string; common: string } | { refusal: string } {
  const pointer = path.join(worktree, '.git');
  let text = '';
  try { text = fs.readFileSync(pointer, 'utf8'); } catch { return { refusal: 'the worktree has no .git file' }; }
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(text);
  if (!m) return { refusal: 'the worktree .git file names no gitdir' };
  const gitdir = path.resolve(worktree, m[1]);
  let common = '';
  try { common = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim()); } catch { return { refusal: 'the worktree gitdir has no commondir' }; }
  if (!inside(gitdir, path.join(common, 'worktrees'))) return { refusal: 'the worktree gitdir is not inside the repository .git/worktrees' };
  let back = '';
  try { back = path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'gitdir'), 'utf8').trim()); } catch {}
  if (path.resolve(back).toLowerCase() !== path.resolve(pointer).toLowerCase()) return { refusal: 'the repository does not point back at this worktree' };
  return { gitdir, common };
}

const bind = (src: string, dst: string, ro = false) => ['--mount', `type=bind,source=${fwd(src)},target=${dst}${ro ? ',readonly' : ''}`];

/** The docker run argv for a sandboxed session, per spec.md "Trooper sandbox host plugin" and the build plan's D2, D6, D7 and D9. */
export function dockerArgv(sessionId: string, engine: EngineSpec, worktree: string, layout: { gitdir: string; common: string }, inner: string[], runtime = 'docker'): string[] {
  const home = os.homedir();
  const hooks = path.join(layout.common, 'hooks');
  fs.mkdirSync(hooks, { recursive: true });
  const logins = (engine.sandbox?.logins ?? []).flatMap((l) => {
    if (!('file' in l)) return [];
    const abs = path.join(home, l.file.replace(/^~[\\/]/, ''));
    return fs.existsSync(abs) ? bind(abs, `/troop/logins/${fwd(path.relative(home, abs))}`, true) : [];
  });
  return [
    runtime, 'run', '--rm', '-it', '--name', containerName(sessionId), '--network', NETWORK, '--user', '1000:1000',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--pids-limit', '512', '--memory', '4g', '--cpus', '2', '--read-only',
    '--tmpfs', '/tmp', '--tmpfs', '/home/trooper:uid=1000,gid=1000',
    ...bind(worktree, mapPath(worktree)),
    ...bind(layout.common, mapPath(layout.common)),
    ...bind(hooks, `${mapPath(layout.common)}/hooks`, true),
    ...bind(path.join(layout.common, 'config'), `${mapPath(layout.common)}/config`, true),
    ...bind(path.join(worktree, '.git'), `${mapPath(worktree)}/.git`, true),
    ...bind(spoolDir(sessionId), '/troop/spool'),
    ...logins,
    '-e', `TROOP_SESSION_ID=${sessionId}`, '-e', 'METATROOPER_SPOOL=/troop/spool',
    '-e', `HTTPS_PROXY=http://${PROXY}:3128`, '-e', `HTTP_PROXY=http://${PROXY}:3128`, '-e', 'NO_PROXY=',
    '-e', `GIT_DIR=${mapPath(layout.gitdir)}`, '-e', `GIT_WORK_TREE=${mapPath(worktree)}`,
    '-w', mapPath(worktree), imageTag(), '/opt/troop/entry.sh', ...inner,
  ];
}

/** Claude hook settings and the Codex notify line, pointing at the scripts inside the image. */
export function sandboxHookArgs(engine: EngineSpec, sessionId: string): string[] {
  if (engine.mcp_attach?.kind === 'codex-config') return ['-c', 'notify=["node", "/opt/troop/codex-notify.js", "[]"]'];
  if (engine.mcp_attach?.kind !== 'claude-mcp-config-flag') return [];
  const events = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd'];
  const group = (ev: string) => {
    const hooks = [{ type: 'command', command: `node /opt/troop/event.js claude.${ev}`, timeout: 5 }];
    return ev.endsWith('ToolUse') ? { matcher: '*', hooks } : { hooks };
  };
  fs.writeFileSync(path.join(spoolDir(sessionId), 'settings.json'), JSON.stringify({ hooks: Object.fromEntries(events.map((ev) => [ev, [group(ev)]])) }, null, 2) + '\n');
  return ['--settings=/troop/spool/settings.json'];
}

/** Starts the egress proxy when it is stopped; a reason when it cannot run. */
export function ensureProxy(): string | null {
  const rt = containerRuntime();
  if (!rt) return 'no container runtime answers; start Docker Desktop';
  const r = spawnSync(rt, ['inspect', '-f', '{{.State.Running}}', PROXY], { encoding: 'utf8', stdio: 'pipe', windowsHide: true });
  if (r.status !== 0) return 'the egress proxy is missing; run troop sandbox build';
  if (r.stdout.trim() === 'true') return null;
  return spawnSync(rt, ['start', PROXY], { stdio: 'pipe', windowsHide: true }).status === 0 ? null : 'the egress proxy did not start; run troop sandbox build';
}

/** Removes a session's container without waiting; a missing container is not an error. */
export function removeContainer(sessionId: string): void {
  try { spawn('docker', ['rm', '-f', containerName(sessionId)], { stdio: 'ignore', windowsHide: true, detached: false }).on('error', () => {}); } catch {}
}
