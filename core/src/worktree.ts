import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import type { EngineSpec } from './engines/registry.ts';
import { canonicalPath, worktreesRoot } from './project.ts';
import { settings } from './settings.ts';
import { untrustFolder } from './trust.ts';

const DAY_MS = 86_400_000;

function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000 });
}

function ok(dir: string, ...args: string[]): boolean {
  try { git(dir, ...args); return true; } catch { return false; }
}

/** The repo's main branch: origin/HEAD's branch, else main, else master; null when none exists locally. */
function mainBranch(repo: string): string | null {
  let head = '';
  try { head = git(repo, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD').trim().replace(/^origin\//, ''); } catch {}
  return [head, 'main', 'master'].find((b) => b && ok(repo, 'rev-parse', '--verify', '-q', `refs/heads/${b}`)) ?? null;
}

type Row = { id: string; path: string; older: number; live: number; last_jd: number };

/**
 * Tidies worktree projects under <home>/worktrees/<parent id>/<name>: a missing folder hides its row; one with no live session and no
 * activity for `worktree.stale_days` is removed (`git worktree remove`, never --force) when clean and merged into the main branch, else
 * marked older. Rows are hidden, never deleted: session, run, browser_pane and schedule reference them.
 */
export function sweepWorktrees(db: DatabaseSync, engines: EngineSpec[], now = Date.now()): { hidden: string[]; removed: string[]; older: string[] } {
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
  for (const r of rows) {
    const parts = r.path.toLowerCase().startsWith(root) ? r.path.slice(root.length).split('/') : [];
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
        if (r.older) set.run(0, 0, r.id);
        continue;
      }
      if (canonicalPath(fs.realpathSync.native(r.path)).toLowerCase().startsWith(canonicalPath(fs.realpathSync.native(root)).toLowerCase() + '/')) {
        const parent = db.prepare('SELECT path FROM project WHERE id = ?').get(parts[0]) as { path: string } | undefined;
        const main = parent && fs.existsSync(parent.path) ? mainBranch(parent.path) : null;
        const clean = git(r.path, 'status', '--porcelain').trim() === '';
        if (parent && main && clean && ok(r.path, 'merge-base', '--is-ancestor', 'HEAD', `refs/heads/${main}`)) {
          try {
            git(parent.path, 'worktree', 'remove', r.path);
            untrustFolder(r.path, engines);
            set.run(1, 0, r.id);
            out.removed.push(r.path);
            console.error(`worktree sweep: removed ${r.path}, idle ${settings().worktree.stale_days}+ days, clean and merged into ${main}`);
            continue;
          } catch (e) {
            console.error(`worktree sweep: could not remove ${r.path}, kept as older: ${(e as Error).message.split('\n')[0]}`);
          }
        }
      }
      if (!r.older) set.run(0, 1, r.id);
      out.older.push(r.path);
    } catch (e) {
      console.error(`worktree sweep: left ${r.path} as it was: ${(e as Error).message.split('\n')[0]}`);
    }
  }
  return out;
}
