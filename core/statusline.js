// Saves the statusline input's rate_limits to <METATROOPER_HOME>/claude-limits.json and the session's context fill to
// <METATROOPER_HOME>/claude-context/<session_id>.json, then runs the given command (or, with --user-statusline, the
// user's own statusLine command from Claude's settings) on the same input.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const input = fs.readFileSync(0);
const home = process.env.METATROOPER_HOME || path.join(os.homedir(), '.metatrooper');

function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(value));
  fs.renameSync(`${file}.tmp`, file);
}

try {
  const d = JSON.parse(input.toString('utf8'));
  // A session's first ticks come before any API reply and carry no rate_limits; keep the last good reading.
  if (d.rate_limits) save(path.join(home, 'claude-limits.json'), { at: new Date().toISOString(), rate_limits: d.rate_limits, keys: Object.keys(d) });
  const pct = d.context_window?.used_percentage;
  if (typeof pct === 'number' && typeof d.session_id === 'string' && /^[A-Za-z0-9_-]+$/.test(d.session_id)) {
    save(path.join(home, 'claude-context', `${d.session_id}.json`), { at: new Date().toISOString(), used_percentage: pct });
  }
} catch {}

const args = process.argv.slice(2);
const next = args[0] === '--user-statusline' ? userStatusLine() : args.join(' ');
if (next) {
  const r = spawnSync(next, { input, shell: true, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
  process.exitCode = r.status ?? 0;
} else {
  process.stdout.write(ownLine());
}

function userStatusLine() {
  try {
    const file = process.env.METATROOPER_CLAUDE_SETTINGS || path.join(os.homedir(), '.claude', 'settings.json');
    const cmd = JSON.parse(fs.readFileSync(file, 'utf8')).statusLine?.command;
    return typeof cmd === 'string' && !cmd.includes('statusline.js') ? cmd : '';
  } catch {
    return '';
  }
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
