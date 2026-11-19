// Engine names and status words. One source for the React screens and the plain-script sidebar (globalThis.ccWords).
const NAMES = { claude: 'Claude', codex: 'Codex', agy: 'Antigravity', gemini: 'Gemini', copilot: 'Copilot', opencode: 'OpenCode', pi: 'Pi' };
const DEFAULT_ENGINE_ORDER = ['claude', 'codex', 'gemini', 'agy', 'opencode'];

export function defaultEngine(ready, lastPick) {
  if (ready.some((e) => e.id === lastPick)) return lastPick;
  return DEFAULT_ENGINE_ORDER.find((id) => ready.some((e) => e.id === id)) || ready[0]?.id || '';
}

export function engineName(id) {
  const raw = String(id || '').trim();
  return NAMES[raw.toLowerCase()] ?? (raw || 'Unknown engine');
}

/** A session row's status key from its real state and outcome. */
export function statusOf(x) {
  const s = x?.state;
  const outcome = String(x?.outcome || '');
  if (s === 'waiting_for_you') return 'waiting';
  if (s === 'unknown') return 'unknown';
  if (s === 'working' || s === 'starting') return 'running';
  if (s === 'failed' || /fail/.test(outcome)) return 'failed';
  if (s === 'exited' && /cancel/.test(outcome)) return 'stopped';
  if (s === 'done' || s === 'exited' || s === 'idle') return 'done';
  return 'running';
}

export const STATUS_WORD = { running: 'Working', unknown: 'Unknown', waiting: 'Needs you', done: 'Done', failed: 'Failed', stopped: 'Stopped' };
export const statusWord = (x) => STATUS_WORD[statusOf(x)];

/** An agent cc started and that still runs can be stopped from the UI; outside sessions and shells cannot. */
export const canStop = (x) => Boolean(x) && x.host !== 'external' && x.state !== 'exited' && !String(x.id).startsWith('sh_');

export function workingRows(snap) {
  const rows = new Map();
  for (const x of [...(snap?.sessions || []), ...(snap?.live || []), ...Object.values(snap?.tree_rows || {})]) rows.set(x.id, { ...rows.get(x.id), ...x });
  return [...rows.values()].filter((x) => x.state === 'starting' || x.state === 'working');
}

export function workingCounts(snap) {
  let working = 0, helpers = 0;
  for (const x of workingRows(snap)) {
    if (x.parent_id && x.parent_id !== x.id) helpers++;
    else working++;
  }
  return { working, helpers };
}

export function workingLabel({ working, helpers }) {
  return working ? `Working ${working}${helpers ? ` (+${helpers} helper${helpers === 1 ? '' : 's'})` : ''}` : 'Nothing working';
}

globalThis.ccWords = { engineName, statusOf, statusWord, STATUS_WORD, canStop, workingCounts };

export const NOT_SENT = 'Not sent: this agent has no live terminal. Open it on the Wall to check it.';
