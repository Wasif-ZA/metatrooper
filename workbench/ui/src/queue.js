// One queued follow-up per session, sent once when that session first becomes idle or done.
const queued = new Map();
const tried = new Map();

export const queuedText = (id) => queued.get(id) || '';

export function setQueued(id, text) {
  const t = String(text || '').trim();
  if (t) queued.set(id, t); else queued.delete(id);
  tried.delete(id);
}

export function flushQueued(sessions, send) {
  for (const x of sessions || []) {
    const t = queued.get(x.id);
    if (!t) continue;
    if (x.state === 'exited') { queued.delete(x.id); tried.delete(x.id); continue; }
    if (x.state !== 'idle' && x.state !== 'done') continue;
    const mark = `${x.state} ${x.state_at || ''}`;
    if (tried.get(x.id) === mark) continue;
    queued.delete(x.id);
    tried.set(x.id, mark);
    void Promise.resolve(send(x, t)).then((ok) => { if (ok) tried.delete(x.id); else if (!queued.has(x.id)) queued.set(x.id, t); }, () => { if (!queued.has(x.id)) queued.set(x.id, t); });
  }
}
