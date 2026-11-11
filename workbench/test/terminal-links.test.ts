import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../renderer/terminal.js', import.meta.url), 'utf8');
const context = vm.createContext({ window: { troop: { onTerm() {} } }, document: { getElementById() {} } });
const view = vm.runInContext(source + '\ntermView;', context);
const find = (line: string) => JSON.parse(JSON.stringify(view.findLocalLinks(line)));

test('local links match localhost and loopback with ports and paths', () => {
  for (const url of ['http://localhost:3000', 'https://localhost:5173/app?q=1#top', 'http://127.0.0.1:8080/path', 'https://127.0.0.1:443/']) {
    assert.deepEqual(find('at ' + url), [{ start: 3, end: 3 + url.length, url }]);
  }
});

test('local links ignore other hosts, missing ports and host suffixes', () => {
  assert.deepEqual(find('http://example.com:3000 http://localhost/path https://127.0.0.1 http://localhost.evil:3000 http://localhost:3000.evil http://localhost:3000@evil.com'), []);
});

test('local links preserve ranges for two links on one line', () => {
  const first = 'http://localhost:3000/a', second = 'https://127.0.0.1:8080/b';
  assert.deepEqual(find(first + ' and ' + second), [
    { start: 0, end: first.length, url: first },
    { start: first.length + 5, end: first.length + 5 + second.length, url: second },
  ]);
});

test('local links exclude surrounding punctuation', () => {
  const url = 'http://localhost:3000/path';
  assert.deepEqual(find('(' + url + ').'), [{ start: 1, end: 1 + url.length, url }]);
});

function panel() {
  const sent: any[] = [], opened: any[] = [];
  const src = readFileSync(new URL('../ui/src/ide-panel.jsx', import.meta.url), 'utf8');
  const ctx = vm.createContext({
    document: { createElement: () => ({}) },
    window: { Terminal: class {
      loadAddon() {}
      onData() {}
      registerLinkProvider(provider: any) { this.provider = provider; }
      attachCustomKeyEventHandler(handler: any) { this.key = handler; }
      buffer = { active: { getLine: () => ({ translateToString: () => 'at http://localhost:3000/path' }) } };
    }, FitAddon: { FitAddon: class {} } },
    troop: { termInput: (...args: any[]) => sent.push(args) },
    termView: view, look: () => ({}), rpc: (...args: any[]) => opened.push(args),
  });
  const t = vm.runInContext(src.slice(src.indexOf('function make(pid)'), src.indexOf('async function connect(t)')) + '\nmake("p1");', ctx);
  t.id = 's1';
  return { t, sent, opened };
}

test('panel Shift+Enter sends escape carriage return once and respects modifiers and session state', () => {
  const { t, sent } = panel();
  let prevented = 0;
  const e = { key: 'Enter', shiftKey: true, ctrlKey: false, altKey: false, metaKey: false, type: 'keydown', preventDefault() { prevented++; } };
  assert.equal(t.term.key(e), false);
  assert.equal(t.term.key({ ...e, type: 'keyup' }), false);
  for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) t.term.key({ ...e, [modifier]: true });
  t.gone = true;
  assert.equal(t.term.key(e), false);
  assert.deepEqual(sent, [['s1', '\x1b\r']]);
  assert.equal(prevented, 3);
});

test('panel local links use xterm ranges, hover underline and the shell project when clicked', () => {
  const { t, opened } = panel();
  let links: any[] = [];
  t.term.provider.provideLinks(2, (value: any[]) => { links = value; });
  const link = links[0];
  assert.deepEqual(JSON.parse(JSON.stringify(link.range)), { start: { x: 4, y: 2 }, end: { x: 29, y: 2 } });
  assert.equal(link.decorations.underline, true);
  link.activate({});
  assert.deepEqual(JSON.parse(JSON.stringify(opened)), [['pane.open', { project_id: 'p1', url: 'http://localhost:3000/path' }]]);
});
