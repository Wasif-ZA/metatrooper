import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { buildGenerated } from './helpers.ts';
import { BUILT_IN } from '../src/engines/registry.ts';
import { HASH_LABEL, imageHash } from '../src/sandbox/build.ts';
import { sandboxRefusal } from '../src/sandbox/checks.ts';
import { coreDir, repoDir } from '../src/paths.ts';

before(buildGenerated);

const claude = BUILT_IN.find(engine => engine.id === 'claude')!;
const engines = BUILT_IN;

function copyRoots(dir: string) {
  const core = join(dir, 'core');
  const repo = join(dir, 'repo');
  mkdirSync(core, { recursive: true });
  mkdirSync(join(repo, 'sandbox'), { recursive: true });
  for (const f of ['event.js', 'codex-notify.js']) copyFileSync(join(coreDir, f), join(core, f));
  cpSync(join(coreDir, 'dist'), join(core, 'dist'), { recursive: true });
  for (const f of ['Dockerfile', 'entry.sh', 'proxy.js', 'selftest.js']) copyFileSync(join(repoDir, 'sandbox', f), join(repo, 'sandbox', f));
  return { core, repo };
}

// Runs sandboxRefusal against a fake runtime whose `image inspect` succeeds.
function refusal(deps: { label: () => string | null; hash: () => string }): string | null {
  const dir = mkdtempSync(join(os.tmpdir(), 'm7-19-refusal-'));
  const home = join(dir, 'home');
  const project = join(home, 'worktrees', 'repo');
  const bin = join(dir, 'bin');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(project, { recursive: true });
  mkdirSync(bin);
  writeFileSync(join(bin, 'image'), 'process.exit(0);\n');
  const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  const cwd = process.cwd();
  process.chdir(bin);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = home;
  try {
    const now = Date.now();
    writeFileSync(join(home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { expiresAt: now + 10 * 60 * 60 * 1000 } }));
    return sandboxRefusal(claude, project, { runtime: () => process.execPath, now: () => now, ...deps });
  } finally {
    process.chdir(cwd);
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a changed hook file makes the launch refuse with rebuild', () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'm7-19-roots-'));
  try {
    const roots = copyRoots(dir);
    const h1 = imageHash(engines, roots);
    const hook = join(roots.core, 'dist', 'hook', 'event.js');
    writeFileSync(hook, readFileSync(hook, 'utf8') + '\n// changed\n');
    const h2 = imageHash(engines, roots);
    assert.notEqual(h1, h2);
    assert.match(refusal({ label: () => h1, hash: () => h2 })!, /out of date.*rebuild/);
    assert.equal(refusal({ label: () => h2, hash: () => h2 }), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the hash covers the egress list and the Dockerfile', () => {
  const dir = mkdtempSync(join(os.tmpdir(), 'm7-19-hash-'));
  try {
    const roots = copyRoots(dir);
    const base = imageHash(engines, roots);
    assert.equal(imageHash(engines, roots), base);
    const extra = engines.map(e => (e.id === 'claude' ? { ...e, sandbox: { ...e.sandbox!, egress: [...(e.sandbox!.egress ?? []), 'extra.example.com'] } } : e));
    assert.notEqual(imageHash(extra, roots), base);
    const dockerfile = join(roots.repo, 'sandbox', 'Dockerfile');
    writeFileSync(dockerfile, readFileSync(dockerfile, 'utf8') + '\n# edited\n');
    assert.notEqual(imageHash(engines, roots), base);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('build labels the image with the hash', () => {
  const src = readFileSync(join(coreDir, 'src', 'sandbox', 'build.ts'), 'utf8');
  assert.equal(HASH_LABEL, 'troop.hash');
  assert.match(src, /\['build', '--label', `\$\{HASH_LABEL\}=\$\{imageHash\(engines\)\}`/);
});

test('an image with no label is out of date', () => {
  assert.match(refusal({ label: () => null, hash: () => 'abc' })!, /out of date.*rebuild/);
});
