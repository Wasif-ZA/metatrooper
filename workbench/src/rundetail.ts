import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { paneFile } from '../../core/src/pipelines/panes.ts';

const DOC_CAP = 200 * 1024;

export interface RunDetail {
  inputs: Record<string, unknown>;
  outputs: Record<string, Record<string, unknown>>;
  docs: { spec: string | null; diff: string | null };
  pr: { number: number | null; url: string } | null;
  findings: unknown[] | null;
}

const parse = (text: string | null | undefined): Record<string, unknown> => {
  try {
    const v = text ? JSON.parse(text) : {};
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
};

/** Inputs, each step's latest outputs, spec.md, review.diff and findings.json from the run folder, and the PR a step output names. */
export function runDetail(db: DatabaseSync, runId: string): RunDetail | { error: string } {
  const run = db.prepare('SELECT r.inputs, r.run_dir, p.path AS project_dir FROM run r JOIN project p ON p.id = r.project_id WHERE r.id = ?').get(runId) as
    | { inputs: string | null; run_dir: string; project_dir: string }
    | undefined;
  if (!run) return { error: `no run ${runId}` };
  const rows = db.prepare('SELECT step_id, outputs FROM run_step WHERE run_id = ? AND outputs IS NOT NULL ORDER BY iteration, fanout_index DESC').all(runId) as Array<{ step_id: string; outputs: string }>;
  const outputs: RunDetail['outputs'] = {};
  for (const r of rows) outputs[r.step_id] = parse(r.outputs);

  const doc = (name: string): string | null => {
    const file = paneFile({ runDir: run.run_dir, projectDir: run.run_dir }, name);
    if (!file) return null;
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(DOC_CAP);
      return buf.subarray(0, fs.readSync(fd, buf, 0, DOC_CAP, 0)).toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  };

  let pr: RunDetail['pr'] = null;
  for (const o of Object.values(outputs)) {
    const url = o.url ?? o.pr_url;
    const m = typeof url === 'string' ? /\/pull\/(\d+)/.exec(url) : null;
    if (m) pr = { number: Number(m[1]), url: url as string };
  }
  let findings: unknown[] | null = null;
  try {
    const v = JSON.parse(doc('findings.json') ?? 'null');
    if (Array.isArray(v)) findings = v;
  } catch {}
  return { inputs: parse(run.inputs), outputs, docs: { spec: doc('spec.md'), diff: doc('review.diff') }, pr, findings };
}
