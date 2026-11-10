import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8');

const extract = (re: RegExp) => {
  const m = mainSource.match(re);
  assert.ok(m, String(re));
  return m[0];
};

function dirtyHarness() {
  let setDirty: Function = () => {};
  const c: any = vm.createContext({
    dirtyFiles: false,
    dirtySummary: '',
    on: (_name: string, fn: Function) => { setDirty = fn; },
  });
  vm.runInContext(stripTypeScriptTypes(extract(/  on\('setDirty'[^\n]+/)), c);
  return { c, setDirty: (dirty: unknown, summary?: unknown) => setDirty(dirty, summary) };
}

function closeHarness(responses: number[], dirtySummary = '') {
  const events: string[] = [];
  const c: any = vm.createContext({
    ownCore: true,
    dirtyFiles: true,
    dirtySummary,
    closing: false,
    demo: false,
    busy: () => false,
    detachAll() {},
    dialog: {
      showMessageBox: async (_w: unknown, options: any) => {
        events.push(options.message);
        assert.ok(responses.length, 'unexpected dialog');
        return { response: responses.shift() };
      },
      showMessageBoxSync: () => 1,
    },
    stopCore: async () => {},
    win: {
      isDestroyed: () => false,
      on: () => {},
      webContents: { on: () => {} },
      close: () => {},
    },
  });
  const code = [
    extract(/^const unsavedMessage[^\n]+/m),
    extract(/^async function onClose\([^]*?^}/m),
  ].join('\n');
  vm.runInContext(stripTypeScriptTypes(code), c);
  return { c, events };
}

// Tests control characters in summary collapse to single spaces and trim.
test('summary with control characters collapses each run to one space and trims', () => {
  const h = dirtyHarness();
  h.setDirty(true, '\x1b\x1b\talpha\n\tbeta\x1b\x7fgamma\x7f\n');
  assert.equal(h.c.dirtySummary, 'alpha beta gamma');
});

// Tests 400-char summary is truncated to 300 chars while 300-char summary is unchanged.
test('400-char summary truncated to 300 chars and 300-char summary unchanged', () => {
  const h = dirtyHarness();
  const summary300 = 'a'.repeat(300);
  const summary400 = summary300 + 'b'.repeat(100);
  h.setDirty(true, summary400);
  assert.equal(h.c.dirtySummary.length, 300);
  assert.equal(h.c.dirtySummary, summary300);

  const exact300 = 'c'.repeat(300);
  h.setDirty(true, exact300);
  assert.equal(h.c.dirtySummary.length, 300);
  assert.equal(h.c.dirtySummary, exact300);
});

// Tests dirty false with summary string results in empty dirtySummary.
test('dirty false with summary string results in empty dirtySummary', () => {
  const h = dirtyHarness();
  h.setDirty(false, 'unsaved.txt');
  assert.equal(h.c.dirtyFiles, false);
  assert.equal(h.c.dirtySummary, '');
});

// Tests dirty true with non-string summary sets dirtySummary to empty string.
test('dirty true with non-string summary sets dirtySummary to empty string', () => {
  const h = dirtyHarness();
  h.setDirty(true, 12345);
  assert.equal(h.c.dirtySummary, '');

  h.setDirty(true, { file: 'test.txt' });
  assert.equal(h.c.dirtySummary, '');

  h.setDirty(true, undefined);
  assert.equal(h.c.dirtySummary, '');
});

// Tests dirty string true results in dirtyFiles false.
test('dirty string true results in dirtyFiles false', () => {
  const h = dirtyHarness();
  h.setDirty('true', 'unsaved.txt');
  assert.equal(h.c.dirtyFiles, false);
  assert.equal(h.c.dirtySummary, '');
});

// Tests onClose dialog message uses unsavedMessage with summary or generic fallback.
test('onClose with summary shows specific message and with empty summary generic text', async () => {
  const withSummary = closeHarness([1], 'notes.txt');
  await withSummary.c.onClose();
  assert.deepEqual(withSummary.events, ['Unsaved changes in notes.txt.']);

  const emptySummary = closeHarness([1], '');
  await emptySummary.c.onClose();
  assert.deepEqual(emptySummary.events, ['Some files in the IDE have unsaved changes.']);
});

// Tests preload setDirty forwards at most the first two arguments.
test('preload setDirty forwards at most the first two arguments', async () => {
  let api: any;
  const invocations: any[] = [];
  vm.runInNewContext(preloadSource, {
    require: (name: string) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: { exposeInMainWorld: (name: string, value: any) => { if (name === 'troop') api = value; } },
        ipcRenderer: {
          on() {},
          invoke: (...args: unknown[]) => { invocations.push(args); },
        },
        webUtils: {},
      };
    },
  });
  await api.setDirty('a', 'b', 'c');
  assert.deepEqual(invocations, [['setDirty', 'a', 'b']]);
});
