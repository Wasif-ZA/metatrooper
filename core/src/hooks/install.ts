import fs from 'node:fs';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { claudeSettingsFile, codexConfigFile, coreDir, hooksStateFile } from '../paths.ts';

const EVENTS = ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd'] as const;
const TOOL_EVENTS = new Set(['PreToolUse', 'PostToolUse']);

type Json = Record<string, any>;

interface State {
  claude?: { file: string; original: string | null; installed: string; absentEvents: string[] };
  codex?: { file: string; original: string; installed: string; previous: string[] | null };
}

function eventScript(): string {
  return path.join(coreDir, 'event.js').split(String.fromCharCode(92)).join('/');
}

function codexScript(): string {
  return path.join(coreDir, 'codex-notify.js').split(String.fromCharCode(92)).join('/');
}

function hookCommand(event: string): string {
  return `node "${eventScript()}" claude.${event}`;
}

function isOurs(group: Json): boolean {
  return Array.isArray(group?.hooks) && group.hooks.some((h: Json) => typeof h?.command === 'string' && h.command.includes(eventScript()));
}

function readState(): State {
  try {
    return JSON.parse(fs.readFileSync(hooksStateFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeState(s: State): void {
  fs.mkdirSync(path.dirname(hooksStateFile()), { recursive: true });
  fs.writeFileSync(hooksStateFile(), JSON.stringify(s, null, 2));
}

function withoutOurs(settings: Json, absentEvents: string[]): Json {
  const out: Json = structuredClone(settings);
  if (!out.hooks) return out;
  for (const ev of EVENTS) {
    if (!Array.isArray(out.hooks[ev])) continue;
    out.hooks[ev] = out.hooks[ev].filter((g: Json) => !isOurs(g));
    if (out.hooks[ev].length === 0 && absentEvents.includes(ev)) delete out.hooks[ev];
  }
  if (Object.keys(out.hooks).length === 0 && absentEvents.includes('__hooks__')) delete out.hooks;
  return out;
}

export interface Plan {
  file: string;
  before: string;
  after: string;
}

export function planClaudeInstall(): Plan {
  const file = claudeSettingsFile();
  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
  const settings: Json = original ? JSON.parse(original) : {};
  const next: Json = structuredClone(settings);
  if (!next.hooks) next.hooks = {};
  for (const ev of EVENTS) {
    const groups: Json[] = Array.isArray(next.hooks[ev]) ? next.hooks[ev].filter((g: Json) => !isOurs(g)) : [];
    const group: Json = { hooks: [{ type: 'command', command: hookCommand(ev), timeout: 5 }] };
    if (TOOL_EVENTS.has(ev)) group.matcher = '*';
    const ordered = TOOL_EVENTS.has(ev) ? { matcher: group.matcher, hooks: group.hooks } : group;
    next.hooks[ev] = [...groups, ordered];
  }
  return { file, before: original ?? '', after: JSON.stringify(next, null, 2) + '\n' };
}

export function installClaude(): Plan {
  const plan = planClaudeInstall();
  const state = readState();
  const original = fs.existsSync(plan.file) ? fs.readFileSync(plan.file, 'utf8') : null;
  if (!state.claude) {
    const settings: Json = original ? JSON.parse(original) : {};
    const absent = EVENTS.filter((ev) => !Array.isArray(settings.hooks?.[ev]));
    const absentEvents: string[] = [...absent, ...(settings.hooks ? [] : ['__hooks__'])];
    state.claude = { file: plan.file, original, installed: plan.after, absentEvents };
  } else {
    state.claude.installed = plan.after;
  }
  fs.mkdirSync(path.dirname(plan.file), { recursive: true });
  fs.writeFileSync(plan.file, plan.after);
  writeState(state);
  return plan;
}

export function uninstallClaude(): Plan | null {
  const state = readState();
  const rec = state.claude;
  const file = rec?.file ?? claudeSettingsFile();
  if (!fs.existsSync(file)) return null;
  const current = fs.readFileSync(file, 'utf8');
  const settings: Json = JSON.parse(current);
  const hasOurs = EVENTS.some((ev) => Array.isArray(settings.hooks?.[ev]) && settings.hooks[ev].some(isOurs));
  if (!rec && !hasOurs) return null;
  const cleaned = withoutOurs(settings, rec?.absentEvents ?? []);
  let after: string | null;
  if (rec && rec.original === null && isDeepStrictEqual(cleaned, {})) after = null;
  else if (rec && rec.original !== null && isDeepStrictEqual(cleaned, JSON.parse(rec.original))) after = rec.original;
  else after = JSON.stringify(cleaned, null, 2) + '\n';
  if (after === null) fs.rmSync(file);
  else fs.writeFileSync(file, after);
  delete state.claude;
  writeState(state);
  return { file, before: current, after: after ?? '' };
}

const NOTIFY_RE = /^notify\s*=\s*(\[.*\])\s*$/m;

function tomlArray(values: string[]): string {
  return `[${values.map((v) => JSON.stringify(v)).join(', ')}]`;
}

export function installCodex(): Plan | null {
  const file = codexConfigFile();
  const original = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const state = readState();
  if (state.codex) return { file, before: original, after: original };
  const m = original.match(NOTIFY_RE);
  const previous: string[] | null = m ? JSON.parse(m[1]) : null;
  const line = `notify = ${tomlArray(['node', codexScript(), JSON.stringify(previous ?? [])])}`;
  const after = m ? original.replace(NOTIFY_RE, line) : `${line}\n${original}`;
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.troop-bak`);
  else fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, after);
  state.codex = { file, original, installed: after, previous };
  writeState(state);
  return { file, before: original, after };
}

export function uninstallCodex(): Plan | null {
  const state = readState();
  const rec = state.codex;
  if (!rec || !fs.existsSync(rec.file)) return null;
  const current = fs.readFileSync(rec.file, 'utf8');
  let after: string;
  if (current === rec.installed) after = rec.original;
  else if (rec.previous) after = current.replace(NOTIFY_RE, `notify = ${tomlArray(rec.previous)}`);
  else after = current.replace(/^notify\s*=\s*\[.*\]\s*\r?\n/m, '');
  fs.writeFileSync(rec.file, after);
  delete state.codex;
  writeState(state);
  return { file: rec.file, before: current, after };
}

/** A minimal line diff for the confirm screen. */
export function lineDiff(before: string, after: string): string {
  const a = before.split('\n');
  const b = after.split('\n');
  const out: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (a[i] !== undefined) out.push(`- ${a[i]}`);
    if (b[i] !== undefined) out.push(`+ ${b[i]}`);
  }
  return out.join('\n');
}
