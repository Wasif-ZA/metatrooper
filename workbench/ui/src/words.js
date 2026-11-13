// Engine names and status words. One source for the React screens and the plain-script sidebar (globalThis.ccWords).
const NAMES = { claude: 'Claude', codex: 'Codex', agy: 'Antigravity', gemini: 'Gemini', copilot: 'Copilot', opencode: 'OpenCode', pi: 'Pi' };

export function engineName(id) {
  const raw = String(id || '').trim();
  return NAMES[raw.toLowerCase()] ?? (raw || 'Unknown engine');
}

/** A session row's status key from its real state and outcome. */
export function statusOf(x) {
  const s = x?.state;
  const outcome = String(x?.outcome || '');
  if (s === 'waiting_for_you') return 'waiting';
  if (s === 'working' || s === 'starting' || s === 'unknown') return 'running';
  if (s === 'failed' || /fail/.test(outcome)) return 'failed';
  if (s === 'exited' && /cancel/.test(outcome)) return 'stopped';
  if (s === 'done' || s === 'exited' || s === 'idle') return 'done';
  return 'running';
}

export const STATUS_WORD = { running: 'Running', waiting: 'Needs you', done: 'Done', failed: 'Failed', stopped: 'Stopped' };
export const statusWord = (x) => STATUS_WORD[statusOf(x)];

globalThis.ccWords = { engineName, statusOf, statusWord, STATUS_WORD };

export const NOT_SENT = 'Not sent: this agent has no live terminal. Open it on the Wall to check it.';
