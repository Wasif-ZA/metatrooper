// Engines show as plain names, status as plain words. One source for the React screens and the plain-script sidebar (globalThis.ccWords).
const NAMES = { claude: 'Claude', codex: 'Codex', agy: 'Antigravity', gemini: 'Gemini', copilot: 'Copilot', opencode: 'OpenCode', pi: 'Pi' };

export function engineName(id) {
  const raw = String(id || '').trim();
  return NAMES[raw.toLowerCase()] ?? (raw || 'Unknown engine');
}

/** "Claude, Codex +1": distinct engine names in order, at most `max` named. */
export function engineList(ids, max = 2) {
  const names = [...new Set(ids.map(engineName))];
  return names.slice(0, max).join(', ') + (names.length > max ? ` +${names.length - max}` : '');
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

globalThis.ccWords = { engineName, engineList, statusOf, statusWord, STATUS_WORD };
