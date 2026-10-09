import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { resolveCommand } from '../hook/resolve.ts';
import { killTree } from '../plugins/actions.ts';

export type ScanResult =
  | { status: 'clean'; count: 0 }
  | { status: 'findings'; count: number; items: Array<{ rule: string; file: string; line: number | null }> }
  | { status: 'unavailable'; reason: string };

const SCAN_TIMEOUT_MS = 60_000;

/** For each 1-based line of a unified diff, the new-side file and line it shows, or null for headers and removed lines. */
export function diffLineMap(diff: string): Array<{ file: string; line: number } | null> {
  const out: Array<{ file: string; line: number } | null> = [null];
  let file = '';
  let next = 0;
  for (const text of diff.split(/\r?\n/)) {
    const f = /^\+\+\+ b\/(.+)$/.exec(text);
    const h = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
    if (f) { file = f[1]; out.push(null); continue; }
    if (h) { next = Number(h[1]); out.push(null); continue; }
    if (text.startsWith('+') && !text.startsWith('+++') && file) { out.push({ file, line: next++ }); continue; }
    if (text.startsWith(' ') && file) { next++; out.push(null); continue; }
    out.push(null);
  }
  return out;
}

/** Runs gitleaks on diff text from stdin with redaction; the diff never lands in the run folder. */
export async function scanDiff(diff: string, runDir: string, label: string): Promise<ScanResult> {
  const exe = resolveCommand('gitleaks');
  if (!exe) return { status: 'unavailable', reason: 'gitleaks is not on PATH' };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-scan-'));
  const report = path.join(tmp, `scan-${label}.json`);
  const input = path.join(tmp, 'in.diff');
  fs.writeFileSync(input, diff);
  let fd: number | null = null;
  try {
    fd = fs.openSync(input, 'r');
    const stdin = fd;
    const code = await new Promise<number | string>((resolve) => {
      const child = spawn(exe[0], [...exe.slice(1), 'stdin', '--redact', '--no-banner', '--exit-code', '1', '--report-format', 'json', '--report-path', report], { stdio: [stdin, 'ignore', 'pipe'], windowsHide: true });
      let err = '';
      child.stderr?.on('data', (d) => { err += d; });
      const timer = setTimeout(() => { killTree(child); resolve('timed out after 60 s'); }, SCAN_TIMEOUT_MS);
      child.on('error', (e) => { clearTimeout(timer); resolve(`could not start gitleaks: ${e.message}`); });
      child.on('exit', (c) => { clearTimeout(timer); resolve(c ?? `gitleaks stopped: ${err.trim().split(/\r?\n/).pop() ?? ''}`); });
    });
    if (code === 0) return { status: 'clean', count: 0 };
    if (code !== 1) return { status: 'unavailable', reason: typeof code === 'string' ? code : `gitleaks exited ${code}` };
    let found: Array<{ RuleID?: string; StartLine?: number }>;
    try { found = JSON.parse(fs.readFileSync(report, 'utf8')); } catch { return { status: 'unavailable', reason: 'gitleaks report could not be read' }; }
    if (!Array.isArray(found)) return { status: 'unavailable', reason: 'gitleaks report is not a list' };
    const map = diffLineMap(diff);
    const items = found.flatMap((f) => {
      if (typeof f.StartLine !== 'number') return [{ rule: String(f.RuleID ?? 'unknown'), file: '', line: null }];
      const at = map[f.StartLine];
      return at ? [{ rule: String(f.RuleID ?? 'unknown'), file: at.file, line: at.line }] : [];
    });
    if (!items.length) return { status: 'clean', count: 0 };
    return { status: 'findings', count: items.length, items };
  } finally {
    if (fd !== null) fs.closeSync(fd);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Scans what a worktree changed since its base commit, new files included. */
export async function scanWorktree(worktree: string, base: string, runDir: string, label: string): Promise<ScanResult> {
  let diff: string;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-index-'));
  try {
    const index = execFileSync('git', ['-C', worktree, 'rev-parse', '--path-format=absolute', '--git-path', 'index'], { encoding: 'utf8', windowsHide: true }).trim();
    const env = { ...process.env, GIT_INDEX_FILE: path.join(tmp, 'index') };
    if (fs.existsSync(index)) fs.copyFileSync(index, env.GIT_INDEX_FILE);
    execFileSync('git', ['-C', worktree, 'add', '-A', '-N'], { stdio: 'ignore', windowsHide: true, env });
    diff = execFileSync('git', ['-C', worktree, 'diff', base], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, env });
  } catch (e) {
    return { status: 'unavailable', reason: `git diff failed: ${(e as Error).message.split(/\r?\n/)[0]}` };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  return scanDiff(diff, runDir, label);
}
