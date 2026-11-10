import { screenResult } from './screen-data.ts';
import { call as coreCall } from '../pipe/client.ts';
import { actionHash, GATE_WAIT_MS, type Control } from '../approvals.ts';
import { WorkbenchPipe, type Reply } from './workbench-pipe.ts';
import { PRESETS } from '../browser/grants.ts';
import { BATCH_TOOLS, BATCH_MAX, checkBatch } from '../browser/batch.ts';
import { serveMcp } from './mcp-stdio.ts';
import { fence } from '../browser/snapshot.ts';

const UNAVAILABLE = 'browser not available: the Ouros workbench is closed';

const pane = { pane_id: { type: 'string', description: 'From panes; may be omitted when this session owns exactly one pane.' } };
const budget = {
  max_tokens: { type: 'integer', default: 4000 },
  continue: { type: 'string', description: 'The cursor named at the end of a cut answer; returns the next part.' },
};
const READ_ONLY = new Set(['panes', 'snapshot', 'screenshot', 'read', 'find', 'console', 'network', 'wait_for', 'export_test']);
const TOOLS: Array<{ name: string; description: string; inputSchema: Record<string, unknown>; annotations?: Record<string, boolean> }> = [
  { name: 'panes', description: 'List the browser panes this session may drive.', inputSchema: { type: 'object', properties: {} } },
  { name: 'navigate', description: 'Load a URL in a pane; opens a pane for this session when it has none. Returns the page state. signed_in: true asks for a pane that uses the sign-in the user lent for that site; if they have not lent it they are asked and this call fails.', inputSchema: { type: 'object', properties: { ...pane, url: { type: 'string' }, signed_in: { type: 'boolean' } }, required: ['url'] } },
  { name: 'back', description: 'Go back one page. Returns the page state.', inputSchema: { type: 'object', properties: { ...pane } } },
  { name: 'snapshot', description: 'Accessibility tree as text, child frames and shadow roots included; actionable nodes carry [ref=e12], or [ref=f1e12] inside a frame. interactive: only nodes with a ref and their ancestors. since_last: lines added (+) and removed (-) since your previous snapshot of this pane. scope_ref: only the subtree under that ref.', inputSchema: { type: 'object', properties: { ...pane, ...budget, scope_ref: { type: 'string' }, interactive: { type: 'boolean', default: false }, since_last: { type: 'boolean', default: false } } } },
  { name: 'read', description: 'The main text of the page, one line per block; search keeps only lines containing it.', inputSchema: { type: 'object', properties: { ...pane, ...budget, search: { type: 'string' } } } },
  { name: 'find', description: 'Snapshot lines containing the query, each with its ref, path and neighbouring lines; cheaper than snapshot.', inputSchema: { type: 'object', properties: { ...pane, ...budget, query: { type: 'string' } }, required: ['query'] } },
  { name: 'click', description: 'Click the node with this ref. Returns the page state and the interactive snapshot diff.', inputSchema: { type: 'object', properties: { ...pane, ref: { type: 'string' } }, required: ['ref'] } },
  { name: 'handoff', description: 'Give the pane to the user (a login, a captcha, a choice only they can make); the tile shows the reason and a Give back button. Every other browser tool fails with "the user has the pane" until they give it back.', inputSchema: { type: 'object', properties: { ...pane, reason: { type: 'string' } }, required: ['reason'] } },
  { name: 'type', description: 'Replace the text of the node with this ref. Returns the page state and the interactive snapshot diff. text "{{secret:NAME}}" fills a secret the user saved, only into a password field on the origin saved with it; you never see the value.', inputSchema: { type: 'object', properties: { ...pane, ref: { type: 'string' }, text: { type: 'string' }, submit: { type: 'boolean' } }, required: ['ref', 'text'] } },
  { name: 'key', description: 'Press a key or chord on the focused element, e.g. "Enter", "Tab", "Control+A".', inputSchema: { type: 'object', properties: { ...pane, keys: { type: 'string' } }, required: ['keys'] } },
  { name: 'select', description: 'Choose an option in a select element. Returns the page state and the interactive snapshot diff.', inputSchema: { type: 'object', properties: { ...pane, ref: { type: 'string' }, value: { type: 'string' } }, required: ['ref', 'value'] } },
  { name: 'scroll', description: 'Scroll the page, or a node into view.', inputSchema: { type: 'object', properties: { ...pane, ref: { type: 'string' }, dy: { type: 'integer' } }, required: ['dy'] } },
  { name: 'wait_for', description: 'Wait until any one condition holds: text appears, text_gone (text no longer on the page), a ref exists, url_includes (page URL contains it), or idle_ms (no request started or open for that long). At least one is required. timeout_ms is capped at 30000; a larger value returns clamped_to_ms.', inputSchema: { type: 'object', properties: { ...pane, text: { type: 'string' }, text_gone: { type: 'string' }, ref: { type: 'string' }, url_includes: { type: 'string' }, idle_ms: { type: 'integer' }, timeout_ms: { type: 'integer', default: 10000 } } } },
  { name: 'screenshot', description: 'JPEG of the viewport, the full page, or one element (ref); no side over 1,568 px. annotate: true draws a red numbered box over every ref of your last snapshot that is in the picture and adds a text legend, one line per number: "n -> ref, x,y,w,h".', inputSchema: { type: 'object', properties: { ...pane, full_page: { type: 'boolean', default: false }, ref: { type: 'string' }, annotate: { type: 'boolean', default: false }, format: { type: 'string', enum: ['jpeg', 'png'], default: 'jpeg' } } } },
  { name: 'evaluate', description: 'Run a JavaScript expression in an isolated world; result capped at 20 KB.', inputSchema: { type: 'object', properties: { ...pane, expression: { type: 'string' } }, required: ['expression'] } },
  { name: 'console', description: 'Last 200 console messages.', inputSchema: { type: 'object', properties: { ...pane, since_ms: { type: 'integer' } } } },
  { name: 'network', description: 'Last 200 requests.', inputSchema: { type: 'object', properties: { ...pane, since_ms: { type: 'integer' } } } },
  { name: 'batch', description: `Run up to ${BATCH_MAX} steps in order in one call, each {tool, args} with tool one of ${BATCH_TOOLS.join(', ')}; pane_id applies to every step unless the step gives its own. Refs come from a snapshot you took before; a batch takes no snapshot. Each step is approved and audited as a single call. stop_on_error (default true): after a failed step the rest read skipped. Returns {steps: [{step, tool, status ok|error|skipped, text}], page}, page being the url, title and changes of the last step that ran.`, inputSchema: { type: 'object', properties: { ...pane, steps: { type: 'array', minItems: 1, maxItems: BATCH_MAX, items: { type: 'object', properties: { tool: { type: 'string', enum: BATCH_TOOLS }, args: { type: 'object' } }, required: ['tool'] } }, stop_on_error: { type: 'boolean', default: true } }, required: ['steps'] } },
  { name: 'export_test', description: 'A Playwright test file replaying the actions this session has run successfully so far. Typed text is never included.', inputSchema: { type: 'object', properties: { ...pane } } },
  { name: 'dialog', description: 'Accept or dismiss the open alert, confirm or beforeunload dialog.', inputSchema: { type: 'object', properties: { ...pane, accept: { type: 'boolean' }, prompt_text: { type: 'string' } }, required: ['accept'] } },
].map((t) => ({ ...t, annotations: READ_ONLY.has(t.name) ? { readOnlyHint: true } : { readOnlyHint: false, destructiveHint: true } }));

const browser = new WorkbenchPipe(UNAVAILABLE);

const CHECKED = new Set(['click', 'type', 'select', 'key']);
const CONTROL_CHANGED = -32035;

/** Describes the target, asks the core's approval.check, then sends the call with the checked control as `expect`; a changed control checks again. A call stopped before it is sent reports its outcome, so the workbench audits it as it audits a sent one. */
async function checkedCall(name: string, args: Record<string, unknown>): Promise<Reply> {
  const stopped = async (error: { code: number; message: string; instruction?: string }): Promise<Reply> => {
    await browser.call('browser.outcome', { pane_id: args.pane_id, tool: name, status: `error ${error.code}` });
    return { error };
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    const d = await browser.call('browser.describe', { ...args, tool: name });
    if (d.error) return stopped(d.error);
    const { session_id, origin, control, password, hidden } = d.result as { session_id: string; origin: string; control: Control | null; password: boolean; hidden: boolean };
    const check = { session_id, surface: 'browser', target: origin || 'about:blank', action: name, args, control };
    const out = await coreCall('approval.check', { ...check, password, hidden, action_hash: actionHash(check) }, { waitMs: GATE_WAIT_MS });
    if (out.kind !== 'reply') return stopped({ code: -32099, message: 'not sent: the Ouros core is offline, so this action cannot be checked' });
    if (out.reply.error) return stopped(out.reply.error);
    const v = out.reply.result as { decision: string; reason?: string; instruction?: string };
    if (v.decision === 'deny') return stopped({ code: -32030, message: `not sent: ${v.reason}` });
    if (v.decision === 'rejected') return stopped({ code: -32030, message: 'not approved: the user rejected this action', instruction: v.instruction });
    if (v.decision === 'expired') return stopped({ code: -32030, message: 'not approved in time' });
    if (v.decision !== 'allow' && v.decision !== 'approved') return stopped({ code: -32030, message: `not sent: unknown decision ${String(v.decision)}` });
    const r = await browser.call(`browser.${name}`, { ...args, expect: { ...(control ?? { name: '', automation_id: '' }), origin, hidden, password } });
    // the workbench writes no row for a CONTROL_CHANGED attempt, so a retried call is one row
    if (r.error?.code !== CONTROL_CHANGED) return r;
  }
  return stopped({ code: CONTROL_CHANGED, message: 'the control kept changing; nothing was sent' });
}

async function singleCall(name: string, args: Record<string, unknown>): Promise<any> {
  if (!TOOLS.some((t) => t.name === name)) return { content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true };
  const { expect: _drop, ...clean } = args ?? {};
  const r = CHECKED.has(name) ? await checkedCall(name, clean) : await browser.call(`browser.${name}`, clean);
  if (r.error) return { content: [{ type: 'text', text: r.error.message }], isError: true, userNote: r.error.instruction };
  const result = r.result as { data_base64?: string; mime?: string; text?: string; truncated?: boolean; legend?: string[] } | undefined;
  if (name === 'screenshot' && result?.data_base64) {
    const content: object[] = [{ type: 'image', data: result.data_base64, mimeType: result.mime ?? 'image/jpeg' }];
    if (result.truncated) content.push({ type: 'text', text: 'truncated: the page is taller than 16,384 px' });
    if (result.legend) content.push({ type: 'text', text: result.legend.join('\n') });
    return { content };
  }
  if (name === 'export_test' && typeof result?.text === 'string') return { content: [{ type: 'text', text: result.text }] };
  if ((name === 'snapshot' || name === 'read' || name === 'find') && typeof result?.text === 'string') return { content: [{ type: 'text', text: fence(result.text) }] };
  if (typeof (result as { changes?: unknown } | undefined)?.changes === 'string') return { content: [{ type: 'text', text: JSON.stringify({ ...result, changes: fence((result as { changes: string }).changes) }) }] };
  return { content: [{ type: 'text', text: JSON.stringify(result ?? {}) }] };
}

const FOOTER = ['url', 'title', 'dialog', 'errors', 'error', 'changes', 'continue'];

async function batchCall(args: Record<string, unknown>): Promise<object> {
  const bad = checkBatch(args.steps, await browser.sessionGrant());
  if (bad) return { content: [{ type: 'text', text: `${bad.code} ${bad.message}` }], isError: true };
  const steps = args.steps as Array<{ tool: string; args?: Record<string, unknown> }>;
  const out: object[] = [];
  let page: Record<string, unknown> | undefined;
  let failed = false;
  let userNote: string | undefined;
  for (const [i, s] of steps.entries()) {
    const entry = { step: i + 1, tool: s.tool };
    if (failed) { out.push({ ...entry, status: 'skipped' }); continue; }
    const r = await singleCall(s.tool, { ...(args.pane_id === undefined ? {} : { pane_id: args.pane_id }), ...s.args });
    const text: string = r.content[0].text;
    page = undefined;
    if (r.isError) { out.push({ ...entry, status: 'error', text }); userNote = r.userNote ?? userNote; failed = args.stop_on_error !== false; continue; }
    // the footer is the page-state fields of the answer; only the last step that ran keeps it
    let rest: any = text;
    try { const o = JSON.parse(text); const r2 = { ...o }; page = Object.fromEntries(FOOTER.filter((k) => k in o).map((k) => [k, o[k]])); for (const k of FOOTER) delete r2[k]; rest = JSON.stringify(r2); } catch {}
    out.push({ ...entry, status: 'ok', text: rest });
  }
  return { content: [{ type: 'text', text: JSON.stringify({ steps: out, ...(page && Object.keys(page).length ? { page } : {}) }) }], userNote };
}

const toolCall = (name: string, args: Record<string, unknown>): Promise<object> => (name === 'batch' ? batchCall(args ?? {}) : singleCall(name, args));

// tools/list shows only the grant's tools; the workbench enforces it on calls
serveMcp('metatrooper-browser', async () => {
  const grant = await browser.sessionGrant();
  return grant && PRESETS[grant] ? TOOLS.filter((t) => PRESETS[grant].includes(t.name)) : TOOLS;
}, async (name, args) => screenResult(await toolCall(name, args)));
