import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import type { EngineSpec } from './engines/registry.ts';
import { canonicalPath, within, worktreesRoot } from './project.ts';
import { settings } from './settings.ts';
import { untrustFolder } from './trust.ts';

const DAY_MS = 86_400_000;

const run = promisify(execFile);

// Async on purpose: the sweep runs inside the core, and a blocking git call would stall terminals, pipe requests and the heartbeat.
async function git(dir: string, args: string[], timeout = 30_000): Promise<string> {
  return (await run('git', ['-C', dir, ...args], { encoding: 'utf8', timeout, windowsHide: true })).stdout;
}

async function ok(dir: string, ...args: string[]): Promise<boolean> {
  try { await git(dir, args); return true; } catch { return false; }
}

/** The repo's main branch: origin/HEAD's branch, else main, else master; null when none exists locally. */
async function mainBranch(repo: string): Promise<string | null> {
  let head = '';
  try { head = (await git(repo, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])).trim().replace(/^origin\//, ''); } catch {}
  for (const b of [head, 'main', 'master']) if (b && await ok(repo, 'rev-parse', '--verify', '-q', `refs/heads/${b}`)) return b;
  return null;
}

/** Worktrees the sweep is removing right now, project id to path; launchSession and shell.open refuse a folder inside one. */
export const removing = new Map<string, string>();

const norm = (p: string) => {
  let r = path.resolve(p);
  try { r = fs.realpathSync.native(r); } catch {}
  const c = canonicalPath(r);
  return process.platform === 'win32' ? c.toLowerCase() : c;
};

const inside = (dir: string, root: string) => within(norm(dir), norm(root));

export function beingRemoved(dir: string): boolean {
  for (const root of removing.values()) if (inside(dir, root)) return true;
  return false;
}

type Row = { id: string; path: string; older: number; live: number; last_jd: number };

/**
 * Tidies worktree projects under <home>/worktrees/<parent id>/<name>: a missing folder hides its row; one with no live session and no
 * activity for `worktree.stale_days` is removed (`git worktree remove`, never --force) when clean and merged into the main branch, else
 * marked older. Rows are hidden, never deleted: session, run, browser_pane and schedule reference them. One worktree at a time, never blocking.
 */
export async function sweepWorktrees(db: DatabaseSync, engines: EngineSpec[], now = Date.now()): Promise<{ hidden: string[]; removed: string[]; older: string[] }> {
  const root = worktreesRoot();
  const staleMs = Math.max(1, settings().worktree.stale_days) * DAY_MS;
  const out = { hidden: [] as string[], removed: [] as string[], older: [] as string[] };
  const rows = db.prepare(
    `SELECT p.id, p.path, p.older,
       (SELECT COUNT(*) FROM session s WHERE s.project_id = p.id AND s.state != 'exited') AS live,
       MAX(julianday(p.last_opened), COALESCE((SELECT MAX(MAX(julianday(s.started_at)), MAX(julianday(s.state_at)), COALESCE(MAX(julianday(s.ended_at)), 0)) FROM session s WHERE s.project_id = p.id), 0)) AS last_jd
     FROM project p WHERE p.hidden = 0`,
  ).all() as Row[];
  const set = db.prepare('UPDATE project SET hidden = ?, older = ? WHERE id = ?');
  const setOlder = db.prepare('UPDATE project SET older = ? WHERE id = ? AND hidden = 0');
  const liveOwn = db.prepare("SELECT 1 FROM session WHERE project_id = ? AND state != 'exited' LIMIT 1");
  const liveCwds = db.prepare("SELECT cwd FROM session WHERE state != 'exited' AND cwd IS NOT NULL");
  const liveNow = (r: Row) => !!liveOwn.get(r.id) || (liveCwds.all() as Array<{ cwd: string }>).some((s) => inside(s.cwd, r.path));
  // Git has let go of this folder (no `.git` entry) but it is still there, as when Windows refused to delete it. Only an empty folder is
  // removed; anything else stays and is tried again next sweep. The workbench never shows such a folder (goneCheckout).
  const leftover = async (r: Row): Promise<void> => {
    removing.set(r.id, r.path);
    try {
      await fs.promises.rmdir(r.path);
    } catch (e) {
      console.error(`worktree sweep: ${r.path} is no longer a worktree but could not be deleted, will retry: ${(e as Error).message.split('\n')[0]}`);
      return;
    } finally {
      removing.delete(r.id);
    }
    untrustFolder(r.path, engines);
    set.run(1, 0, r.id);
    out.removed.push(r.path);
    console.error(`worktree sweep: removed ${r.path}, left over after git worktree remove`);
  };
  for (const r of rows) {
    const parts = r.path.toLowerCase().startsWith(root.toLowerCase()) ? r.path.slice(root.length).split('/') : [];
    if (parts.length !== 2 || !parts[0] || !parts[1]) continue;
    try {
      if (!fs.existsSync(r.path)) {
        set.run(1, 0, r.id);
        out.hidden.push(r.path);
        console.error(`worktree sweep: hid ${r.path}, its folder is gone`);
        continue;
      }
      const stale = !r.live && now - (r.last_jd - 2440587.5) * DAY_MS >= staleMs;
      if (!stale) {
        if (r.older) setOlder.run(0, r.id);
        continue;
      }
      if (canonicalPath(fs.realpathSync.native(r.path)).toLowerCase().startsWith(canonicalPath(fs.realpathSync.native(root)).toLowerCase() + '/')) {
        if (!fs.existsSync(path.join(r.path, '.git'))) {
          if (!liveNow(r)) await leftover(r);
          continue;
        }
        const parent = db.prepare('SELECT path FROM project WHERE id = ?').get(parts[0]) as { path: string } | undefined;
        const main = parent && fs.existsSync(parent.path) ? await mainBranch(parent.path) : null;
        const clean = (await git(r.path, ['status', '--porcelain'])).trim() === '';
        const merged = parent && main && clean && await ok(r.path, 'merge-base', '--is-ancestor', 'HEAD', `refs/heads/${main}`);
        // A session may have started while git ran: such a worktree is no longer stale, so leave it as it is.
        if (liveNow(r)) continue;
        if (merged && parent) {
          removing.set(r.id, r.path);
          try {
            // Longer than worktree.create's 60 s add: a timeout mid-remove would leave a half-deleted folder.
            await git(parent.path, ['worktree', 'remove', r.path], 300_000);
            untrustFolder(r.path, engines);
            set.run(1, 0, r.id);
            out.removed.push(r.path);
            console.error(`worktree sweep: removed ${r.path}, idle ${settings().worktree.stale_days}+ days, clean and merged into ${main}`);
            continue;
          } catch (e) {
            if (fs.existsSync(r.path) && !fs.existsSync(path.join(r.path, '.git'))) {
              await leftover(r);
              continue;
            }
            console.error(`worktree sweep: could not remove ${r.path}, kept as older: ${(e as Error).message.split('\n')[0]}`);
          } finally {
            removing.delete(r.id);
          }
        }
      }
      if (!r.older) setOlder.run(1, r.id);
      out.older.push(r.path);
    } catch (e) {
      console.error(`worktree sweep: left ${r.path} as it was: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  return out;
}
