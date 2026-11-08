import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BS = String.fromCharCode(92);

function findCoreDir(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  while (path.basename(dir) !== 'core' && path.dirname(dir) !== dir) dir = path.dirname(dir);
  return dir;
}

export const coreDir = findCoreDir();
export const repoDir = path.resolve(coreDir, '..');
export const schemaFile = path.join(repoDir, 'contracts', 'schema.sql');

export function homeDir(): string {
  return process.env.METATROOPER_HOME || path.join(os.homedir(), '.metatrooper');
}

// Home that engine session logs (~/.codex, ~/.claude) are read from: the instance home when isolated, else the real home.
export function engineHome(): string {
  return process.env.METATROOPER_HOME ? homeDir() : os.homedir();
}

export function dbFile(): string {
  return path.join(homeDir(), 'troop.db');
}

export function uiKeyFile(): string {
  return path.join(homeDir(), 'ui.key');
}

export function logsDir(): string {
  return path.join(homeDir(), 'logs');
}

export function pipePrefix(): string {
  return process.env.METATROOPER_PIPE_PREFIX || 'metatrooper';
}

/** `p` with links resolved through its deepest existing folder, lowercased on Windows. */
function canonical(p: string): string {
  let dir = path.resolve(p);
  const tail: string[] = [];
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) { tail.unshift(path.basename(dir)); dir = path.dirname(dir); }
  try { dir = fs.realpathSync.native(dir); } catch {}
  const out = path.join(dir, ...tail);
  return process.platform === 'win32' ? out.toLowerCase() : out;
}

/** Why a demo with this home and pipe prefix could touch the real data folder or pipes, or null (M6-16). */
export function demoProblem(home: string | undefined, prefix: string | undefined, realHome = path.join(os.homedir(), '.metatrooper')): string | null {
  if (!home || !prefix) return 'demo needs METATROOPER_HOME and METATROOPER_PIPE_PREFIX set to its own folder and prefix';
  const rel = path.relative(canonical(realHome), canonical(home));
  const inside = rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
  return inside || prefix.toLowerCase() === 'metatrooper' ? 'demo would use the real data folder' : null;
}

/** Windows named pipe; on other hosts an absolute unix socket file (the code stays portable). */
export function corePipe(): string {
  if (process.platform !== 'win32') return path.join(os.tmpdir(), `${pipePrefix()}.sock`);
  return BS + BS + '.' + BS + 'pipe' + BS + pipePrefix();
}

/** Windows named pipe; on other hosts an absolute socket file, since agents run from other folders. */
export function browserPipe(): string {
  if (process.platform !== 'win32') return path.join(os.tmpdir(), `${pipePrefix()}-browser.sock`);
  return BS + BS + '.' + BS + 'pipe' + BS + pipePrefix() + '-browser';
}

export function claudeSettingsFile(): string {
  return process.env.METATROOPER_CLAUDE_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
}

export function codexConfigFile(): string {
  return process.env.METATROOPER_CODEX_CONFIG || path.join(os.homedir(), '.codex', 'config.toml');
}

export function hooksStateFile(): string {
  return path.join(homeDir(), 'hooks-install.json');
}

/** Windows named pipe for terminal bytes; on other hosts an absolute socket file. */
export function termPipe(): string {
  if (process.platform !== 'win32') return path.join(os.tmpdir(), `${pipePrefix()}-term.sock`);
  return BS + BS + '.' + BS + 'pipe' + BS + pipePrefix() + '-term';
}
