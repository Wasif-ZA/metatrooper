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
        finish({ ok: false, code: null, stdout: '' });
        return;
      }
      child = spawn(direct[0], [...direct.slice(1), ...argv.slice(1)], { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      finish({ ok: false, code: null, stdout: '' });
      return;
    }
    const t = setTimeout(() => {
      child.kill();
      finish({ ok: false, code: null, stdout });
    }, timeoutMs);
    child.stdout?.on('data', (c) => (stdout += c));
    child.on('error', () => {
      clearTimeout(t);
      finish({ ok: false, code: null, stdout });
    });
    child.on('close', (code) => {
      clearTimeout(t);
      finish({ ok: code === 0, code, stdout });
    });
  });
}

export async function checkEngine(db: DatabaseSync, e: EngineSpec): Promise<void> {
  const v = await run(e.version_cmd);
  const installed = v.ok;
  let auth: 'ok' | 'missing' | 'unknown' = 'unknown';
  let detail: string | null = null;
  if (installed && e.auth_cmd && e.auth_cmd.length) {
    const a = await run(e.auth_cmd);
    const want = e.auth_ok?.exit_code ?? 0;
    const re = e.auth_ok?.stdout_regex ? new RegExp(e.auth_ok.stdout_regex) : null;
    auth = a.code === want && (!re || re.test(a.stdout)) ? 'ok' : 'missing';
    if (auth === 'missing') detail = 'auth check failed';
  }
  if (!installed) detail = 'not installed or version check failed';
  db.prepare('INSERT OR REPLACE INTO engine_check (engine_id, checked_at, installed, version, auth, detail) VALUES (?, ?, ?, ?, ?, ?)')
    .run(e.id, nowIso(), installed ? 1 : 0, installed ? v.stdout.trim().split('\n')[0].slice(0, 120) : null, installed ? auth : 'missing', detail);
}

export async function checkAll(db: DatabaseSync, engines: EngineSpec[]): Promise<void> {
  for (const e of engines) await checkEngine(db, e);
}
