import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const win = process.platform === 'win32';

function link(dir, project) {
  const target = path.join(dir, '.vercel', 'project.json');
  if (fs.existsSync(target)) return;
  const source = project ? path.join(path.resolve(project), '.vercel', 'project.json') : null;
  if (!source || !fs.existsSync(source)) throw new Error(`link the project first: run \`vercel link\` in ${project ? path.resolve(project) : dir}`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function check(input, project) {
  link(path.resolve(project || input.path), project);
  return { linked: true };
}

function deploy(input, project, prod) {
  const dir = path.resolve(project || '.', input.path);
  link(dir, project);
  const args = ['deploy', '--yes', ...(prod ? ['--prod'] : [])];
  const r = spawnSync('vercel', args, { cwd: dir, encoding: 'utf8', windowsHide: true, shell: win, maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw new Error(`vercel could not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`vercel deploy failed: ${(r.stderr || r.stdout || '').trim().slice(-500)}`);
  const url = r.stdout.replace(/\x1b\[[0-9;]*m/g, '').match(/https?:\/\/\S+/)?.[0];
  if (!url) throw new Error(`vercel did not print a deployment URL: ${r.stdout.trim().slice(0, 200)}`);
  return { url };
}

try {
  const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const action = process.argv[2];
  if (!['check', 'preview', 'production'].includes(action)) throw new Error(`unknown action ${action}`);
  const project = process.env.TROOP_PROJECT_DIR || req.project;
  const outputs = action === 'check' ? check(req.input || {}, project) : deploy(req.input || {}, project, action === 'production');
  process.stdout.write(JSON.stringify({ ok: true, outputs }));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: { message: e instanceof Error ? e.message : String(e), retryable: false } }));
}
