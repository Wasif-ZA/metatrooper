import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const win = process.platform === 'win32';

function reply(obj) {
  process.stdout.write(JSON.stringify(obj));
}

function fail(message) {
  reply({ ok: false, error: { message, retryable: false } });
}

function readStdin() {
  const text = fs.readFileSync(0, 'utf8');
  return text ? JSON.parse(text) : {};
}

function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || '').trim()}`);
  return r.stdout;
}

export function detect(dir) {
  const has = (f) => fs.existsSync(path.join(dir, f));
  if (has('package.json')) {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    if (pkg.scripts && pkg.scripts.test && !/no test specified/.test(pkg.scripts.test)) {
      const pm = has('pnpm-lock.yaml') ? 'pnpm' : has('yarn.lock') ? 'yarn' : 'npm';
      return { runner: pm, command: [pm, 'test'] };
    }
  }
  const pyTests = has('tests') && fs.readdirSync(path.join(dir, 'tests')).some((f) => f.endsWith('.py'));
  if (has('pyproject.toml') || has('pytest.ini') || has('setup.cfg') || pyTests) {
    if (has('uv.lock')) return { runner: 'pytest', command: ['uv', 'run', 'pytest'] };
    return { runner: 'pytest', command: win ? ['py', '-m', 'pytest'] : ['python3', '-m', 'pytest'] };
  }
  if (has('Cargo.toml')) return { runner: 'cargo', command: ['cargo', 'test'] };
  if (has('go.mod')) return { runner: 'go', command: ['go', 'test', './...'] };
  return { runner: 'none', command: [] };
}

/** Failing test names from node:test TAP, vitest, jest or pytest output; "unknown" for any other runner. */
export function failingTests(output) {
  const lines = output.split(/\r?\n/);
  const names = new Set();
  const tap = /^TAP version|^\s*(not )?ok \d+ - /m.test(output);
  const jest = /^\s*(Tests:|Test Files\s)/m.test(output);
  const pytest = /=+ test session starts =+/.test(output);
  if (!tap && !jest && !pytest) return 'unknown';
  for (const line of lines) {
    let m;
    if (tap && !/#\s*(TODO|SKIP)\b/i.test(line) && (m = /^\s*not ok \d+ - (.+?)(\s+#.*)?$/.exec(line))) names.add(m[1].trim());
    if (jest && (m = /^\s*(?:FAIL\s+(\S.*?)|[✕×]\s+(.+?))(\s+\(\d+(?:\.\d+)? ?m?s\))?$/.exec(line))) names.add((m[1] || m[2]).trim());
    if (pytest && (m = /^FAILED\s+(\S+)/.exec(line))) names.add(m[1].trim());
  }
  return [...names];
}

function runTests(dir, command) {
  const q = (a) => (/[\s"&|<>^()]/.test(a) ? `"${a}"` : a);
  const argv = win ? [process.env.COMSPEC || 'cmd.exe', '/d', '/s', '/c', `"${command.map(q).join(' ')}"`] : command;
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: dir, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: win, maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  process.stderr.write(output.slice(-20000));
  return { passed: r.status === 0, exit_code: r.status ?? -1, output_tail: output.split(/\r?\n/).slice(-50).join('\n'), failing: failingTests(output) };
}

function diff(dir, base, runDir) {
  const stat = git(dir, ['diff', '--stat', base]).trim();
  const files = git(dir, ['diff', '--name-only', base]).split(/\r?\n/).filter(Boolean);
  const untracked = git(dir, ['ls-files', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean);
  const patch = git(dir, ['diff', '--binary', base]);
  const file = path.join(runDir, `diff-${Date.now()}.patch`);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(file, patch);
  return { stat, files, untracked, patch_path: file.split(String.fromCharCode(92)).join('/') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) try {
  const req = readStdin();
  const input = req.input || {};
  const dir = path.resolve(process.env.TROOP_PROJECT_DIR || req.project || '.', input.path || '.');
  const action = process.argv[2];
  if (action === 'detect-tests') reply({ ok: true, outputs: detect(dir) });
  else if (action === 'run-tests') {
    const command = Array.isArray(input.command) && input.command.length ? input.command : detect(dir).command;
    if (!command.length) reply({ ok: true, outputs: { passed: false, exit_code: -1, runner: 'none', output_tail: `no test runner found in ${dir}`, failing: 'unknown' } });
    else reply({ ok: true, outputs: runTests(dir, command) });
  } else if (action === 'diff') reply({ ok: true, outputs: diff(dir, input.base || 'HEAD', process.env.TROOP_RUN_DIR || dir) });
  else fail(`unknown action ${action}`);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
