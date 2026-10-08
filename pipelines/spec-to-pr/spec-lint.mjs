import fs from 'node:fs';
import path from 'node:path';

const SCOPE_WORDS = ['also', 'additionally', 'bonus', 'nice to have'];

/** Section bodies of a markdown file keyed by lower-case heading text. */
export function sections(text) {
  const out = {};
  let key = null;
  for (const line of text.split(/\r?\n/)) {
    const h = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (h) { key = h[1].toLowerCase(); out[key] = ''; continue; }
    if (key !== null) out[key] += `${line}\n`;
  }
  return out;
}

function find(secs, name) {
  const keys = Object.keys(secs);
  const key = keys.find((k) => k.startsWith(name)) ?? keys.find((k) => k.includes(name));
  return key === undefined ? null : secs[key];
}

const bullets = (body) => body.split(/\r?\n/).filter((l) => /^\s*([-*+]|\d+[.)])\s+/.test(l)).map((l) => l.replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
const longWords = (s) => new Set((s.toLowerCase().match(/[a-z]{5,}/g) ?? []));

/** Flags for a spec: missing or empty acceptance checks, behaviour bullets no check covers, scope-creep words in the goal. */
export function lintSpec(text) {
  const secs = sections(text);
  const flags = [];
  const checks = find(secs, 'acceptance check');
  const checkLines = checks === null ? [] : checks.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!checkLines.length) flags.push('Acceptance checks section is missing or empty.');
  const checkWords = longWords(checkLines.join(' '));
  for (const b of bullets(find(secs, 'user-visible behaviour') ?? find(secs, 'user-visible behavior') ?? '')) {
    if (![...longWords(b)].some((w) => checkWords.has(w))) flags.push(`No acceptance check covers: ${b.slice(0, 120)}`);
  }
  const goal = (find(secs, 'goal') ?? '').toLowerCase();
  for (const w of SCOPE_WORDS) if (new RegExp(`\\b${w}\\b`).test(goal)) flags.push(`Goal says "${w}": check for scope creep.`);
  return flags;
}

export async function run(ctx) {
  let text = '';
  try { text = fs.readFileSync(path.join(ctx.runDir, 'spec.md'), 'utf8'); } catch {}
  const flags = text ? lintSpec(text) : ['spec.md was not written.'];
  return { flags: flags.length ? `Spec lint:\n${flags.map((f) => `- ${f}`).join('\n')}` : 'Spec lint: no flags.', count: flags.length };
}
