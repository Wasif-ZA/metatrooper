export const chatModeOf = (engineId, source) => source === 'transcript' ? 'chat' : 'terminal';

export const TERMINAL_ONLY_NOTE = 'This agent shares no chat record, so cc shows its terminal only.';

export function pollDelay({ state, pending, hidden }) {
  if (hidden) return 1500;
  return state === 'working' || state === 'starting' || pending > 0 ? 300 : 1500;
}

export function mergeEcho(items, echoes, now) {
  const pending = echoes.filter(({ text, seen, at }) => {
    if (now - at > 30000) return false;
    const matching = items.filter((item) => item.kind === 'user' && item.text.trim() === text.trim());
    return matching.every((item) => item.id != null)
      ? !matching.some((item) => !seen.includes(item.id))
      : matching.length <= seen.length;
  });
  return { items: pending.length ? [...items, ...pending.map(({ text }) => ({ kind: 'user', text, echo: true }))] : items, pending };
}

export function baselineOf(prev, items) {
  const baseline = new Map(prev);
  let index = 0;
  for (const item of items) {
    if (item.kind !== 'text') continue;
    const key = item.id ?? `text:${index}`;
    index++;
    if (!baseline.has(key)) baseline.set(key, prev === null ? item.text.length : 0);
  }
  return baseline;
}

export function liveChunks(chunks, now, fadeMs) {
  return chunks.filter(({ born }) => now - born < fadeMs);
}

export function paceFor(tail) {
  return Math.min(1200, (tail.match(/\S+/g) || []).length * 50);
}

export function revealSteps(fromLen, text, windowMs) {
  if (fromLen > text.length) return [{ at: 0, len: text.length }];
  if (fromLen === text.length) return [];
  const ends = [];
  for (let len = fromLen + 1; len <= text.length; len++) {
    if (len === text.length || text[len] === ' ' || text[len] === '\n') ends.push(len);
  }
  const count = Math.min(60, ends.length);
  return Array.from({ length: count }, (_, i) => ({
    at: count === 1 ? 0 : i * windowMs / (count - 1),
    len: ends[Math.ceil((i + 1) * ends.length / count) - 1],
  }));
}

export const approvalInput = (engineId, allow) => engineId === 'claude' ? allow ? '1' : '\x1b' : null;

export function approvalText(item) {
  return item.label.replace(/^(Ran|Edited|Used) /, (_, verb) => ({ Ran: '', Edited: 'Edit ', Used: 'Use ' })[verb]);
}

export function groupItems(items) {
  const out = [];
  let run = [];
  const flush = () => {
    if (run.length < 4) out.push(...run);
    else {
      const failed = run.filter((x) => x.status === 'error').length;
      const suffix = failed ? ` · ${failed} failed` : run.some((x) => x.status === 'running') ? ' · working' : '';
      out.push({ kind: 'steps', id: `steps:${run[0].id}`, items: run, label: `${run.length} steps${suffix}` });
    }
    run = [];
  };
  for (const item of items) {
    if (item.kind === 'tool' && !item.file && item.status !== 'waiting') run.push(item);
    else { flush(); out.push(item); }
  }
  flush();
  return out;
}

export function splitLabel(label) {
  const verb = ['Searched the web for', 'Started a helper:', 'Searched for', 'Updated the plan']
    .find((verb) => label === verb || label.startsWith(verb + ' ')) || label.split(' ')[0];
  return { verb, arg: label.slice(verb.length).trimStart() };
}

export function fileTotals(items) {
  const totals = Object.create(null);
  for (const item of items) {
    if (item.kind !== 'tool' || !item.file) continue;
    const total = totals[item.file] ||= { added: 0, removed: 0, edits: 0 };
    total.added += item.preview?.added || 0;
    total.removed += item.preview?.removed || 0;
    total.edits++;
  }
  return { ...totals };
}
