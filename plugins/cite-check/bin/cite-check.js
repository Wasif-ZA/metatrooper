import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { safeFetch } from './safe-fetch.js';

const UA = 'MetaTrooper-CiteCheck/0.1';

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', mdash: '-', ndash: '-' };

export function normalise(s) {
  return s
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[‐-―−]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ponytail: sentence split on terminal punctuation followed by a capital; abbreviations like "e.g. The" split early.
const sentences = (line) => line.split(/(?<=[.!?](?:\s*\[s\w+\])*)\s+(?=["“(]?[A-Z])/);

function loadSources(where) {
  const file = fs.statSync(where).isDirectory() ? path.join(where, 'sources.json') : where;
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { dir: path.dirname(file), list: Array.isArray(list) ? list : list.sources ?? [] };
}

async function sourceText(src, dir, ms) {
  if (src.path) {
    const file = path.resolve(dir, src.path);
    if (path.relative(dir, file).startsWith('..') || path.isAbsolute(path.relative(dir, file))) throw new Error(`path ${src.path} is outside the sources folder`);
    return fs.readFileSync(file, 'utf8');
  }
  const res = await safeFetch(src.url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

export async function check(input, runDir) {
  const report = fs.readFileSync(input.report, 'utf8');
  const { dir, list } = loadSources(input.sources);
  const ms = (input.timeout_seconds ?? 15) * 1000;
  const texts = new Map();
  const dead_links = [];
  for (const src of list) {
    try {
      texts.set(src.id, normalise(await sourceText(src, dir, ms)));
    } catch (e) {
      dead_links.push({ id: src.id, url: src.url ?? src.path, error: e instanceof Error ? e.message : String(e) });
    }
  }
  const unbound = [];
  let claims_total = 0;
  let bound = 0;
  report.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    if (/^\s*(#|```|\||>|$)/.test(raw)) return;
    for (const text of sentences(raw.trim())) {
      const ids = [...text.matchAll(/\[(s\w+)\]/g)].map((m) => m[1]);
      if (!ids.length) {
        if (/\d/.test(text)) unbound.push({ line, text, reason: 'uncited factual sentence' });
        continue;
      }
      claims_total += 1;
      const quotes = [...text.matchAll(/["“]([^"“”]{4,})["”]/g)].map((m) => normalise(m[1]));
      const missing = ids.filter((id) => !list.some((s) => s.id === id));
      if (missing.length) { unbound.push({ line, text, reason: `unknown source ${missing.join(', ')}` }); continue; }
      if (!quotes.length) { unbound.push({ line, text, reason: 'no quote to check' }); continue; }
      const absent = quotes.filter((q) => !ids.some((id) => texts.get(id)?.includes(q)));
      if (absent.length) { unbound.push({ line, text, reason: `quote not found in ${ids.join(', ')}: "${absent[0]}"` }); continue; }
      bound += 1;
    }
  });
  const result = { passed: unbound.length === 0 && dead_links.length === 0, claims_total, bound, unbound, dead_links };
  const result_path = path.join(runDir || path.dirname(input.report), 'cite-check.json');
  fs.writeFileSync(result_path, JSON.stringify(result, null, 2));
  return { ...result, result_path };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const outputs = await check(req.input || {}, process.env.TROOP_RUN_DIR || req.run?.dir);
    process.stdout.write(JSON.stringify({ ok: true, outputs }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: e instanceof Error ? e.message : String(e), retryable: false } }));
  }
}
