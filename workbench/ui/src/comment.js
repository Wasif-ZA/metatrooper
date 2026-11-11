export { MAX, formatComment } from '../../src/editor-comment.js';

export async function sendComment(sessionId, args, call = (p) => globalThis.troop.comment(p)) {
  if (!String(args?.text ?? '').trim()) return { ok: false, error: 'Write a comment first.' };
  try {
    return await call({ ...args, session_id: sessionId });
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}
