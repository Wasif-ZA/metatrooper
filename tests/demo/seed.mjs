// Builds a demo home under METATROOPER_HOME for the README GIFs: one neutral project and three finished runs.
// Usage: METATROOPER_HOME=<empty folder> node tests/demo/seed.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openCoreDb } from '../../core/src/store/db.ts';
import { syncPipelines } from '../../core/src/pipelines/store.ts';
import { loadEngines, syncEngines } from '../../core/src/engines/registry.ts';
import { canonicalPath, projectId } from '../../core/src/project.ts';
import { nowIso, ulid } from '../../core/src/time.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const home = process.env.METATROOPER_HOME;
if (!home) throw new Error('set METATROOPER_HOME to an empty folder');
if (fs.existsSync(path.join(home, 'troop.db'))) throw new Error(`${home} already has a troop.db; seed an empty folder`);

const slash = (p) => p.replaceAll(path.sep, '/');
const write = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };
const ago = (min) => nowIso(new Date(Date.now() - min * 60_000));

// The project: a small cart library, main has the good code, fix/cart-math brings three planted bugs.
const projDir = path.join(home, 'demo', 'shop-cart');
fs.mkdirSync(projDir, { recursive: true });
const git = (...args) => execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: projDir, stdio: 'pipe' });
const fixture = path.join(repo, 'tests', 'fixtures', 'pr-review-fix');
fs.cpSync(path.join(fixture, 'base'), projDir, { recursive: true });
write(path.join(projDir, 'README.md'), '# shop-cart\n\nCart totals, discounts and paging for a small shop.\n');
git('init', '-q', '-b', 'main');
git('add', '-A');
git('commit', '-q', '-m', 'Cart totals, discounts and paging');
git('checkout', '-q', '-b', 'fix/cart-math');
fs.cpSync(path.join(fixture, 'head'), projDir, { recursive: true });
git('commit', '-q', '-am', 'Rework cart math');
git('checkout', '-q', 'main');

const db = openCoreDb();
syncEngines(db, loadEngines());
syncPipelines(db);
const canon = canonicalPath(projDir);
const pid = projectId(canon);
db.prepare('INSERT INTO project (id, path, name, opened_at, last_opened) VALUES (?, ?, ?, ?, ?)').run(pid, canon, 'shop-cart', ago(240), ago(5));

const insRun = db.prepare(`INSERT INTO run (id, pipeline_id, project_id, inputs, run_dir, status, paused_why, trigger, max_tokens, max_usd, max_minutes, started_at, ended_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', 2000000, 20, 120, ?, ?)`);
const insStep = db.prepare(`INSERT INTO run_step (run_id, step_id, status, engine_id, output_path, outputs, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

/** One run: steps is [step_id, status, engine_id, outputs, files] in pipeline order; files land in the run folder. */
function run(pipelineId, { start, end, status, pausedWhy = null, inputs, steps, files = {} }) {
  const id = ulid(Date.parse(start));
  const dir = path.join(projDir, '.troop', 'runs', id);
  fs.cpSync(path.join(repo, 'pipelines', `${pipelineId}.json`), path.join(dir, 'pipeline.json'));
  for (const [name, text] of Object.entries(files)) write(path.join(dir, name), text);
  insRun.run(id, pipelineId, pid, JSON.stringify(inputs), slash(dir) + '/', status, pausedWhy, start, end);
  const log = [{ at: start, stream: 'runner', event: 'run started', pipeline: pipelineId }];
  const span = (Date.parse(end ?? nowIso()) - Date.parse(start)) / steps.length;
  steps.forEach(([step, st, engine = null, outputs = null], i) => {
    const s = st === 'pending' ? null : nowIso(new Date(Date.parse(start) + i * span));
    const e = st === 'done' ? nowIso(new Date(Date.parse(start) + (i + 1) * span)) : null;
    insStep.run(id, step, st, engine, null, outputs && JSON.stringify(outputs), s, e);
    if (e) log.push({ at: e, stream: 'runner', event: 'step done', step, iteration: 0, index: 0 });
  });
  if (status === 'paused') log.push({ at: nowIso(), stream: 'runner', event: 'run paused', why: pausedWhy });
  if (end) log.push({ at: end, stream: 'runner', event: `run ${status}` });
  write(path.join(dir, 'log.jsonl'), log.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return { id, dir: slash(dir) };
}

const bugs = JSON.parse(fs.readFileSync(path.join(fixture, 'planted.json'), 'utf8')).bugs;
const finding = (b, who) => ({ file: b.file, line_start: b.line_start, line_end: b.line_end, title: b.title, by: who });
const buckets = { both: bugs.map((b) => ({ id: b.id, codex: finding(b, 'codex'), gemini: finding(b, 'gemini') })), codex_only: [], gemini_only: [], disagree: [] };
const prInputs = { range: '', branch: 'fix/cart-math', base_branch: 'main' };

// 1. PR review and fix with proof, finished.
{
  const start = ago(180), end = ago(152);
  const proof = { total: { claimed: true, passed: true, why: null }, discount: { claimed: true, passed: true, why: null }, paginate: { claimed: true, passed: true, why: null } };
  const items = bugs.map((b, i) => ({ n: i + 1, id: b.id, file: b.file, title: b.title, state: 'fixed', proof: b.test ? `test ${b.test}` : 'diff touches the flagged line' }));
  const handback = ['# Hand-back: fix/cart-math', '', 'Both engines found 3 bugs. All 3 were fixed, and each fix carries proof that ran.', '',
    ...items.map((x) => `${x.n}. **${x.title}** (${x.file}). Fixed. Proof: ${x.proof}.`), ''].join('\n');
  run('pr-review-fix', {
    start, end, status: 'done', inputs: prInputs,
    files: { 'buckets.json': JSON.stringify(buckets, null, 2), 'picks.json': JSON.stringify({ pick: bugs.map((b) => b.id) }, null, 2), 'proof.json': JSON.stringify({ results: proof }, null, 2), 'handback.md': handback },
    steps: [
      ['checkout', 'done', null, { base: 'main', head: 'fix/cart-math', range: 'main..fix/cart-math' }],
      ['review', 'done', null, { both: 3, codex_only: 0, gemini_only: 0, disagree: 0, buckets: 'buckets.json' }],
      ['picks', 'done', null, { picks: 3 }],
      ['pick', 'done'],
      ['freeze', 'done', null, { pick: bugs.map((b) => b.id) }],
      ['fix', 'done', 'claude', { fixes: 3 }],
      ['proof', 'done', null, { checked: 3, passed: 3 }],
      ['rereview', 'done', null, { both: 0, codex_only: 0, gemini_only: 0, disagree: 0 }],
      ['handback', 'done', null, { document: 'handback.md', count: 3, fixed: 3, claimed: 0, still_found: 0, not_picked: 0, items }],
    ],
  });
}

// 2. The same review on a newer push, waiting at the pick gate.
{
  const r = run('pr-review-fix', {
    start: ago(25), end: null, status: 'paused', pausedWhy: 'gate', inputs: prInputs,
    files: { 'buckets.json': JSON.stringify(buckets, null, 2), 'picks.json': JSON.stringify({ pick: bugs.map((b) => b.id) }, null, 2) },
    steps: [
      ['checkout', 'done', null, { base: 'main', head: 'fix/cart-math', range: 'main..fix/cart-math' }],
      ['review', 'done', null, { both: 3, codex_only: 0, gemini_only: 0, disagree: 0, buckets: 'buckets.json' }],
      ['picks', 'done', null, { picks: 3 }],
      ['pick', 'waiting'],
      ['freeze', 'pending'], ['fix', 'pending'], ['proof', 'pending'], ['rereview', 'pending'], ['handback', 'pending'],
    ],
  });
  db.prepare(`INSERT INTO gate (id, run_id, step_id, guards_step, kind, summary, status, scan) VALUES (?, ?, 'pick', NULL, 'approve', ?, 'waiting', ?)`)
    .run(ulid(), r.id, '3 findings are ticked, every one both engines agree on. Edit picks.json to tick others by id (see buckets.json), then approve to fix them. Reject to stop.', JSON.stringify({ status: 'clean', count: 0 }));
}

// 3. Spec in, PR out.
{
  const spec = ['# Spec: bulk discount', '', 'Add `bulkDiscount(items, threshold, percent)` to src/discount.js: when the cart holds at least `threshold` items,',
    'take `percent` off the total. Below the threshold the total is unchanged.', '', '## Tests', '', '- 9 items at threshold 10 keep the full price.', '- 10 items at threshold 10 and 5 percent take 5 percent off.', ''].join('\n');
  const diff = ['diff --git a/src/discount.js b/src/discount.js', '--- a/src/discount.js', '+++ b/src/discount.js', '@@ -3,0 +4,5 @@',
    '+', '+export function bulkDiscount(items, threshold, percent) {', '+  const sum = items.reduce((n, i) => n + i.price * i.qty, 0);', '+  const count = items.reduce((n, i) => n + i.qty, 0);', '+  return count >= threshold ? sum * (1 - percent / 100) : sum;', '+}', ''].join('\n');
  run('spec-to-pr', {
    start: ago(120), end: ago(96), status: 'done', inputs: { idea: 'Take a percent off when the cart holds at least N items', repo: 'example/shop-cart', base_branch: 'main' },
    files: { 'spec.md': spec, 'review.diff': diff },
    steps: [
      ['spec', 'done', 'claude', { document: 'spec.md' }],
      ['spec-lint', 'done', null, { summary: 'spec has a goal, tests and no open questions' }],
      ['approve-spec', 'done'],
      ['build', 'done', 'codex', { branch: 'feat/bulk-discount' }],
      ['check-build', 'done', null, { summary: 'build clean' }],
      ['verify', 'done', null, { passed: true, summary: '5 of 5 tests pass' }],
      ['compare-tests', 'done', null, { summary: '2 new tests, none removed' }],
      ['approve-pr', 'done'],
      ['open-pr', 'done', null, { url: 'https://github.com/example/shop-cart/pull/7' }],
    ],
  });
}

// Nothing the window reads may point outside the demo folder.
const homeAbs = slash(path.resolve(home)).toLowerCase();
const paths = [...db.prepare('SELECT path AS p FROM project').all(), ...db.prepare('SELECT run_dir AS p FROM run').all()].map((r) => slash(r.p).toLowerCase());
const runs = db.prepare('SELECT status FROM run WHERE parent_run IS NULL').all();
if (runs.length !== 3 || !paths.every((p) => p.startsWith(homeAbs))) throw new Error(`seed check failed: ${runs.length} runs, paths ${paths.join(', ')}`);
db.close();
console.log(`Demo home ready: ${slash(home)} (${runs.map((r) => r.status).join(', ')})`);
console.log('Open it with METATROOPER_HOME set to that folder and METATROOPER_DEMO=1 to hide meters and usage.');
