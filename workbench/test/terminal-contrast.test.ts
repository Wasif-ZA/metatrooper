import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const terminal = readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../ui/src/ide-panel.jsx', import.meta.url), 'utf8');

test('Wall and IDE terminal contrast follows light and dark at creation and on look changes', () => {
  const stop = new Error('captured terminal options');
  let options: any;
  const element = { dataset: {}, classList: { toggle() {} }, addEventListener() {}, querySelector() { return this; } };
  const context = vm.createContext({
    window: { troop: { onTerm() {} }, Terminal: class { constructor(o: any) { options = o; throw stop; } } },
    document: { getElementById: () => element, createElement: () => element },
  });
  const view = vm.runInContext(terminal.replace('return { show, lend,', 'return { terms, show, lend,') + '\ntermView;', context);
  const existing = { term: { options: {} }, el: { isConnected: false } };
  const ideOptions: any = {};
  const panelContext = vm.createContext({ ui: {}, shells: new Map([['p', { term: { options: ideOptions } }]]) });
  const panelLook = vm.runInContext(panel.slice(panel.indexOf('function look()'), panel.indexOf('function listen()')) + '\nlook;', panelContext);
  for (const [scheme, expected] of [['light', 4.5], ['dark', 1]] as const) {
    const look = { terminal: { scrollback: 10000, font_size: 13 }, theme: { scheme } };
    view.terms.clear(); view.setLook(look);
    assert.throws(() => view.show({ sessions: [{ id: 's' }] }), (e: unknown) => e === stop);
    assert.equal(options.minimumContrastRatio, expected, 'Wall creation');
    view.terms.set('s', existing); view.setLook(look);
    assert.equal((existing.term.options as any).minimumContrastRatio, expected, 'Wall look change');
    panelContext.ui.look = look;
    assert.equal(panelLook().minimumContrastRatio, expected, 'IDE creation options');
    vm.runInContext('ideTermLook()', panelContext);
    assert.equal(ideOptions.minimumContrastRatio, expected, 'IDE look change');
  }
});
