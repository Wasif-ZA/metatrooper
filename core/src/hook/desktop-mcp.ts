import { appendFileSync } from 'node:fs';
import { screenResult } from './screen-data.ts';
import { call as coreCall } from '../pipe/client.ts';
import { actionHash, APPROVAL_TIMEOUT_MS, desktopKeysProblem, type Control } from '../approvals.ts';
import { WorkbenchPipe, findSession, type Reply } from './workbench-pipe.ts';
import { serveMcp, type ToolDef } from './mcp-stdio.ts';

const UNAVAILABLE = 'desktop not available: the MetaTrooper workbench is closed';
const CORE_OFFLINE = 'not sent: the MetaTrooper core is offline, so this action cannot be checked';
const CONTROL_CHANGED = -32035;

const win = { window: { type: 'integer', description: 'A window handle from windows.' } };
const READ_ONLY = new Set(['windows', 'snapshot', 'screenshot', 'wait_for', 'verify', 'check']);
const verifyTitle = { verify_title: { type: 'string', description: 'Optional exact window title expected after this action. Must differ before dispatch; verify can later clear an unresolved outcome when this title is read.' } };
const TOOLS: ToolDef[] = [
  { name: 'verify', description: 'Read the predeclared title postcondition of a held action and clear it only if it passes.', inputSchema: { type: 'object', properties: { action_hash: { type: 'string' } }, required: ['action_hash'] } },
  { name: 'check', description: 'Checks a window title or control values with no model and returns each actual value.', inputSchema: { type: 'object', properties: { ...win, checks: { type: 'array', maxItems: 8, items: { type: 'object', properties: { kind: { type: 'string', enum: ['title', 'value'] }, ref: { type: 'string' }, op: { type: 'string', enum: ['equals', 'contains', 'not_contains'] }, expected: { type: 'string' } }, required: ['kind', 'op', 'expected'] } } }, required: ['window', 'checks'] } },
  { name: 'windows', description: 'List the desktop windows the user gave this session, and the windows they own (dialogs, menus).', inputSchema: { type: 'object', properties: {} } },
  { name: 'snapshot', description: 'UI Automation tree of a window as text; each node carries [ref=e12]. Refs last until the next snapshot of that window.', inputSchema: { type: 'object', properties: { ...win, max_nodes: { type: 'integer', default: 400 } }, required: ['window'] } },
  { name: 'screenshot', description: 'JPEG of one window, even when covered; no side over 1,568 px.', inputSchema: { type: 'object', properties: { ...win }, required: ['window'] } },
  { name: 'click', description: 'Click the control with this ref. Returns confirmed or unverifiable.', inputSchema: { type: 'object', properties: { ...win, ...verifyTitle, ref: { type: 'string' } }, required: ['window', 'ref'] } },
  { name: 'type', description: 'Replace the text of the control with this ref. Returns confirmed or unverifiable.', inputSchema: { type: 'object', properties: { ...win, ...verifyTitle, ref: { type: 'string' }, text: { type: 'string' } }, required: ['window', 'ref', 'text'] } },
  { name: 'key', description: 'Press a key in the window, e.g. "Enter", "Tab", "Escape". Control and Shift chords are refused: a posted modifier never reaches the app.', inputSchema: { type: 'object', properties: { ...win, ...verifyTitle, keys: { type: 'string' } }, required: ['window', 'keys'] } },
  { name: 'scroll', description: 'Scroll a control (or the first scrollable one) by dy pixels; positive scrolls down.', inputSchema: { type: 'object', properties: { ...win, ref: { type: 'string' }, dy: { type: 'integer' } }, required: ['window', 'dy'] } },
  { name: 'wait_for', description: 'Wait until a control whose name or value contains text appears in the window.', inputSchema: { type: 'object', properties: { ...win, text: { type: 'string' }, timeout_ms: { type: 'integer', default: 10000 } }, required: ['window', 'text'] } },
].map((t) => ({ ...t, annotations: READ_ONLY.has(t.name) ? { readOnlyHint: true } : { readOnlyHint: false, destructiveHint: true } }));

const workbench = new WorkbenchPipe(UNAVAILABLE);

async function core(method: string, params: Record<string, unknown>, waitMs = 60_000): Promise<Reply> {
  const out = await coreCall(method, params, { waitMs });
  if (out.kind !== 'reply') return { error: { code: -32099, message: method === 'approval.check' || method === 'desktop.act' ? CORE_OFFLINE : 'the MetaTrooper core is offline' } };
  return out.reply;
}

/** The input's time for M6-18e, beside the workbench's cursor rows; never the args or the caption. */
function probe(state: Record<string, unknown>): void {
  const file = process.env.METATROOPER_WORKBENCH_PROBE;
  if (!file) return;
  try {
    appendFileSync(file, JSON.stringify({ at: Date.now(), state }) + '\n');
  } catch {}
}

/** The cursor's caption: never the typed text; " behind <title>" when another window covers the target. */
function caption(name: string, args: Record<string, unknown>, control: Control | null, coveredBy: string): string {
  const what = name === 'type' ? `type ${Array.from(String(args.text ?? '')).length} characters`
    : name === 'key' ? `press ${String(args.keys ?? '')}`
    : name === 'scroll' ? 'scroll'
    : `click ${control?.name || control?.automation_id || control?.role || ''}`.trim();
  return coveredBy ? `${what} behind ${coveredBy}` : what;
}

/** Describe, approval.check, cursor glide, then act with the checked control as `expect`; a changed control checks again. */
async function input(name: string, args: Record<string, unknown>, session_id: string): Promise<Reply> {
  const me = { session_id, pid: process.pid };
  const keysProblem = name === 'key' ? desktopKeysProblem(args.keys) : null;
  if (keysProblem) return { error: { code: -32602, message: keysProblem } };
  for (let attempt = 0; attempt < 3; attempt++) {
    const d = await core('desktop.describe', { ...me, window: args.window, ref: args.ref });
    if (d.error) return d;
    const { grant_id, control, password, hidden, file_dialog, rect, token, minimized, covered_by } = d.result as { grant_id: string; control: Control | null; password: boolean; hidden: boolean; file_dialog: boolean; rect: number[] | null; token: string; minimized?: boolean; covered_by?: string };
    const check = { session_id, surface: 'desktop', target: grant_id, action: name, args, control };
    const v = await core('approval.check', { ...check, password, hidden, file_dialog, action_hash: actionHash(check) }, APPROVAL_TIMEOUT_MS + 10_000);
    if (v.error) return v;
    const out = v.result as { decision: string; reason?: string };
    if (out.decision === 'deny') return { error: { code: -32030, message: out.reason === 'paused by the user' || out.reason?.startsWith('window not granted') ? out.reason : `not sent: ${out.reason}` } };
    if (out.decision === 'rejected') return { error: { code: -32030, message: 'not approved: the user rejected this action' } };
    if (out.decision === 'expired') return { error: { code: -32030, message: 'not approved in time' } };
    const glide = await workbench.call('cursor.glide', { session: session_id, target_rect_px: minimized ? null : rect, caption: caption(name, args, control, String(covered_by ?? '')) });
    // only a refused session stops the input; a cursor that failed to draw never blocks it (D57)
    if (glide.error?.code === -32030) return glide;
    probe({ kind: 'desktop-input', session: session_id, tool: name });
    const r = await core('desktop.act', { ...me, ...args, action: name, expect: { ...(control ?? { name: '', automation_id: '', role: '' }), password, hidden, file_dialog, grant_id, token } }, 10 * 60_000);
    if (r.error?.code !== CONTROL_CHANGED) return r;
  }
  return { error: { code: CONTROL_CHANGED, message: 'the control kept changing; nothing was sent' } };
}

async function waitFor(args: Record<string, unknown>, session_id: string): Promise<Reply> {
  const end = Date.now() + (typeof args.timeout_ms === 'number' && args.timeout_ms > 0 ? Math.min(args.timeout_ms, 120_000) : 10_000);
  for (;;) {
    const r = await core('desktop.find', { session_id, pid: process.pid, window: args.window, text: args.text });
    if (r.error || (r.result as { found?: boolean }).found || Date.now() >= end) return r;
    await new Promise((res) => setTimeout(res, 250));
  }
}

async function toolCall(name: string, raw: Record<string, unknown>): Promise<object> {
  const fail = (text: string) => ({ content: [{ type: 'text', text }], isError: true });
  if (!TOOLS.some((t) => t.name === name)) return fail(`unknown tool ${name}`);
  const { expect: _drop, session_id: _s, pid: _p, ...args } = raw ?? {};
  if (!(await workbench.available())) return fail(UNAVAILABLE);
  const session_id = workbench.sessionId ?? findSession();
  if (!session_id) return fail('this process is not inside a MetaTrooper session');
  const me = { session_id, pid: process.pid };
  const r = name === 'windows' ? await core('desktop.windows', me)
    : name === 'snapshot' ? await core('desktop.snapshot', { ...me, window: args.window, max_nodes: args.max_nodes })
    : name === 'screenshot' ? await core('desktop.screenshot', { ...me, window: args.window })
    : name === 'check' ? await core('desktop.check', { ...me, window: args.window, checks: args.checks })
    : name === 'verify' ? await core('desktop.action.verify', { ...me, action_hash: args.action_hash })
    : name === 'wait_for' ? await waitFor(args, session_id)
    : await input(name, args, session_id);
  if (r.error) return fail(r.error.message);
  const result = r.result as { data_base64?: string; mime?: string; text?: string } | undefined;
  if (name === 'screenshot' && result?.data_base64) return { content: [{ type: 'image', data: result.data_base64, mimeType: result.mime ?? 'image/jpeg' }] };
  if (name === 'snapshot' && typeof result?.text === 'string') return { content: [{ type: 'text', text: result.text }] };
  return { content: [{ type: 'text', text: JSON.stringify(result ?? {}) }] };
}

serveMcp('metatrooper-desktop', TOOLS, async (name, args) => screenResult(await toolCall(name, args)));
