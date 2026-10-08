import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const fn = (name: string) => source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?\\n}\\n`, 'm'))![0];
const esc = (s: unknown) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const gallery = new Function('esc', `${fn('templateGallery')}; return templateGallery;`)(esc);

test('M3-04 gallery lists every template with its requires and says ready only when nothing is missing', () => {
  const list = [
    { id: 'issue-to-pr', title: 'Issue to PR', lane: 'Coding', requires: ['repo', 'github'], missing: [], ready: true },
    { id: 'morning-brief', title: 'Morning brief', lane: 'Personal ops', requires: ['gmail', 'calendar'], missing: ['calendar'], ready: false },
  ];
  const html = gallery(list);
  assert.match(html, /1 of 2 ready/);
  const rows = html.split('<tbody>')[1].split('<tr>').slice(1);
  assert.equal(rows.length, 2);
  const [row1, row2] = rows;
  assert.match(row1, /Issue to PR/);
  assert.match(row1, /<span class="state done">ready<\/span>/);
  assert.match(row1, /<span class="req ">repo<\/span> <span class="req ">github<\/span>/);
  assert.match(row2, /Morning brief/);
  assert.doesNotMatch(row2, />ready</);
  assert.match(row2, /needs calendar/);
  assert.match(row2, /<span class="req ">gmail<\/span> <span class="req missing">calendar<\/span>/);
});

test('gallery escapes template fields and shows loading before the first list', () => {
  assert.match(gallery(undefined), /Loading templates/);
  const html = gallery([{ id: 'x', title: '<b>x</b>', lane: 'a', requires: [], missing: [], ready: true }]);
  assert.match(html, /&lt;b>x&lt;\/b>/);
});

test('the workbench may call template.list and loads it on the Pipelines tab', () => {
  assert.match(main, /UI_METHODS = new Set\(\[[^\]]*'template\.list'/);
  assert.match(fn('openTab'), /tab === 'pipelines'\) await loadTemplates\(\)/);
  assert.match(fn('renderPipelines'), /templateGallery\(ui\.templates\)/);
});
