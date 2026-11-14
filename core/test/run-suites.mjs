// Runs the core tests in two passes: everything else in parallel, then the spec latency checks one file at a time,
// so a "within N" budget is measured on a machine that is not also running a dozen other test files.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// Each entry: a test file and the start of the test names in it that check a spec latency budget.
const TIMING = [
  ['test/core.test.ts', 'each Claude hook has a median under 250 ms over ten runs'],
  ['test/core.test.ts', 'M1-08 queued commands run in the order they were queued'],
  ['test/m6-03-ports.test.ts', 'M6-03a a dev server in the session terminal gets an ancestry row within 2 s'],
  ['test/m6-05-hook-state.test.ts', 'M6-05a a Codex session with -c hooks shows waiting_for_you within 2 s'],
  ['test/m6-06-restart.test.ts', 'M6-06a killing the core brings 4 live sessions back within 30 s'],
  ['test/m6-17-public-api.test.ts', 'session.wait over real pipe returns within 1 s of state change'],
  ['test/m6-17-public-api.test.ts', 'session.wait already in target state returns in under 300 ms'],
  ['test/m6-19-search.test.ts', 'M6-19a a unique marker printed in one of 4 terminals is found case insensitively within 1 s'],
  ['test/m6-22-watcher.test.ts', 'M6-22a on this desktop: SendKeys from another program raises one item within 1 s'],
];

for (const [file, name] of TIMING) {
  if (!readFileSync(new URL(`../${file}`, import.meta.url), 'utf8').includes(`test('${name}`)) throw new Error(`timing test not found, so it would silently not run: ${file}: ${name}`);
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = `^(${TIMING.map(([, name]) => escape(name)).join('|')})`;
const files = [...new Set(TIMING.map(([file]) => file))];
const run = (args) => spawnSync(process.execPath, ['--import=./test/clean-env.mjs', '--test', '--test-timeout=120000', ...args], { stdio: 'inherit' }).status ?? 1;

const parallel = () => run([`--test-skip-pattern=${pattern}`, 'test/*.test.ts']);
const timing = () => run(['--test-concurrency=1', `--test-name-pattern=${pattern}`, ...files]);

const mode = process.argv[2] ?? 'all';
const codes = mode === 'parallel' ? [parallel()] : mode === 'timing' ? [timing()] : [parallel(), timing()];
process.exit(codes.some((c) => c !== 0) ? 1 : 0);
