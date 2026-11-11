// Builds a demo home: the neutral shop-cart project and engines.json with the demo-fixture engine (M6-16).
// `--demo` calls seedDemo before its core starts and launchDemo once the core answers.
// Usage: node tests/demo/seed.mjs <empty folder>   (or METATROOPER_HOME=<empty folder> node tests/demo/seed.mjs)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { shippedEngines } from '../../core/src/engines/registry.ts';
import { cronNext, nowIso } from '../../core/src/time.ts';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEMO_ENGINE = 'demo-fixture';
export const DEMO_ROLES = ['preview', 'asker'];

const slash = (p) => path.resolve(p).replaceAll(path.sep, '/').toLowerCase();

/** Makes `<home>/demo/shop-cart` (main has the good code, fix/cart-math three planted bugs) and `<home>/engines.json`; writes nothing else. */
export function seedDemo(home) {
  if (fs.existsSync(path.join(home, 'troop.db'))) throw new Error(`${home} already has a troop.db; seed an empty folder`);
  const projDir = path.join(home, 'demo', 'shop-cart');
  fs.mkdirSync(projDir, { recursive: true });
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: projDir, stdio: 'pipe' });
  const fixture = path.join(repo, 'tests', 'fixtures', 'pr-review-fix');
  fs.cpSync(path.join(fixture, 'base'), projDir, { recursive: true });
  fs.writeFileSync(path.join(projDir, 'README.md'), '# shop-cart\n\nCart totals, discounts and paging for a small shop.\n');
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Cart totals, discounts and paging');
  git('checkout', '-q', '-b', 'fix/cart-math');
  fs.cpSync(path.join(fixture, 'head'), projDir, { recursive: true });
  git('commit', '-q', '-am', 'Rework cart math');
  git('checkout', '-q', 'main');

  const engines = path.join(home, 'engines.json');
  const demoEngine = {
    id: DEMO_ENGINE, command: 'node', args: [path.join(repo, 'tests', 'fixtures', 'demo-session.mjs')], prompt_arg: 'positional',
    version_cmd: ['node', '--version'], state_source: 'process', roles: [], cost_rank: 9,
  };
  fs.writeFileSync(engines, JSON.stringify([...shippedEngines().filter((e) => e.id !== DEMO_ENGINE), demoEngine], null, 2));

  // Nothing the demo stores may point outside the demo folder.
  const homeAbs = slash(home) + '/';
  for (const p of [projDir, engines]) if (!slash(p).startsWith(homeAbs)) throw new Error(`seed check failed: ${p} is outside ${home}`);
  return { project: projDir, engines };
}

/** Once the core answers: opens the project and launches one demo-fixture session per role; `request(method, params)` resolves to the result or throws. */
export async function launchDemo(request, project, roles = DEMO_ROLES) {
  const { project_id } = await request('project.open', { path: project });
  const sessions = {};
  for (const role of roles) sessions[role] = (await request('session.launch', { project_id, engine_id: DEMO_ENGINE, prompt: role })).session_id;
  return { project_id, sessions };
}

/** After launchDemo: a second project and the seeded rows the Home screen and sidebar draw (seedFixtures). */
export async function seedRows(request, project) {
  const { project_id } = await request('project.open', { path: project });
  const home = path.resolve(project, '..', '..');
  const api = path.join(home, 'demo', 'api-server');
  // api-server ships its own favicon (the sidebar shows it); shop-cart has none, so it shows its monogram.
  gitRepo(api, {
    'README.md': '# api-server\n\nOrders and payments API.\n',
    'public/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#2563eb"/><path d="M12 8.5c-3 0-3.5 1.75-3.5 4s-.75 3.5-2.5 3.5c1.75 0 2.5 1.25 2.5 3.5s.5 4 3.5 4M20 8.5c3 0 3.5 1.75 3.5 4s.75 3.5 2.5 3.5c-1.75 0-2.5 1.25-2.5 3.5s-.5 4-3.5 4" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>\n',
  });
  const { project_id: api_id } = await request('project.open', { path: api });
  await request('project.open', { path: project });
  seedFixtures(home, { shop: { id: project_id, path: project }, api: { id: api_id, path: api } });
}

function gitRepo(dir, files) {
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, stdio: 'pipe' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('commit', '-q', '-m', 'Start');
}

/** Rows the Home screen and sidebar tree draw: mixed-engine agents with sub-agents, steps, a PR, issues and three automations; tables a newer migration adds are filled only when present. */
export function seedFixtures(home, { shop, api }) {
  const fix = path.join(home, 'demo', 'shop-cart-fix');
  execFileSync('git', ['worktree', 'add', '-q', fix, 'fix/cart-math'], { cwd: shop.path, stdio: 'pipe' });
  // A real uncommitted diff of +48 -12 in the PR worktree, so its Changes count is true.
  const gitFix = (...args) => execFileSync('git', ['-c', 'user.name=Demo', '-c', 'user.email=demo@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: fix, stdio: 'pipe' });
  const steps = (n, word) => Array.from({ length: n }, (_, i) => `export const ${word}${i + 1} = (cart) => cart;`).join('\n') + '\n';
  fs.writeFileSync(path.join(fix, 'src', 'checkout.js'), steps(12, 'oldStep'));
  gitFix('add', 'src/checkout.js');
  gitFix('commit', '-q', '-m', 'Checkout as one flow');
  fs.writeFileSync(path.join(fix, 'src', 'checkout.js'), steps(48, 'step'));
  fs.writeFileSync(path.join(home, 'demo', 'github.json'), JSON.stringify({
    prs: { 'fix/cart-math': { number: 12, state: 'OPEN', url: 'https://example.invalid/shop-cart/pull/12', checks: 'pass' } },
    issues: {
      'shop-cart': [
        { number: 31, title: 'Discount rounds the wrong way on 3-for-2', labels: ['bug'], assignees: [], url: 'https://example.invalid/shop-cart/issues/31' },
        { number: 29, title: 'Pager skips the last page', labels: ['bug', 'cart'], assignees: ['demo'], url: 'https://example.invalid/shop-cart/issues/29' },
        { number: 24, title: 'Show savings on the cart summary', labels: ['feature'], assignees: [], url: 'https://example.invalid/shop-cart/issues/24' },
      ],
      'api-server': [{ number: 7, title: 'Rate limit the orders endpoint', labels: ['feature'], assignees: [], url: 'https://example.invalid/api-server/issues/7' }],
    },
  }, null, 2));

  const db = new DatabaseSync(path.join(home, 'troop.db'));
  db.exec('PRAGMA busy_timeout = 5000');
  const has = (table, col) => col
    ? db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col)
    : Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
  const engines = new Set(db.prepare('SELECT id FROM engine').all().map((r) => r.id));
  const eng = (id) => (engines.has(id) ? id : DEMO_ENGINE);
  const ago = (min) => new Date(Date.now() - min * 60_000).toISOString();
  const later = (min) => new Date(Date.now() + min * 60_000).toISOString();
  const add = db.prepare(`INSERT INTO session (id, project_id, engine_id, host, state, state_at, cwd, parent_id, started_at, ended_at, outcome, prompt, wait_reason, last_line)
    VALUES (?, ?, ?, 'external', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const usage = db.prepare("INSERT INTO usage (at, session_id, engine_id, provider, model, source, dedupe_key) VALUES (?, ?, ?, 'local-cli', ?, 'unknown', ?)");
  const rows = [
    ['demo-checkout', shop, 'claude', 'working', 12, fix, null, null, 'Split checkout into steps', null, 'opus-5.5', 'Split the address and payment steps; waiting on the pager preview and the cart total tests before wiring them together.'],
    ['demo-tests', shop, 'claude', 'working', 4, fix, 'demo-checkout', null, 'Write cart total tests', null, 'sonnet-5.5', 'Running npm test -- cart/totals'],
    ['demo-rounding', shop, 'codex', 'exited', 9, fix, 'demo-checkout', 'succeeded', 'Check discount rounding', null, 'gpt-5.4', 'Done: rounding fixed in discount.js, 3-for-2 now rounds half up.'],
    ['demo-pager', shop, 'agy', 'waiting_for_you', 3, fix, 'demo-checkout', null, 'Preview the pager fix', 'permission', 'flash-3.8', 'Asked for permission to start the dev server on port 5173.'],
    ['demo-limits', api, 'codex', 'working', 20, api.path, null, null, 'Add rate limits to orders', null, 'gpt-5.4', 'Adding a token bucket to POST /orders; 429 test written, implementation next.'],
    ['demo-docs', api, 'claude', 'exited', 60, api.path, null, 'succeeded', 'Update the API docs', null, 'haiku-5.5', 'Done: README and OpenAPI file list the new orders fields.'],
  ];
  for (const [id, p, engine, state, min, cwd, parent, outcome, prompt, reason, model, line] of rows) {
    add.run(id, p.id, eng(engine), state, ago(state === 'exited' ? Math.max(1, min - 7) : min), cwd, parent, ago(min), state === 'exited' ? ago(Math.max(1, min - 7)) : null, outcome, prompt, reason, line);
    usage.run(ago(min), id, eng(engine), model, `demo:${id}`);
  }
  if (has('session_label')) for (const [id, name] of [['demo-checkout', 'checkout'], ['demo-pager', 'cart']]) db.prepare('INSERT OR IGNORE INTO session_label (session_id, name) VALUES (?, ?)').run(id, name);
  if (has('session_step')) {
    const step = db.prepare('INSERT OR REPLACE INTO session_step (session_id, idx, text, done) VALUES (?, ?, ?, ?)');
    ['Read the checkout flow', 'List the steps', 'Split the address step', 'Split the payment step', 'Move validation', 'Update the tests', 'Run the suite', 'Write the summary']
      .forEach((t, i) => step.run('demo-checkout', i, t, i < 2 ? 1 : 0));
    ['Find the orders route', 'Add a token bucket', 'Return 429 with Retry-After', 'Test the limit'].forEach((t, i) => step.run('demo-limits', i, t, i < 1 ? 1 : 0));
  }

  const autos = [
    ['demo-auto-triage', shop, 'Nightly triage', '\u{1F319}', '0 2 * * *', 1440, 1, ['triage'], 'Read new GitHub issues, label them, and draft a fix for anything marked easy.'],
    ['demo-auto-tests', shop, 'Test sweep', '\u{1F9EA}', '0 10 * * 1-5', 1440, 1, ['tests'], 'Run the full test suite and fix what fails, one cause per branch.'],
    ['demo-auto-deps', api, 'Dependency check', '\u{1F4E6}', '0 9 * * 1', 10080, 0, ['deps', 'triage'], 'Check for outdated or vulnerable packages and open a branch with safe upgrades.'],
  ];
  const extra = ['icon', 'cron'].filter((c) => has('automation', c));
  const auto = db.prepare(`INSERT INTO automation (id, project_id, name, every_min, runner, script, script_sha256, engine_id, prompt, enabled, next_due, created_at${extra.map((c) => `, ${c}`).join('')})
    VALUES (?, ?, ?, ?, '["bash"]', '', '', ?, ?, ?, ?, ?${extra.map(() => ', ?').join('')})`);
  for (const [id, p, name, icon, cron, every, enabled, labels, prompt] of autos) {
    auto.run(id, p.id, name, every, eng('claude'), prompt, enabled, nowIso(cronNext(cron, new Date()) ?? new Date(Date.now() + every * 60_000)), ago(1440), ...extra.map((c) => (c === 'icon' ? icon : cron)));
    if (has('automation_label')) for (const n of labels) db.prepare('INSERT OR IGNORE INTO automation_label (automation_id, name) VALUES (?, ?)').run(id, n);
  }
  const limit = db.prepare("INSERT OR REPLACE INTO limit_reading (provider, account, window, used_pct, resets_at, read_at, status) VALUES (?, 'demo', ?, ?, ?, ?, 'ok')");
  limit.run('agy', 'daily', 24, later(4560), ago(1));
  // The core rewrites claude and codex readings from these files each poll (core/src/limits.ts), so seed the sources.
  const epoch = (min) => Math.round(Date.now() / 1000 + min * 60);
  fs.writeFileSync(path.join(home, 'claude-limits.json'), JSON.stringify({ at: ago(1), rate_limits: { five_hour: { used_percentage: 42, resets_at: epoch(168) }, seven_day: { used_percentage: 59, resets_at: epoch(6120) } } }));
  const day = new Date();
  const sessions = path.join(home, '.codex', 'sessions', String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, '0'), String(day.getDate()).padStart(2, '0'));
  fs.mkdirSync(sessions, { recursive: true });
  fs.writeFileSync(path.join(sessions, 'demo-limits.jsonl'), JSON.stringify({ timestamp: ago(1), payload: { type: 'token_count', rate_limits: { plan_type: 'plus', primary: { used_percent: 48, window_minutes: 300, resets_at: epoch(192) }, secondary: { used_percent: 63, window_minutes: 10080, resets_at: epoch(2280) } } } }) + '\n');
  if (has('label')) for (const [name, colour] of [['triage', '#8A63D2'], ['tests', '#2F9E6E'], ['deps', '#D4A017'], ['checkout', '#3B7BE8'], ['cart', '#E8743B']]) db.prepare('INSERT OR IGNORE INTO label (name, colour) VALUES (?, ?)').run(name, colour);
  db.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const home = process.argv[2] || process.env.METATROOPER_HOME;
  if (!home) throw new Error('name an empty folder, or set METATROOPER_HOME to one');
  const out = seedDemo(home);
  console.log(`Demo home seeded: ${out.project} and ${out.engines}`);
  console.log('`npm run dev -- --demo` in workbench/ seeds its own temporary home this way and launches the fixture sessions.');
}
