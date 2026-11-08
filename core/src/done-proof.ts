import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exec } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { E, RpcError } from './pipe/errors.ts';
import { gitAsync } from './sessions/owners.ts';
import { nowIso, ulid } from './time.ts';

export interface DoneProof { id: string; session_id: string; at: string; revision: string | null; tree: string | null; command: string; environment: string; acceptance: string | null; exit_code: number | null; output_tail: string }

const cwdOf = (db: DatabaseSync, id: string): string => {
  const row = db.prepare('SELECT cwd FROM session WHERE id = ?').get(id) as { cwd: string | null } | undefined;
  if (!row) throw new RpcError(E.NOT_FOUND, 'session not found');
  if (!row.cwd) throw new RpcError(E.INVALID_PARAMS, 'session has no folder');
  return row.cwd;
};

/** The HEAD revision and a git tree of the folder as it is now (index copy, add -A, write-tree); both null outside a repository. */
export async function folderTree(cwd: string): Promise<{ revision: string | null; tree: string | null }> {
  const git = async (args: string[], env: Record<string, string> = {}) => (await gitAsync(cwd, args, 15000, env, false)).trim();
  const index = path.join(os.tmpdir(), `troop-proof-${ulid()}`);
  try {
    const revision = await git(['rev-parse', 'HEAD']);
    await fs.promises.copyFile(path.resolve(cwd, await git(['rev-parse', '--git-path', 'index'])), index);
    await git(['add', '-A'], { GIT_INDEX_FILE: index });
    return { revision, tree: await git(['write-tree'], { GIT_INDEX_FILE: index }) };
  } catch {
    return { revision: null, tree: null };
  } finally {
    await fs.promises.rm(index, { force: true }).catch(() => {});
  }
}

/** Runs `command` in the session's folder, then stores and returns a row with its exit code, output tail and the folder tree after the run. */
export async function runCheck(db: DatabaseSync, session_id: string, command: string, acceptance?: string): Promise<DoneProof> {
  const cwd = cwdOf(db, session_id);
  const { code, out } = await new Promise<{ code: number | null; out: string }>((resolve) => {
    exec(command, { cwd, timeout: 600000, killSignal: 'SIGKILL', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      const e = err as (NodeJS.ErrnoException & { code?: number | string }) | null;
      resolve({ code: e ? (typeof e.code === 'number' ? e.code : null) : 0, out: `${stdout}${stderr}` });
    });
  });
  const { revision, tree } = await folderTree(cwd);
  const row: DoneProof = { id: ulid(), session_id, at: nowIso(), revision, tree, command, environment: `${process.platform} ${process.arch} node ${process.version}`, acceptance: acceptance || null, exit_code: code, output_tail: out.slice(-4000) };
  db.prepare('INSERT INTO done_proof (id, session_id, at, revision, tree, command, environment, acceptance, exit_code, output_tail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(row.id, session_id, row.at, revision, tree, command, row.environment, row.acceptance, code, row.output_tail);
  return row;
}

/** Whether the latest check on the folder as it is now passed: done (with acceptance), checks_passed (without) or needs_review. */
export async function doneResult(db: DatabaseSync, session_id: string) {
  const cwd = cwdOf(db, session_id);
  const current = await folderTree(cwd);
  const proof = (current.tree ? db.prepare('SELECT * FROM done_proof WHERE session_id = ? AND tree = ? ORDER BY at DESC, id DESC LIMIT 1').get(session_id, current.tree) : undefined) as DoneProof | undefined;
  const result = proof?.exit_code === 0 ? (proof.acceptance ? 'done' : 'checks_passed') : 'needs_review';
  const state = (db.prepare('SELECT state FROM session WHERE id = ?').get(session_id) as { state: string }).state;
  return { result, unverified: state === 'done' && result === 'needs_review', proof: proof ?? null, current };
}
