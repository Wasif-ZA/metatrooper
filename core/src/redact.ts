type Obj = Record<string, unknown>;

const FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'MultiEdit', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);
const PATH_TOOLS = new Set(['Grep', 'Glob']);

function lengthOf(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === 'string') return v.length;
  return JSON.stringify(v).length;
}

function asObject(v: unknown): Obj {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {};
}

function pick(raw: Obj, keys: string[]): Obj {
  const out: Obj = {};
  for (const k of keys) if (raw[k] !== undefined) out[k] = raw[k];
  return out;
}

/** Redacts a Claude tool_input per the table in contracts/events-and-hooks.md. */
export function redactToolInput(toolName: string, input: unknown): Obj {
  const o = asObject(input);
  if (SHELL_TOOLS.has(toolName)) {
    const cmd = typeof o.command === 'string' ? o.command : '';
    return { first_word: cmd.trim().split(/\s+/)[0] ?? '', length: cmd.length };
  }
  if (FILE_TOOLS.has(toolName)) return typeof o.file_path === 'string' ? { file_path: o.file_path } : {};
  if (PATH_TOOLS.has(toolName)) return typeof o.path === 'string' ? { path: o.path } : {};
  if (toolName === 'WebFetch') {
    try {
      return { host: new URL(String(o.url)).host };
    } catch {
      return { host: '' };
    }
  }
  const lengths: Record<string, number> = {};
  for (const k of Object.keys(o)) lengths[k] = lengthOf(o[k]);
  return lengths;
}

function classifyNotification(message: string): 'permission' | 'input' | 'other' {
  if (/permission|allow|approve|wants to use/i.test(message)) return 'permission';
  if (/waiting for (your )?input|waiting for you|idle/i.test(message)) return 'input';
  return 'other';
}

/** Builds an event payload from an explicit per-kind allowlist; any other field is dropped. */
export function buildPayload(kind: string, raw: object): Obj {
  const r = asObject(raw);
  const tool = (): Obj => ({
    ...pick(r, ['session_id', 'transcript_path', 'cwd', 'tool_name', 'tool_use_id']),
    tool_input: redactToolInput(String(r.tool_name ?? ''), r.tool_input),
  });
  switch (kind) {
    case 'launch':
      return pick(r, ['session_id', 'pid', 'cwd', 'engine', 'started_at']);
    case 'claude.PreToolUse':
      return tool();
    case 'claude.PostToolUse':
      return { ...tool(), response_length: lengthOf(r.tool_response) };
    case 'claude.UserPromptSubmit':
      return { ...pick(r, ['session_id', 'cwd']), prompt_length: lengthOf(r.prompt) };
    case 'claude.Notification': {
      const msg = typeof r.message === 'string' ? r.message : '';
      return { ...pick(r, ['session_id', 'cwd']), class: classifyNotification(msg), message_length: msg.length };
    }
    case 'claude.Stop':
      return pick(r, ['session_id', 'cwd', 'stop_hook_active']);
    case 'claude.SessionEnd':
      return pick(r, ['session_id', 'cwd', 'reason']);
    case 'codex.turn':
      return {
        ...pick(r, ['type', 'thread-id', 'turn-id', 'cwd']),
        input_length: lengthOf(r['input-messages']),
        reply_length: lengthOf(r['last-assistant-message']),
      };
    case 'herdr.state':
      return pick(r, ['pane', 'state', 'agent']);
    case 'core.activity':
      return pick(r, ['state']);
    case 'core.process-gone':
      return pick(r, ['pid']);
    default:
      return {};
  }
}
