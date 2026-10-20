import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { registerHooks } from 'node:module';

async function paneFixture() {
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'electron' ? { url: 'test:electron', shortCircuit: true } : nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      return url === 'test:electron'
        ? { format: 'module', source: 'export const app = {}, clipboard = {}, Menu = {}, nativeImage = {}, session = {}, WebContentsView = class {};', shortCircuit: true }
        : nextLoad(url, context);
    },
  });
  let PaneManager: typeof import('../src/browser/panes.ts').PaneManager;
  try {
    ({ PaneManager } = await import('../src/browser/panes.ts'));
  } finally {
    hook.deregister();
  }
  const changes: Array<{ id: string; url: string }> = [];
  const manager = new PaneManager({} as never, {
    urlChanged: (id: string, url: string) => changes.push({ id, url }),
    paneEvent() {},
  } as never);
  const wc = Object.assign(new EventEmitter(), {
    isDestroyed: () => false,
    getURL: () => 'https://example.test/start',
    getTitle: () => 'Example',
    isLoading: () => false,
    getZoomFactor: () => 1,
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    setWindowOpenHandler() {},
  });
  const pane = { row: { id: 'bp_agent_test', project_id: 'project' }, view: { webContents: wc } };
  (manager as any).wireContents(pane);
  return { wc, changes };
}

test('M7-11 child frame in-page navigation does not change the pane URL', async () => {
  const { wc, changes } = await paneFixture();
  wc.emit('did-navigate-in-page', {}, 'https://example.test/child#section', false);
  assert.deepEqual(changes, []);
});

test('M7-11 main frame in-page navigation changes the pane URL', async () => {
  const { wc, changes } = await paneFixture();
  wc.emit('did-navigate-in-page', {}, 'https://example.test/start#section', true);
  assert.deepEqual(changes, [{ id: 'bp_agent_test', url: 'https://example.test/start#section' }]);
});
