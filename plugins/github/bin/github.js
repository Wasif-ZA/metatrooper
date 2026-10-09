import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  if (r.error) throw new Error(`${cmd} could not start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`${cmd} ${args[0]} failed: ${(r.stderr || r.stdout || '').trim().slice(-500)}`);
  return r.stdout;
}

function gh(args, cwd) {
  return run('gh', args, cwd);
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

export function checkState(rows) {
  return rows.some((r) => r.bucket === 'fail' || r.bucket === 'cancel') ? 'failing' : rows.some((r) => r.bucket === 'pending') ? 'pending' : 'passing';
}

function checks(input) {
  const rows = JSON.parse(gh(['pr', 'checks', input.pr, '--repo', input.repo, '--json', 'name,state,bucket,link']) || '[]');
  return { state: checkState(rows), checks: rows };
}

function sinceDate(repo, since, gh_) {
  if (/^\d{4}-\d{2}-\d{2}/.test(since)) return { tag: null, date: since.slice(0, 10) };
  const args = since && since !== 'last tag' ? ['release', 'view', since] : ['release', 'view'];
  try {
    const r = JSON.parse(gh_([...args, '--repo', repo, '--json', 'tagName,publishedAt,createdAt']));
    return { tag: r.tagName, date: (r.publishedAt || r.createdAt || '').slice(0, 10) || null };
  } catch {
    if (!since) return { tag: null, date: null };
    if (since === 'last tag') {
      if (gh_(['api', `repos/${repo}/tags?per_page=1`, '--jq', '.[0].name // empty']).trim()) throw new Error(`${repo} has tags but no release; set Since to a tag or a date`);
      return { tag: null, date: null };
    }
    const date = gh_(['api', `repos/${repo}/commits/${encodeURIComponent(since)}`, '--jq', '.commit.committer.date']).trim().slice(0, 10);
    return { tag: since, date };
  }
}

export function listPrs(input, gh_ = gh) {
  const { tag, date } = sinceDate(input.repo, input.since, gh_);
  const search = date ? ['--search', `merged:>=${date}`] : [];
  const prs = JSON.parse(gh_(['pr', 'list', '--repo', input.repo, '--state', 'merged', '--base', input.base || 'main', ...search,
    '--json', 'number,title,labels,mergedAt,url,author,body', '--limit', String(input.limit ?? 200)]) || '[]');
  return {
    since_tag: tag, since_date: date, count: prs.length,
    prs: prs.map((p) => ({ number: p.number, title: p.title, labels: p.labels.map((l) => l.name), merged_at: p.mergedAt, url: p.url, author: p.author?.login, body: (p.body || '').slice(0, 2000) })),
  };
}

function release(input, project) {
  const cwd = input.path ? path.resolve(project || '.', input.path) : undefined;
  const out = gh(['release', 'create', input.tag, '--repo', input.repo, '--target', input.target, '--title', input.tag, '--notes-file', input.notes], cwd);
  const url = out.trim().split(/\r?\n/).pop();
  if (!/^https?:\/\//.test(url)) throw new Error(`gh did not print a release URL: ${out.trim().slice(0, 200)}`);
  return { url, tag: input.tag };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const action = process.argv[2];
    const project = process.env.TROOP_PROJECT_DIR || req.project;
    const outputs = action === 'create-pr' ? createPr(req.input || {}, project)
      : action === 'checks' ? checks(req.input || {})
      : action === 'list-prs' ? listPrs(req.input || {})
      : action === 'release' ? release(req.input || {}, project)
      : null;
    if (!outputs) throw new Error(`unknown action ${action}`);
    process.stdout.write(JSON.stringify({ ok: true, outputs }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: e instanceof Error ? e.message : String(e), retryable: false } }));
  }
}
