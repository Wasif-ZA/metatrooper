// Run from the repo root: node workbench/ui/icons-sheet/build-sheet.mjs
// First bundle src/icons/index.js as icons-sheet/icons-check.js (ESM, external React).
// React's static renderer inlines the exact component SVGs; sheet.html is standalone.
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import * as icons from './icons-check.js';

const groups = [
  ['Status', ['NeedsYou', 'Working', 'Blocked', 'InReview', 'Failed', 'Done', 'Starting']],
  ['Priority', ['None', 'Low', 'Medium', 'High', 'Urgent']],
  ['Properties', ['Parent', 'SubTasks', 'BlockedBy', 'Blocking', 'Reviewer', 'Approver', 'Monitor', 'Workspace', 'Branch', 'Service', 'RunLedger', 'Label', 'Assignee', 'Project']],
  ['Actions', ['Answer', 'HandOver', 'Approve', 'Reject', 'NewSubTask', 'OpenOnWall', 'PanelToggle']],
  ['Engines', ['claude', 'codex', 'gemini', 'other', 'fallback'].map(id => ({ name: `EngineMark / ${id}`, component: 'EngineMark', props: { id: id === 'other' ? 'ouros' : id === 'fallback' ? '' : id } }))],
  ['Empty state', ['NothingNeedsYou']],
];

function svgFor(item, size, title) {
  const spec = typeof item === 'string' ? { name: item, component: item } : item;
  const component = icons[spec.component];
  assert.equal(typeof component, 'function', `Missing ${spec.component}`);
  return renderToStaticMarkup(React.createElement(component, { ...spec.props, size, title }));
}

let samples = 0;
const sections = groups.map(([name, items], index) => {
  const cards = items.map(item => {
    const label = typeof item === 'string' ? item : item.name;
    const svgs = [16, 20, 32].map(size => {
      const svg = svgFor(item, size);
      assert.match(svg, /viewBox="0 0 16 16"/);
      assert.match(svg, /aria-hidden="true"/);
      assert.match(svg, new RegExp(`width="${size}" height="${size}"`));
      assert.doesNotMatch(svg, /(?:linearGradient|radialGradient|filter=|#[0-9a-f]{3,8})/i);
      assert.match(svgFor(item, size, label), /role="img"/);
      samples++;
      return `<div class="sample">${svg}<span>${size}</span></div>`;
    }).join('');
    return `<figure><div class="samples">${svgs}</div><figcaption>${label}</figcaption></figure>`;
  }).join('');
  return `<section><h2><span class="number">0${index + 1}</span>${name}<small>${items.length} marks</small></h2><div class="grid">${cards}</div></section>`;
}).join('\n');

// Check accessible title escaping and the engine mapping through the actual components.
assert.match(svgFor('NeedsYou', 16, 'A & B'), /<title>A &amp; B<\/title>/);
for (const [id, expected] of [['claude', 'C'], ['codex', 'X'], ['gemini', 'G'], ['ouros', 'O'], ['  ', '?']]) {
  assert.match(svgFor({ component: 'EngineMark', props: { id } }, 16), new RegExp(`>${expected === '?' ? '\\?' : expected}<\\/text>`));
}
assert.equal(Object.keys(icons).length, 35, 'Public barrel should contain only the 35 requested components');
const empty = renderToStaticMarkup(React.createElement(icons.NothingNeedsYou));
assert.match(empty, /width="64" height="64"/);

const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ouros / Needs you / Icon sheet</title>
<script>document.documentElement.dataset.theme = new URLSearchParams(location.search).get('theme') === 'light' ? 'light' : 'dark';</script>
<style>
*{box-sizing:border-box}html{background:#0b0b0c;color:#e6e6e6;color-scheme:dark;--line:#29292c;--muted:#99999f;--surface:#111113}
html[data-theme=light]{background:#fafafa;color:#202024;color-scheme:light;--line:#dcdce0;--muted:#64646c;--surface:#fff}
body{margin:0;padding:40px 48px;font:14px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif;max-width:1400px}
header{border-bottom:1px solid var(--line);padding-bottom:22px;margin-bottom:22px;display:flex;justify-content:space-between;align-items:center}
.eyebrow{font-size:11px;letter-spacing:.16em;color:var(--muted);text-transform:uppercase;margin:0 0 8px}
h1{font-size:28px;font-weight:550;letter-spacing:-.025em;margin:0}header p{margin:8px 0 0;color:var(--muted);font-size:12px}
nav{display:flex;gap:6px}nav a{color:inherit;text-decoration:none;border:1px solid var(--line);border-radius:5px;padding:7px 12px;font-size:12px}
html[data-theme=dark]a[href='?theme=dark'],html[data-theme=light]a[href='?theme=light']{background:var(--line)}
section{margin-bottom:20px}h2{font-size:13px;font-weight:550;margin:0 0 10px;display:flex;align-items:center;gap:10px}h2 small{margin-left:auto;color:var(--muted);font-size:11px;font-weight:400}
.number{color:var(--muted);font:11px ui-monospace,monospace}.grid{display:grid;grid-template-columns:repeat(7,176px);gap:12px}
figure{margin:0;background:var(--surface);border:1px solid var(--line);border-radius:6px;height:114px;padding:14px 15px}
.samples{display:flex;gap:8px;width:136px;margin:0 auto}.sample{width:40px;flex:none;height:56px;display:grid;grid-template-rows:36px 16px;align-items:center;justify-items:center;gap:4px}
svg{display:block;flex-shrink:0}.sample span{font:10px ui-monospace,monospace;color:var(--muted)}figcaption{text-align:center;font-size:11px;line-height:15px;margin-top:10px;white-space:nowrap}
.empty-note{display:flex;align-items:center;gap:20px;color:var(--muted);font-size:12px;margin-top:12px;border-top:1px solid var(--line);padding-top:14px}.empty-note svg{color:inherit}
footer{border-top:1px solid var(--line);padding-top:14px;font-size:11px;color:var(--muted);display:flex;justify-content:space-between;gap:24px}
@media(max-width:1399px){body{padding:28px}.grid{grid-template-columns:repeat(auto-fit,176px)}}
</style></head>
<body><header><div><p class="eyebrow">Ouros / Interface assets</p><h1>Needs you</h1><p>16 px grid · 1.5 stroke · Round caps &amp; joins · currentColor</p></div><nav aria-label="Colour theme"><a href="?theme=dark">Dark</a><a href="?theme=light">Light</a></nav></header>
<main>${sections}<div class="empty-note">${empty}<span>NothingNeedsYou / native 64 px<br>Same 16 px geometry, scaled with its stroke.</span></div></main>
<footer><span>Every sample is rendered from the React components. Sizes shown at 1×.</span><span>InReview uses half-ring hatching to respect the no-fill rule.</span></footer>
</body></html>`;
writeFileSync(new URL('./sheet.html', import.meta.url), html);
console.log(`Rendered ${samples} SVG samples + the native 64 px empty state; all 35 exports checked.`);
