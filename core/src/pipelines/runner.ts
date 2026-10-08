import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, fork, type ChildProcess } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { coreDir, homeDir } from '../paths.ts';
import { nowIso, ulid } from '../time.ts';
import { E, RpcError } from '../pipe/errors.ts';
import { bindRole, getEngine, type EngineSpec } from '../engines/registry.ts';
import { folderApproval, launchSession } from '../sessions/launch.ts';
import { canonicalPath } from '../project.ts';
import { pidAlive } from '../sessions/watch.ts';
import { trustFolder } from '../trust.ts';
import { leasePort, releasePorts } from '../ports.ts';
import { getSecret } from '../secrets.ts';
import { BASE_ENV, killPid, killTree, runAction } from '../plugins/actions.ts';
import { loadPlugin } from '../plugins/store.ts';
import { pluginAction, syncPipelines, validationContext } from './store.ts';
import { isGuarded, parseUses, validatePipeline, type Pipeline, type Step } from './validate.ts';
import { actionHash, parseFrontMatter, resolveString, resolveValue, sha256, type Scope } from './template.ts';
import { startDevServer, stopDevServer, stopRunServers, waitReady } from './devserver.ts';
import * as term from '../terminal/index.ts';
import { BOARD_ACTION, captureBoard, recordBoard, referencesOf, type BoardCapture } from '../board.ts';

const POLL_MS = 500;
const STABLE_MS = 10_000;
const SETTLED_GRACE_MS = 120_000;
const DRIVER_PROMPT = path.join(import.meta.dirname, 'driver-prompt.md');
const DRIVER_TURNS = 3;
const BREAKER = 3;

interface RunRow {
  id: string;
  pipeline_id: string;
  parent_run: string | null;
  parent_step: string | null;
  depth: number;
  project_id: string;
  inputs: string;
  run_dir: string;
  status: string;
  paused_why: string | null;
  max_tokens: number;
  max_usd: number;
  max_minutes: number;
  started_at: string;
}

interface StepRow {
  step_id: string;
  iteration: number;
  fanout_index: number;
  status: string;
  engine_id: string | null;
  session_id: string | null;
  output_path: string | null;
  outputs: string | null;
  fail_count: number;
  started_at: string | null;
}

type IndexResult = { ok: true; outputs: Record<string, unknown> } | { ok: false; error: string } | { paused: string };
type StepOutcome = 'done' | 'failed' | 'paused' | 'stopped';
export type PaneCapture = (paneId: string, label: string) => Promise<{ w1280_path: string }>;

export interface StartParams {
  pipeline_id: string;
  project_id: string;
  inputs?: Record<string, unknown>;
  trigger?: 'manual' | 'schedule' | 'cli';
}

function slash(p: string): string {
  return p.split(String.fromCharCode(92)).join('/');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

class Semaphore {
  private free: number;
  private queue: Array<() => void> = [];
  constructor(n: number) {
    this.free = n;
  }
  async take(): Promise<() => void> {
    if (this.free > 0) this.free--;
    else await new Promise<void>((r) => this.queue.push(r));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) next();
      else this.free++;
    };
  }
}

export class Runner {
  private db: DatabaseSync;
  private active = new Set<string>();
  private children = new Map<string, ChildProcess>();
  private boardCapture: BoardCapture | null = null;
  private paneCapture: PaneCapture | null = null;

  constructor(db: DatabaseSync) {
    this.db = db;
  }

  setBoardCapture(capture: BoardCapture): void {
    this.boardCapture = capture;
  }

  setPaneCapture(capture: PaneCapture): void {
    this.paneCapture = capture;
  }

  private run(id: string): RunRow | undefined {
    return this.db.prepare('SELECT * FROM run WHERE id = ?').get(id) as RunRow | undefined;
  }

  private pipelineOf(run: RunRow): Pipeline {
    return JSON.parse(fs.readFileSync(path.join(run.run_dir, 'pipeline.json'), 'utf8')) as Pipeline;
  }

  private project(id: string): { id: string; path: string; name: string } {
    const p = this.db.prepare('SELECT id, path, name FROM project WHERE id = ?').get(id) as { id: string; path: string; name: string } | undefined;
    if (!p) throw new RpcError(E.NOT_FOUND, 'project not found');
    return p;
  }

  private log(run: RunRow, entry: Record<string, unknown>): void {
    try {
      fs.appendFileSync(path.join(run.run_dir, 'log.jsonl'), JSON.stringify({ at: nowIso(), stream: 'runner', ...entry }) + '\n');
    } catch {}
  }

  private needsYou(kind: string, ref: string, text: string): void {
    this.db.prepare('INSERT INTO needs_you (id, at, kind, ref, text) VALUES (?, ?, ?, ?, ?)').run(ulid(), nowIso(), kind, ref, text);
  }


  start(params: StartParams, parent?: { run: RunRow; step: string; budget: { tokens: number; usd: number; minutes: number } }): string {
    const found = syncPipelines(this.db);
    const entry = found.get(params.pipeline_id);
    if (!entry) throw new RpcError(E.NOT_FOUND, `pipeline ${params.pipeline_id} not found`);
    const errors = entry.json === null ? ['file is not valid JSON'] : validatePipeline(entry.json, validationContext(this.db, found, path.dirname(entry.path)));
    if (errors.length) throw new RpcError(E.VALIDATION, `pipeline ${params.pipeline_id} is invalid`, { errors });
    const pipe = entry.json as Pipeline;
    if (pipe.run_in === 'cloud') throw new RpcError(E.CLOUD_UNAVAILABLE, 'cloud runs are not available yet');
    const project = this.project(params.project_id);
    const inputs = this.inputsFor(pipe, params.inputs ?? {});

    const id = ulid();
    const runDir = parent ? path.join(parent.run.run_dir, parent.step, id) : path.join(project.path, '.troop', 'runs', id);
    fs.mkdirSync(runDir, { recursive: true });
    if (!parent) excludeTroop(project.path);
    const snapshot: Pipeline & { source_dir?: string } = { ...pipe, source_dir: path.dirname(entry.path) } as Pipeline & { source_dir?: string };
    fs.writeFileSync(path.join(runDir, 'pipeline.json'), JSON.stringify(snapshot, null, 2) + '\n');
    fs.writeFileSync(path.join(runDir, 'inputs.json'), JSON.stringify(inputs, null, 2) + '\n');
    const b = pipe.budget ?? {};
    const budget = parent?.budget ?? { tokens: b.max_tokens ?? 2_000_000, usd: b.max_usd ?? 5, minutes: b.max_minutes ?? 120 };
    this.db.prepare(
      `INSERT INTO run (id, pipeline_id, parent_run, parent_step, depth, project_id, inputs, run_dir, status, trigger, max_tokens, max_usd, max_minutes, started_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?, ?, ?, ?)`,
    ).run(id, pipe.id, parent?.run.id ?? null, parent?.step ?? null, parent ? parent.run.depth + 1 : 0, project.id, JSON.stringify(inputs), slash(runDir),
      params.trigger ?? 'manual', Math.max(0, Math.floor(budget.tokens)), Math.max(0, budget.usd), Math.max(0, Math.ceil(budget.minutes)), nowIso());
    const pending = this.db.prepare("INSERT INTO run_step (run_id, step_id, iteration, fanout_index, status) VALUES (?, ?, 0, 0, 'pending')");
    for (const s of pipe.steps) pending.run(id, s.id);
    const run = this.run(id) as RunRow;
    this.log(run, { event: 'run started', pipeline: pipe.id });
    void this.drive(id);
    return id;
  }

  private inputsFor(pipe: Pipeline, given: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    const errors: string[] = [];
    for (const [name, spec] of Object.entries(pipe.inputs ?? {})) {
      const v = given[name] === '' ? spec.default : given[name] ?? spec.default;
      if (v === undefined || v === '') {
        if (spec.required !== false) errors.push(`input ${name} is required`);
        continue;
      }
      if (spec.type === 'number' && typeof v !== 'number') errors.push(`input ${name} must be a number`);
      else if (spec.type === 'boolean' && typeof v !== 'boolean') errors.push(`input ${name} must be true or false`);
      else if (spec.type === 'choice' && !(spec.choices ?? []).includes(String(v))) errors.push(`input ${name} must be one of ${(spec.choices ?? []).join(', ')}`);
      else if (['text', 'url', 'path'].includes(spec.type) && typeof v !== 'string') errors.push(`input ${name} must be text`);
      out[name] = v;
    }
    if (errors.length) throw new RpcError(E.VALIDATION, 'inputs are invalid', { errors });
    return out;
  }

  cancel(runId: string): void {
    const run = this.run(runId);
    if (!run) throw new RpcError(E.NOT_FOUND, 'run not found');
    if (['done', 'failed', 'cancelled'].includes(run.status) && run.status !== 'failed') return;
    for (const child of this.db.prepare("SELECT id FROM run WHERE parent_run = ? AND status IN ('running','paused')").all(runId) as Array<{ id: string }>) this.cancel(child.id);
    this.end(run, 'cancelled');
  }

  resume(runId: string, raise: { max_tokens?: number; max_usd?: number; max_minutes?: number } = {}): void {
    const run = this.run(runId);
    if (!run) throw new RpcError(E.NOT_FOUND, 'run not found');
    if (run.status === 'running') return;
    if (run.status === 'done' || run.status === 'cancelled') throw new RpcError(E.VALIDATION, `run is ${run.status}`, { errors: [`run is ${run.status}`] });
    if (this.db.prepare("SELECT 1 FROM gate WHERE run_id = ? AND status = 'waiting'").get(runId)) {
      throw new RpcError(E.VALIDATION, 'the run is waiting at a gate; resolve it instead', { errors: ['waiting at a gate'] });
    }
    const set = this.db.prepare('UPDATE run SET max_tokens = MAX(max_tokens, ?), max_usd = MAX(max_usd, ?), max_minutes = MAX(max_minutes, ?) WHERE id = ?');
    set.run(raise.max_tokens ?? 0, raise.max_usd ?? 0, raise.max_minutes ?? 0, runId);
    if (run.paused_why === 'breaker') {
      this.db.prepare("UPDATE run_step SET fail_count = 0 WHERE run_id = ? AND status = 'failed'").run(runId);
      this.log(run, { event: 'breaker reset', detail: 'failure counts cleared by resume' });
    }
    if (!this.active.has(runId)) {
      for (const s of this.db.prepare("SELECT session_id FROM run_step WHERE run_id = ? AND status IN ('failed','running') AND session_id IS NOT NULL").all(runId) as Array<{ session_id: string }>) this.killSession(s.session_id);
    }
    this.db.prepare("UPDATE run_step SET status = 'pending', session_id = NULL WHERE run_id = ? AND status IN ('failed','running')").run(runId);
    const raised = this.run(runId) as RunRow;
    for (const c of this.db.prepare("SELECT * FROM run WHERE parent_run = ? AND status IN ('paused','failed') AND paused_why IS NOT 'breaker'").all(runId) as unknown as RunRow[]) {
      if (this.db.prepare("SELECT 1 FROM gate WHERE run_id = ? AND status = 'waiting'").get(c.id)) continue;
      this.resume(c.id, {
        max_tokens: c.max_tokens + raised.max_tokens - run.max_tokens,
        max_usd: c.max_usd + raised.max_usd - run.max_usd,
        max_minutes: c.max_minutes + raised.max_minutes - run.max_minutes,
      });
    }
    this.db.prepare("UPDATE run SET status = 'running', paused_why = NULL, ended_at = NULL WHERE id = ?").run(runId);
    this.db.prepare("UPDATE needs_you SET resolved_at = ? WHERE ref = ? AND kind IN ('run-failed','budget','other') AND resolved_at IS NULL").run(nowIso(), runId);
    this.log(run, { event: 'run resumed' });
    void this.drive(runId);
  }

  private pause(run: RunRow, why: string, needs?: { kind: string; ref: string; text: string }): StepOutcome {
    this.db.prepare("UPDATE run SET status = 'paused', paused_why = ? WHERE id = ? AND status = 'running'").run(why, run.id);
    if (needs) this.needsYou(needs.kind, needs.ref, needs.text);
    this.log(run, { event: 'run paused', why });
    return 'paused';
  }

  private fail(run: RunRow, text: string, breaker = false): StepOutcome {
    this.db.prepare("UPDATE run SET status = 'failed', paused_why = ?, ended_at = ? WHERE id = ?").run(breaker ? 'breaker' : null, nowIso(), run.id);
    this.needsYou('run-failed', run.id, text);
    this.log(run, { event: 'run failed', why: text });
    stopRunServers(this.db, run.id);
    return 'failed';
  }

  private end(run: RunRow, status: 'done' | 'cancelled'): void {
    this.db.prepare('UPDATE run SET status = ?, paused_why = NULL, ended_at = ? WHERE id = ?').run(status, nowIso(), run.id);
    if (status === 'cancelled') {
      this.db.prepare("UPDATE gate SET status = 'rejected', decided_at = ?, note = 'run cancelled' WHERE run_id = ? AND status = 'waiting'").run(nowIso(), run.id);
      this.db.prepare("UPDATE needs_you SET resolved_at = ? WHERE resolved_at IS NULL AND (ref = ? OR ref IN (SELECT id FROM gate WHERE run_id = ?))").run(nowIso(), run.id, run.id);
      for (const [k, child] of this.children) if (k.startsWith(`${run.id}/`)) killTree(child);
      for (const s of this.db.prepare('SELECT id FROM session WHERE run_id = ?').all(run.id) as Array<{ id: string }>) this.killSession(s.id);
    }
    stopRunServers(this.db, run.id);
    this.removeWorktrees(run);
    this.log(run, { event: `run ${status}` });
  }

  /** Removes the run's clean worktrees, and each troop branch that has no commits beyond the project's HEAD. */
  private removeWorktrees(run: RunRow): void {
    const project = this.project(run.project_id);
    const root = path.join(homeDir(), 'worktrees', project.id);
    if (!fs.existsSync(root)) return;
    for (const name of fs.readdirSync(root).filter((n) => n.startsWith(`${run.id.toLowerCase()}-`))) {
      const dir = path.join(root, name);
      try {
        git(project.path, ['worktree', 'remove', dir]);
        this.db.prepare("UPDATE variant SET worktree = '' WHERE run_id = ? AND worktree = ?").run(run.id, slash(dir));
      } catch (e) {
        this.log(run, { event: 'worktree kept', path: slash(dir), why: gitError(e) });
      }
      try {
        git(project.path, ['branch', '-d', `troop/${name}`]);
      } catch {}
    }
  }

  private live(runId: string): boolean {
    return this.run(runId)?.status === 'running';
  }


  /** Runs steps in order until the run finishes, pauses or fails. One drive per run at a time. */
  async drive(runId: string): Promise<void> {
    if (this.active.has(runId)) return;
    this.active.add(runId);
    try {
      for (;;) {
        const run = this.run(runId);
        if (!run || run.status !== 'running') return;
        const pipe = this.pipelineOf(run);
        const next = this.nextStep(run, pipe);
        if (!next) {
          this.end(run, 'done');
          return;
        }
        const over = this.budgetReason(run);
        if (over) {
          this.pause(run, 'budget', { kind: 'budget', ref: run.id, text: `${pipe.title}: ${over}; raise the budget and resume` });
          return;
        }
        const outcome = await this.execStep(run, pipe, next.step, next.iteration);
        const finished = outcome === 'done' || (outcome === 'stopped' && this.run(runId)?.status === 'paused');
        if (next.step.loop && finished && this.rows(runId, next.step.id, next.iteration).every((r) => r.status === 'done')) this.afterLoop(run, pipe, next.step, next.iteration);
        if (outcome !== 'done') return;
      }
    } catch (e) {
      const run = this.run(runId);
      if (run && run.status === 'running') this.fail(run, `runner error: ${(e as Error).message}`);
    } finally {
      this.active.delete(runId);
    }
  }

  private rows(runId: string, stepId: string, iteration?: number): StepRow[] {
    if (iteration === undefined) {
      return this.db.prepare(
        'SELECT * FROM run_step WHERE run_id = ? AND step_id = ? AND iteration = (SELECT MAX(iteration) FROM run_step WHERE run_id = ? AND step_id = ?) ORDER BY fanout_index',
      ).all(runId, stepId, runId, stepId) as unknown as StepRow[];
    }
    return this.db.prepare('SELECT * FROM run_step WHERE run_id = ? AND step_id = ? AND iteration = ? ORDER BY fanout_index').all(runId, stepId, iteration) as unknown as StepRow[];
  }

  private nextStep(run: RunRow, pipe: Pipeline): { step: Step; iteration: number } | null {
    for (const step of pipe.steps) {
      const rows = this.rows(run.id, step.id);
      if (!rows.length) return { step, iteration: 0 };
      const want = step.fanout ?? 1;
      if (rows.length < want || rows.some((r) => r.status !== 'done' && r.status !== 'skipped')) return { step, iteration: rows[0].iteration };
    }
    return null;
  }

  private afterLoop(run: RunRow, pipe: Pipeline, step: Step, iteration: number): void {
    const loop = step.loop as NonNullable<Step['loop']>;
    if (this.evalUntil(run, loop.until)) {
      this.log(run, { event: 'loop passed', step: step.id, iteration });
      return;
    }
    if (iteration + 1 >= loop.max) {
      this.pause(run, 'loop-max', { kind: 'other', ref: run.id, text: `${pipe.title}: loop ending at ${step.id} ran ${loop.max} times without passing; resume to go on anyway` });
      return;
    }
    const insert = this.db.prepare("INSERT OR IGNORE INTO run_step (run_id, step_id, iteration, fanout_index, status) VALUES (?, ?, ?, 0, 'pending')");
    for (const id of loop.steps) insert.run(run.id, id, iteration + 1);
    this.log(run, { event: 'loop again', step: step.id, iteration: iteration + 1 });
  }

  private evalUntil(run: RunRow, until: string): boolean {
    const passed = /^steps\.([a-z0-9-]+)\.passed$/.exec(until);
    const equals = /^steps\.([a-z0-9-]+)\.outputs\.([a-z0-9_]+) == "([^"]*)"$/.exec(until);
    const id = (passed ?? equals)?.[1];
    if (!id) return false;
    const rows = this.rows(run.id, id);
    if (!rows.length || rows.some((r) => r.status !== 'done')) return false;
    const outs = rows.map((r) => (r.outputs ? JSON.parse(r.outputs) : {}) as Record<string, unknown>);
    if (passed) return outs.every((o) => o.passed !== false);
    return outs.every((o) => String(o[(equals as RegExpExecArray)[2]]) === (equals as RegExpExecArray)[3]);
  }


  private runTree(runId: string): string[] {
    const ids = [runId];
    for (let i = 0; i < ids.length; i++) {
      for (const r of this.db.prepare('SELECT id FROM run WHERE parent_run = ?').all(ids[i]) as Array<{ id: string }>) ids.push(r.id);
    }
    return ids;
  }

  /** Tokens (input, output and cache writes) and dollars used by a run and its sub-pipeline runs. */
  used(runId: string): { tokens: number; usd: number } {
    const ids = this.runTree(runId);
    const marks = ids.map(() => '?').join(',');
    const r = this.db.prepare(
      `SELECT COALESCE(SUM(COALESCE(tokens_in,0) + COALESCE(tokens_out,0) + COALESCE(cache_write,0)), 0) AS tokens, COALESCE(SUM(usd), 0) AS usd
       FROM usage WHERE run_id IN (${marks})`,
    ).get(...ids) as { tokens: number; usd: number };
    return { tokens: Number(r.tokens), usd: Number(r.usd) };
  }

  private budgetReason(run: RunRow): string | null {
    const u = this.used(run.id);
    if (u.tokens >= run.max_tokens) return `token budget reached (${u.tokens} of ${run.max_tokens})`;
    if (u.usd >= run.max_usd) return `dollar budget reached ($${u.usd.toFixed(2)} of $${run.max_usd.toFixed(2)})`;
    const minutes = this.minutesUsed(run);
    if (minutes >= run.max_minutes) return `time budget reached (${Math.floor(minutes)} of ${run.max_minutes} minutes)`;
    return null;
  }

  /** Wall-clock minutes since the run started, less the time it or its sub-pipeline runs waited at a gate. */
  private minutesUsed(run: RunRow): number {
    const ids = this.runTree(run.id);
    const waits = this.db.prepare(
      `SELECT at, resolved_at FROM needs_you WHERE kind IN ('gate','handoff') AND ref IN (SELECT id FROM gate WHERE run_id IN (${ids.map(() => '?').join(',')})) ORDER BY at`,
    ).all(...ids) as Array<{ at: string; resolved_at: string | null }>;
    const now = Date.now();
    const start = Date.parse(run.started_at);
    let ms = now - start;
    let edge = start;
    for (const w of waits) {
      const from = Math.max(Date.parse(w.at), edge);
      const to = w.resolved_at ? Date.parse(w.resolved_at) : now;
      if (to > from) ms -= to - from;
      edge = Math.max(edge, to);
    }
    return ms / 60_000;
  }

  private remaining(run: RunRow): { tokens: number; usd: number; minutes: number } {
    const u = this.used(run.id);
    const minutes = this.minutesUsed(run);
    return { tokens: Math.max(0, run.max_tokens - u.tokens), usd: Math.max(0, run.max_usd - u.usd), minutes: Math.max(1, run.max_minutes - minutes) };
  }


  private scope(run: RunRow, index?: number, port?: number): Scope {
    const project = this.project(run.project_id);
    const pipelineOf = (r: RunRow) => this.pipelineOf(r);
    return {
      inputs: JSON.parse(run.inputs),
      steps: (id) => {
        const rows = this.rows(run.id, id).filter((r) => r.status === 'done');
        if (!rows.length) return null;
        return {
          outputs: rows.map((r) => (r.outputs ? JSON.parse(r.outputs) : {})),
          outputPaths: rows.map((r) => r.output_path ?? '').filter(Boolean),
          fanout: rows.length > 1 || rows[0].fanout_index > 0,
        };
      },
      run: { id: run.id, dir: run.run_dir },
      project: { path: project.path },
      get pipeline() {
        const dir = (pipelineOf(run) as Pipeline & { source_dir?: string }).source_dir;
        return dir ? { dir: slash(dir) } : undefined;
      },
      picked: () => (this.db.prepare("SELECT worktree, branch FROM variant WHERE run_id = ? AND status = 'picked'").get(run.id) as { worktree: string; branch: string } | undefined) ?? null,
      index,
      port,
    };
  }


  private async execStep(run: RunRow, pipe: Pipeline, step: Step, iteration: number): Promise<StepOutcome> {
    const n = step.fanout ?? 1;
    const ensure = this.db.prepare("INSERT OR IGNORE INTO run_step (run_id, step_id, iteration, fanout_index, status) VALUES (?, ?, ?, ?, 'pending')");
    for (let i = 0; i < n; i++) ensure.run(run.id, step.id, iteration, i);

    if (step.kind === 'gate') return this.gateStep(run, pipe, step, iteration);
    const ctx = { action: (p: string, a: string) => pluginAction(this.db, p, a) };
    if (isGuarded(step, ctx)) {
      const check = this.checkApproval(run, pipe, step);
      if (check !== 'ok') return check;
    }

    const rows = this.rows(run.id, step.id, iteration);
    const limit = new Semaphore(step.kind === 'agent' ? pipe.budget?.max_parallel ?? 3 : n);
    let budgetHit = false;
    const results = await Promise.all(rows.map(async (row): Promise<IndexResult | null> => {
      if (row.status === 'done' || row.status === 'skipped') return null;
      const release = await limit.take();
      try {
        const fresh = this.run(run.id) as RunRow;
        if (fresh.status !== 'running') return { paused: fresh.status };
        if (!row.session_id && step.kind === 'agent' && this.budgetReason(fresh)) {
          budgetHit = true;
          return { paused: 'budget' };
        }
        return await this.execIndex(fresh, pipe, step, row);
      } finally {
        release();
      }
    }));

    const current = this.run(run.id) as RunRow;
    const failures = results.filter((r): r is { ok: false; error: string } => r !== null && 'ok' in r && r.ok === false);
    if (failures.length) {
      const tripped = this.rows(run.id, step.id, iteration).some((r) => r.fail_count >= BREAKER);
      if (current.status !== 'running') return 'failed';
      if (!budgetHit || tripped) return this.fail(current, `step ${step.id} failed: ${failures.map((f) => f.error).join('; ')}`, tripped);
    }
    if (current.status !== 'running') return 'stopped';
    if (budgetHit) return this.pause(current, 'budget', { kind: 'budget', ref: run.id, text: `${pipe.title}: budget reached during ${step.id}; raise the budget and resume` });
    if (results.some((r) => r !== null && 'paused' in r)) return 'stopped';
    return 'done';
  }

  private markRunning(run: RunRow, row: StepRow, extra: Record<string, unknown> = {}): void {
    this.db.prepare("UPDATE run_step SET status = 'running', started_at = COALESCE(?, started_at), ended_at = NULL WHERE run_id = ? AND step_id = ? AND iteration = ? AND fanout_index = ?")
      .run(row.status === 'running' ? null : nowIso(), run.id, row.step_id, row.iteration, row.fanout_index);
    for (const [k, v] of Object.entries(extra)) {
      if (!['engine_id', 'session_id', 'output_path'].includes(k)) continue;
      this.db.prepare(`UPDATE run_step SET ${k} = ? WHERE run_id = ? AND step_id = ? AND iteration = ? AND fanout_index = ?`)
        .run(v as string, run.id, row.step_id, row.iteration, row.fanout_index);
    }
  }

  private finishRow(run: RunRow, row: StepRow, r: IndexResult): IndexResult {
    if ('paused' in r) return r;
    if (r.ok) {
      this.db.prepare("UPDATE run_step SET status = 'done', outputs = ?, ended_at = ? WHERE run_id = ? AND step_id = ? AND iteration = ? AND fanout_index = ?")
        .run(JSON.stringify(r.outputs), nowIso(), run.id, row.step_id, row.iteration, row.fanout_index);
      this.log(run, { event: 'step done', step: row.step_id, iteration: row.iteration, index: row.fanout_index });
    } else {
      this.db.prepare("UPDATE run_step SET status = 'failed', fail_count = fail_count + 1, ended_at = ? WHERE run_id = ? AND step_id = ? AND iteration = ? AND fanout_index = ?")
        .run(nowIso(), run.id, row.step_id, row.iteration, row.fanout_index);
      this.log(run, { event: 'step failed', step: row.step_id, iteration: row.iteration, index: row.fanout_index, why: r.error });
    }
    return r;
  }

  private async execIndex(run: RunRow, pipe: Pipeline, step: Step, row: StepRow, raw = false): Promise<IndexResult> {
    row = { ...row };
    const idx = row.fanout_index;
    const fanout = Boolean(step.fanout);
    try {
      const place = await this.placeIndex(run, step, idx);
      this.markRunning(run, row);
      row = this.rows(run.id, row.step_id, row.iteration).find((r) => r.fanout_index === idx) as StepRow;
      const early = step.serve === 'before' && Boolean(step.dev_command && place.port);
      if (early) {
        const ready = await this.serveIndex(run, step, idx, place);
        if (!ready.ok) return this.finishRow(run, row, { ok: false, error: `dev server on port ${place.port} gave no response in 90 s:\n${ready.tail}` });
      }
      let result: IndexResult;
      if (step.kind === 'agent') result = await this.agentIndex(run, pipe, step, row, place, raw);
      else if (step.kind === 'action') result = await this.actionIndex(run, step, row, fanout);
      else if (step.kind === 'code') result = await this.codeIndex(run, pipe, step, row, fanout);
      else result = await this.pipelineIndex(run, step, row);
      if ('ok' in result && result.ok && step.worktree && place.branch) result = { ok: true, outputs: { ...result.outputs, worktree: place.cwd, branch: place.branch } };
      if ('ok' in result && result.ok && step.dev_command && place.port && !early) {
        const ready = await this.serveIndex(run, step, idx, place);
        if (!ready.ok) result = { ok: false, error: `dev server on port ${place.port} gave no response in 90 s:\n${ready.tail}` };
      }
      if ('ok' in result && result.ok && fanout && step.worktree) this.db.prepare("UPDATE variant SET status = 'ready' WHERE run_id = ? AND idx = ? AND status = 'building'").run(run.id, idx);
      return this.finishRow(run, row, result);
    } catch (e) {
      return this.finishRow(run, row, { ok: false, error: (e as Error).message });
    }
  }


  private async placeIndex(run: RunRow, step: Step, idx: number): Promise<{ cwd: string; port?: number; paneId?: string; branch?: string }> {
    const project = this.project(run.project_id);
    let cwd = project.path;
    let branch: string | undefined;
    if (step.worktree) {
      const name = `${run.id.toLowerCase()}-${step.id}-${idx}`;
      const dir = path.join(homeDir(), 'worktrees', project.id, name);
      branch = `troop/${name}`;
      let listed = '';
      try {
        listed = git(project.path, ['worktree', 'list', '--porcelain']);
      } catch {}
      const registered = listed.split('\n').some((l) => l.startsWith('worktree ') && slash(l.slice(9).trim()).toLowerCase() === slash(dir).toLowerCase());
      if (!registered) {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(dir), { recursive: true });
        try {
          git(project.path, ['worktree', 'prune']);
          let kept = true;
          try {
            git(project.path, ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]);
          } catch {
            kept = false;
          }
          git(project.path, ['worktree', 'add', dir, ...(kept ? [branch] : ['-b', branch, 'HEAD'])]);
        } catch (e) {
          throw new Error(`git worktree add failed: ${gitError(e)}`);
        }
      }
      cwd = slash(dir);
    } else if (step.cwd) {
      cwd = slash(resolveString(step.cwd, this.scope(run, idx)));
    }
    let port: number | undefined;
    if (step.dev_command) {
      const leased = this.db.prepare('SELECT port FROM port_lease WHERE run_id = ? AND idx = ?').get(run.id, idx) as { port: number } | undefined;
      port = leased?.port ?? (await leasePort(this.db, run.id, idx));
    }
    if (step.fanout && step.worktree) {
      this.db.prepare(
        `INSERT INTO variant (run_id, idx, worktree, branch, dev_port, status) VALUES (?, ?, ?, ?, ?, 'building')
         ON CONFLICT(run_id, idx) DO UPDATE SET worktree = excluded.worktree, branch = excluded.branch, dev_port = excluded.dev_port`,
      ).run(run.id, idx, cwd, branch ?? '', port ?? 0);
    }
    let paneId: string | undefined;
    if (step.browser) {
      const existing = this.db.prepare('SELECT id FROM browser_pane WHERE run_id = ? AND variant = ? AND open = 1').get(run.id, idx) as { id: string } | undefined;
      paneId = existing?.id ?? `bp_${ulid()}`;
      if (!existing) {
        this.db.prepare('INSERT INTO browser_pane (id, project_id, run_id, variant, dev_port, open) VALUES (?, ?, ?, ?, ?, 1)').run(paneId, project.id, run.id, idx, port ?? null);
      }
      if (step.fanout && step.worktree) this.db.prepare('UPDATE variant SET pane_id = ? WHERE run_id = ? AND idx = ?').run(paneId, run.id, idx);
    }
    return { cwd, port, paneId, branch };
  }

  private async serveIndex(run: RunRow, step: Step, idx: number, place: { cwd: string; port?: number; paneId?: string }): Promise<{ ok: true } | { ok: false; tail: string }> {
    const port = place.port as number;
    const command = resolveString(step.dev_command as string, this.scope(run, idx, port));
    startDevServer(this.db, run.id, idx, port, command, place.cwd);
    const ready = await waitReady(this.db, run.id, idx, port, () => !['running', 'paused'].includes(this.run(run.id)?.status ?? ''));
    if (ready.ok) {
      if (place.paneId) this.db.prepare('UPDATE browser_pane SET url = ?, dev_port = ?, open = 1 WHERE id = ?').run(`http://127.0.0.1:${port}/`, port, place.paneId);
    }
    return ready;
  }


  /** An active engine whose latest check does not say it is missing or signed out. */
  private usableEngine(id: string): EngineSpec | null {
    const e = getEngine(this.db, id);
    if (!e) return null;
    const c = this.db.prepare('SELECT installed, auth FROM engine_check WHERE engine_id = ? ORDER BY checked_at DESC LIMIT 1').get(id) as { installed: number; auth: string } | undefined;
    return c && (!c.installed || c.auth === 'missing') ? null : e;
  }

  private bindEngine(step: Step): EngineSpec | null {
    const usable = (id: string) => this.usableEngine(id);
    if (typeof step.engine === 'string') return usable(step.engine);
    if (Array.isArray(step.engine)) {
      for (const id of step.engine) {
        const e = usable(id);
        if (e) return e;
      }
      return null;
    }
    return bindRole(this.db, step.role ?? 'worker');
  }

  private outputPath(run: RunRow, stepId: string, idx: number, fanout: boolean): string {
    return slash(path.join(run.run_dir, fanout ? `${stepId}-${idx}.md` : `${stepId}.md`));
  }

  private promptFor(run: RunRow, idx: number, outPath: string, template: string, outputs: string[], raw = false): string {
    const body = raw ? template : resolveString(template, this.scope(run, idx));
    const earlier = new Set<string>();
    for (const m of template.matchAll(/\{\{\s*steps\.([a-z0-9-]+)\./g)) {
      for (const r of this.rows(run.id, m[1])) if (r.output_path) earlier.add(r.output_path);
    }
    const footer = [
      `When you are done, write your result to: ${outPath}`,
      `Start that file with a front matter block containing these keys: ${[...outputs].join(', ')}${outputs.length ? ', ' : ''}and status: done or failed.`,
      `Earlier step results you may need are in: ${earlier.size ? [...earlier].join(', ') : 'none'}`,
    ].join('\n');
    return `${body}\n\n${footer}`;
  }

  /** The driver session's prompt: the step prompt goes to a file, and the driver runs the engine on it in print mode. */
  private driverPrompt(engine: EngineSpec, prompt: string, a: { outPath: string; outputs: string[]; cwd: string; approval?: string }): string {
    const promptFile = a.outPath.replace(/\.md$/, '.prompt.md');
    fs.writeFileSync(promptFile, prompt);
    const q = (s: string) => `'${s.split("'").join(`'\\''`)}'`;
    const flags = engine.approval_profiles?.[folderApproval(canonicalPath(a.cwd), a.approval, engine)] ?? [];
    const command = [engine.command, ...(engine.args ?? []), '--print', `"$(cat ${q(promptFile)})"`, '--print-timeout', '0', '--output-format', 'text', ...flags, '--add-dir', q(slash(a.cwd)), '--add-dir', q(slash(path.dirname(a.outPath)))].join(' ');
    const fill: Record<string, string> = {
      engine: engine.id, prompt_file: promptFile, followup_file: a.outPath.replace(/\.md$/, '.followup.md'), output_path: a.outPath,
      outputs: a.outputs.length ? a.outputs.join(', ') : 'none', cwd: slash(a.cwd), command, max_turns: String(DRIVER_TURNS),
    };
    return fs.readFileSync(DRIVER_PROMPT, 'utf8').replace(/\{\{(\w+)\}\}/g, (m, k: string) => fill[k] ?? m);
  }

  private async agentIndex(run: RunRow, pipe: Pipeline, step: Step, row: StepRow, place: { cwd: string; paneId?: string }, raw = false): Promise<IndexResult> {
    const fanout = Boolean(step.fanout);
    const outPath = row.output_path ?? this.outputPath(run, step.id, row.fanout_index, fanout);
    if (step.continue) this.log(run, { event: 'memory not kept', step: step.id, detail: `continue: ${step.continue} is not supported; ran as a new session` });
    return this.runAgent(run, pipe, {
      stepId: step.id,
      row,
      template: step.prompt as string,
      raw,
      outputs: step.outputs ?? [],
      engine: () => this.bindEngine(step),
      outPath,
      cwd: place.cwd,
      paneId: place.paneId,
      timeoutMinutes: step.timeout_minutes ?? 30,
      index: row.fanout_index,
      approval: step.approval,
    });
  }

  private async runAgent(
    run: RunRow,
    pipe: Pipeline,
    a: { stepId: string; row: StepRow; template: string; raw?: boolean; outputs: string[]; engine: () => EngineSpec | null; outPath: string; cwd: string; paneId?: string; timeoutMinutes: number; index: number; approval?: string },
  ): Promise<IndexResult> {
    let sessionId = a.row.session_id;
    const where = [run.id, a.row.step_id, a.row.iteration, a.row.fanout_index] as const;
    if (!sessionId) {
      const engine = a.engine();
      if (!engine) return { ok: false, error: `no installed engine for step ${a.stepId}` };
      if (fs.existsSync(a.outPath)) fs.renameSync(a.outPath, a.outPath.replace(/\.md$/, `.iter${a.row.iteration}-${Date.now()}.md`));
      const prompt = this.promptFor(run, a.index, a.outPath, a.template, a.outputs, a.raw);
      const project = this.project(run.project_id);
      const driver = engine.driver ? this.usableEngine(engine.driver) : null;
      if (engine.driver && !driver) this.log(run, { event: 'driver unavailable', step: a.stepId, detail: `${engine.driver} is not usable; ${engine.id} runs without a driver` });
      const approval = driver ? a.approval ?? 'contained' : a.approval;
      trustFolder(fs.realpathSync.native(a.cwd), driver ? [engine, driver] : [engine]);
      const launched = launchSession(this.db, {
        projectId: project.id, projectPath: project.path, projectName: project.name, engine: driver ?? engine,
        prompt: driver ? this.driverPrompt(engine, prompt, { ...a, approval }) : prompt, cwd: a.cwd, runId: run.id, stepId: a.stepId, approval, drivenEngine: driver ? engine.id : undefined,
      });
      sessionId = launched.session_id;
      this.markRunning(run, a.row, { engine_id: (driver ?? engine).id, session_id: sessionId, output_path: a.outPath });
      if (a.paneId) this.db.prepare('UPDATE browser_pane SET session_id = ? WHERE id = ?').run(sessionId, a.paneId);
    }
    const started = Date.parse(a.row.started_at ?? nowIso());
    const deadline = started + a.timeoutMinutes * 60_000;
    try {
      for (;;) {
        const fresh = this.run(run.id);
        const status = fresh?.status;
        if (status === 'cancelled' || status === 'failed') return { paused: status };
        const over = fresh && status === 'running' ? this.budgetReason(fresh) : null;
        if (fresh && over) {
          this.pause(fresh, 'budget', { kind: 'budget', ref: run.id, text: `${pipe.title}: ${over} during ${a.stepId}; raise the budget and resume` });
          return { paused: 'budget' };
        }
        const session = this.db.prepare('SELECT state, state_at, driven_engine FROM session WHERE id = ?').get(sessionId) as { state: string; state_at: string; driven_engine: string | null } | undefined;
        const settled = session?.state === 'done' || session?.state === 'idle' || session?.state === 'exited';
        let fm: Record<string, unknown> | null = null;
        let mtime = 0;
        if (fs.existsSync(a.outPath)) {
          mtime = fs.statSync(a.outPath).mtimeMs;
          fm = parseFrontMatter(fs.readFileSync(a.outPath, 'utf8'));
        }
        if (fm?.status === 'failed') {
          return { ok: false, error: `${a.stepId} wrote status: failed` };
        }
        if (fm?.status === 'done') {
          const missing = a.outputs.filter((k) => !(k in fm));
          if (missing.length && (settled || !session?.driven_engine)) {
            return { ok: false, error: `${a.stepId} output is missing ${missing.join(', ')}` };
          }
          if (!missing.length && (settled || Date.now() - mtime >= STABLE_MS)) {
            const { status: _s, ...outputs } = fm;
            return { ok: true, outputs };
          }
        } else if (session?.state === 'exited') {
          return { ok: false, error: `${a.stepId}: the session exited without writing ${a.outPath}` };
        } else if (settled && Date.now() - Date.parse(session.state_at) >= SETTLED_GRACE_MS) {
          return { ok: false, error: `${a.stepId}: the session stopped without writing ${a.outPath}` };
        }
        if (Date.now() > deadline) {
          return { ok: false, error: `${a.stepId} timed out after ${a.timeoutMinutes} minutes` };
        }
        await sleep(POLL_MS);
      }
    } finally {
      this.killSession(sessionId);
    }
  }

  private killSession(id: string | null): void {
    if (id) term.kill(id);
  }


  private async actionIndex(run: RunRow, step: Step, row: StepRow, fanout: boolean): Promise<IndexResult> {
    const u = parseUses(step.uses as string);
    if (u?.kind !== 'plugin') return { ok: false, error: `bad uses ${step.uses}` };
    const plugin = loadPlugin(this.db, u.plugin);
    if (!plugin) return { ok: false, error: `plugin ${u.plugin} is not installed or not enabled` };
    const input = resolveValue(step.with ?? {}, this.scope(run, row.fanout_index)) as Record<string, unknown>;
    const project = this.project(run.project_id);
    const r = await runAction({
      plugin, actionId: u.action, input, projectDir: project.path, run: { id: run.id, dir: run.run_dir },
      secret: (name) => getSecret(plugin.id, name),
    });
    const file = path.join(run.run_dir, fanout ? `${step.id}-${row.fanout_index}.json` : `${step.id}.json`);
    fs.writeFileSync(file, JSON.stringify(r, null, 2) + '\n');
    this.markRunning(run, row, { output_path: slash(file) });
    if (r.ok && u.plugin === BOARD_ACTION.plugin && u.action === BOARD_ACTION.action) {
      return { ok: true, outputs: { ...r.outputs, board: await this.board(run, r.outputs) } };
    }
    return r.ok ? { ok: true, outputs: r.outputs } : { ok: false, error: r.error.message };
  }

  private async board(run: RunRow, outputs: Record<string, unknown>): Promise<{ items: number; captured: number }> {
    const items = recordBoard(this.db, run.id, referencesOf(outputs));
    if (!this.boardCapture) {
      this.log(run, { board: 'captures skipped: browser not available' });
      return { items: items.length, captured: 0 };
    }
    const { captured, failures } = await captureBoard(this.db, run.project_id, items, this.boardCapture);
    for (const f of failures) this.log(run, { board: `capture failed: ${f}` });
    this.log(run, { board: `${captured} of ${items.length} references captured` });
    return { items: items.length, captured };
  }


  private guardedAfter(pipe: Pipeline, gateStep: Step): Step | null {
    const ctx = { action: (p: string, a: string) => pluginAction(this.db, p, a) };
    const i = pipe.steps.findIndex((s) => s.id === gateStep.id);
    for (const s of pipe.steps.slice(i + 1)) {
      if (s.kind === 'gate' && s.gate === 'approve') return null;
      if (isGuarded(s, ctx)) return s;
    }
    return null;
  }

  /** The hash input for a guarded step, or null when its templates cannot resolve yet. */
  private hashFor(run: RunRow, step: Step): { hash: string; summary: string } | null {
    try {
      const scope = this.scope(run);
      if (step.kind === 'action') {
        const args = resolveValue(step.with ?? {}, scope) as Record<string, unknown>;
        const u = parseUses(step.uses as string);
        const spec = u?.kind === 'plugin' ? pluginAction(this.db, u.plugin, u.action) : null;
        const destination = spec?.destination_field ? args[spec.destination_field] ?? null : null;
        return {
          hash: actionHash({ step: step.id, action: step.uses, args, destination }),
          summary: `${step.title ?? step.id}: ${step.uses} with ${JSON.stringify(args)}${destination !== null ? `, sending to ${String(destination)}` : ''}`,
        };
      }
      if (step.kind === 'agent') {
        const engine = typeof step.engine === 'string' ? step.engine : null;
        if (!engine) return null;
        const outPath = this.outputPath(run, step.id, 0, false);
        const prompt = this.promptFor(run, 0, outPath, step.prompt as string, step.outputs ?? []);
        const destination = step.destination ? resolveString(step.destination, scope) : null;
        return {
          hash: actionHash({ step: step.id, engine, prompt_sha256: sha256(prompt), destination }),
          summary: `${step.title ?? step.id}: ${engine} publishes${destination ? ` to ${destination}` : ''}`,
        };
      }
      return { hash: actionHash({ step: step.id, kind: step.kind, uses: step.uses ?? null, code: step.code ?? null }), summary: `${step.title ?? step.id}` };
    } catch {
      return null;
    }
  }

  private gateStep(run: RunRow, pipe: Pipeline, step: Step, iteration: number): StepOutcome {
    const waiting = this.db.prepare("SELECT id FROM gate WHERE run_id = ? AND step_id = ? AND status = 'waiting'").get(run.id, step.id);
    if (!waiting) {
      const guarded = step.gate === 'approve' ? this.guardedAfter(pipe, step) : null;
      const h = guarded ? this.hashFor(run, guarded) : null;
      let summary: string;
      try {
        summary = step.gate_summary ? resolveString(step.gate_summary, this.scope(run)) : h?.summary ?? step.title ?? `Continue ${pipe.title}`;
      } catch {
        summary = step.title ?? step.id;
      }
      const id = ulid();
      this.db.prepare('INSERT INTO gate (id, run_id, step_id, guards_step, kind, action_hash, summary, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, run.id, step.id, guarded?.id ?? null, step.gate as string, h?.hash ?? null, summary, 'waiting');
      this.needsYou(step.gate === 'approve' ? 'gate' : 'handoff', id, summary);
    }
    this.db.prepare("UPDATE run_step SET status = 'waiting', started_at = COALESCE(started_at, ?) WHERE run_id = ? AND step_id = ? AND iteration = ?").run(nowIso(), run.id, step.id, iteration);
    return this.pause(run, step.gate === 'approve' ? 'gate' : 'handoff');
  }

  /** Before a guarded step runs: its approval must match the action it is about to take, and is used up by it. */
  private checkApproval(run: RunRow, pipe: Pipeline, step: Step): 'ok' | StepOutcome {
    const h = this.hashFor(run, step);
    if (!h) return this.fail(run, `step ${step.id}: its arguments could not be resolved for the approval check`);
    const approved = this.db.prepare(
      "SELECT id, action_hash FROM gate WHERE run_id = ? AND guards_step = ? AND status = 'approved' ORDER BY decided_at DESC LIMIT 1",
    ).get(run.id, step.id) as { id: string; action_hash: string | null } | undefined;
    if (approved && approved.action_hash === h.hash) {
      this.db.prepare("UPDATE gate SET status = 'stale', note = ? WHERE id = ?").run(`approval used by ${step.id}`, approved.id);
      return 'ok';
    }
    const earlier = this.db.prepare('SELECT step_id, kind FROM gate WHERE run_id = ? AND guards_step = ? ORDER BY rowid DESC LIMIT 1').get(run.id, step.id) as
      | { step_id: string; kind: string }
      | undefined;
    if (approved) this.db.prepare("UPDATE gate SET status = 'stale', note = 'the action changed since approval' WHERE id = ?").run(approved.id);
    const kind = earlier ? earlier.kind : 'auto-external';
    const id = ulid();
    const summary = `${approved ? 'Changed since approval. ' : ''}${h.summary}`;
    this.db.prepare("INSERT INTO gate (id, run_id, step_id, guards_step, kind, action_hash, summary, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'waiting')")
      .run(id, run.id, earlier?.step_id ?? step.id, step.id, kind, h.hash, summary);
    this.needsYou('gate', id, summary);
    this.log(run, { event: approved ? 'gate stale' : 'gate needed', step: step.id });
    return this.pause(run, 'gate');
  }


  private async pipelineIndex(run: RunRow, step: Step, row: StepRow): Promise<IndexResult> {
    const u = parseUses(step.uses as string);
    if (u?.kind !== 'pipeline') return { ok: false, error: `bad uses ${step.uses}` };
    const prior = row.output_path ? this.run(path.basename(row.output_path)) : undefined;
    let child = prior && (prior.status === 'running' || prior.status === 'paused') ? { id: prior.id } : undefined;
    if (!child) {
      const inputs = resolveValue(step.with ?? {}, this.scope(run, row.fanout_index)) as Record<string, unknown>;
      const id = this.start({ pipeline_id: u.id, project_id: run.project_id, inputs, trigger: 'manual' }, { run, step: step.id, budget: this.remaining(run) });
      child = { id };
    }
    this.markRunning(run, row, { output_path: slash(path.join(run.run_dir, step.id, child.id)) });
    for (;;) {
      const parent = this.run(run.id) as RunRow;
      const c = this.run(child.id) as RunRow;
      if (parent.status === 'cancelled' || parent.status === 'failed') {
        if (c.status === 'running' || c.status === 'paused') this.cancel(c.id);
        return { paused: parent.status };
      }
      if (c.status === 'done') {
        if (parent.status === 'paused') this.db.prepare("UPDATE run SET status = 'running', paused_why = NULL WHERE id = ?").run(run.id);
        const pipe = this.pipelineOf(c);
        const last = pipe.steps[pipe.steps.length - 1];
        const rows = this.rows(c.id, last.id);
        const outs = rows.map((r) => (r.outputs ? JSON.parse(r.outputs) : {}));
        return { ok: true, outputs: outs.length === 1 ? outs[0] : { outputs: outs } };
      }
      if (c.status === 'failed' || c.status === 'cancelled') {
        if (parent.status === 'paused') this.db.prepare("UPDATE run SET status = 'running', paused_why = NULL WHERE id = ?").run(run.id);
        return { ok: false, error: `sub-pipeline ${u.id} ${c.status}` };
      }
      if (c.status === 'paused' && parent.status === 'running') this.db.prepare("UPDATE run SET status = 'paused', paused_why = ? WHERE id = ?").run(c.paused_why, run.id);
      if (c.status === 'running' && parent.status === 'paused') this.db.prepare("UPDATE run SET status = 'running', paused_why = NULL WHERE id = ?").run(run.id);
      await sleep(POLL_MS);
    }
  }


  private async codeIndex(run: RunRow, pipe: Pipeline, step: Step, row: StepRow, fanout: boolean): Promise<IndexResult> {
    const sourceDir = (pipe as Pipeline & { source_dir?: string }).source_dir ?? run.run_dir;
    const module = path.resolve(sourceDir, step.code as string);
    const project = this.project(run.project_id);
    const env: Record<string, string> = {};
    for (const name of BASE_ENV) if (process.env[name] !== undefined) env[name] = process.env[name] as string;
    env.TROOP_RUN_DIR = run.run_dir;
    env.TROOP_PROJECT_DIR = project.path;
    const steps: Record<string, unknown> = {};
    for (const s of pipe.steps) {
      const done = this.rows(run.id, s.id).filter((r) => r.status === 'done');
      if (done.length) steps[s.id] = done.length > 1 ? done.map((r) => JSON.parse(r.outputs ?? '{}')) : JSON.parse(done[0].outputs ?? '{}');
    }
    const execArgv = process.allowedNodeEnvironmentFlags.has('--experimental-default-type') ? ['--experimental-default-type=module'] : [];
    const child = fork(path.join(coreDir, 'code-host.js'), [], { cwd: run.run_dir, env, execArgv, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], detached: process.platform !== 'win32' });
    const key = `${run.id}/${step.id}/${row.fanout_index}`;
    this.children.set(key, child);
    let agents = 0;
    const inRunDir = (rel: string) => {
      const abs = path.resolve(run.run_dir, rel);
      const r = path.relative(run.run_dir, abs);
      if (!r || r.startsWith('..') || path.isAbsolute(r)) throw new Error(`${rel} is outside the run directory`);
      return abs;
    };
    const handlers: Record<string, (...args: unknown[]) => Promise<unknown> | unknown> = {
      log: (text) => this.log(run, { stream: 'code', step: step.id, line: String(text) }),
      readFile: (rel) => fs.readFileSync(inRunDir(String(rel)), 'utf8'),
      writeFile: (rel, text) => {
        const abs = inRunDir(String(rel));
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, String(text));
        return null;
      },
      startAgent: async (opts) => {
        const o = (opts ?? {}) as { prompt?: string; engine?: string; outputs?: string[] };
        if (typeof o.prompt !== 'string') throw new Error('startAgent needs a prompt');
        const agentStep = `${step.id}-agent-${++agents}`;
        this.db.prepare("INSERT OR IGNORE INTO run_step (run_id, step_id, iteration, fanout_index, status) VALUES (?, ?, ?, ?, 'pending')").run(run.id, agentStep, row.iteration, row.fanout_index);
        const agentRow = this.rows(run.id, agentStep, row.iteration).find((r) => r.fanout_index === row.fanout_index) as StepRow;
        this.markRunning(run, agentRow);
        const fresh = { ...agentRow, started_at: nowIso() };
        const r = await this.runAgent(run, pipe, {
          stepId: agentStep, row: fresh, template: o.prompt, raw: true, outputs: Array.isArray(o.outputs) ? o.outputs.map(String) : [],
          engine: () => (o.engine ? getEngine(this.db, o.engine) : bindRole(this.db, 'worker')),
          outPath: this.outputPath(run, agentStep, row.fanout_index, fanout), cwd: project.path, timeoutMinutes: step.timeout_minutes ?? 30, index: row.fanout_index,
        });
        this.finishRow(run, agentRow, r);
        if ('paused' in r) throw new Error('run stopped');
        if (!r.ok) throw new Error(r.error);
        return r.outputs;
      },
    };
    const timeoutMs = (step.timeout_minutes ?? 30) * 60_000;
    let stderr = '';
    child.stderr?.on('data', (c: Buffer) => { stderr = (stderr + c.toString('utf8')).slice(-4000); });
    const result = await new Promise<IndexResult>((resolve) => {
      let settled = false;
      const done = (r: IndexResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(watch);
        resolve(r);
      };
      const timer = setTimeout(() => { killTree(child); done({ ok: false, error: `code step timed out after ${step.timeout_minutes ?? 30} minutes` }); }, timeoutMs);
      const watch = setInterval(() => {
        const st = this.run(run.id)?.status;
        if (st === 'cancelled' || st === 'failed') { killTree(child); done({ paused: st }); }
      }, POLL_MS);
      child.on('message', async (raw) => {
        const m = raw as { id?: number; method?: string; args?: unknown[]; type?: string; value?: unknown; message?: string };
        if (m.type === 'result') return done({ ok: true, outputs: m.value as Record<string, unknown> });
        if (m.type === 'error') return done({ ok: false, error: `code step: ${m.message}` });
        if (typeof m.id !== 'number' || typeof m.method !== 'string') return;
        const h = handlers[m.method];
        try {
          if (!h) throw new Error(`ctx has no method ${m.method}`);
          const result = await h(...(m.args ?? []));
          if (child.connected) child.send({ id: m.id, result: result ?? null });
        } catch (e) {
          if (child.connected) child.send({ id: m.id, error: (e as Error).message });
        }
      });
      child.on('exit', (code) => done({ ok: false, error: `code step exited with code ${code} before returning${stderr ? `: ${stderr.trim().split('\n').slice(-5).join(' | ')}` : ''}` }));
      child.on('error', (e) => done({ ok: false, error: `code step could not start: ${e.message}` }));
      child.send({ type: 'init', module, ctx: { inputs: JSON.parse(run.inputs), steps, runDir: run.run_dir, projectPath: project.path } });
    });
    this.children.delete(key);
    if ('ok' in result && result.ok) {
      const file = path.join(run.run_dir, fanout ? `${step.id}-${row.fanout_index}.json` : `${step.id}.json`);
      fs.writeFileSync(file, JSON.stringify(result.outputs, null, 2) + '\n');
      this.markRunning(run, row, { output_path: slash(file) });
    }
    return result;
  }


  /** Picks up decided gates on paused runs and restarts drives for running runs that have none. */
  tick(): void {
    const paused = this.db.prepare("SELECT * FROM run WHERE status = 'paused' AND paused_why IN ('gate','handoff')").all() as unknown as RunRow[];
    for (const run of paused) {
      if (this.active.has(run.id)) continue;
      if (this.db.prepare("SELECT 1 FROM gate WHERE run_id = ? AND status = 'waiting'").get(run.id)) continue;
      const child = this.db.prepare("SELECT 1 FROM run WHERE parent_run = ? AND status = 'paused'").get(run.id);
      if (child) continue;
      const last = this.db.prepare("SELECT status FROM gate WHERE run_id = ? AND decided_at IS NOT NULL AND (note IS NULL OR note != 'output arrived') ORDER BY decided_at DESC LIMIT 1").get(run.id) as
        | { status: string }
        | undefined;
      if (last?.status === 'rejected') {
        this.end(run, 'cancelled');
        continue;
      }
      this.db.prepare(
        "UPDATE run_step SET status = 'done', ended_at = ? WHERE run_id = ? AND status = 'waiting' AND step_id IN (SELECT step_id FROM gate WHERE run_id = ? AND status IN ('approved','stale'))",
      ).run(nowIso(), run.id, run.id);
      this.db.prepare("UPDATE run SET status = 'running', paused_why = NULL WHERE id = ?").run(run.id);
      this.log(run, { event: 'gate resolved' });
      void this.drive(run.id);
    }
    const running = this.db.prepare("SELECT id FROM run WHERE status = 'running'").all() as Array<{ id: string }>;
    for (const r of running) if (!this.active.has(r.id)) void this.drive(r.id);
  }

  /** At core start: steps that were mid-way through an action, code or sub-pipeline fail; agent steps reattach. */
  recover(): void {
    const rows = this.db.prepare(
      "SELECT s.run_id, s.step_id, s.iteration, s.fanout_index, s.session_id, s.output_path FROM run_step s JOIN run r ON r.id = s.run_id WHERE r.status = 'running' AND s.status = 'running'",
    ).all() as Array<{ run_id: string; step_id: string; iteration: number; fanout_index: number; session_id: string | null; output_path: string | null }>;
    for (const r of rows) {
      const run = this.run(r.run_id) as RunRow;
      if (run.status !== 'running') continue;
      let step: Step | undefined;
      try {
        step = this.pipelineOf(run).steps.find((s) => s.id === r.step_id);
      } catch (e) {
        this.fail(run, `its run folder could not be read after a core restart: ${(e as Error).message}`);
        continue;
      }
      if (step?.kind === 'agent') {
        const s = r.session_id ? (this.db.prepare('SELECT state, pid FROM session WHERE id = ?').get(r.session_id) as { state: string; pid: number | null } | undefined) : undefined;
        if (s && s.state !== 'exited' && s.pid && pidAlive(s.pid)) continue;
        const fm = r.output_path && fs.existsSync(r.output_path) ? parseFrontMatter(fs.readFileSync(r.output_path, 'utf8')) : null;
        if (r.session_id && (fm?.status === 'done' || fm?.status === 'failed')) {
          this.db.prepare("UPDATE session SET state = 'exited' WHERE id = ?").run(r.session_id);
          continue;
        }
        this.db.prepare('UPDATE run_step SET session_id = NULL, started_at = ? WHERE run_id = ? AND step_id = ? AND iteration = ? AND fanout_index = ?')
          .run(nowIso(), r.run_id, r.step_id, r.iteration, r.fanout_index);
        this.log(run, { event: 'step relaunched', step: r.step_id, detail: 'its session ended with the last core; started again' });
        continue;
      }
      if (step?.kind === 'pipeline') continue;
      this.db.prepare("UPDATE run_step SET status = 'failed', fail_count = fail_count + 1, ended_at = ? WHERE run_id = ? AND step_id = ? AND iteration = ? AND fanout_index = ?")
        .run(nowIso(), r.run_id, r.step_id, r.iteration, r.fanout_index);
      this.fail(run, `step ${r.step_id} was interrupted by a core restart; resume to run it again`);
    }
    for (const d of this.db.prepare("SELECT pid FROM dev_server WHERE status IN ('starting','ready') AND pid IS NOT NULL").all() as Array<{ pid: number }>) {
      if (pidAlive(d.pid)) killPid(d.pid);
    }
    this.db.prepare("DELETE FROM dev_server WHERE status IN ('starting','ready','failed','stopped')").run();
    this.db.prepare("DELETE FROM port_lease WHERE run_id IN (SELECT id FROM run WHERE status IN ('done','failed','cancelled'))").run();
  }

  shutdown(): void {
    for (const child of this.children.values()) killTree(child);
    const rows = this.db.prepare("SELECT run_id, idx FROM dev_server WHERE status IN ('starting','ready')").all() as Array<{ run_id: string; idx: number }>;
    for (const r of rows) stopDevServer(this.db, r.run_id, r.idx);
  }


  /** Refuses Continue on a handoff gate step after a fan-out worktree step while no variant is picked. */
  checkContinue(runId: string, stepId: string): void {
    const run = this.run(runId);
    if (!run) return;
    const steps = this.pipelineOf(run).steps;
    const i = steps.findIndex((s) => s.id === stepId);
    const s = steps[i];
    if (!s || s.kind !== 'gate' || s.gate !== 'handoff' || !steps.slice(0, i).some((t) => t.fanout && t.worktree)) return;
    if (this.db.prepare("SELECT 1 FROM variant WHERE run_id = ? AND status = 'picked'").get(runId)) return;
    throw new RpcError(E.VALIDATION, 'pick a tile first', { errors: ['no variant is picked'] });
  }

  pick(runId: string, idx: number): void {
    const v = this.db.prepare('SELECT status FROM variant WHERE run_id = ? AND idx = ?').get(runId, idx) as { status: string } | undefined;
    if (!v) throw new RpcError(E.NOT_FOUND, 'variant not found');
    if (v.status !== 'ready' && v.status !== 'picked') throw new RpcError(E.VALIDATION, `variant is ${v.status}, not ready`, { errors: [`variant is ${v.status}`] });
    this.db.prepare("UPDATE variant SET status = 'ready' WHERE run_id = ? AND status = 'picked'").run(runId);
    this.db.prepare("UPDATE variant SET status = 'picked' WHERE run_id = ? AND idx = ?").run(runId, idx);
  }

  /** Stops the variant's dev server tree, releases its port, closes its pane and removes its worktree and branch. */
  discard(runId: string, idx: number): void {
    const v = this.db.prepare('SELECT worktree, branch, pane_id FROM variant WHERE run_id = ? AND idx = ?').get(runId, idx) as
      | { worktree: string; branch: string; pane_id: string | null }
      | undefined;
    if (!v) throw new RpcError(E.NOT_FOUND, 'variant not found');
    stopDevServer(this.db, runId, idx);
    releasePorts(this.db, runId, idx);
    if (v.pane_id) this.db.prepare('UPDATE browser_pane SET open = 0 WHERE id = ?').run(v.pane_id);
    const run = this.run(runId) as RunRow;
    const project = this.project(run.project_id);
    try {
      execFileSync('git', ['-C', project.path, 'worktree', 'remove', '--force', v.worktree], { stdio: 'pipe', timeout: 60_000, windowsHide: true });
    } catch {}
    if (v.worktree && fs.existsSync(v.worktree)) {
      throw new RpcError(E.VALIDATION, `the worktree at ${v.worktree} could not be removed; close anything using it and discard again`, { errors: ['worktree still on disk'] });
    }
    try {
      if (v.branch) execFileSync('git', ['-C', project.path, 'branch', '-D', v.branch], { stdio: 'pipe', timeout: 30_000, windowsHide: true });
    } catch {}
    this.db.prepare("UPDATE variant SET status = 'discarded' WHERE run_id = ? AND idx = ?").run(runId, idx);
  }

  /** Starts an agent in a fresh worktree from project HEAD as the next variant, given the note and each selected variant's diff and pane capture. */
  async combine(runId: string, indices: number[], note: string): Promise<{ step_id: string }> {
    const run = this.run(runId);
    if (!run) throw new RpcError(E.NOT_FOUND, 'run not found');
    const chosen = [...new Set(indices)];
    const invalid = (msg: string) => new RpcError(E.VALIDATION, msg, { errors: [msg] });
    if (chosen.length < 2) throw invalid('combine needs at least 2 different variants');
    if (!note.trim()) throw invalid('combine needs a note');
    const variants = chosen.map((idx) => {
      const v = this.db.prepare('SELECT idx, worktree, branch, pane_id, status FROM variant WHERE run_id = ? AND idx = ?').get(runId, idx) as
        | { idx: number; worktree: string; branch: string; pane_id: string | null; status: string }
        | undefined;
      if (!v) throw new RpcError(E.NOT_FOUND, `variant ${idx} not found`);
      if (v.status === 'discarded') throw invalid(`variant ${idx} was discarded`);
      if (!v.worktree) throw invalid(`variant ${idx} has no worktree`);
      return v;
    });
    const pipe = this.pipelineOf(run);
    const src = [...pipe.steps].reverse().find((s) => s.kind === 'agent' && s.fanout && s.worktree);
    if (!src) throw invalid('this run has no fan-out agent step to combine');

    const prior = (this.db.prepare("SELECT count(DISTINCT step_id) AS n FROM run_step WHERE run_id = ? AND step_id LIKE 'combine-%'").get(runId) as { n: number }).n;
    const stepId = `combine-${prior + 1}`;
    const idx = (this.db.prepare('SELECT COALESCE(MAX(idx), -1) + 1 AS n FROM variant WHERE run_id = ?').get(runId) as { n: number }).n;
    this.db.prepare("INSERT INTO variant (run_id, idx, worktree, branch, dev_port, status) VALUES (?, ?, '', '', 0, 'building')").run(runId, idx);
    this.db.prepare("INSERT INTO run_step (run_id, step_id, iteration, fanout_index, status) VALUES (?, ?, 0, ?, 'pending')").run(runId, stepId, idx);

    const project = this.project(run.project_id);
    const dir = path.join(run.run_dir, stepId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'note.md'), note);
    const git = (cwd: string, args: string[]) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe', timeout: 60_000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    const head = git(project.path, ['rev-parse', 'HEAD']).trim();
    for (const v of variants) {
      try {
        git(v.worktree, ['add', '-A', '-N']);
        const base = git(project.path, ['merge-base', head, v.branch]).trim();
        fs.writeFileSync(path.join(dir, `variant-${v.idx}.diff`), git(v.worktree, ['diff', base]));
      } catch (e) {
        this.log(run, { event: 'combine diff failed', variant: v.idx, why: (e as Error).message });
      }
      if (!v.pane_id || !this.paneCapture) {
        this.log(run, { event: 'combine crop skipped', variant: v.idx, why: v.pane_id ? 'browser not available' : 'variant has no pane' });
        continue;
      }
      try {
        const shot = await this.paneCapture(v.pane_id, stepId);
        fs.copyFileSync(shot.w1280_path, path.join(dir, `variant-${v.idx}.png`));
      } catch (e) {
        this.log(run, { event: 'combine crop failed', variant: v.idx, why: (e as Error).message });
      }
    }

    const listed = fs.readdirSync(dir).sort().map((f) => slash(path.join(dir, f)));
    const prompt = [
      `Combine variants ${chosen.join(', ')} into one result in this worktree, which starts from the project's HEAD.`,
      `The user's note:\n\n${note}`,
      `Each variant's diff against the project and its screenshot are in these files:\n${listed.map((f) => `- ${f}`).join('\n')}`,
    ].join('\n\n');
    const step: Step = { ...src, id: stepId, prompt, fanout: 1 };
    const row = this.rows(runId, stepId)[0];
    this.log(run, { event: 'combine started', step: stepId, variants: chosen, index: idx });
    void this.execIndex(run, pipe, step, row, true).catch(() => {});
    return { step_id: stepId };
  }
}

function git(cwd: string, args: string[]): string {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: 'pipe', timeout: 60_000, windowsHide: true });
}

function gitError(e: unknown): string {
  return String((e as { stderr?: string }).stderr || e).trim();
}

/** Adds `.troop/` to the project's `.git/info/exclude` once, when the project is a git repository. */
export function excludeTroop(projectPath: string): void {
  let file: string;
  try {
    file = execFileSync('git', ['-C', projectPath, 'rev-parse', '--git-path', 'info/exclude'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
  } catch {
    return;
  }
  const abs = path.resolve(projectPath, file);
  const text = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : '';
  if (text.split(/\r?\n/).some((l) => l.trim() === '.troop/')) return;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.appendFileSync(abs, `${text && !text.endsWith('\n') ? '\n' : ''}.troop/\n`);
}
