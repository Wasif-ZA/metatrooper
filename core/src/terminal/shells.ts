import fs from 'node:fs';
import path from 'node:path';
import { settings } from '../settings.ts';

/** First existing executable: an absolute path as given, otherwise searched on PATH with PATHEXT. */
export function resolve(cmd: string): string | null {
  if (path.isAbsolute(cmd)) return fs.existsSync(cmd) ? cmd : null;
  const exts = process.platform === 'win32' ? ['', ...(process.env.PATHEXT ?? '.EXE').split(';')] : [''];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    for (const ext of exts) {
      const full = path.join(dir, cmd.toLowerCase().endsWith(ext.toLowerCase()) ? cmd : cmd + ext);
      if (dir && fs.existsSync(full)) return full;
    }
  }
  return null;
}

/** Shell tabs from settings.terminal.shells that exist on this machine, using the fallback command when the first is missing. */
export function availableShells(): Array<{ kind: string; label: string; argv: string[] }> {
  const out = [];
  for (const [kind, s] of Object.entries(settings().terminal.shells)) {
    for (const argv of [s.command, s.fallback]) {
      if (!argv?.length) continue;
      const exe = resolve(argv[0]);
      if (exe) { out.push({ kind, label: s.label, argv: [exe, ...argv.slice(1)] }); break; }
    }
  }
  return out;
}
