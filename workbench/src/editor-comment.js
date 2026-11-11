export const MAX = 4000;
const EXCERPT_MAX = 500;

const RAW_MAX = 8000;

const flat = (s) => String(s ?? '').slice(0, RAW_MAX).trim().replace(/\s*[\r\n]+\s*/g, ' / ').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');

export function formatComment({ path, line, endLine, side = 'new', excerpt = '', text }) {
  const range = endLine && endLine !== line ? `${line}-${endLine}` : `${line}`;
  const code = flat(excerpt);
  const tail = ` / File: ${flat(path)}:${range} (${side === 'old' ? 'old' : 'new'} side)` + (code ? ` / Line: ${code.slice(0, EXCERPT_MAX)}` : '');
  return (flat(text).slice(0, Math.max(0, MAX - tail.length)) + tail).slice(0, MAX);
}
