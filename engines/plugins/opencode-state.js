// MetaTrooper state plugin for opencode, after herdr's opencode agent-state plugin (Apache-2.0).
import { spawn } from 'node:child_process';

const WORKING_STATUS = new Set(['busy', 'retry', 'running']);
const WORKING_EVENTS = new Set(['tool.execute.before', 'tool.execute.after']);
const ASKS = { 'permission.asked': 'permission', 'question.asked': 'question' };
const ANSWERS = { 'permission.replied': 'permission', 'question.replied': 'question', 'question.rejected': 'question' };

// Seeded from the clock, so it rises across opencode restarts.
let seq = Date.now() * 1000;
let asked = 0;
const parents = new Map();
/** Per root session: the asks not yet answered, by id, with their kind and asking session. */
const open = new Map();

function rootOf(id) {
  const seen = new Set();
  while (parents.has(id) && !seen.has(id)) { seen.add(id); id = parents.get(id); }
  return id;
}

function report(state, root) {
  const { TROOP_NODE, TROOP_EVENT_JS, TROOP_SESSION_ID } = process.env;
  if (!TROOP_NODE || !TROOP_EVENT_JS || !TROOP_SESSION_ID) return;
  try {
    const child = spawn(TROOP_NODE, [TROOP_EVENT_JS, 'opencode.state', '--session', TROOP_SESSION_ID], { detached: true, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => {});
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ ...state, seq: ++seq, ...(typeof root === 'string' ? { session_id: root } : {}) }));
    child.unref();
  } catch {}
}

/** Maps one opencode bus event to a report for its root session; while an ask is open, work in that root reports nothing and an answer reports the next open ask. */
function onEvent(event) {
  const type = event?.type;
  const p = event?.properties ?? {};
  if (p.info?.id && p.info.parentID) parents.set(p.info.id, p.info.parentID);
  const child = parents.has(p.sessionID);
  const root = rootOf(p.sessionID);
  const asks = open.get(root) ?? new Map();
  open.set(root, asks);
  const waiting = () => ({ state: 'waiting', ...([...asks.values()].some((a) => a.kind === 'permission') ? { why: 'permission' } : {}) });
  if (ASKS[type]) {
    asks.set(p.id ?? p.requestID ?? `ask-${++asked}`, { kind: ASKS[type], from: p.sessionID });
    return report(waiting(), root);
  }
  if (ANSWERS[type]) {
    const id = p.permissionID ?? p.requestID ?? p.id;
    const same = [...asks].filter(([, a]) => a.kind === ANSWERS[type] && a.from === p.sessionID);
    asks.delete(id ?? (same.length === 1 ? same[0][0] : undefined));
    return report(asks.size ? waiting() : { state: 'working' }, root);
  }
  if (child) return;
  if (type === 'session.idle') return report(asks.size ? waiting() : { state: 'done' }, root);
  if (type === 'session.error') return report({ state: 'waiting', why: 'error' }, root);
  const kind = typeof p.status === 'string' ? p.status : p.status?.type;
  if ((type === 'session.status' && WORKING_STATUS.has(kind)) || WORKING_EVENTS.has(type)) {
    if (!asks.size) report({ state: 'working' }, root);
  }
}

async function server() {
  return { event: async ({ event }) => onEvent(event) };
}

export default { id: 'metatrooper.opencode-state', server };
