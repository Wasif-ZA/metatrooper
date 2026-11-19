import fs from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { ownersAsync, repoOfAsync } from './owners.ts';
import { liveText } from '../terminal/events.ts';
import { redactCredentials, redactSecretValues } from '../redact.ts';
import { linkCodex } from './watch.ts';

export interface Handoff {
  parent_id: string | null;
  cwd: string | null;
  summary: string | null;
  files: Array<{ path: string; committed: boolean }>;
  transcript: string | null;
}

interface TranscriptRecord {
  type?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  message?: { role?: string; content?: unknown };
  payload?: { type?: string; role?: string; phase?: string; content?: unknown };
}

export async function gatherHandoff(db: DatabaseSync, sessionId: string, titles: Record<string, string | undefined>): Promise<Handoff | null> {
  const row = db.prepare('SELECT parent_id, cwd FROM session WHERE id = ?').get(sessionId) as { parent_id: string | null; cwd: string | null } | undefined;
  if (!row) return null;
  const repo = await repoOfAsync(row.cwd);
  const claimed = new Set<string>();
  for (const r of db.prepare("SELECT payload FROM event WHERE kind = 'core.claim' AND session_id = ?").all(sessionId) as Array<{ payload: string }>) {
    try { for (const f of JSON.parse(r.payload).files) claimed.add(f.path); } catch {}
  }
  let dirty = new Set<string>();
  try { if (repo) dirty = new Set((await ownersAsync(db, repo, titles)).map((o) => o.path)); } catch {}
  const transcript = (db.prepare("SELECT json_extract(payload, '$.transcript_path') AS t FROM event WHERE session_id = ? AND json_extract(payload, '$.transcript_path') IS NOT NULL ORDER BY seq DESC LIMIT 1").get(sessionId) as { t: string } | undefined)?.t ?? null;
  return { ...row, summary: liveText()[sessionId]?.line ?? null, transcript, files: [...claimed].sort().map((path) => ({ path, committed: !dirty.has(path) })) };
}

function records(file: string | null): TranscriptRecord[] | null {
  if (!file) return null;
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).flatMap((line) => {
      try { const row = JSON.parse(line); return row && typeof row === 'object' && !Array.isArray(row) ? [row] : []; } catch { return []; }
    });
  } catch { return null; }
}

function text(content: unknown): string {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter((b) => ['text', 'input_text', 'output_text'].includes(b?.type)).map((b) => b.text ?? '').join('\n') : '';
}

export function readFailingCommand(file: string | null, secrets: Iterable<string> = []): { command: string; output: string } | null {
  const values = [...secrets];
  const clean = (value: string) => redactCredentials(redactSecretValues(value, values));
  const commands = new Map<string, string>();
  const failures = new Map<string, string>();
  for (const row of records(file) ?? []) {
    if (row.isSidechain || row.isMeta) continue;
    for (const block of Array.isArray(row.message?.content) ? row.message.content : []) {
      if (block?.type === 'tool_use' && block.name === 'Bash' && typeof block.input?.command === 'string' && typeof block.id === 'string') commands.set(block.id, block.input.command);
      if (block?.type === 'tool_result' && block.is_error === true && commands.has(block.tool_use_id)) {
        failures.set(block.tool_use_id, text(block.content));
      }
    }
  }
  const last = [...commands].reverse().find(([id]) => failures.has(id));
  return last ? { command: clean(last[1]).slice(0, 300), output: clean(failures.get(last[0])!).split(/\r?\n/).slice(0, 20).join('\n').slice(0, 1000) } : null;
}

export function readTurns(file: string | null, engine: string): Array<{ user: string; reply: string }> | null {
  if (engine !== 'claude' && engine !== 'codex') return null;
  const rows = records(file);
  if (!rows?.length) return null;
  const turns: Array<{ user: string; reply: string }> = [];
  for (const row of rows) {
    if (row.isSidechain || row.isMeta) continue;
    const message = engine === 'codex' ? row.type === 'response_item' && row.payload?.type === 'message' ? row.payload : null : row.message;
    if (!message) continue;
    const role = message.role ?? row.type;
    const value = text(message.content);
    if (!value.trim()) continue;
    if (role === 'user') turns.push({ user: value, reply: '' });
    if (role === 'assistant' && turns.length && (engine !== 'codex' || row.payload?.phase !== 'commentary')) turns.at(-1)!.reply = value;
  }
  return turns;
}

export function handoffTranscript(db: DatabaseSync, sessionId: string, engine: string, file: string | null): string | null {
  if (file || engine !== 'codex') return file;
  const row = db.prepare('SELECT s.*, p.path AS project_path FROM session s JOIN project p ON p.id = s.project_id WHERE s.id = ?').get(sessionId);
  return row ? linkCodex(db, row as Parameters<typeof linkCodex>[1]) : null;
}

export function buildHandoff(row: Handoff, engine: string, title: string | undefined, secrets: Iterable<string>): string {
  const values = [...secrets];
  const clean = (value: string) => redactCredentials(redactSecretValues(value, values));
  const turns = readTurns(row.transcript, engine);
  const failure = readFailingCommand(row.transcript, values);
  let task = clean(title || turns?.[0]?.user || 'Task unavailable').slice(0, 200);
  let folder = clean(row.cwd ?? '');
  const files = row.files.map((f) => `- ${clean(f.path)} (${f.committed ? 'committed' : 'uncommitted'})`);
  let count = Math.min(40, files.length);
  const command = failure ? clean(failure.command).slice(0, 300) : '';
  let output = failure ? clean(failure.output).slice(0, 1000) : '';
  const fixed = () => `# Continue this task\n${clean(engine)} stopped at its usage limit.\n\n## Task\n${task}\n\n## Working folder\n${folder}\n\n## Changed files\n${files.slice(0, count).join('\n') || 'none changed'}${files.length > count ? `\nand ${files.length - count} more` : ''}\n${failure ? `\n## Last failing command\n${command}\n${output}\n` : ''}\n## Last turns\n${turns === null ? clean(`no transcript was readable for ${engine}`) + '\n' : ''}`;
  const bytes = (value: string) => Buffer.byteLength(value, 'utf8');
  while (bytes(fixed()) > 6144 && count) count--;
  while (bytes(fixed()) > 6144 && output) output = output.slice(0, -1);
  while (bytes(fixed()) > 6144 && folder) folder = folder.slice(0, -1);
  while (bytes(fixed()) > 6144 && task) task = task.slice(0, -1);
  const chosen: string[] = [];
  for (const turn of (turns ?? []).slice(-10).reverse()) {
    const part = `\nUser: ${clean(turn.user).slice(0, 1000)}\nAgent: ${clean(turn.reply).slice(0, 1000)}\n`;
    if (bytes(fixed() + part + chosen.join('')) > 6144) break;
    chosen.unshift(part);
  }
  return fixed() + chosen.join('');
}
