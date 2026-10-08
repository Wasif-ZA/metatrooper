import fs from 'node:fs';
import path from 'node:path';
import { repoDir } from '../paths.ts';
import { validate } from '../jsonschema.ts';
import type { ActionSpec } from '../plugins/manifest.ts';
import { assistErrors } from './assists.ts';
import { parseRef, refsIn, templateStrings } from './template.ts';

export interface Step {
  id: string;
  title?: string;
  role?: string;
  kind: 'agent' | 'action' | 'pipeline' | 'code' | 'gate';
  prompt?: string;
  engine?: string | string[];
  continue?: string;
  uses?: string;
  with?: Record<string, unknown>;
  code?: string;
  gate?: 'approve' | 'handoff';
  gate_summary?: string;
  external?: boolean;
  destination?: string;
  fanout?: number;
  worktree?: boolean;
  cwd?: string;
  browser?: boolean;
  dev_command?: string;
  serve?: 'before' | 'after';
  outputs?: string[];
  view?: string;
  loop?: { steps: string[]; until: string; max: number };
  timeout_minutes?: number;
  approval?: 'ask' | 'edits' | 'contained';
}

export interface Pipeline {
  schema: 1;
  id: string;
  title: string;
  lane?: string;
  inputs?: Record<string, { type: string; label?: string; required?: boolean; default?: unknown; choices?: string[] }>;
  run_in?: 'local' | 'cloud';
  budget?: { max_tokens?: number; max_usd?: number; max_minutes?: number; max_parallel?: number };
  requires?: string[];
  assists?: Array<{ tool: string; steps: string[]; use: string }>;
  steps: Step[];
}

export interface ValidationContext {
  /** Another pipeline by id, for `kind: pipeline` steps; null when unknown. */
  pipeline: (id: string) => Pipeline | null;
  /** A plugin action's manifest entry, when the plugin is installed. */
  action: (pluginId: string, actionId: string) => ActionSpec | null;
  /** Folder of the pipeline file, to check `code` paths; null for a pipeline that is not on disk. */
  dir: string | null;
}

let schemaCache: Record<string, unknown> | null = null;

function pipelineSchema(): Record<string, unknown> {
  schemaCache ??= JSON.parse(fs.readFileSync(path.join(repoDir, 'contracts', 'pipeline.schema.json'), 'utf8'));
  return schemaCache as Record<string, unknown>;
}

export function parseUses(uses: string): { kind: 'plugin'; plugin: string; action: string } | { kind: 'pipeline'; id: string } | null {
  let m = /^plugin:([a-z0-9-]+)\/([a-z0-9-]+)$/.exec(uses);
  if (m) return { kind: 'plugin', plugin: m[1], action: m[2] };
  m = /^pipeline:([a-z0-9-]+)$/.exec(uses);
  return m ? { kind: 'pipeline', id: m[1] } : null;
}

/** True for a step that publishes or reaches outside: `role: publish`, `external: true`, or an action its plugin marks external. */
export function isGuarded(step: Step, ctx: Pick<ValidationContext, 'action'>): boolean {
  if (step.role === 'publish' || step.external === true) return true;
  if (step.kind === 'action' && step.uses) {
    const u = parseUses(step.uses);
    if (u?.kind === 'plugin') return ctx.action(u.plugin, u.action)?.external === true;
  }
  return false;
}

function at(i: number, step: Step): string {
  return `/steps/${i} (${step.id})`;
}

/** Schema errors, then the rules in pipelines.md "Validation" in their numbered order. */
export function validatePipeline(json: unknown, ctx: ValidationContext): string[] {
  const errors = validate(pipelineSchema(), json);
  if (errors.length) return errors;
  const p = json as Pipeline;
  errors.push(...assistErrors(p));
  const index = new Map<string, number>();
  p.steps.forEach((s, i) => {
    if (index.has(s.id)) errors.push(`${at(i, s)}: duplicate step id`);
    else index.set(s.id, i);
  });
  const inputs = new Set(Object.keys(p.inputs ?? {}));

  p.steps.forEach((s, i) => {
    const fields: Array<[string, unknown]> = [['prompt', s.prompt], ['gate_summary', s.gate_summary], ['destination', s.destination], ['with', s.with], ['dev_command', s.dev_command], ['cwd', s.cwd]];
    if (s.cwd !== undefined && s.worktree) errors.push(`${at(i, s)}/cwd: a step with worktree cannot also set cwd`);
    for (const [field, value] of fields) {
      for (const text of templateStrings(value)) {
        for (const expr of refsIn(text)) {
          const ref = parseRef(expr);
          if (!ref) {
            errors.push(`${at(i, s)}/${field}: unknown reference {{${expr}}}`);
            continue;
          }
          if (ref.root === 'port' && field !== 'dev_command') errors.push(`${at(i, s)}/${field}: {{port}} is only allowed in dev_command`);
          if (ref.root === 'inputs' && !inputs.has(ref.name as string)) errors.push(`${at(i, s)}/${field}: {{${expr}}} names no input`);
          if (ref.root === 'variants') {
            const src = p.steps.findIndex((t, j) => j < i && t.fanout && t.worktree);
            const gated = src >= 0 && p.steps.some((t, j) => j > src && j < i && t.kind === 'gate' && t.gate === 'handoff');
            if (!gated) errors.push(`${at(i, s)}/${field}: {{${expr}}} needs an earlier fan-out worktree step and a handoff gate after it`);
          }
          if (ref.root === 'index' && !s.fanout) errors.push(`${at(i, s)}/${field}: {{index}} needs a fan-out step`);
          if (ref.index === 'i' && !s.fanout) errors.push(`${at(i, s)}/${field}: {{${expr}}} uses [i] but the step has no fanout`);
          if (ref.root === 'steps') {
            const j = index.get(ref.step as string);
            if (j === undefined) errors.push(`${at(i, s)}/${field}: {{${expr}}} names no step`);
            else if (j >= i) errors.push(`${at(i, s)}/${field}: {{${expr}}} refers forward to a later step`);
            else {
              const declared = p.steps[j].outputs;
              const runnerOwned = p.steps[j].worktree === true && (ref.key === 'worktree' || ref.key === 'branch');
              if (ref.field === 'outputs' && declared && p.steps[j].kind === 'agent' && !runnerOwned && !declared.includes(ref.key as string)) {
                errors.push(`${at(i, s)}/${field}: step ${ref.step} does not declare output ${ref.key}`);
              }
            }
          }
        }
      }
    }
  });

  let armed = false;
  p.steps.forEach((s, i) => {
    if (s.kind === 'gate' && s.gate === 'approve') armed = true;
    if (isGuarded(s, ctx)) {
      if (!armed) errors.push(`${at(i, s)}: publish rule: a publish or external step needs an approve gate earlier, with no other publish or external step between them`);
      armed = false;
      if (s.fanout) errors.push(`${at(i, s)}: a publish or external step cannot use fanout`);
      if (s.kind === 'agent' && typeof s.engine !== 'string') errors.push(`${at(i, s)}: an agent publish or external step must pin engine to one engine id`);
    }
  });

  p.steps.forEach((s, i) => {
    if (s.continue !== undefined) {
      const j = index.get(s.continue);
      if (j === undefined || j >= i || p.steps[j].kind !== 'agent') errors.push(`${at(i, s)}/continue: must name an earlier agent step`);
    }
    if (s.loop) {
      const ids = s.loop.steps;
      const first = index.get(ids[0]);
      const ok = first !== undefined && ids[ids.length - 1] === s.id && ids.every((id, k) => index.get(id) === first + k);
      if (!ok) errors.push(`${at(i, s)}/loop/steps: must be consecutive step ids ending with ${s.id}`);
      const target = /^steps\.([a-z0-9-]+)\./.exec(s.loop.until)?.[1];
      if (target && !ids.includes(target)) errors.push(`${at(i, s)}/loop/until: must name a step in the loop`);
    }
  });

  const requires = new Set(p.requires ?? []);
  p.steps.forEach((s, i) => {
    if (!s.uses) return;
    const u = parseUses(s.uses);
    if (s.kind === 'action' && u?.kind !== 'plugin') errors.push(`${at(i, s)}/uses: an action step uses plugin:<id>/<action>`);
    if (s.kind === 'pipeline' && u?.kind !== 'pipeline') errors.push(`${at(i, s)}/uses: a pipeline step uses pipeline:<id>`);
    if (u?.kind === 'plugin' && !requires.has(u.plugin)) errors.push(`${at(i, s)}/uses: requires must list plugin ${u.plugin}`);
    if (s.kind === 'action' && u?.kind === 'plugin' && !ctx.action(u.plugin, u.action)) errors.push(`${at(i, s)}/uses: plugin ${u.plugin} is not installed or has no action ${u.action}`);
  });

  const resultSteps = p.steps.filter((t) => t.kind === 'action' || t.kind === 'code').map((t) => t.id);
  p.steps.forEach((s, i) => {
    for (const text of templateStrings(s.with ?? {})) {
      for (const id of resultSteps) {
        if (new RegExp(`^\\{\\{\\s*run\\.dir\\s*\\}\\}/${id}(-\\d+)?\\.json$`).test(text.trim())) {
          errors.push(`${at(i, s)}/with: ${text.trim()} is step ${id}'s result file and the runner overwrites it; use another name`);
        }
      }
    }
  });

  p.steps.forEach((s, i) => {
    if (s.kind === 'code' && s.code && ctx.dir) {
      const abs = path.resolve(ctx.dir, s.code);
      if (!fs.existsSync(abs)) errors.push(`${at(i, s)}/code: ${s.code} does not exist`);
    }
  });

  errors.push(...nestingErrors(p, ctx));
  return errors;
}

function nestingErrors(root: Pipeline, ctx: ValidationContext): string[] {
  const errors: string[] = [];
  const walk = (p: Pipeline, chain: string[], depth: number) => {
    for (const s of p.steps) {
      if (s.kind !== 'pipeline' || !s.uses) continue;
      const u = parseUses(s.uses);
      if (u?.kind !== 'pipeline') continue;
      if (chain.includes(u.id)) {
        errors.push(`step ${s.id}: pipeline ${u.id} includes itself (${[...chain, u.id].join(' > ')})`);
        continue;
      }
      if (depth + 1 > 3) {
        errors.push(`step ${s.id}: pipelines nest at most 3 levels deep (${[...chain, u.id].join(' > ')})`);
        continue;
      }
      const child = ctx.pipeline(u.id);
      if (!child) {
        errors.push(`step ${s.id}: pipeline ${u.id} is not known`);
        continue;
      }
      walk(child, [...chain, u.id], depth + 1);
    }
  };
  walk(root, [root.id], 0);
  return errors;
}
