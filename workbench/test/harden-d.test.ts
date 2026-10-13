import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

test('a tile that leaves the wall stops observing its size and drops its pending refit', () => {
  const observers: Array<{ disconnected: boolean }> = [];
  const cleared: unknown[] = [];
  const node = (): any => ({ dataset: {}, classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, addEventListener() {}, querySelector: () => node(), append() {}, remove() {}, isConnected: true });
  const troop = { onTerm() {}, termInput() {}, termAttach: async () => {}, termDetach: async () => {} };
  class Terminal { options = {}; loadAddon() {} registerLinkProvider() {} open() {} onData() {} attachCustomKeyEventHandler() {} write() {} focus() {} dispose() {} }
  class ResizeObserver { disconnected = false; constructor() { observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  const ctx = vm.createContext({ window: { troop, Terminal, FitAddon: { FitAddon: class {} } }, document: { getElementById: () => node(), createElement: node }, ResizeObserver, setTimeout: () => 7, clearTimeout: (t: unknown) => cleared.push(t), performance });
  vm.runInContext(`${readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8')}\nthis.termView = termView;`, ctx);
  ctx.termView.show({ mode: 'single', selected: 's1', sessions: [{ id: 's1', state: 'working', words: '' }] });
  assert.equal(observers.length, 1);
  ctx.termView.show({ mode: 'single', selected: null, sessions: [] });
  assert.equal(observers[0].disconnected, true);
});
