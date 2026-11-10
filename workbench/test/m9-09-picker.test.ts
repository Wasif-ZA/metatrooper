import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const chromeSource = readFileSync(new URL('../renderer/browser-chrome.js', import.meta.url), 'utf8');

const onClickSource = appSource.slice(
  appSource.indexOf('async function onClick('),
  appSource.indexOf('\nfunction onInput('),
);

// Tests pane menu Driven by items include sessions for bp_agent_ panes and omit them for user panes.
test('driven by pane menu includes sessions for bp_agent_ panes and none for bp_ user panes', async () => {
  let capturedItems: any[] = [];
  const api = {
    paneMenu: async (items: any[]) => {
      capturedItems = items;
      return null;
    },
  };
  const ui: any = {
    projectId: 'p1',
    paneId: null,
    browserMode: 'live',
    snap: {
      panes: [
        { id: 'bp_agent_123', session_id: 's1' },
        { id: 'bp_user_456', session_id: null },
      ],
      sessions: [
        { id: 's1', engine_id: 'claude' },
        { id: 's2', engine_id: 'codex' },
      ],
      snapshots: [],
    },
  };

  const context: any = {
    ui,
    api,
    sessionLabel: (s: any) => s.engine_id || s.id,
    toast() {},
    rpc: async () => ({}),
    render() {},
    loadTimeline: async () => {},
    openFind() {},
  };

  runInNewContext(chromeSource, context);
  const onClick = runInNewContext('(' + onClickSource + ')', context);

  const clickEvent = {
    stopPropagation() {},
    target: {
      closest: (sel: string) =>
        sel === '[data-action]'
          ? {
              tagName: 'BUTTON',
              dataset: { action: 'pane-menu' },
              getBoundingClientRect: () => ({ right: 200, bottom: 50 }),
              closest: () => null,
            }
          : null,
    },
  };

  ui.paneId = 'bp_agent_123';
  await onClick(clickEvent);
  const agentDrivenBy = capturedItems.find((i: any) => i.label === 'Driven by')?.submenu;
  assert.ok(agentDrivenBy);
  assert.deepEqual(
    [...agentDrivenBy.map((i: any) => i.id)],
    ['own:', 'own:s1', 'own:s2'],
  );
  assert.equal(agentDrivenBy.find((i: any) => i.id === 'own:s1')?.checked, true);

  capturedItems = [];
  ui.paneId = 'bp_user_456';
  await onClick(clickEvent);
  const userDrivenBy = capturedItems.find((i: any) => i.label === 'Driven by')?.submenu;
  assert.ok(userDrivenBy);
  assert.deepEqual(
    [...userDrivenBy.map((i: any) => i.id)],
    ['own:'],
  );
  assert.equal(userDrivenBy[0].checked, true);
});
