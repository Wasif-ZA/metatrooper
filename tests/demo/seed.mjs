// Builds a demo home: the neutral shop-cart project and engines.json with the demo-fixture engine (M6-16).
// `--demo` calls seedDemo before its core starts and launchDemo once the core answers.
// Usage: node tests/demo/seed.mjs <empty folder>   (or METATROOPER_HOME=<empty folder> node tests/demo/seed.mjs)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadEngines } from '../../core/src/engines/registry.ts';

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
  fs.writeFileSync(engines, JSON.stringify([...loadEngines().filter((e) => e.id !== DEMO_ENGINE), demoEngine], null, 2));

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

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const home = process.argv[2] || process.env.METATROOPER_HOME;
  if (!home) throw new Error('name an empty folder, or set METATROOPER_HOME to one');
  const out = seedDemo(home);
  console.log(`Demo home seeded: ${out.project} and ${out.engines}`);
  console.log('`npm run dev -- --demo` in workbench/ seeds its own temporary home this way and launches the fixture sessions.');
}
