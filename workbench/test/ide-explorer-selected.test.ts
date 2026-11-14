import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const tokens = Object.fromEntries([...read('renderer/wall.css').matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
const lum = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

test('the Explorer selected row stands out from the side bar background', () => {
  const side = read('ui/src/ide-side.css');
  assert.match(side, /\.ou-ide-tree \[aria-selected="true"\] > \* > \.astryx-tree-list-item \{ background: var\(--row-selected\); \}/);
  const selected = side.match(/--row-selected: var\((--[\w-]+)\)/)![1];
  const bg = read('ui/src/editor-ref.css').match(/\.ou-ide-side, \.ou-ide-side \.ou-ide-head \{ background: var\((--[\w-]+)\)/)![1];
  assert.ok(ratio(tokens[selected], tokens[bg]) >= 1.2, `${selected} on ${bg} is ${ratio(tokens[selected], tokens[bg]).toFixed(2)}:1`);
});
