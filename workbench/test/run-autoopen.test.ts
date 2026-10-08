import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../renderer/layouts/run.js', import.meta.url), 'utf8');

function load() {
  let blurs = 0;
  const document = { activeElement: { blur: () => { blurs++; } } };
  const ctx = vm.createContext({ window: {}, document, matchMedia: () => ({ matches: false }) });
  vm.runInContext(`${source}\nthis.runScreen = runScreen;`, ctx);
  return { rs: ctx.runScreen, blurs: () => blurs };
}

test('an auto-opened run keeps focus and ignores keys until opened by hand', () => {
  const { rs, blurs } = load();
  rs.open('r1', true);
  assert.equal(blurs(), 0);
  assert.equal(rs.key({ key: 'Escape' }), false);
  rs.open('r1');
  assert.equal(blurs(), 1);
});
