export const ISSUE_PREFIX = 'https://github.com/Wasif-ZA/metatrooper-private/issues/new?';
export const MAX_URL = 7500;

export type IssueFacts = { version: string; commit: string; view: string; project: string; os: string; time: string; errors: string[] };

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').slice(0, max) : '');

/** Keeps only the renderer fields the report may carry; the project is reduced to its last path segment. */
export function cleanReport(raw: unknown): { view: string; project: string; errors: string[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const project = str(r.project, 200).split(/[\\/]/).filter(Boolean).pop() || '';
  const errors = Array.isArray(r.errors) ? r.errors.slice(-20).map((x) => str(x, 300)).filter(Boolean) : [];
  return { view: str(r.view, 40) || 'unknown', project, errors };
}

export function localIso(d = new Date()): string {
  const p = (n: number) => String(Math.abs(n)).padStart(2, '0');
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}${off < 0 ? '-' : '+'}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
}

function body(f: IssueFacts, errors: string[], dropped: number): string {
  const lines = [
    '## What happened', '', '', '## What I expected', '', '',
    '## Context', '',
    `- Ouros: ${f.version}${f.commit ? ` (${f.commit})` : ''}`,
    `- View: ${f.view}`,
    `- Project: ${f.project || 'none'}`,
    `- OS: ${f.os}`,
    `- Time: ${f.time}`,
  ];
  if (errors.length || dropped) lines.push('', `## Recent console errors (${errors.length}${dropped ? `, ${dropped} older cut for length` : ''})`, '', '```', ...errors, '```');
  return lines.join('\n');
}

const urlOf = (title: string, text: string) => `${ISSUE_PREFIX}title=${encodeURIComponent(title)}&body=${encodeURIComponent(text)}`;

/** Builds the new-issue URL from the hard-coded prefix, dropping the oldest errors first to stay under MAX_URL. */
export function issueUrl(f: IssueFacts): string {
  const title = `Ouros: ${f.view}`;
  let errors = f.errors.slice(-20);
  let url = urlOf(title, body(f, errors, 0));
  while (url.length > MAX_URL && errors.length) {
    errors = errors.slice(1);
    url = urlOf(title, body(f, errors, f.errors.length - errors.length));
  }
  return url;
}
