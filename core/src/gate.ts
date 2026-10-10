import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { settings } from './settings.ts';

const STATUS_ASK = /what are you doing|how long|\beta\b|\/btw eta|status\?/i;
const SMOKE = /reply (ready|ok)|name the model|which model|echo|ping|say ok|are you (there|working)/i;

export interface Metric {
  num: number | null;
  den: number | null;
  value: number | null;
  target: string;
  pass: boolean | null;
  reason?: string;
}

export interface GateReport {
  window: { since: string; until: string };
  counts: { prompts: number; asked: number; unclassified: number; engine_runs: number; skipped_lines: number; unreadable_files: number };
  A01: Metric;
  A02: Metric;
  A03: Metric;
  A04: Metric;
  A05: Metric;
}

export interface GateOptions {
  since: Date;
  until: Date;
  home: string;
  db: DatabaseSync | null;
  toolrouter: string[] | null;
  askPaths?: unknown[];
}

type Counts = GateReport['counts'];
type Rec = Record<string, unknown>;

const TARGETS: Record<'A01' | 'A02' | 'A03' | 'A04' | 'A05', [string, (v: number) => boolean]> = {
  A01: ['>= 70', (v) => v >= 70],
  A02: ['< 1', (v) => v < 1],
  A03: ['< 3', (v) => v < 3],
  A04: ['< 0.5', (v) => v < 0.5],
  A05: ['>= 20', (v) => v >= 20],
};

function metric(id: keyof typeof TARGETS, num: number | null, den: number | null, reason?: string): Metric {
  const [target, ok] = TARGETS[id];
  const value = num !== null && den ? (num / den) * 100 : null;
  const m: Metric = { num, den, value, target, pass: value === null ? null : ok(value) };
  if (reason) m.reason = reason;
  return m;
}

/** Parsed object lines of a JSONL file; null when the file cannot be read. */
function readJsonl(file: string, c: Counts): Rec[] | null {
  let text: string;
  try { text = fs.readFileSync(file, 'utf8'); } catch { c.unreadable_files++; return null; }
  const out: Rec[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const v = JSON.parse(line);
      if (v && typeof v === 'object' && !Array.isArray(v)) out.push(v);
      else c.skipped_lines++;
    } catch { c.skipped_lines++; }
  }
  return out;
}

function listDir(dir: string): fs.Dirent[] {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

function walkJsonl(dir: string, out: string[] = []): string[] {
  for (const e of listDir(dir)) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJsonl(p, out);
    else if (e.name.endsWith('.jsonl')) out.push(p);
  }
  return out;
}

function firstUserMessage(texts: string[]): string | null {
  for (const t of texts) {
    const s = t.trim();
    if (s && !s.startsWith('<') && !s.startsWith('# AGENTS.md')) return s;
  }
  return null;
}

function claudeSessionAsks(files: string[], c: Counts, ask: Ask): boolean | null {
  let readable = 0;
  let asked = false;
  for (const f of files) {
    const recs = readJsonl(f, c);
    if (!recs) continue;
    readable++;
    for (const r of recs) {
      if (ask(String(r.cwd ?? ''))) asked = true;
      const content = (r.message as Rec | undefined)?.content;
      if (Array.isArray(content)) {
        for (const b of content) if (b?.type === 'tool_use' && ask(JSON.stringify(b.input ?? null))) asked = true;
      }
    }
  }
  return readable ? asked : null;
}

interface Run { start: number; asked: boolean; texts: string[] }

function codexRun(file: string, c: Counts, ask: Ask): Run | null {
  const recs = readJsonl(file, c);
  if (!recs) return null;
  const meta = recs.find((r) => r.type === 'session_meta');
  const start = meta ? Date.parse(String(meta.timestamp ?? (meta.payload as Rec | undefined)?.timestamp ?? '')) : NaN;
  if (!meta || Number.isNaN(start)) { c.skipped_lines++; return null; }
  let asked = ask(String((meta.payload as Rec | undefined)?.cwd ?? ''));
  const texts: string[] = [];
  for (const r of recs) {
    const p = r.payload as Rec | undefined;
    if (r.type !== 'response_item' || !p) continue;
    if (p.type === 'message' && p.role === 'user' && Array.isArray(p.content)) {
      texts.push(p.content.filter((i: Rec) => i?.type === 'input_text' && typeof i.text === 'string').map((i: Rec) => i.text).join(''));
    }
    if (p.type === 'function_call' && ask(String(p.arguments ?? ''))) asked = true;
  }
  return { start, asked, texts };
}

/** The text inside agy's <USER_REQUEST> wrapper; the whole content when there is no wrapper. */
export function agyRequest(content: string): string {
  const open = content.indexOf('<USER_REQUEST>');
  if (open < 0) return content;
  const rest = content.slice(open + '<USER_REQUEST>'.length);
  const end = rest.search(/<\/USER_REQUEST>|<ADDITIONAL_METADATA>|<PLAN>|<USER_SETTINGS_CHANGE>/);
  return end < 0 ? rest : rest.slice(0, end);
}

function agyRun(file: string, c: Counts, ask: Ask): Run | null {
  const recs = readJsonl(file, c);
  if (!recs) return null;
  const start = recs.length ? Date.parse(String(recs[0].created_at ?? '')) : NaN;
  if (Number.isNaN(start)) { c.skipped_lines++; return null; }
  let asked = false;
  const input = recs.find((r) => r.type === 'USER_INPUT');
  const texts = typeof input?.content === 'string' ? [agyRequest(input.content)] : [];
  for (const r of recs) if ('tool_calls' in r && ask(JSON.stringify(r.tool_calls))) asked = true;
  return { start, asked, texts };
}

function toolrouterMetric(argv: string[] | null, since: Date, until: Date): Metric {
  if (!argv) return metric('A05', null, null, 'toolrouter not found');
  let stdout: string;
  try {
    stdout = execFileSync(argv[0], [...argv.slice(1), 'ingest', '--since', since.toISOString(), '--until', until.toISOString(), '--no-save', '--json'],
      { encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { signal?: string };
    if (err.code === 'ENOENT') return metric('A05', null, null, 'toolrouter not found');
    if (err.code === 'ETIMEDOUT' || err.signal) return metric('A05', null, null, 'toolrouter timed out');
    return metric('A05', null, null, 'toolrouter failed');
  }
  let out: Rec;
  try { out = JSON.parse(stdout.trim()); } catch { return metric('A05', null, null, 'toolrouter output invalid'); }
  const shell = out?.shell_read_tokens, saved = out?.saved_tokens;
  if (!out || out.ok !== true || typeof shell !== 'number' || typeof saved !== 'number') return metric('A05', null, null, 'toolrouter output invalid');
  return metric('A05', saved, shell + saved);
}

type Ask = (text: string) => boolean;

const slashes = (s: string) => s.toLowerCase().replace(/[\\/]+/g, '/');

/** True when the text names a folder from `sessions.ask_paths`, in either slash form and any case. */
function askMatcher(paths: unknown[]): Ask {
  const roots = paths.filter((p): p is string => typeof p === 'string' && p.trim() !== '').map((p) => slashes(p).replace(/\/$/, ''));
  return (text) => { const t = slashes(text); return roots.some((r) => t.includes(r)); };
}

export function measureGate(o: GateOptions): GateReport {
  const ask = askMatcher(o.askPaths ?? settings().sessions.ask_paths);
  const lo = o.since.getTime(), hi = o.until.getTime();
  const inWindow = (t: number) => t >= lo && t < hi;
  const c: Counts = { prompts: 0, asked: 0, unclassified: 0, engine_runs: 0, skipped_lines: 0, unreadable_files: 0 };

  const transcripts = new Map<string, string[]>();
  const projects = path.join(o.home, '.claude', 'projects');
  for (const d of listDir(projects)) {
    if (!d.isDirectory()) continue;
    for (const f of listDir(path.join(projects, d.name))) {
      if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
      const sid = f.name.slice(0, -6);
      transcripts.set(sid, [...(transcripts.get(sid) ?? []), path.join(projects, d.name, f.name)]);
    }
  }
  const askBySession = new Map<string, boolean | null>();
  const classify = (sid: string) => {
    if (!askBySession.has(sid)) {
      const files = transcripts.get(sid);
      askBySession.set(sid, files ? claudeSessionAsks(files, c, ask) : null);
    }
    return askBySession.get(sid) as boolean | null;
  };

  const sessions = new Set<string>();
  let statusAsks = 0, screenshots = 0;
  for (const r of readJsonl(path.join(o.home, '.claude', 'history.jsonl'), c) ?? []) {
    if (typeof r.sessionId !== 'string' || typeof r.display !== 'string' || typeof r.timestamp !== 'number') { c.skipped_lines++; continue; }
    if (!inWindow(r.timestamp)) continue;
    const asked = classify(r.sessionId);
    if (asked === null) { c.unclassified++; continue; }
    if (asked) { c.asked++; continue; }
    c.prompts++;
    sessions.add(r.sessionId);
    if (STATUS_ASK.test(r.display)) statusAsks++;
    if (r.display.includes('[Image #')) screenshots++;
  }

  let A01: Metric;
  if (!o.db) A01 = metric('A01', null, null, 'troop.db not found');
  else {
    const q = o.db.prepare(`SELECT 1 FROM session s JOIN engine e ON e.id = s.engine_id WHERE e.id = 'claude' AND s.native_id = ?`);
    let linked = 0;
    for (const sid of sessions) if (q.get(sid)) linked++;
    A01 = metric('A01', linked, sessions.size);
  }

  const runs: Run[] = [];
  for (const f of walkJsonl(path.join(o.home, '.codex', 'sessions'))) {
    const r = codexRun(f, c, ask);
    if (r) runs.push(r);
  }
  const brain = path.join(o.home, '.gemini', 'antigravity-cli', 'brain');
  for (const d of listDir(brain)) {
    const f = path.join(brain, d.name, '.system_generated', 'logs', 'transcript.jsonl');
    if (!d.isDirectory() || !fs.existsSync(f)) continue;
    const r = agyRun(f, c, ask);
    if (r) runs.push(r);
  }
  let smoke = 0;
  for (const r of runs) {
    if (!inWindow(r.start) || r.asked) continue;
    c.engine_runs++;
    const first = firstUserMessage(r.texts);
    if (first !== null && first.length < 80 && SMOKE.test(first)) smoke++;
  }

  return {
    window: { since: o.since.toISOString(), until: o.until.toISOString() },
    counts: c,
    A01,
    A02: metric('A02', statusAsks, c.prompts),
    A03: metric('A03', smoke, c.engine_runs),
    A04: metric('A04', screenshots, c.prompts),
    A05: toolrouterMetric(o.toolrouter, o.since, o.until),
  };
}

const DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(Z|[+-]\d{2}:\d{2})?)?$/;

/** Parses a --since/--until value; null when it is not an accepted form. */
export function parseGateDate(s: string): Date | null {
  if (!DATE.test(s)) return null;
  const withZone = s.includes('T') && !/(Z|[+-]\d{2}:\d{2})$/.test(s) ? s + 'Z' : s;
  const t = Date.parse(withZone);
  return Number.isNaN(t) ? null : new Date(t);
}

export function formatGate(r: GateReport): string {
  const c = r.counts;
  const lines = [`window ${r.window.since} to ${r.window.until}  prompts ${c.prompts}  ask paths ${c.asked}  unclassified ${c.unclassified}  engine runs ${c.engine_runs}`];
  const unit: Record<string, string> = { A01: '%', A02: ' per 100', A03: '%', A04: ' per 100', A05: '%' };
  for (const id of ['A01', 'A02', 'A03', 'A04', 'A05'] as const) {
    const m = r[id];
    const label = `A-${id.slice(1)}`;
    lines.push(m.value === null
      ? `${label}  n/a  target ${m.target}${m.reason ? `  (${m.reason})` : ''}`
      : `${label}  ${m.num} / ${m.den} = ${m.value.toFixed(1)}${unit[id]}  target ${m.target}  ${m.pass ? 'PASS' : 'FAIL'}`);
  }
  return lines.join('\n');
}
