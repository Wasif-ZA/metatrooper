// Saves the statusline input's rate_limits to <METATROOPER_HOME>/claude-limits.json, then runs the given command on the same input.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const input = fs.readFileSync(0);
try {
  const d = JSON.parse(input.toString('utf8'));
  const home = process.env.METATROOPER_HOME || path.join(os.homedir(), '.metatrooper');
  fs.mkdirSync(home, { recursive: true });
  const out = { at: new Date().toISOString(), rate_limits: d.rate_limits ?? null, keys: Object.keys(d) };
  fs.writeFileSync(path.join(home, 'claude-limits.json.tmp'), JSON.stringify(out));
  fs.renameSync(path.join(home, 'claude-limits.json.tmp'), path.join(home, 'claude-limits.json'));
} catch {}
const next = process.argv.slice(2).join(' ');
if (next) {
  const r = spawnSync(next, { input, shell: true, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
  process.exitCode = r.status ?? 0;
} else {
  process.stdout.write(ownLine());
}

function ownLine() {
  let d = {};
  try { d = JSON.parse(input.toString('utf8')); } catch {}
  const parts = [];
  if (d.model?.display_name) parts.push(d.model.display_name);
  const dir = d.workspace?.current_dir || d.cwd;
  if (dir) parts.push(path.basename(dir));
  if (dir) {
    const b = spawnSync('git', ['-C', dir, 'branch', '--show-current'], { encoding: 'utf8', windowsHide: true });
    if (b.status === 0 && b.stdout.trim()) parts.push(b.stdout.trim());
  }
  const ctx = d.context_window?.used_percentage;
  if (typeof ctx === 'number') parts.push(`ctx ${Math.round(ctx)}%`);
  const rl = d.rate_limits;
  if (rl?.five_hour) parts.push(`5h ${Math.round(rl.five_hour.used_percentage)}%`);
  if (rl?.seven_day) parts.push(`7d ${Math.round(rl.seven_day.used_percentage)}%`);
  return parts.join(' | ');
}
