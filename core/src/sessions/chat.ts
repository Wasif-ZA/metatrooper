import { posix, win32 } from 'node:path';
import { agyRequest } from '../gate.ts';

export interface ToolItem {
  kind: 'tool';
  id: string;
  name: string;
  label: string;
  status: 'running' | 'ok' | 'error' | 'waiting';
  file?: string;
  preview?: { added: number; removed: number; more: number; lines: { sign: '-' | '+'; text: string }[] };
  output?: string[];
}

export type Item = { kind: 'user' | 'text'; text: string; id?: string } | ToolItem;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function preview(name: string, input: Record<string, unknown>): ToolItem['preview'] {
  if (!['Edit', 'MultiEdit', 'Write'].includes(name)) return;
  const edits = name === 'MultiEdit' ? (Array.isArray(input.edits) ? input.edits.map(record) : []) : [input];
  const split = (value: unknown) => string(value) === '' ? [] : string(value).split(/\r?\n/);
  const removed = name === 'Write' ? [] : edits.flatMap((edit) => split(edit.old_string));
  const added = name === 'Write' ? split(input.content) : edits.flatMap((edit) => split(edit.new_string));
  const lines = [
    ...removed.map((text) => ({ sign: '-' as const, text: text.slice(0, 200) })),
    ...added.map((text) => ({ sign: '+' as const, text: text.slice(0, 200) })),
  ].slice(0, 3);
  return { added: added.length, removed: removed.length, more: added.length + removed.length - lines.length, lines };
}

function relativeFile(file: string, cwd: string | null): string {
  if (!cwd || !file) return file;
  const path = /^[a-z]:[\\/]|^[\\/]{2}/i.test(cwd) ? win32 : posix;
  const normalized = file.replace(/\\/g, '/');
  if (!path.isAbsolute(normalized)) return file;
  const relative = path.relative(cwd.replace(/\\/g, '/'), normalized).replace(/\\/g, '/');
  return relative === '..' || relative.startsWith('../') || path.isAbsolute(relative) ? file : relative || '.';
}

function toolLabel(name: string, input: Record<string, unknown>, cwd: string | null): { label: string; file?: string } {
  const file = relativeFile(string(input.file_path) || string(input.notebook_path), cwd);
  switch (name) {
    case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit': return { label: `Edited ${file}`, file };
    case 'Read': return { label: `Read ${file}` };
    case 'Bash': case 'PowerShell': return { label: `Ran ${string(input.command).split(/\r?\n/)[0].slice(0, 80)}` };
    case 'Grep': return { label: `Searched for ${string(input.pattern)}` };
    case 'Glob': return { label: `Listed ${string(input.pattern)}` };
    case 'WebFetch': {
      let host = '';
      try { host = new URL(string(input.url)).host; } catch {}
      return { label: `Fetched ${host}` };
    }
    case 'WebSearch': return { label: `Searched the web for ${string(input.query)}` };
    case 'Task': case 'Agent': return { label: `Started a helper: ${string(input.description)}` };
    case 'TodoWrite': case 'TaskCreate': case 'TaskUpdate': return { label: 'Updated the plan' };
    default: return { label: `Used ${name}` };
  }
}

export function parseChat(lines: string[], state: string, cwd: string | null = null, permissionToolUseId: string | null = null): { items: Item[]; waiting: boolean } {
  const items: Item[] = [];
  const tools = new Map<string, ToolItem>();
  for (const line of lines) {
    let entry: Record<string, unknown>;
    try { entry = record(JSON.parse(line)); } catch { continue; }
    if (entry.isSidechain || entry.isMeta || (entry.type !== 'user' && entry.type !== 'assistant')) continue;
    const content = record(entry.message).content;
    const uuid = string(entry.uuid);
    if (typeof content === 'string') {
      if (entry.type === 'user' && !/^(<command-|<local-command|Caveat:)/.test(content)) items.push({ kind: 'user', text: content, ...(uuid ? { id: uuid } : {}) });
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const [blockIndex, value] of content.entries()) {
      const block = record(value);
      if (block.type === 'text' && typeof block.text === 'string') {
        const text = entry.type === 'assistant' ? block.text.trim() : block.text;
        if (text) items.push({ kind: entry.type === 'user' ? 'user' : 'text', text, ...(uuid ? { id: `${uuid}:${blockIndex}` } : {}) });
      } else if (block.type === 'tool_use') {
        const id = string(block.id), name = string(block.name);
        const input = record(block.input);
        const diff = preview(name, input);
        const tool: ToolItem = { kind: 'tool', id, name, ...toolLabel(name, input, cwd), status: 'running', ...(diff ? { preview: diff } : {}) };
        tools.set(id, tool);
        items.push(tool);
      } else if (block.type === 'tool_result') {
        const tool = tools.get(string(block.tool_use_id));
        if (tool) {
          tool.status = block.is_error === true ? 'error' : 'ok';
          if (block.is_error === true) {
            const text = Array.isArray(block.content)
              ? block.content.map(record).filter((part) => part.type === 'text').map((part) => string(part.text)).join('\n')
              : string(block.content);
            tool.output = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 3).map((line) => line.slice(0, 200));
          } else delete tool.output;
        }
      }
    }
  }
  const last = items.at(-1);
  const waiting = state === 'waiting_for_you' && last?.kind === 'tool' && last.status === 'running'
    && last.name !== 'AskUserQuestion' && permissionToolUseId === last.id;
  if (waiting) last.status = 'waiting';
  return { items, waiting };
}

/** Codex rollout or agy transcript lines as chat items: user turns, agent replies, and tool calls (the last one marked waiting while the session waits). */
export function parseEngineChat(lines: string[], state: string): { items: Item[]; waiting: boolean } {
  const items: Item[] = [];
  for (const line of lines) {
    let entry: Record<string, unknown>;
    try { entry = record(JSON.parse(line)); } catch { continue; }
    const p = record(entry.payload);
    if (entry.type === 'response_item' && p.type === 'message' && (p.role === 'assistant' || p.role === 'user')) {
      const text = (Array.isArray(p.content) ? p.content : []).map(record).filter((c) => c.type === 'output_text' || c.type === 'input_text').map((c) => string(c.text)).join('').trim();
      if (text && !text.startsWith('<')) items.push({ kind: p.role === 'assistant' ? 'text' : 'user', text });
    } else if (entry.type === 'response_item' && p.type === 'function_call') {
      items.push({ kind: 'tool', id: string(p.call_id), name: string(p.name), label: `Used ${string(p.name)}`, status: 'running' });
    } else if (entry.type === 'response_item' && p.type === 'function_call_output') {
      const tool = items.findLast((i): i is ToolItem => i.kind === 'tool' && i.id === string(p.call_id));
      if (tool) tool.status = 'ok';
    } else if (entry.type === 'USER_INPUT' && typeof entry.content === 'string') {
      items.push({ kind: 'user', text: agyRequest(entry.content).trim() });
    } else if (entry.type === 'PLANNER_RESPONSE') {
      for (const prev of items) if (prev.kind === 'tool' && prev.status === 'running') prev.status = 'ok';
      if (typeof entry.content === 'string' && entry.content.trim()) items.push({ kind: 'text', text: entry.content.trim() });
      for (const call of Array.isArray(entry.tool_calls) ? entry.tool_calls.map(record) : []) {
        items.push({ kind: 'tool', id: `${String(entry.step_index ?? '')}:${string(call.name)}`, name: string(call.name), label: `Wants to use ${string(call.name)}`, status: 'running' });
      }
    }
  }
  const last = items.at(-1);
  const waiting = state === 'waiting_for_you' && last?.kind === 'tool' && last.status === 'running';
  if (waiting) last.status = 'waiting';
  return { items, waiting };
}
