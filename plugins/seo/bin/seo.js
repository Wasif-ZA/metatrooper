import fs from 'node:fs';
import path from 'node:path';

const UA = 'MetaTrooper-SEO/0.1';

const attr = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))?.slice(1).find((v) => v !== undefined);
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').trim();

async function fetchText(url, ms = 15000) {
  const started = Date.now();
  const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': UA }, signal: AbortSignal.timeout(ms) });
  const body = await res.text();
  return { res, body, ms: Date.now() - started };
}

async function robotsRules(origin) {
  try {
    const { res, body } = await fetchText(`${origin}/robots.txt`, 5000);
    if (!res.ok) return [];
    const rules = [];
    let agents = [];
    let inRules = false;
    for (const raw of body.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim();
      const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i);
      if (!m) continue;
      const key = m[1].toLowerCase();
      if (key === 'user-agent') {
        if (inRules) { agents = []; inRules = false; }
        agents.push(m[2].trim());
      } else {
        inRules = true;
        if (key === 'disallow' && m[2] && agents.includes('*')) rules.push(m[2].trim());
      }
    }
    return rules;
  } catch {
    return [];
  }
}

function normalise(href, base, origin) {
  try {
    const u = new URL(decode(href), base);
    if (u.origin !== origin) return null;
    u.hash = '';
    return u.href;
  } catch {
    return null;
  }
}

function analyse(html, url, origin) {
  const head = (re) => { const m = html.match(re); return m ? decode(m[1].replace(/<[^>]+>/g, '')) : null; };
  const metas = html.match(/<meta\b[^>]*>/gi) ?? [];
  const desc = metas.find((t) => /name\s*=\s*["']?description/i.test(t));
  const canon = (html.match(/<link\b[^>]*>/gi) ?? []).find((t) => /rel\s*=\s*["']?canonical/i.test(t));
  const text = html.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ');
  const links = new Set();
  for (const tag of html.match(/<a\b[^>]*>/gi) ?? []) {
    const href = attr(tag, 'href');
    const n = href && !/^(mailto|tel|javascript):/i.test(href) ? normalise(href, url, origin) : null;
    if (n) links.add(n);
  }
  return {
    title: head(/<title\b[^>]*>([\s\S]*?)<\/title>/i),
    meta_description: desc ? decode(attr(desc, 'content') ?? '') : null,
    canonical: canon ? attr(canon, 'href') ?? null : null,
    h1_count: (html.match(/<h1\b/gi) ?? []).length,
    img_missing_alt: (html.match(/<img\b[^>]*>/gi) ?? []).filter((t) => !/\balt\s*=/i.test(t)).length,
    word_count: decode(text).split(/\s+/).filter((w) => /\w/.test(w)).length,
    internal_links: [...links],
  };
}

async function crawl(input, runDir) {
  const start = new URL(input.url);
  start.hash = '';
  const origin = start.origin;
  const limit = input.limit ?? 50;
  const disallow = await robotsRules(origin);
  const blocked = (u) => { const p = new URL(u).pathname; return disallow.some((d) => p.startsWith(d)); };
  const queue = [start.href];
  const seen = new Set(queue);
  const pages = [];
  const skipped = [];
  while (queue.length && pages.length < limit) {
    const url = queue.shift();
    if (blocked(url)) { skipped.push(url); continue; }
    const page = { url, status: 0, response_ms: 0 };
    try {
      const { res, body, ms } = await fetchText(url);
      Object.assign(page, { status: res.status, response_ms: ms, content_type: res.headers.get('content-type') ?? '' });
      if (res.url && res.url !== url) page.final_url = res.url;
      if (res.ok && /html/i.test(page.content_type)) Object.assign(page, analyse(body, res.url || url, origin));
    } catch (e) {
      page.error = e instanceof Error ? e.message : String(e);
    }
    pages.push(page);
    for (const link of page.internal_links ?? []) {
      if (!seen.has(link)) { seen.add(link); queue.push(link); }
    }
  }
  const broken = pages.filter((p) => p.status === 0 || p.status >= 400);
  const inbound = new Map();
  for (const p of pages) for (const l of p.internal_links ?? []) inbound.set(l, (inbound.get(l) ?? 0) + 1);
  const ok = pages.filter((p) => p.status >= 200 && p.status < 300 && p.url !== start.href);
  ok.sort((a, b) => (inbound.get(b.url) ?? 0) - (inbound.get(a.url) ?? 0));
  const key_pages = [start.href, ...ok.slice(0, 2).map((p) => p.url)];
  const data = {
    start: start.href, crawled_at: new Date().toISOString(), limit, robots_disallow: disallow, skipped_by_robots: skipped,
    pages, broken: broken.map((p) => ({ url: p.url, status: p.status, error: p.error, linked_from: pages.filter((q) => q.internal_links?.includes(p.url)).map((q) => q.url) })),
  };
  const summary = { pages: pages.length, broken: broken.length, key_pages };
  const out = input.out ?? (runDir ? path.join(runDir, 'crawl.json') : null);
  if (!out) return { ...summary, data };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data, null, 2));
  return { crawl: out, ...summary };
}

try {
  const req = JSON.parse(fs.readFileSync(0, 'utf8') || '{}');
  if (process.argv[2] !== 'crawl') throw new Error(`unknown action ${process.argv[2]}`);
  const outputs = await crawl(req.input || {}, process.env.TROOP_RUN_DIR || req.run?.dir);
  process.stdout.write(JSON.stringify({ ok: true, outputs }));
} catch (e) {
  process.stdout.write(JSON.stringify({ ok: false, error: { message: e instanceof Error ? e.message : String(e), retryable: false } }));
}
