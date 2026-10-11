#!/usr/bin/env node
// Runs the metarouter copy beside this file with the first Python 3.11+ found, else an installed `metarouter`.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const routerDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIN = 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)';

function candidates(env) {
  if (env.TROOP_PYTHON) return [[env.TROOP_PYTHON]];
  return process.platform === 'win32' ? [['py', '-3'], ['python'], ['python3']] : [['python3'], ['python']];
}

export function findPython(env = process.env) {
  for (const c of candidates(env)) {
    const r = spawnSync(c[0], [...c.slice(1), '-c', MIN], { stdio: 'ignore', timeout: 10_000, windowsHide: true });
    if (r.status === 0) return c;
  }
  return null;
}

export function command(args, env = process.env) {
  const py = findPython(env);
  if (py) {
    const sep = process.platform === 'win32' ? ';' : ':';
    const pythonPath = env.PYTHONPATH ? `${routerDir}${sep}${env.PYTHONPATH}` : routerDir;
    return { argv: [...py, '-m', 'metarouter', ...args], env: { ...env, PYTHONPATH: pythonPath, PYTHONUTF8: '1' } };
  }
  return { argv: ['metarouter', ...args], env };
}

export function run(args, opts = {}) {
  const env = opts.env ?? process.env;
  const c = command(args, env);
  const r = spawnSync(c.argv[0], c.argv.slice(1), { env: c.env, stdio: opts.stdio ?? 'inherit', input: opts.input, encoding: opts.encoding, windowsHide: true });
  if (r.error?.code === 'ENOENT') {
    if ((opts.stdio ?? 'inherit') === 'inherit') console.error('metarouter needs Python 3.11 or later. Install it, or set TROOP_PYTHON to its path.');
    return { ...r, status: 127 };
  }
  return r;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = run(process.argv.slice(2)).status ?? 1;
}
