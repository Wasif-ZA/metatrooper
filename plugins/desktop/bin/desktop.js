import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./desktop.ps1', import.meta.url));

try {
  const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, process.argv[2] ?? ''], {
    encoding: 'utf8', windowsHide: true, env: { ...process.env, TROOP_DESKTOP_INPUT: JSON.stringify(req.input || {}) },
  });
  if (r.error) throw r.error;
  const line = r.stdout.trim().split(/\r?\n/).pop() || '';
  if (!line.startsWith('{')) throw new Error(`powershell printed no result: ${(r.stderr || r.stdout).trim().slice(-400)}`);
  process.stdout.write(line);
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: { message: e instanceof Error ? e.message : String(e), retryable: false } }));
}
