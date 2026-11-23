import fs from 'node:fs'; import path from 'node:path';
const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const engines = ['round2', 'claude', 'codex', 'gemini'];
const nameOf = (e) => e === 'round2' ? 'Round 2: option' : 'Round 1: ' + e[0].toUpperCase() + e.slice(1);
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const notesOf = (e) => { try { return fs.readFileSync(path.join(dir, e, 'notes.md'), 'utf8').split('\n').filter((l) => /^\s*(dir-\d+:|\d+[.)]|[-*])/.test(l)); } catch { return []; } };
let cards = '';
const old = fs.readFileSync(path.join(dir, '../../assets/logos/cc-mark.svg'), 'utf8');
const card = (id, label, svg, note) => `<section class="card" data-id="${id}"><h2>${label}</h2><div class="row"><div class="big">${svg}</div><div class="sm"><div class="s48">${svg}</div><div class="s16">${svg}</div><div class="dk"><div class="s48">${svg}</div></div></div></div><p>${esc(note || '')}</p><textarea placeholder="Notes on ${label}"></textarea></section>`;
cards += card('current', 'Current (rejected)', old, 'Two nested c arcs and an orange dot.');
for (const e of engines) {
  const notes = notesOf(e);
  for (let i = 1; i <= 8; i++) {
    const f = path.join(dir, e, `dir-${i}.svg`); if (!fs.existsSync(f)) continue;
    const svg = fs.readFileSync(f, 'utf8').replace(/<\?xml[^>]*>/, '').replace(/<script[\s\S]*?<\/script>/gi, '');
    cards += card(`${e}-${i}`, `${nameOf(e)} ${i}`, svg, (notes[i - 1] || '').replace(/^\s*(dir-\d+:|\d+[.)]|[-*])\s*/, ''));
  }
}
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>cc logo directions</title><style>
:root{--bg:#f6f6f4;--fg:#151516;--mut:#5e5e62;--line:#dcdcd8;--card:#fff}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#111112;--fg:#f1f1ef;--mut:#a4a4a8;--line:#3a3a3d;--card:#18181a}}
:root[data-theme=dark]{--bg:#111112;--fg:#f1f1ef;--mut:#a4a4a8;--line:#3a3a3d;--card:#18181a}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,"Segoe UI",sans-serif;padding:16px}
header{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}h1{font-size:20px;margin:0 auto 0 0}
button{background:none;border:1px solid var(--line);color:var(--fg);padding:5px 10px;cursor:pointer;font:inherit}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);padding:12px}.card h2{font-size:14px;margin:0 0 8px}
.row{display:flex;gap:12px;align-items:center}.big svg{width:128px;height:128px;display:block}
.sm{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.s48 svg{width:48px;height:48px;display:block}.s16 svg{width:16px;height:16px;display:block}
.dk{background:#111112;padding:8px}.card p{color:var(--mut);margin:8px 0;min-height:2.5em}
textarea{width:100%;min-height:54px;background:var(--bg);color:var(--fg);border:1px solid var(--line);font:inherit;padding:6px}
</style></head><body><header><h1>cc logo directions</h1><button id="copy">Copy all notes</button><button id="theme">Light/dark</button></header>
<p style="color:var(--mut)">Each shows 128, 48 and 16 px, then on a dark background. Write which you like and why; notes save in this browser.</p>
<section class="card" style="margin-bottom:14px"><h2>Inspiration (found with agent-reach: Exa search and Jina reader)</h2><ul style="margin:0;padding-left:18px">
<li><a href="https://www.raycast.com/blog/a-fresh-look-and-feel">Raycast</a>: they tried glass cubes and magnifiers; what stuck was a keycap, the product's core interaction. For cc that is the tile that comes forward. Trust: high (their own post).</li>
<li><a href="https://linear.app/brand">Linear</a>: three assets, not one: wordmark (strongest recognition), logomark for tight spots, icon chip for social. Mostly monochrome, colour kept for backgrounds. Trust: high (their brand page).</li>
<li><a href="https://zed.dev/brand">Zed</a>: three colours only, never recoloured. Trust: high.</li>
<li><a href="https://hackernoon.com/dev-tools-dont-need-a-prettier-logo-they-need-one-bold-branding-idea">One bold idea</a>: if one sentence explains the product and also drives the logo, copy and UI, you have a brand. Avoid dark + violet/green gradient + terminal window, the look everyone has. Trust: medium-low (agency author, AI-assisted).</li>
<li>Ghostty: a single character (the ghost) carries the whole brand across platforms. Trust: medium (commit history mirror).</li>
</ul><p>Read across: the big-slot directions (Claude 1, Codex 1, Gemini 1) pass the one-sentence test: "every agent gets a tile; the one that needs you comes forward."</p></section>
<div class="grid">${cards}</div><script>
const K='cc-logo-board:';document.querySelectorAll('.card').forEach(c=>{const t=c.querySelector('textarea'),k=K+c.dataset.id;try{t.value=localStorage.getItem(k)||''}catch{}t.oninput=()=>{try{localStorage.setItem(k,t.value)}catch{}}});
document.getElementById('copy').onclick=()=>{const s=[...document.querySelectorAll('.card')].map(c=>c.querySelector('h2').textContent+': '+(c.querySelector('textarea').value||'-')).join('\n');navigator.clipboard.writeText(s)};
document.getElementById('theme').onclick=()=>{const r=document.documentElement;r.dataset.theme=(r.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'))==='dark'?'light':'dark'};
</script></body></html>`;
fs.writeFileSync(path.join(dir, 'board.html'), html); console.log('board.html', cards.split('class="card"').length - 1, 'cards');
