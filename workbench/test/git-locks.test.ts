import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitIn, handback } from '../src/handback.ts';
import { gitView, runIn } from '../src/gitpane.ts';
import { refreshRowGit } from '../src/rowgit.ts';

/** A git on PATH that logs GIT_OPTIONAL_LOCKS for each call, then runs the real git. */
function loggingGit(bin: string, log: string): Record<string, string> {
  if (process.platform !== 'win32') {
    const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
    writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "\${GIT_OPTIONAL_LOCKS:-unset}" >> ${log}\nexec ${real} "$@"\n`);
    chmodSync(join(bin, 'git'), 0o755);
    return { PATH: `${bin}:${process.env.PATH}` };
  }
  const real = execFileSync('where', ['git'], { encoding: 'utf8' }).split(/\r?\n/)[0].trim();
  copyFileSync(process.execPath, join(bin, 'git.exe'));
  const stub = join(bin, 'stub.cjs');
  writeFileSync(stub, `const { appendFileSync } = require('node:fs');
const { spawnSync } = require('node:child_process');
appendFileSync(${JSON.stringify(log)}, (process.env.GIT_OPTIONAL_LOCKS ?? 'unset') + String.fromCharCode(10));
const args = [require('node:path').basename(process.argv[1]), ...process.argv.slice(2)];
const r = spawnSync(${JSON.stringify(real)}, args, { stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '' } });
process.exit(r.status ?? 1);
`);
  return { PATH: `${bin};${process.env.PATH}`, NODE_OPTIONS: `--require ${JSON.stringify(stub)}` };
}

test('every workbench git call runs with GIT_OPTIONAL_LOCKS=0, so it never takes index.lock from a concurrent git add', async () => {
  const d = mkdtempSync(join(tmpdir(), 'git-locks-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: d, encoding: 'utf8' });
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  writeFileSync(join(d, 'a.txt'), 'one\n');
  g('add', '.');
  g('commit', '-qm', 'init');
  const bin = mkdtempSync(join(tmpdir(), 'git-locks-bin-'));
  const log = join(bin, 'log');
  let seen: string[] = [];
  let old: Record<string, string | undefined> = {};
  try {
    writeFileSync(log, '');
    const vars = loggingGit(bin, log);
    old = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    Object.assign(process.env, vars);
    await handback(gitIn(d));
    await gitView(runIn(d));
    await refreshRowGit([{ id: 's', cwd: d }]);
  } finally {
    for (const [k, v] of Object.entries(old)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { seen = readFileSync(log, 'utf8').split('\n').filter(Boolean); } catch {}
    for (const dir of [bin, d]) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  assert.ok(seen.length >= 10, `only ${seen.length} git calls were logged`);
  assert.deepEqual([...new Set(seen)], ['0']);
});
