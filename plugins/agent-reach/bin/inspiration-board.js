import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const STOPWORDS = new Set(
  'a an and the for with of to in on at by from is are be it its this that as or our we you your their they them into over under about site page website design make build want wants need needs should like feel looks look using use'.split(' '),
);

function run(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { windowsHide: true, timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${path.basename(cmd)} failed: ${(stderr || err.message).trim().slice(0, 300)}`));
      else resolve(stdout);
    });
  });
}

export function clip(text, max = 200) {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : flat.slice(0, max - 3).trimEnd() + '...';
}

export function parseExaText(text) {
  const out = [];
  for (const block of text.split(/\n-{3,}\n/)) {
    const title = /^Title:\s*(.+)$/m.exec(block)?.[1]?.trim();
    const url = /^URL:\s*(\S+)$/m.exec(block)?.[1]?.trim();
    if (!title || !url) continue;
    const highlights = block.split(/^Highlights:\s*$/m)[1] ?? '';
    const line = highlights
      .split('\n')
      .map((l) => l.replace(/^#+\s*/, '').trim())
      .find((l) => l.length > 40 && l !== title && l !== '...');
    out.push({ source_url: url, title, reason: clip(line || title), kind: 'web', excerpt: highlights.trim() });
  }
  return out;
}

export function deriveGithubQuery(brief, words = 3) {
  const picked = [];
  for (const w of brief.toLowerCase().match(/[a-z][a-z0-9-]{2,}/g) ?? []) {
    if (STOPWORDS.has(w) || picked.includes(w)) continue;
    picked.push(w);
    if (picked.length === words) break;
  }
  return picked.join(' ');
}

function urlKey(u) {
  try {
    const p = new URL(u);
    return (p.hostname.replace(/^www\./, '') + p.pathname.replace(/\/+$/, '')).toLowerCase();
  } catch {
    return u;
  }
}

export function pickReferences(web, github, count) {
  const seen = new Set();
  const unique = (list) =>
    list.filter((r) => {
      const k = urlKey(r.source_url);
      if (!/^https?:\/\//i.test(r.source_url) || seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  const w = unique(web);
  const g = unique(github);
  const githubShare = Math.min(g.length, Math.max(count - w.length, Math.round(count * 0.3)));
  const picked = [...w.slice(0, count - githubShare), ...g.slice(0, githubShare)];
  for (const r of [...w, ...g]) {
    if (picked.length >= count) break;
    if (!picked.includes(r)) picked.push(r);
  }
  return picked.slice(0, count);
}

function searchExa(brief, n) {
  return exaSearch(`websites and landing pages with strong visual design for: ${brief}`, n);
}

export async function exaSearch(query, n) {
  const cli = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', 'mcporter', 'dist', 'cli.js');
  if (!fs.existsSync(cli)) throw new Error(`mcporter not found at ${cli}`);
  const raw = await run(process.execPath, [cli, 'call', 'exa.web_search_exa', `query=${query}`, `numResults=${n}`, '--output', 'json'], 90_000);
  const parsed = JSON.parse(raw);
  return (parsed.content ?? []).filter((c) => c.type === 'text' && c.text).flatMap((c) => parseExaText(c.text));
}

async function searchGithub(query, n) {
  const raw = await run('gh', ['search', 'repos', query, '--json', 'fullName,url,description,stargazersCount', '--limit', String(n), '--sort', 'stars'], 60_000);
  const rows = JSON.parse(raw);
  return rows.map((r) => ({
    source_url: r.url,
    title: r.fullName,
    reason: clip(`${r.description || 'GitHub library'} (${r.stargazersCount} stars)`),
    kind: 'github',
  }));
}

async function main() {
  const req = JSON.parse(fs.readFileSync(0, 'utf8'));
  const brief = String(req.input?.brief ?? '').trim();
  if (!brief) throw new Error('input.brief is required');
  const count = Math.min(12, Math.max(8, req.input.count ?? 10));
  const ghQuery = req.input.github_query?.trim() || deriveGithubQuery(brief);
  const [web, github] = await Promise.allSettled([searchExa(brief, count + 4), searchGithub(ghQuery, count)]);
  for (const r of [web, github]) if (r.status === 'rejected') process.stderr.write(`${r.reason.message}\n`);
  const refs = pickReferences(web.status === 'fulfilled' ? web.value : [], github.status === 'fulfilled' ? github.value : [], count);
  if (refs.length === 0) throw new Error('no references found');
  const references = refs.map(({ excerpt, ...r }) => r);
  process.stdout.write(JSON.stringify({ ok: true, outputs: { references } }) + '\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    process.stdout.write(JSON.stringify({ ok: false, error: { message: e.message, retryable: true } }) + '\n');
    process.exit(1);
  });
}
