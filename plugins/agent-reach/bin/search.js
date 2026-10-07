import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exaSearch } from './inspiration-board.js';

const UA = 'MetaTrooper-Search/0.1';

export function queriesOf(plan) {
  return [...plan.matchAll(/^\s*(?:[-*]|\d+\.)?\s*search:\s*(.+?)\s*$/gim)].map((m) => m[1]);
}

export function pageText(html) {
  return html
    .replace(/<(script|style|noscript|nav|footer)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|li|h\d|tr|br)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

async function save(url, file) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!/html|text\/plain/i.test(type)) throw new Error(`unsupported content type ${type}`);
  const text = pageText(await res.text());
  if (text.length < 200) throw new Error('page had no readable text');
  fs.writeFileSync(file, text);
}

export async function search(input, search_ = exaSearch, save_ = save) {
  const queries = queriesOf(fs.readFileSync(input.plan, 'utf8'));
  if (!queries.length) throw new Error('plan has no "search:" lines');
  fs.mkdirSync(input.out, { recursive: true });
  const per = input.per_query ?? 3;
  const sources = [];
  const seen = new Set();
  const failed = [];
  for (const query of queries) {
    let hits = [];
    try { hits = await search_(query, per); } catch (e) { failed.push({ query, error: e.message }); continue; }
    for (const hit of hits.slice(0, per)) {
      if (seen.has(hit.source_url)) continue;
      seen.add(hit.source_url);
      const id = `s${String(sources.length + 1).padStart(2, '0')}`;
      const src = { id, url: hit.source_url, title: hit.title, query };
      try {
        await save_(hit.source_url, path.join(input.out, `${id}.txt`));
        src.path = `${id}.txt`;
      } catch (e) {
        src.error = e.message;
        if (hit.excerpt) {
          fs.writeFileSync(path.join(input.out, `${id}.txt`), hit.excerpt);
          Object.assign(src, { path: `${id}.txt`, excerpt_only: true });
        }
      }
      sources.push(src);
    }
  }
  fs.writeFileSync(path.join(input.out, 'sources.json'), JSON.stringify(sources, null, 2));
  return { sources: path.join(input.out, 'sources.json'), count: sources.length, saved: sources.filter((s) => s.path && !s.excerpt_only).length, excerpts: sources.filter((s) => s.excerpt_only).length, failed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    process.stdout.write(JSON.stringify({ ok: true, outputs: await search(req.input || {}) }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: e.message, retryable: true } }) + '\n');
    process.exit(1);
  }
}
