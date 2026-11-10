import { useEffect, useMemo, useRef } from 'react';
import { Marked } from 'marked';

export const isMd = (p) => /\.(md|markdown)$/i.test(p);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const slashed = (s) => String(s).replace(/\\/g, '/');
export const slug = (s) => String(s).trim().toLowerCase().replace(/[^\p{L}\p{N} -]/gu, '').replace(/ /g, '-');
const plain = (tokens) => tokens.map((t) => (t.type === 'html' ? '' : t.tokens ? plain(t.tokens) : t.text ?? '')).join('');
const fileName = (p) => slashed(p).split(/[?#]/)[0].split('/').pop();
const PICTURE = /\.(png|jpe?g|gif|svg|webp|bmp|avif|ico)$/i;
const LINK = 'role="link" tabindex="0"';
const chip = (attr, value, label) => `<a class="ou-md-img" ${attr}="${esc(value)}" ${LINK}>Image: ${esc(label)}</a>`;

const wiki = {
  name: 'wiki',
  level: 'inline',
  start(src) { const i = src.search(/!?\[\[/); return i < 0 ? undefined : i; },
  tokenizer(src) {
    const m = /^(!?)\[\[([^[\]|\n]+)(?:\|([^[\]\n]+))?\]\]/.exec(src);
    if (!m) return undefined;
    const target = m[2].trim();
    return { type: 'wiki', raw: m[0], embed: m[1] === '!', target, text: (m[3] || '').trim() || target };
  },
  renderer(t) {
    if (t.embed && PICTURE.test(t.target)) return chip('data-wiki', t.target, t.text);
    return `<a data-wiki="${esc(t.target)}" ${LINK}>${esc(t.text)}</a>`;
  },
};

const md = new Marked({
  gfm: true,
  breaks: false,
  extensions: [wiki],
  renderer: {
    html({ text, block }) {
      if (/^\s*<!--[\s\S]*-->\s*$/.test(text)) return '';
      return block ? `<p>${esc(text.trim())}</p>\n` : esc(text);
    },
    code({ text }) { return `<pre><code>${esc(text)}</code></pre>\n`; },
    heading({ tokens, depth }) { return `<h${depth} data-slug="${esc(slug(plain(tokens)))}">${this.parser.parseInline(tokens)}</h${depth}>\n`; },
    link({ href, tokens }) { return `<a data-href="${esc(href)}" ${LINK}>${this.parser.parseInline(tokens)}</a>`; },
    image({ href, text }) { return chip('data-href', href, text || fileName(href)); },
  },
});

const FRONT = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function renderMd(source) {
  let text = String(source ?? '').replace(/^﻿/, '');
  let front = null;
  const m = FRONT.exec(text);
  if (m) { front = m[1] || ''; text = text.slice(m[0].length); }
  return { front, html: text.trim() ? md.parse(text) : '' };
}

export function resolveRel(note, href) {
  let p = href.split(/[?#]/)[0];
  try { p = decodeURIComponent(p); } catch { /* keep the raw path */ }
  p = slashed(p);
  const out = p.startsWith('/') ? [] : slashed(note).split('/').slice(0, -1);
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') { if (!out.length) return null; out.pop(); } else out.push(seg);
  }
  return out.length ? out.join('/') : null;
}

function scrollToSlug(root, fragment) {
  let want = fragment;
  try { want = decodeURIComponent(fragment); } catch { /* keep the raw fragment */ }
  want = slug(want);
  for (const h of root.querySelectorAll('[data-slug]')) if (h.dataset.slug === want) { h.scrollIntoView({ block: 'start' }); return; }
}

async function follow(a, root, { path, pid, open }) {
  const w = a.dataset.wiki;
  if (w !== undefined) {
    const at = w.indexOf('#');
    const target = slashed(at < 0 ? w : w.slice(0, at)).trim();
    if (!target) { scrollToSlug(root, w.slice(at + 1)); return; }
    const name = /\.[^./]+$/.test(target) ? target : `${target}.md`;
    const want = name.toLowerCase();
    let hits = [];
    try { hits = (await api.fsFind(pid, fileName(name))) || []; } catch { /* no hits */ }
    const hit = hits.map(slashed).find((h) => h.toLowerCase() === want || h.toLowerCase().endsWith(`/${want}`));
    if (hit) open(hit); else toast(`No note called "${target}" in this project.`);
    return;
  }
  const href = (a.dataset.href || '').trim();
  if (!href) return;
  if (href.startsWith('#')) { scrollToSlug(root, href.slice(1)); return; }
  if (/^https?:\/\//.test(href)) { void api.openLink(href, 1, 1); return; }
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || /^[\\/]{2}/.test(href)) return;
  const rel = resolveRel(path, href);
  if (rel) open(rel);
}

export function Preview({ text, path, pid, open, tab }) {
  const doc = (tab.view ? tab.view.state : tab.state)?.doc;
  const key = doc ?? text;
  const { front, html } = useMemo(() => renderMd(doc ? doc.toString() : text), [key]);
  const ref = useRef(null);
  useEffect(() => { ref.current.scrollTop = tab.pvTop || 0; }, [tab]);
  const go = (e) => {
    e.preventDefault();
    const a = e.target.closest?.('a');
    if (a) void follow(a, e.currentTarget, { path, pid, open });
  };
  return (
    <div ref={ref} className="ou-md" onScroll={(e) => { tab.pvTop = e.currentTarget.scrollTop; }}>
      <div className="ou-md-doc">
        {front === null ? null : <details className="ou-md-front"><summary>Properties</summary><pre>{front}</pre></details>}
        {html ? <div className="ou-md-body" onClick={go} onKeyDown={(e) => { if (e.key === 'Enter' && e.target.matches?.('a')) go(e); }} dangerouslySetInnerHTML={{ __html: html }} />
          : front === null ? <p className="ou-md-empty">This note is empty.</p> : null}
      </div>
    </div>
  );
}
