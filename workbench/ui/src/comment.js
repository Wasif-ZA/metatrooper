// Editor line comments sent to the owning agent; same shape as diffLineBody in workbench/src/comments.ts, on one line.
export const MAX = 4000;
const EXCERPT_MAX = 500;

// Core refuses control characters, so line breaks become ' / ' and the rest become spaces.
const flat = (s) => String(s ?? '').trim().replace(/\s*[\r\n]+\s*/g, ' / ').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');

export function formatComment({ path, line, endLine, side = 'new', excerpt = '', text }) {
  const range = endLine && endLine !== line ? `${line}-${endLine}` : `${line}`;
  const code = flat(excerpt);
  const tail = ` / File: ${flat(path)}:${range} (${side === 'old' ? 'old' : 'new'} side)` + (code ? ` / Line: ${code.slice(0, EXCERPT_MAX)}` : '');
  return (flat(text).slice(0, Math.max(0, MAX - tail.length)) + tail).slice(0, MAX);
}

export async function sendComment(sessionId, args, call = (m, p) => globalThis.troop.call(m, p)) {
  if (!String(args?.text ?? '').trim()) return { ok: false, error: 'Write a comment first.' };
  try {
    const out = await call('session.send', { session_id: sessionId, text: formatComment(args) });
    if (out?.kind === 'offline') return { ok: false, error: 'The core is offline.' };
    const err = out?.reply?.error;
    return err ? { ok: false, error: err.message } : { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
