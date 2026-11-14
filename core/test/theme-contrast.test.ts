import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/settings.ts';

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const alpha = (hex: string) => (hex.length === 9 ? parseInt(hex.slice(7, 9), 16) / 255 : 1);
const lum = (c: number[]) => {
  const [r, g, b] = c.map((v) => v / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a: number[], b: number[]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** A translucent row colour laid over a surface, as the browser paints it. */
const over = (top: string, base: string) => rgb(top).map((v, i) => Math.round(rgb(base)[i] + (v - rgb(base)[i]) * alpha(top)));

test('Dither: a deleted diff line meets WCAG AA (4.5:1) on its row over every Dither surface', () => {
  const t = DEFAULTS.ui.themes.dither as Record<string, string>;
  for (const surface of ['bg', 'panel', 'panel2', 'term_bg']) {
    const row = over(t.del_bg, t[surface]);
    const r = ratio(rgb(t.del_fg), row);
    assert.ok(r >= 4.5, `del_fg ${t.del_fg} on del_bg over ${surface} ${t[surface]} is ${r.toFixed(2)}:1`);
  }
});
