// One queued follow-up per session, sent once when that session first becomes idle or done.
const queued = new Map();

export const queuedText = (id) => queued.get(id) || '';

export function setQueued(id, text) {
  const t = String(text || '').trim();
  if (t) queued.set(id, t); else queued.delete(id);
}

export function flushQueued(sessions, send) {
  for (const x of sessions || []) {
    const t = queued.get(x.id);
    if (!t) continue;
    if (x.state === 'exited') { queued.delete(x.id); continue; }
    if (x.state !== 'idle' && x.state !== 'done') continue;
    queued.delete(x.id);
    void send(x, t);
  }
}
