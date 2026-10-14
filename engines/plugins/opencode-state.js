// MetaTrooper state plugin for opencode, after herdr's opencode agent-state plugin (Apache-2.0).
import { spawn } from 'node:child_process';

const WORKING_STATUS = new Set(['busy', 'retry', 'running']);
const WORKING_EVENTS = new Set(['tool.execute.before', 'tool.execute.after', 'permission.replied', 'question.replied', 'question.rejected']);
const CHILD_EVENTS = new Set(['permission.asked', 'question.asked', 'permission.replied', 'question.replied', 'question.rejected']);

// Seeded from the clock so a restarted opencode keeps rising past the last seq the core saw.
let seq = Date.now() * 1000;
const children = new Set();

function stateOf(type, properties) {
  if (type === 'session.status') {
    const s = properties.status;
    return WORKING_STATUS.has(typeof s === 'string' ? s : s?.type) ? { state: 'working' } : null;
  }
  if (WORKING_EVENTS.has(type)) return { state: 'working' };
  if (type === 'permission.asked') return { state: 'waiting', why: 'permission' };
  if (type === 'question.asked') return { state: 'waiting' };
  if (type === 'session.error') return { state: 'waiting', why: 'error' };
  if (type === 'session.idle') return { state: 'done' };
  return null;
}

function report(state) {
  const { TROOP_NODE, TROOP_EVENT_JS, TROOP_SESSION_ID } = process.env;
  if (!TROOP_NODE || !TROOP_EVENT_JS || !TROOP_SESSION_ID) return;
  try {
    const child = spawn(TROOP_NODE, [TROOP_EVENT_JS, 'opencode.state', '--session', TROOP_SESSION_ID], { detached: true, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('error', () => {});
    child.stdin.on('error', () => {});
    child.stdin.end(JSON.stringify({ ...state, seq: ++seq }));
    child.unref();
  } catch {}
}

/** Reports each opencode bus event that names a state; a child session reports only its asks and their answers, under the root session. */
async function server() {
  return {
    event: async ({ event }) => {
      const type = event?.type;
      const properties = event?.properties ?? {};
      if (properties.info?.id && properties.info.parentID) children.add(properties.info.id);
      const state = stateOf(type, properties);
      if (!state || (children.has(properties.sessionID) && !CHILD_EVENTS.has(type))) return;
      report(state);
    },
  };
}

export default { id: 'metatrooper.opencode-state', server };
