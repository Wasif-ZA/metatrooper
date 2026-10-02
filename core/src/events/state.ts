export type SessionState = 'starting' | 'working' | 'waiting_for_you' | 'done' | 'idle' | 'unknown' | 'exited';

export interface StateEvent {
  kind: string;
  payload: Record<string, unknown>;
}

const WORKING_KINDS = new Set(['claude.UserPromptSubmit', 'claude.PreToolUse', 'claude.PostToolUse']);

export function nextState(current: string, event: StateEvent): SessionState | null {
  if (current === 'exited') return null;
  const p = event.payload ?? {};
  switch (event.kind) {
    case 'launch':
      return 'starting';
    case 'claude.Notification':
      return p.class === 'permission' || p.class === 'input' ? 'waiting_for_you' : null;
    case 'claude.Stop':
      return 'done';
    case 'claude.SessionEnd':
      return 'exited';
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
    default:
      if (WORKING_KINDS.has(event.kind)) return 'working';
      return null;
  }
}
