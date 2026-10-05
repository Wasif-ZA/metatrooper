import fs from 'node:fs';
import path from 'node:path';
import type { DatabaseSync } from 'node:sqlite';

export const PANE_VIEWS = ['items', 'document', 'table', 'findings'] as const;
export type PaneView = (typeof PANE_VIEWS)[number];
export const ITEM_STATUS = ['pending', 'approved', 'dropped', 'published', 'failed'] as const;

interface StepSource { view: PaneView; outputs: Record<string, unknown>; runDir: string; projectDir: string }

function stepSource(db: DatabaseSync, runId: string, stepId: string): StepSource | null {
  const run = db.prepare('SELECT r.run_dir, r.pipeline_id, p.path AS project_dir FROM run r JOIN project p ON p.id = r.project_id WHERE r.id = ?').get(runId) as
    | { run_dir: string; pipeline_id: string; project_dir: string }
    | undefined;
  if (!run) return null;
  const file = db.prepare('SELECT path FROM pipeline WHERE id = ?').get(run.pipeline_id) as { path: string } | undefined;
  let view: unknown;
  try {
    const def = JSON.parse(fs.readFileSync(file?.path ?? '', 'utf8')) as { steps?: Array<{ id?: string; view?: string }> };
    view = def.steps?.find((s) => s.id === stepId)?.view;
  } catch {}
  if (!PANE_VIEWS.includes(view as PaneView)) return null;
  const row = db.prepare('SELECT outputs FROM run_step WHERE run_id = ? AND step_id = ? AND outputs IS NOT NULL ORDER BY iteration DESC, fanout_index LIMIT 1').get(runId, stepId) as
    | { outputs: string }
    | undefined;
  let outputs: Record<string, unknown> = {};
  try { outputs = row ? JSON.parse(row.outputs) : {}; } catch {}
  return { view: view as PaneView, outputs, runDir: run.run_dir, projectDir: run.project_dir };
}

/** A path named by a step output, resolved against the run folder then the project; null when it leaves both. */
export function paneFile(src: { runDir: string; projectDir: string }, value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  for (const base of [src.runDir, src.projectDir]) {
    const full = path.resolve(base, value);
    if (!fs.existsSync(full) || !fs.existsSync(base)) continue;
    const rel = path.relative(fs.realpathSync(base), fs.realpathSync(full));
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return full;
  }
  return null;
}

function load(src: StepSource, key: string, json: boolean): unknown {
  const v = src.outputs[key];
  if (v !== null && typeof v === 'object') return v;
  const file = paneFile(src, v);
  if (!file) return null;
  const text = fs.readFileSync(file, 'utf8');
  return json ? JSON.parse(text) : text;
}

/** What a result pane shows for one step: its view and the data its outputs point at. */
export function paneData(db: DatabaseSync, runId: string, stepId: string): { view: PaneView; data: unknown; sources?: unknown; score?: unknown; editable?: boolean } | { error: string } {
  const src = stepSource(db, runId, stepId);
  if (!src) return { error: 'this step has no result pane' };
  try {
    if (src.view === 'document') return { view: 'document', data: load(src, 'document', false), sources: load(src, 'sources', true), score: load(src, 'score', true) };
    return { view: src.view, data: load(src, src.view, true), editable: src.view === 'items' && Boolean(paneFile(src, src.outputs.items)) };
  } catch (e) {
    return { error: `could not read the ${src.view} output: ${(e as Error).message}` };
  }
}

/** Sets one item's status in the step's items file. */
export function setItemStatus(db: DatabaseSync, runId: string, stepId: string, itemId: string, status: string): void {
  if (!ITEM_STATUS.includes(status as (typeof ITEM_STATUS)[number])) throw new Error(`status must be one of ${ITEM_STATUS.join(', ')}`);
  const src = stepSource(db, runId, stepId);
  if (!src || src.view !== 'items') throw new Error('this step has no items pane');
  const file = paneFile(src, src.outputs.items);
  if (!file) throw new Error('the items output is not a file in the run or project folder');
  const items = JSON.parse(fs.readFileSync(file, 'utf8')) as Array<{ id?: unknown; status?: string }>;
  const item = Array.isArray(items) ? items.find((x) => String(x.id) === itemId) : undefined;
  if (!item) throw new Error(`no item ${itemId}`);
  item.status = status;
  fs.writeFileSync(file, JSON.stringify(items, null, 2) + '\n');
}
