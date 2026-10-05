import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';

export const OFFLINE_AFTER_MS = 6000;

export type Light = 'green' | 'grey' | 'red';

export interface Snapshot {
  at: number;
  core: { online: boolean; pid: number | null; heartbeat_age_ms: number | null };
  projects: Array<{ id: string; name: string; path: string; last_opened: string }>;
  engines: Array<{ id: string; light: Light; version: string | null; auth: string | null; checked_at: string | null; plugin_id: string | null; roles: string[]; resumable: boolean }>;
  sessions: Array<{ id: string; engine_id: string; driven_engine: string | null; state: string; state_at: string; last_tool: string | null; cwd: string | null; title: string | null; last_line: string | null; native_id: string | null; run_id: string | null; step_id: string | null; started_at: string; tokens: number | null; usd: number | null }>;
  pipelines: Array<{ id: string; title: string; source: string; path: string; valid: boolean; errors: string[]; inputs: Record<string, unknown>; layout: string | null; background: boolean; step_defs: StepDef[] }>;
  runs: Array<{ id: string; pipeline_id: string; status: string; paused_why: string | null; started_at: string; ended_at: string | null; depth: number; parent_run: string | null }>;
  steps: Array<{ run_id: string; step_id: string; iteration: number; fanout_index: number; status: string; engine_id: string | null; session_id: string | null; fail_count: number; output_path: string | null }>;
  gates: Array<{ id: string; run_id: string; top_run: string; pipeline_id: string; step_id: string; guards_step: string | null; kind: string; action_hash: string | null; summary: string; project_id: string }>;
  needs_you: Array<{ id: string; at: string; kind: string; ref: string | null; text: string; read_at: string | null }>;
  panes: Array<{ id: string; url: string | null; session_id: string | null; run_id: string | null; variant: number | null; dev_port: number | null }>;
  snapshots: Array<{ id: string; pane_id: string; label: string; url: string; taken_at: string; w390_path: string | null; w1280_path: string | null }>;
  board: Array<{ id: string; run_id: string; source_url: string; capture_path: string | null; reason: string; pinned: number }>;
  limits: Array<{ provider: string; account: string; window: string; used_pct: number | null; resets_at: string | null; read_at: string; status: string }>;
  selected: string | null;
  git: Record<string, { branch: string | null; added: number; deleted: number }>;
  variants: Array<{ idx: number; status: string; branch: string; pane_id: string | null; dev_port: number; step_id: string | null; engine_id: string | null; session_id: string | null; tokens: number | null; usd: number | null }>;
}

/** Engine light: green when installed and auth ok, grey when auth is unknown or never checked, red when missing or failed. */
export function light(check: { installed: number; auth: string } | null | undefined): Light {
  if (!check) return 'grey';
  if (!check.installed || check.auth === 'missing') return 'red';
  return check.auth === 'ok' ? 'green' : 'grey';
}

const fileCache = new Map<string, PipelineFile>();

type StepDef = { id: string; kind: string; gate?: string; fanout?: number; loop_max?: number; view?: string; layout: string | null };
type PipelineFile = { title: string; inputs: Record<string, unknown>; layout: string | null; background: boolean; step_defs: StepDef[] };

function pipelineFile(path: string, version: number, id: string): PipelineFile {
  const key = `${path}:${version}`;
  let hit = fileCache.get(key);
  if (!hit) {
    const json = (() => {
      try {
        return JSON.parse(fs.readFileSync(path, 'utf8')) as { title?: unknown; inputs?: unknown; steps?: unknown; layout?: unknown; background?: unknown };
      } catch {
        return {};
      }
    })();
    const steps = Array.isArray(json.steps) ? (json.steps as Array<Record<string, any>>) : [];
    hit = {
      title: typeof json.title === 'string' ? json.title : id,
      inputs: json.inputs && typeof json.inputs === 'object' ? (json.inputs as Record<string, unknown>) : {},
      layout: typeof json.layout === 'string' ? json.layout : null,
      background: json.background === true,
      step_defs: steps.filter((s) => s && typeof s.id === 'string').map((s) => ({ id: s.id, kind: String(s.kind ?? ''), gate: s.gate, fanout: s.fanout, loop_max: s.loop?.max, view: s.view, layout: typeof s.layout === 'string' ? s.layout : null })),
    };
    fileCache.set(key, hit);
  }
  return hit;
}

function parse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Everything the workbench draws, read in one pass from a read-only connection. `projectId` scopes sessions and runs. */
export function snapshot(db: DatabaseSync, projectId: string | null, runId: string | null, now = Date.now()): Snapshot {
  const meta = Object.fromEntries((db.prepare("SELECT key, value FROM meta WHERE key IN ('core_pid','core_heartbeat')").all() as Array<{ key: string; value: string }>).map((r) => [r.key, r.value]));
  const beat = meta.core_heartbeat ? Date.parse(meta.core_heartbeat) : NaN;
  const age = Number.isNaN(beat) ? null : Math.max(0, now - beat);

  const engines = (db.prepare(
    `SELECT e.id, e.plugin_id, e.spec_json, c.installed, c.version, c.auth, c.checked_at
     FROM engine e LEFT JOIN plugin p ON p.id = e.plugin_id
     LEFT JOIN engine_check c ON c.engine_id = e.id AND c.checked_at = (SELECT MAX(checked_at) FROM engine_check WHERE engine_id = e.id)
     WHERE e.plugin_id IS NULL OR p.enabled = 1
     ORDER BY e.cost_rank, e.id`,
  ).all() as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    light: light(r.checked_at ? { installed: Number(r.installed), auth: String(r.auth) } : null),
    version: (r.version as string | null) ?? null,
    auth: (r.auth as string | null) ?? null,
    checked_at: (r.checked_at as string | null) ?? null,
    plugin_id: (r.plugin_id as string | null) ?? null,
    roles: parse<{ roles?: string[] }>(r.spec_json as string, {}).roles ?? [],
    resumable: Boolean(parse<{ resume_args?: string[] }>(r.spec_json as string, {}).resume_args?.length),
  }));

  const pipelines = (db.prepare('SELECT id, source, path, version, valid, errors FROM pipeline ORDER BY id').all() as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id),
    ...pipelineFile(String(r.path), Number(r.version), String(r.id)),
    source: String(r.source),
    path: String(r.path),
    valid: Number(r.valid) === 1,
    errors: parse<string[]>(r.errors as string | null, []),
  }));

  const driven = (db.prepare('PRAGMA table_info(session)').all() as Array<{ name: string }>).some((c) => c.name === 'driven_engine') ? 's.driven_engine' : 'NULL AS driven_engine';
  const sessions = projectId
    ? (db.prepare(
        `SELECT s.id, s.engine_id, ${driven}, s.state, s.state_at, s.last_tool, s.cwd, s.title, s.last_line, s.native_id, s.run_id, s.step_id, s.started_at,
           (SELECT SUM(COALESCE(tokens_in,0) + COALESCE(tokens_out,0) + COALESCE(cache_read,0) + COALESCE(cache_write,0)) FROM usage u WHERE u.session_id = s.id) AS tokens,
           (SELECT CASE WHEN COUNT(*) = COUNT(usd) THEN SUM(usd) END FROM usage u WHERE u.session_id = s.id) AS usd
         FROM session s WHERE s.project_id = ? AND s.hidden = 0 ORDER BY s.started_at DESC LIMIT 50`,
      ).all(projectId) as Snapshot['sessions'])
    : [];

  const runs = projectId
    ? (db.prepare(
        `SELECT id, pipeline_id, status, paused_why, started_at, ended_at, depth, parent_run FROM run
         WHERE project_id = ? ORDER BY started_at DESC LIMIT 30`,
      ).all(projectId) as Snapshot['runs'])
    : [];

  const steps = projectId
    ? (db.prepare(
        `WITH shown(id) AS (
           SELECT id FROM run WHERE id = ? OR (project_id = ? AND (status IN ('running', 'paused') OR id IN (SELECT run_id FROM session WHERE project_id = ? AND run_id IS NOT NULL ORDER BY started_at DESC LIMIT 20)))
         )
         SELECT run_id, step_id, iteration, fanout_index, status, engine_id, session_id, fail_count, output_path FROM run_step
         WHERE run_id IN (SELECT id FROM shown) OR run_id IN (SELECT id FROM run WHERE parent_run IN (SELECT id FROM shown)) ORDER BY rowid`,
      ).all(runId, projectId, projectId) as Snapshot['steps'])
    : [];

  const gates = (db.prepare(
    `WITH RECURSIVE up(id, top) AS (
       SELECT id, id FROM run WHERE parent_run IS NULL
       UNION ALL SELECT r.id, up.top FROM run r JOIN up ON r.parent_run = up.id)
     SELECT g.id, g.run_id, up.top AS top_run, r.pipeline_id, g.step_id, g.guards_step, g.kind, g.action_hash, g.summary, r.project_id
     FROM gate g JOIN run r ON r.id = g.run_id JOIN up ON up.id = g.run_id
     WHERE g.status = 'waiting' ORDER BY g.rowid`,
  ).all() as Snapshot['gates']);

  const panes = projectId
    ? (db.prepare('SELECT id, url, session_id, run_id, variant, dev_port FROM browser_pane WHERE project_id = ? AND open = 1 ORDER BY id').all(projectId) as Snapshot['panes'])
    : [];
  const snapshots = projectId
    ? (db.prepare(
        `SELECT s.id, s.pane_id, s.label, s.url, s.taken_at, s.w390_path, s.w1280_path FROM snapshot s JOIN browser_pane p ON p.id = s.pane_id
         WHERE p.project_id = ? ORDER BY s.taken_at DESC LIMIT 40`,
      ).all(projectId) as Snapshot['snapshots'])
    : [];

  const board = runId
    ? (db.prepare(
        `SELECT id, run_id, source_url, capture_path, reason, pinned FROM board_item
         WHERE removed = 0 AND (run_id = ? OR run_id IN (SELECT id FROM run WHERE parent_run = ?)) ORDER BY pinned DESC, rowid`,
      ).all(runId, runId) as Snapshot['board'])
    : [];

  const variants = runId
    ? (db.prepare(
        `SELECT v.idx, v.status, v.branch, v.pane_id, v.dev_port, a.step_id, a.engine_id, a.session_id,
           (SELECT SUM(COALESCE(tokens_in,0) + COALESCE(tokens_out,0) + COALESCE(cache_read,0) + COALESCE(cache_write,0)) FROM usage u WHERE u.session_id = a.session_id) AS tokens,
           (SELECT CASE WHEN COUNT(*) = COUNT(usd) THEN SUM(usd) END FROM usage u WHERE u.session_id = a.session_id) AS usd
         FROM variant v
         LEFT JOIN run_step a ON a.rowid = (SELECT rowid FROM run_step WHERE run_id = v.run_id AND fanout_index = v.idx AND session_id IS NOT NULL ORDER BY rowid DESC LIMIT 1)
         WHERE v.run_id = ? ORDER BY v.idx`,
      ).all(runId) as Snapshot['variants'])
    : [];

  const needs_you = db.prepare('SELECT id, at, kind, ref, text, read_at FROM needs_you WHERE resolved_at IS NULL ORDER BY at DESC LIMIT 100').all() as Snapshot['needs_you'];

  return {
    at: now,
    core: { online: age !== null && age < OFFLINE_AFTER_MS, pid: meta.core_pid ? Number(meta.core_pid) : null, heartbeat_age_ms: age },
    projects: db.prepare('SELECT id, name, path, last_opened FROM project ORDER BY last_opened DESC').all() as Snapshot['projects'],
    engines,
    sessions,
    pipelines,
    runs,
    steps,
    gates,
    needs_you,
    panes,
    snapshots,
    board,
    variants,
    git: {},
    selected: (db.prepare("SELECT session_id FROM ui_selection WHERE window_id = 'main'").get() as { session_id: string | null } | undefined)?.session_id ?? null,
    limits: db.prepare('SELECT provider, account, window, used_pct, resets_at, read_at, status FROM limit_reading ORDER BY provider, window').all() as Snapshot['limits'],
  };
}

export function dataVersion(db: DatabaseSync): number {
  return Number((db.prepare('PRAGMA data_version').get() as { data_version: number }).data_version);
}
