import fs from 'node:fs';
import path from 'node:path';

const BS = String.fromCharCode(92);

function onPath(name: string): string | null {
  const exts = path.extname(name) ? [''] : (process.env.PATHEXT || '.EXE;.CMD;.BAT').split(';').map((e) => e.toLowerCase());
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    }
  }
  return null;
}

/** Turns a command name into argv that can be spawned without a shell: npm .cmd shims are unwrapped to their target. */
export function resolveCommand(name: string): string[] | null {
  const explicit = path.isAbsolute(name) || name.includes('/') || name.includes(BS);
  const found = explicit ? (fs.existsSync(name) && fs.statSync(name).isFile() ? name : null) : onPath(name);
  if (!found) return null;
  if (!/\.(cmd|bat)$/i.test(found)) return [found];
  const text = fs.readFileSync(found, 'utf8');
  const targets = [...text.matchAll(/"%dp0%\\([^"]+\.(?:js|cjs|mjs|exe))"/gi)]
    .map((m) => m[1])
    .filter((t) => !/(^|\\)node\.exe$/i.test(t));
  if (targets.length === 0) return null;
  const target = path.join(path.dirname(found), targets[targets.length - 1].split(BS).join(path.sep));
  return /\.exe$/i.test(target) ? [target] : [process.execPath, target];
}
