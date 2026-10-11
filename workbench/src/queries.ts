import type { DatabaseSync } from 'node:sqlite';

export const OFFLINE_AFTER_MS = 6000;

export type Light = 'green' | 'grey' | 'red';

export interface Snapshot {
  at: number;
  core: { online: boolean; pid: number | null; heartbeat_age_ms: number | null };
  projects: Array<{ id: string; name: string; path: string; last_opened: string }>;
  engines: Array<{ id: string; light: Light; version: string | null; auth: string | null; checked_at: string | null; plugin_id: string | null; roles: string[]; resumable: boolean; detail: string | null; fix: string | null; install: string | null; login: string | null }>;
  sessions: Array<{ id: string; engine_id: string; driven_engine: string | null; host: string; state: string; state_at: string; last_tool: string | null; cwd: string | null; title: string | null; last_line: string | null; native_id: string | null; run_id: string | null; step_id: string | null; started_at: string; tokens: number | null; usd: number | null }>;
  needs_you: Array<{ id: string; at: string; kind: string; ref: string | null; text: string; read_at: string | null }>;
  live: Array<{ id: string; project_id: string; engine_id: string; state: string; title: string | null; cwd: string | null; step_id: string | null; started_at: string; last_line: string | null }>;
  panes: Array<{ id: string; url: string | null; session_id: string | null; dev_port: number | null }>;
  snapshots: Array<{ id: string; pane_id: string; label: string; url: string; taken_at: string; w390_path: string | null; w1280_path: string | null }>;
  limits: Array<{ provider: string; account: string; window: string; used_pct: number | null; resets_at: string | null; read_at: string; status: string }>;
  selected: string | null;
  git: Record<string, { branch: string | null; added: number; deleted: number }>;
}

/** Engine light: green when installed and auth ok, grey when auth is unknown or never checked, red when missing or failed. */
export function light(check: { installed: number; auth: string } | null | undefined): Light {
  if (!check) return 'grey';
  if (!check.installed || check.auth === 'missing') return 'red';
  return check.auth === 'ok' ? 'green' : 'grey';
}

/** The one-line fix shown for a failed engine check. */
export function engineFix(e: { id: string; install?: string; login?: string; min_version?: string }, detail: string | null): string | null {
  if (detail === 'missing') return e.install ? `Install it: ${e.install}` : `Put ${e.id} on PATH`;
  if (detail === 'too-old') return `Needs ${e.min_version} or newer${e.install ? `: ${e.install}` : ''}`;
  if (detail === 'not-logged-in') return e.login ?? `Log in to ${e.id}`;
  if (detail === 'timeout') return `${e.id} did not answer in 10 s; run it in a terminal, then Check again`;
  return null;
}

function parse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Everything the workbench draws, read in one pass from a read-only connection. `projectId` scopes sessions and panes. */
export function snapshot(db: DatabaseSync, projectId: string | null, now = Date.now()): Snapshot {
  const meta = Object.fromEntries((db.prepare("SELECT key, value FROM meta WHERE key IN ('core_pid','core_heartbeat')").all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
  const beat = meta.core_heartbeat ? Date.parse(meta.core_heartbeat) : NaN;
  const age = Number.isNaN(beat) ? null : Math.max(0, now - beat);

  const engines = (db.prepare(
    `SELECT e.id, e.plugin_id, e.spec_json, c.installed, c.version, c.auth, c.checked_at, c.detail
     FROM engine e LEFT JOIN plugin p ON p.id = e.plugin_id
     LEFT JOIN engine_check c ON c.engine_id = e.id AND c.rowid = (SELECT rowid FROM engine_check WHERE engine_id = e.id ORDER BY julianday(checked_at) DESC LIMIT 1)
     WHERE e.plugin_id IS NULL OR p.enabled = 1
     ORDER BY e.cost_rank, e.id`,
  ).all() as Array<Record<string, unknown>>).map((r) => {
    const spec = parse<{ roles?: string[]; resume_args?: string[]; install?: string; login?: string; min_version?: string; shift_enter?: string }>(r.spec_json as string, {});
    const detail = (r.detail as string | null) ?? null;
    return {
      id: String(r.id),
      light: light(r.checked_at ? { installed: Number(r.installed), auth: String(r.auth) } : null),
      version: (r.version as string | null) ?? null,
      auth: (r.auth as string | null) ?? null,
      checked_at: (r.checked_at as string | null) ?? null,
      plugin_id: (r.plugin_id as string | null) ?? null,
      roles: spec.roles ?? [],
      resumable: Boolean(spec.resume_args?.length),
      shift_enter: spec.shift_enter === 'alt-enter' ? 'alt-enter' : 'paste',
      detail,
      fix: engineFix({ ...spec, id: String(r.id) }, detail),
      install: spec.install ?? null,
      login: spec.login ?? null,
    };
  });

  const driven = (db.prepare('PRAGMA table_info(session)').all() as Array<{ name: string }>).some((c) => c.name === 'driven_engine') ? 's.driven_engine' : 'NULL AS driven_engine';
  const sessions = projectId
    ? (db.prepare(
        `SELECT s.id, s.engine_id, ${driven}, s.host, s.state, s.state_at, s.last_tool, s.cwd, s.title, s.last_line, s.native_id, s.run_id, s.step_id, s.started_at,
           (SELECT SUM(COALESCE(tokens_in,0) + COALESCE(tokens_out,0) + COALESCE(cache_read,0) + COALESCE(cache_write,0)) FROM usage u WHERE u.session_id = s.id) AS tokens,
           (SELECT CASE WHEN COUNT(*) = COUNT(usd) THEN SUM(usd) END FROM usage u WHERE u.session_id = s.id) AS usd
         FROM session s WHERE s.project_id = ? AND s.hidden = 0 ORDER BY julianday(s.started_at) DESC LIMIT 50`,
      ).all(projectId) as Snapshot['sessions'])
    : [];

  const panes = projectId
    ? (db.prepare('SELECT id, url, session_id, dev_port FROM browser_pane WHERE project_id = ? AND open = 1 ORDER BY id').all(projectId) as Snapshot['panes'])
    : [];
  const snapshots = projectId
    ? (db.prepare(
        `SELECT s.id, s.pane_id, s.label, s.url, s.taken_at, s.w390_path, s.w1280_path FROM snapshot s JOIN browser_pane p ON p.id = s.pane_id
         WHERE p.project_id = ? ORDER BY julianday(s.taken_at) DESC LIMIT 40`,
      ).all(projectId) as Snapshot['snapshots'])
    : [];

  const needs_you = db.prepare('SELECT id, at, kind, ref, text, read_at FROM needs_you WHERE resolved_at IS NULL ORDER BY julianday(at) DESC LIMIT 100').all() as Snapshot['needs_you'];

  return {
    at: now,
    core: { online: age !== null && age < OFFLINE_AFTER_MS, pid: meta.core_pid ? Number(meta.core_pid) : null, heartbeat_age_ms: age },
    projects: db.prepare('SELECT id, name, path, last_opened FROM project ORDER BY julianday(last_opened) DESC').all() as Snapshot['projects'],
    engines,
    sessions,
    needs_you,
    live: db.prepare("SELECT id, project_id, engine_id, state, title, cwd, step_id, started_at, last_line FROM session WHERE hidden = 0 AND state IN ('working', 'waiting_for_you') ORDER BY julianday(started_at) DESC").all() as Snapshot['live'],
    panes,
    snapshots,
    git: {},
    selected: (db.prepare("SELECT session_id FROM ui_selection WHERE window_id = 'main'").get() as { session_id: string | null } | undefined)?.session_id ?? null,
    limits: db.prepare('SELECT provider, account, window, used_pct, resets_at, read_at, status FROM limit_reading ORDER BY provider, window').all() as Snapshot['limits'],
  };
}

export function dataVersion(db: DatabaseSync): number {
  return Number((db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version);
}

export type LiveText = Record<string, { line?: string; title?: string }>;

/** Fills each session's last_line and title from the core's in-memory live text (session.live-text); the database never holds them. */
export function withLiveText(s: Snapshot, live: LiveText): Snapshot {
  const fill = <T extends { id: string; title: string | null; last_line: string | null }>(x: T): T => ({ ...x, title: live[x.id]?.title ?? null, last_line: live[x.id]?.line ?? null });
  return { ...s, sessions: s.sessions.map(fill), live: s.live?.map(fill) };
}
