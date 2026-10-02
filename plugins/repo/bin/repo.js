import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
  if (has('pyproject.toml') || has('pytest.ini') || has('setup.cfg') || has('tests')) {
    if (has('uv.lock')) return { runner: 'pytest', command: ['uv', 'run', 'pytest'] };
    if (has('pyproject.toml') || has('pytest.ini')) return { runner: 'pytest', command: ['python', '-m', 'pytest'] };
  }
  if (has('Cargo.toml')) return { runner: 'cargo', command: ['cargo', 'test'] };
  if (has('go.mod')) return { runner: 'go', command: ['go', 'test', './...'] };
  return { runner: 'none', command: [] };
}

function runTests(dir, command) {
  const q = (a) => (/[\s"&|<>^()]/.test(a) ? `"${a}"` : a);
  const argv = win ? [process.env.COMSPEC || 'cmd.exe', '/d', '/s', '/c', `"${command.map(q).join(' ')}"`] : command;
  const r = spawnSync(argv[0], argv.slice(1), {
    cwd: dir, encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: win, maxBuffer: 64 * 1024 * 1024,
  });
  const output = `${r.stdout || ''}${r.stderr || ''}`;
  process.stderr.write(output.slice(-20000));
  return { passed: r.status === 0, exit_code: r.status ?? -1, output_tail: output.split(/\r?\n/).slice(-50).join('\n') };
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

try {
  const req = readStdin();
  const input = req.input || {};
  const dir = path.resolve(process.env.TROOP_PROJECT_DIR || req.project || '.', input.path || '.');
  const action = process.argv[2];
  if (action === 'detect-tests') reply({ ok: true, outputs: detect(dir) });
  else if (action === 'run-tests') {
    const command = Array.isArray(input.command) && input.command.length ? input.command : detect(dir).command;
    if (!command.length) fail(`no test runner found in ${dir}`);
    else reply({ ok: true, outputs: runTests(dir, command) });
  } else if (action === 'diff') reply({ ok: true, outputs: diff(dir, input.base || 'HEAD', process.env.TROOP_RUN_DIR || dir) });
  else fail(`unknown action ${action}`);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
