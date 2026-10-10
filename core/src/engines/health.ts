import { spawn } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { nowIso } from '../time.ts';
import type { EngineSpec } from './registry.ts';
import { resolveCommand } from '../hook/resolve.ts';
import fs from 'node:fs';

interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  why?: 'missing' | 'timeout';
}

function run(argv: string[], timeoutMs = 10_000): Promise<RunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let done = false;
    const finish = (r: RunResult) => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    let child;
    try {
      const direct = fs.existsSync(argv[0]) ? [argv[0]] : resolveCommand(argv[0]);
      if (!direct) {
        finish({ ok: false, code: null, stdout: '', why: 'missing' });
        return;
      }
      child = spawn(direct[0], [...direct.slice(1), ...argv.slice(1)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      finish({ ok: false, code: null, stdout: '', why: 'missing' });
      return;
    }
    const t = setTimeout(() => {
      child.kill();
      finish({ ok: false, code: null, stdout, why: 'timeout' });
    }, timeoutMs);
    child.stdout?.on('data', (c) => (stdout += c));
    child.on('error', () => {
      clearTimeout(t);
      finish({ ok: false, code: null, stdout, why: 'missing' });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      finish({ ok: code === 0, code, stdout });
    });
  });
}

function older(version: string, min: string): boolean {
  const parts = (s: string) => (s.match(/\d+(\.\d+)*/)?.[0] ?? '0').split('.').map(Number);
  const a = parts(version);
  const b = parts(min);
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  return false;
}

export async function checkEngine(db: DatabaseSync, e: EngineSpec): Promise<void> {
  const v = await run(e.version_cmd);
  const version = v.stdout.trim().split('\n')[0].slice(0, 120) || null;
  let detail: string | null = v.ok ? null : v.why ?? 'missing';
  if (!detail && e.min_version && older(version ?? '', e.min_version)) detail = 'too-old';
  const installed = !detail;
  let auth: 'ok' | 'missing' | 'unknown' = 'unknown';
  if (installed && e.auth_cmd && e.auth_cmd.length) {
    const a = await run(e.auth_cmd);
    const want = e.auth_ok?.exit_code ?? 0;
    const re = e.auth_ok?.stdout_regex ? new RegExp(e.auth_ok.stdout_regex) : null;
    if (a.why === 'timeout') detail = 'timeout';
    else auth = a.code === want && (!re || re.test(a.stdout)) ? 'ok' : 'missing';
    if (auth === 'missing') detail = 'not-logged-in';
  }
  db.prepare('INSERT OR REPLACE INTO engine_check (engine_id, checked_at, installed, version, auth, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .run(e.id, nowIso(), installed ? 1 : 0, version, installed ? auth : 'missing', detail);
}

export async function checkAll(db: DatabaseSync, engines: EngineSpec[]): Promise<void> {
  for (const e of engines) await checkEngine(db, e);
}
