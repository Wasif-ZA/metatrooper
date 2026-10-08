import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import type { EngineSpec } from '../engines/registry.ts';
import { containerRuntime, imageTag } from './checks.ts';
import { dockerArgv, ensureProxy, gitLayout, mapPath } from './launch.ts';
import { spoolDir } from './spool.ts';

export interface SelftestResult { name: string; expect: 'blocked' | 'allowed'; ok: boolean; detail: string }

/** Runs sandbox/selftest.js in a container started exactly as a trooper's, on a throwaway repo and worktree. */
export function runSelftest(engines: EngineSpec[]): { ok: boolean; results: SelftestResult[]; error?: string } {
  const rt = containerRuntime();
  if (!rt) return { ok: false, results: [], error: 'no container runtime answers; start Docker Desktop' };
  if (spawnSync(rt, ['image', 'inspect', imageTag()], { stdio: 'pipe', windowsHide: true }).status !== 0) return { ok: false, results: [], error: `run troop sandbox build first (${imageTag()} is missing)` };
  const proxy = ensureProxy();
  if (proxy) return { ok: false, results: [], error: proxy };
  const engine = engines.find((e) => e.sandbox?.logins.some((l) => 'file' in l && fs.existsSync(path.join(os.homedir(), l.file.replace(/^~[\\/]/, '')))));
  if (!engine?.sandbox) return { ok: false, results: [], error: 'no engine with a sandbox login file on this machine' };
  const login = engine.sandbox.logins.find((l) => 'file' in l) as { file: string };
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-selftest-'));
  const repo = path.join(base, 'repo');
  const worktree = path.join(base, 'wt');
  const id = `SELFTEST${Date.now().toString(36).toUpperCase()}`;
  const probe = path.join(os.homedir(), '.troop-selftest-probe');
  try {
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' });
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'README.md'), 'selftest\n');
    git(repo, 'add', 'README.md');
    git(repo, '-c', 'user.email=selftest@troop', '-c', 'user.name=selftest', 'commit', '-qm', 'init');
    git(repo, 'worktree', 'add', '-q', worktree, '-b', 'selftest');
    const layout = gitLayout(worktree);
    if ('refusal' in layout) return { ok: false, results: [], error: layout.refusal };
    fs.writeFileSync(probe, 'selftest\n');
    fs.mkdirSync(spoolDir(id), { recursive: true });
    const argv = dockerArgv(id, engine, worktree, layout, ['node', '/opt/troop/selftest.js'], rt, {
      SELFTEST_HOME: mapPath(os.homedir()),
      SELFTEST_COMMON: mapPath(layout.common),
      SELFTEST_LOGIN: login.file.replace(/^~[\\/]/, ''),
      SELFTEST_ALLOWED: engine.sandbox.egress[0],
    }).filter((a) => a !== '-it');
    const r = spawnSync(argv[0], argv.slice(1), { encoding: 'utf8', windowsHide: true, timeout: 120_000 });
    const line = (r.stdout || '').trim().split('\n').pop() ?? '';
    let results: SelftestResult[] = [];
    try { results = JSON.parse(line); } catch { return { ok: false, results: [], error: `the self-test printed no results: ${(r.stderr || r.stdout || '').trim().slice(-300)}` }; }
    return { ok: results.length > 0 && results.every((x) => x.ok), results };
  } finally {
    fs.rmSync(probe, { force: true });
    fs.rmSync(spoolDir(id), { recursive: true, force: true });
    fs.rmSync(base, { recursive: true, force: true });
  }
}
