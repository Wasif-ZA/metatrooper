export const SESSION_STATES = ['starting', 'working', 'waiting_for_you', 'done', 'idle', 'unknown', 'exited'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export interface StateEvent {
  kind: string;
  payload: Record<string, unknown>;
}

const WORKING_KINDS = new Set(['claude.UserPromptSubmit', 'claude.PreToolUse', 'claude.PostToolUse', 'gemini.BeforeAgent', 'gemini.AfterTool']);

/** States set by the Codex and Gemini hooks; SessionStart only links the session, and moves it out of `starting`. */
const HOOK_STATES: Record<string, SessionState> = {
  'codex.PermissionRequest': 'waiting_for_you', 'codex.Stop': 'done', 'codex.Interrupt': 'idle',
  'gemini.Notification': 'waiting_for_you', 'gemini.AfterAgent': 'done',
};

/** `waited` is the tool_use_id a Claude permission wait is on: while waiting for it, only its own PostToolUse (or a prompt, Stop, ...) moves the session. */
export function nextState(current: string, event: StateEvent, waited: string | null = null): SessionState | null {
  if (current === 'exited') return null;
  const p = event.payload ?? {};
  if (HOOK_STATES[event.kind]) return HOOK_STATES[event.kind];
  const held = current === 'waiting_for_you' && waited !== null;
  switch (event.kind) {
    case 'codex.SessionStart':
    case 'gemini.SessionStart':
      return current === 'starting' ? 'idle' : null;
    case 'claude.PermissionRequest':
      return 'waiting_for_you';
    case 'claude.PostToolUse':
    case 'claude.PostToolUseFailure':
      return held && p.tool_use_id !== waited ? null : 'working';
    case 'launch':
      return 'starting';
    case 'claude.Notification':
      if (p.class === 'permission' || p.class === 'input') return 'waiting_for_you';
      return p.class === 'idle' && current === 'starting' ? 'idle' : null;
    case 'claude.Stop':
      return 'done';
    case 'claude.StopFailure':
      return 'waiting_for_you';
    // A Claude conversation can end (clear, resume) while its terminal lives on; core.process-gone marks the real exit.
    case 'claude.SessionEnd':
      return current === 'idle' ? null : 'idle';
    case 'codex.turn':
      return 'done';
    case 'core.activity':
      if (p.state === 'working') return 'working';
      if (p.state === 'quiet') return current === 'working' ? 'done' : null;
      if (p.state === 'blocked') return current === 'working' ? 'waiting_for_you' : null;
      return null;
    case 'core.process-gone':
      return 'exited';
    case 'core.stalled':
      return current === 'starting' ? 'waiting_for_you' : null;
    case 'core.seen':
      return current === 'done' ? 'idle' : null;
    case 'term.bell':
      return current === 'working' || current === 'unknown' || current === 'starting' ? 'waiting_for_you' : null;
    case 'term.output':
      return current === 'waiting_for_you' || current === 'unknown' ? 'working' : null;
    // Claude Code can fire a PreToolUse after Stop that never runs (no PostToolUse, not in the transcript); a finished session waits for PostToolUse or a prompt.
    case 'claude.PreToolUse':
      return current === 'done' || current === 'idle' || held ? null : 'working';
    default:
      if (WORKING_KINDS.has(event.kind)) return 'working';
      return null;
  }
}

const stateWatchers = new Set<(sessionId: string, state: string) => void>();

/** Calls fn on every session state change the core writes; returns the unsubscribe. */
export function onStateChange(fn: (sessionId: string, state: string) => void): () => void {
  stateWatchers.add(fn);
  return () => { stateWatchers.delete(fn); };
}

export function stateChanged(sessionId: string, state: string): void {
  for (const fn of stateWatchers) fn(sessionId, state);
}
