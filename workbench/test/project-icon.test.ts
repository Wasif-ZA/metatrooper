import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkOverride, findFavicon, PICK_ICONS, PROJECT_COLOURS, readOverrides, resolveProjectIcon, writeOverride } from '../src/projecticon.ts';
import { PICK_ICONS as UI_PICK, PROJECT_COLOURS as UI_COLOURS, projectIconHtml, SHAPES } from '../ui/src/icons/shapes.js';

const dir = () => mkdtempSync(join(tmpdir(), 'wb-project-icon-'));

test('resolve order: an override wins, then the repo favicon, else none', () => {
  const d = dir();
  const e = dir();
  try {
    const p = { path: d, name: 'shop-cart' };
    assert.equal(resolveProjectIcon(p), null);
    mkdirSync(join(e, 'public'));
    writeFileSync(join(e, 'public', 'favicon.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    const fav = resolveProjectIcon({ path: e, name: 'api-server' }, null);
    assert.deepEqual([fav.kind, fav.kind === 'image' && fav.file], ['image', 'public/favicon.svg']);
    const override = { kind: 'emoji' as const, emoji: '🚀' };
    assert.deepEqual(resolveProjectIcon({ path: e, name: 'api-server' }, override), override, 'an override beats the favicon');
    assert.deepEqual(resolveProjectIcon(p, override), override);
  } finally { rmSync(d, { recursive: true, force: true }); rmSync(e, { recursive: true, force: true }); }
});

test('findFavicon prefers the root favicon, reads it as a data URL, skips files over 256 KB, and caches for a minute', () => {
  const d = dir();
  try {
    mkdirSync(join(d, 'public'));
    writeFileSync(join(d, 'public', 'favicon.png'), Buffer.alloc(300 * 1024, 1));
    writeFileSync(join(d, 'logo.svg'), '<svg/>');
    const t = 1_000_000;
    const a = findFavicon(d, t);
    assert.deepEqual([a?.file, a?.src], ['logo.svg', `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}`], 'the 300 KB png is skipped');
    writeFileSync(join(d, 'favicon.ico'), Buffer.from([0, 0, 1, 0]));
    assert.equal(findFavicon(d, t + 30_000)?.file, 'logo.svg', 'cached within the minute');
    const later = findFavicon(d, t + 61_000);
    assert.equal(later?.file, 'favicon.ico', 'after a minute the folder is read again and the root favicon wins');
    assert.ok(later?.src.startsWith('data:image/x-icon;base64,'));
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('an override must be a 1-2 letter monogram, an emoji, or a listed icon, with a listed colour', () => {
  assert.deepEqual(checkOverride({ kind: 'monogram', text: ' ab ', colour: 'teal' }), { kind: 'monogram', text: 'AB', colour: 'teal' });
  assert.deepEqual(checkOverride({ kind: 'icon', name: 'rocket', colour: 'rose' }), { kind: 'icon', name: 'rocket', colour: 'rose' });
  assert.equal(checkOverride(null), null);
  for (const bad of [{ kind: 'monogram', text: 'abc', colour: 'teal' }, { kind: 'monogram', text: 'a', colour: '#fff' }, { kind: 'icon', name: 'snake', colour: 'red' }, { kind: 'emoji', emoji: '<b>' }, { kind: 'image', src: 'https://x.invalid/a.png' }, 'x']) {
    assert.throws(() => checkOverride(bad), /icon must be|unknown colour/, JSON.stringify(bad));
  }
});

test('overrides are stored per project and null removes one', () => {
  const d = dir();
  try {
    const f = join(d, 'project-icons.json');
    assert.deepEqual(readOverrides(f), {});
    writeOverride(f, 'p1', { kind: 'emoji', emoji: '📦' });
    writeOverride(f, 'p2', { kind: 'monogram', text: 'AS', colour: 'blue' });
    writeOverride(f, 'p1', null);
    assert.deepEqual(readOverrides(f), { p2: { kind: 'monogram', text: 'AS', colour: 'blue' } });
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('the UI draws every kind, escapes its text, and lists the same icons and colours the main process accepts', () => {
  assert.deepEqual(UI_PICK, [...PICK_ICONS]);
  assert.deepEqual(UI_COLOURS, PROJECT_COLOURS);
  for (const name of PICK_ICONS) assert.ok(SHAPES[name], name);
  const tile = projectIconHtml({ kind: 'monogram', text: 'SC', colour: 'blue' }, 18);
  assert.match(tile, /width:18px;height:18px;border-radius:4px;background:#60a5fa;color:#fff;font:600 9px\/18px/);
  assert.ok(tile.endsWith('>SC</span>') && !tile.includes('textLength'), 'white letters on the colour, natural spacing');
  assert.match(projectIconHtml({ kind: 'monogram', text: '<', colour: 'blue' }), /&#60;<\/span>/);
  assert.match(projectIconHtml({ kind: 'image', src: 'data:image/svg+xml;base64,AA==', file: 'favicon.svg' }), /<img class="picon" src="data:image\/svg\+xml;base64,AA=="/);
  assert.match(projectIconHtml({ kind: 'icon', name: 'rocket', colour: 'rose' }), /color:#fb7185/);
  assert.match(projectIconHtml(undefined), /<svg/);
  assert.ok(!Object.keys(SHAPES).some((k) => /^mark/.test(k)), 'no serpent marks left in the set');
});
