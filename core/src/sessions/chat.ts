export interface ToolItem {
  kind: 'tool';
  id: string;
  name: string;
  label: string;
  status: 'running' | 'ok' | 'error' | 'waiting';
  file?: string;
}

export type Item = { kind: 'user' | 'text'; text: string } | ToolItem;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function string(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toolLabel(name: string, input: Record<string, unknown>): { label: string; file?: string } {
  const file = string(input.file_path) || string(input.notebook_path);
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

export function parseChat(lines: string[], state: string): { items: Item[]; waiting: boolean } {
  const items: Item[] = [];
  const tools = new Map<string, ToolItem>();
  for (const line of lines) {
    let entry: Record<string, unknown>;
    try { entry = record(JSON.parse(line)); } catch { continue; }
    if (entry.isSidechain || entry.isMeta || (entry.type !== 'user' && entry.type !== 'assistant')) continue;
    const content = record(entry.message).content;
    if (typeof content === 'string') {
      if (entry.type === 'user' && !/^(<command-|<local-command|Caveat:)/.test(content)) items.push({ kind: 'user', text: content });
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const value of content) {
      const block = record(value);
      if (block.type === 'text' && typeof block.text === 'string') {
        const text = entry.type === 'assistant' ? block.text.trim() : block.text;
        if (text) items.push({ kind: entry.type === 'user' ? 'user' : 'text', text });
      } else if (block.type === 'tool_use') {
        const id = string(block.id), name = string(block.name);
        const tool: ToolItem = { kind: 'tool', id, name, ...toolLabel(name, record(block.input)), status: 'running' };
        tools.set(id, tool);
        items.push(tool);
      } else if (block.type === 'tool_result') {
        const tool = tools.get(string(block.tool_use_id));
        if (tool) tool.status = block.is_error === true ? 'error' : 'ok';
      }
    }
  }
  const last = items.at(-1);
  const waiting = state === 'waiting_for_you' && last?.kind === 'tool' && last.status === 'running';
  if (waiting) last.status = 'waiting';
  return { items, waiting };
}
