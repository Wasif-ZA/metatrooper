import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handback, gitIn } from '../src/handback.ts';

const here = dirname(fileURLToPath(import.meta.url));

function repo() {
  const d = mkdtempSync(join(tmpdir(), 'hb-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: d, encoding: 'utf8' });
  g('init', '-q');
  g('config', 'user.email', 't@t');
  g('config', 'user.name', 't');
  writeFileSync(join(d, 'a.txt'), 'one\n');
  g('add', 'a.txt');
  g('commit', '-qm', 'init');
  return { d, g };
}

test('M1-27 tray lists staged stat, binary by name, untracked separately', () => {
  const { d, g } = repo();
  writeFileSync(join(d, 'a.txt'), 'one\ntwo\n');
  writeFileSync(join(d, 'b.bin'), Buffer.from([0, 1, 2, 0, 3]));
  writeFileSync(join(d, 'new.txt'), 'x');
  g('add', 'a.txt', 'b.bin');
  const h = handback(gitIn(d));
  assert.match(h.stat, /a\.txt/);
  assert.equal(h.files.find((f) => f.path === 'b.bin')?.kind, 'binary');
  assert.equal(h.files.find((f) => f.path === 'a.txt')?.added, 1);
  assert.deepEqual(h.untracked, ['new.txt']);
  assert.match(h.command, /^git commit -m '/);
  assert.match(g('status', '--porcelain'), /\?\? new\.txt/);
});

test('M1-27 tray only ever invokes read-only git (stubbed git on PATH)', { skip: process.platform === 'win32' && 'the git stub is a sh script' }, () => {
  const { d } = repo();
  const bin = mkdtempSync(join(tmpdir(), 'hb-bin-'));
  const log = join(bin, 'log');
  const real = execFileSync('which', ['git'], { encoding: 'utf8' }).trim();
  writeFileSync(join(bin, 'git'), `#!/bin/sh\necho "$1" >> ${log}\nexec ${real} "$@"\n`);
  chmodSync(join(bin, 'git'), 0o755);
  const old = process.env.PATH;
  process.env.PATH = `${bin}:${old}`;
  try {
    handback(gitIn(d));
  } finally {
    process.env.PATH = old;
  }
  const used = new Set(readFileSync(log, 'utf8').split('\n').filter(Boolean));
  assert.ok(used.size > 0);
  for (const cmd of used) assert.ok(['diff', 'ls-files'].includes(cmd), cmd);
  assert.throws(() => gitIn(d)(['commit', '-m', 'x']), /not allowed/);
});

test('M1-27 no commit/push/rebase execution path in workbench source', () => {
  const files: string[] = [];
  const walk = (p: string) => {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      const f = join(p, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.(ts|js|cjs|mjs)$/.test(e.name)) files.push(f);
    }
  };
  walk(join(here, '../src'));
  walk(join(here, '../renderer'));
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    const bad = src.match(/['"`]git['"`]\s*,\s*\[\s*['"`](commit|push|rebase|merge|add|reset)['"`]|exec\w*\([^)]*git (commit|push|rebase)/);
    assert.equal(bad, null, f);
  }
});

test('M2-03 a picked variant shows its worktree diff against the base, read-only, with a commit -am command in that worktree', () => {
  const d = mkdtempSync(join(tmpdir(), 'hb-variant-'));
  const g = (...a: string[]) => execFileSync('git', a, { cwd: d, encoding: 'utf8' });
  g('init', '-q');
  g('config', 'user.email', 't@example.com');
  g('config', 'user.name', 't');
  writeFileSync(join(d, 'kept.txt'), 'one\n');
  g('add', '.');
  g('commit', '-qm', 'base');
  const base = g('rev-parse', 'HEAD').trim();
  writeFileSync(join(d, 'committed.txt'), 'c\n');
  g('add', '.');
  g('commit', '-qm', 'variant work');
  writeFileSync(join(d, 'kept.txt'), 'one\ntwo\n');
  writeFileSync(join(d, 'new.txt'), 'n\n');
  const calls: string[][] = [];
  const git = gitIn(d);
  const h = handback((args) => { calls.push(args); return git(args); }, { base, cwd: d });
  assert.deepEqual(h.files.map((f) => f.path).sort(), ['committed.txt', 'kept.txt']);
  assert.deepEqual(h.untracked, ['new.txt']);
  assert.ok(calls.every((a) => a[0] === 'diff' || a[0] === 'ls-files'), JSON.stringify(calls));
  assert.ok(calls.filter((a) => a[0] === 'diff').every((a) => a[1] === base && !a.includes('--cached')));
  assert.ok(h.command.startsWith(`git -C '${d}' commit -am `), h.command);
});
