import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const win = process.platform === 'win32';

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, shell: win && cmd === 'gh', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw new Error(`${cmd} could not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed: ${(r.stderr || r.stdout || '').trim().slice(0, 500)}`);
  return r.stdout;
}

function quote(a) {
  return win && /[\s"&|<>^]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

function gh(args, cwd) {
  return run('gh', win ? args.map(quote) : args, cwd);
}

function createPr(input, project) {
  const dir = path.resolve(project || '.', input.path);
  run('git', ['-C', dir, 'push', '-u', 'origin', input.branch], dir);
  const bodyFile = path.join(process.env.TROOP_RUN_DIR || dir, `pr-body-${Date.now()}.md`);
  fs.writeFileSync(bodyFile, input.body);
  const out = gh(['pr', 'create', '--repo', input.repo, '--head', input.branch, '--base', input.base, '--title', input.title, '--body-file', bodyFile], dir);
  const url = out.trim().split(/\r?\n/).pop();
  if (!/^https?:\/\//.test(url)) throw new Error(`gh did not print a pull request URL: ${out.trim().slice(0, 200)}`);
  return { url };
}

function checks(input) {
  const rows = JSON.parse(gh(['pr', 'checks', input.pr, '--repo', input.repo, '--json', 'name,state,link']) || '[]');
  const state = rows.some((r) => r.state === 'FAILURE') ? 'failing' : rows.every((r) => r.state === 'SUCCESS') ? 'passing' : 'pending';
  return { state, checks: rows };
}

try {
  const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  const action = process.argv[2];
  const outputs = action === 'create-pr' ? createPr(req.input || {}, process.env.TROOP_PROJECT_DIR || req.project)
    : action === 'checks' ? checks(req.input || {})
    : null;
  if (!outputs) throw new Error(`unknown action ${action}`);
  process.stdout.write(JSON.stringify({ ok: true, outputs }));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: { message: e instanceof Error ? e.message : String(e), retryable: false } }));
}
