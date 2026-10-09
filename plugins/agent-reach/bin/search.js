import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exaSearch } from './inspiration-board.js';
import { safeFetch } from './safe-fetch.js';

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
  const res = await safeFetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
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
  if (!sources.length) throw new Error(`no sources found${failed.length ? `: ${failed.map((f) => `${f.query}: ${f.error}`).join('; ')}` : ''}`);
  fs.writeFileSync(path.join(input.out, 'sources.json'), JSON.stringify(sources, null, 2));
  return { sources: path.join(input.out, 'sources.json'), count: sources.length, saved: sources.filter((s) => s.path && !s.excerpt_only).length, excerpts: sources.filter((s) => s.excerpt_only).length, failed };
}

const PREFER = /about|service|team|story|work|menu|pricing|book|contact/i;

export function sameSiteLinks(html, base) {
  const origin = new URL(base).origin;
  const links = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], base);
      if (u.origin === origin && !/\.(pdf|jpe?g|png|gif|zip|mp4)$/i.test(u.pathname) && u.href !== base) links.add(u.href.replace(/\/$/, ''));
    } catch {}
  }
  return [...links].sort((a, b) => Number(PREFER.test(b)) - Number(PREFER.test(a)));
}

async function fetchHtml(url) {
  const res = await safeFetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  if (!/html/i.test(res.headers.get('content-type') ?? '')) throw new Error('not an HTML page');
  return { html: await res.text(), url: res.url || url };
}

export async function sources(input, get = fetchHtml) {
  const prospects = JSON.parse(fs.readFileSync(input.prospects, 'utf8'));
  const max = Number(input.max_pages ?? 3);
  fs.mkdirSync(input.out, { recursive: true });
  const index = [];
  const flush = () => fs.writeFileSync(path.join(input.out, 'index.json'), JSON.stringify(index, null, 2));
  for (const [i, p] of prospects.entries()) {
    const entry = { index: i, name: p.name ?? '', business: p.business ?? '', site: p.site ?? '', pages: [], errors: [] };
    index.push(entry);
    if (!p.site) { entry.errors.push('no site'); continue; }
    const start = /^https?:\/\//i.test(p.site) ? p.site : `https://${p.site}`;
    const dir = path.join(input.out, String(i));
    fs.mkdirSync(dir, { recursive: true });
    const queue = [start];
    const seen = new Set();
    while (queue.length && entry.pages.length < max) {
      const url = queue.shift();
      if (seen.has(url)) continue;
      seen.add(url);
      try {
        const page = await get(url);
        const file = `p${entry.pages.length + 1}.txt`;
        fs.writeFileSync(path.join(dir, file), `${page.url}\n\n${pageText(page.html)}`);
        entry.pages.push({ url: page.url, file: `${i}/${file}` });
        if (entry.pages.length === 1) queue.push(...sameSiteLinks(page.html, page.url));
      } catch (e) {
        entry.errors.push(`${url}: ${e.message}`);
      }
      flush();
    }
  }
  flush();
  if (index.length && !index.some((e) => e.pages.length)) throw new Error(`no site could be fetched: ${index.slice(0, 3).map((e) => e.errors[0]).join('; ')}`);
  return { out: input.out, prospects: index.length, with_pages: index.filter((e) => e.pages.length).length, pages: index.reduce((n, e) => n + e.pages.length, 0) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
    const fn = process.argv[2] === 'sources' ? sources : search;
    process.stdout.write(JSON.stringify({ ok: true, outputs: await fn(req.input || {}) }) + '\n');
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: e.message, retryable: true } }) + '\n');
    process.exit(1);
  }
}
