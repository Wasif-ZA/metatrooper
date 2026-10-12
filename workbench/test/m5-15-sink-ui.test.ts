import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');

const fn = (name: string) => appSource.match(new RegExp(`^(?:async )?function ${name}\\([^]*?\\n}\\n`, 'm'))![0];

const needsYouLinkRaw = mainSource.match(/^export function needsYouLink\([^]*?\n}\n/m)![0];
const needsYouLinkJs = needsYouLinkRaw
  .replace(/^export\s+/, '')
  .replace(/\(argv:[^)]*\)(?::[^{]*)?\{/, '(argv) {');
const needsYouLink: (argv: string[]) => string | null = new Function(
  `${needsYouLinkJs}; return needsYouLink;`
)();

const uiMethodsRaw = mainSource.match(/^export const UI_METHODS\s*=\s*new Set\(\[[^]*?\]\);/m)![0];
const UI_METHODS: Set<string> = new Function(
  `${uiMethodsRaw.replace(/^export\s+/, '')}; return UI_METHODS;`
)();

const sinkConstants = appSource.match(/const SINK_KINDS = [^]*?const SINK_DEST_HINT = \{[^]*?\};\n/m)![0];
const { SINK_KINDS, SINK_DEFAULT_KINDS, SINK_ALL_KINDS, SINK_DEST_HINT } = new Function(
  `${sinkConstants}; return { SINK_KINDS, SINK_DEFAULT_KINDS, SINK_ALL_KINDS, SINK_DEST_HINT };`
)();

const makeRenderSinks = (ui: any, setHtml: (id: string, html: string) => void) => {
  return new Function(
    'ui', 'setHtml',
    `${sinkConstants}\n${fn('esc')}\n${fn('renderSinks')}; return renderSinks;`
  )(ui, setHtml);
};

const makeSaveAndOpenSinks = (ui: any, doc: any, rpc: any, toast: any, renderSinks: any) => {
  return new Function(
    'ui', 'document', 'rpc', 'toast', 'renderSinks',
    `${sinkConstants}\n${fn('openSinks')}\n${fn('saveSink')}; return { saveSink, openSinks };`
  )(ui, doc, rpc, toast, renderSinks);
};

const makeOpenNeedsYou = (ui: any, doc: any, rpc: any, wall: any, renderInbox: any, pick: any, openTab: any) => {
  return new Function(
    'ui', 'document', 'rpc', 'wall', 'renderInbox', 'pick', 'openTab',
    `${fn('openNeedsYou')}; return openNeedsYou;`
  )(ui, doc, rpc, wall, renderInbox, pick, openTab);
};

const createDocument = (elements: Record<string, any>, querySelectors: Record<string, any[]> = {}) => ({
  getElementById: (id: string) => elements[id] ?? { value: '', checked: false, hidden: false },
  querySelectorAll: (selector: string) => querySelectors[selector] ?? [],
});

test('needsYouLink parses valid links and rejects invalid schemes, paths, and characters', () => {
  assert.equal(needsYouLink(['metatrooper://needs-you/gate-1']), 'gate-1');
  assert.equal(needsYouLink(['metatrooper://needs-you/aA0_-']), 'aA0_-');

  assert.equal(needsYouLink(['metatrooper://needs-you/gate-1/']), 'gate-1');
  assert.equal(needsYouLink(['METATROOPER://NEEDS-YOU/gate-1']), 'gate-1');
  assert.equal(needsYouLink(['MetaTrooper://Needs-You/gate-1/']), 'gate-1');

  assert.equal(needsYouLink(['http://needs-you/gate-1']), null);
  assert.equal(needsYouLink(['https://needs-you/gate-1']), null);
  assert.equal(needsYouLink(['file://needs-you/gate-1']), null);
  assert.equal(needsYouLink(['troop://needs-you/gate-1']), null);

  assert.equal(needsYouLink(['metatrooper://evil/x']), null);
  assert.equal(needsYouLink(['metatrooper://needs-you/']), null);
  assert.equal(needsYouLink(['metatrooper://needs-you']), null);
  assert.equal(needsYouLink(['metatrooper://other/gate-1']), null);

  assert.equal(needsYouLink(['metatrooper://needs-you/gate.1']), null);
  assert.equal(needsYouLink(['metatrooper://needs-you/gate/1']), null);
  assert.equal(needsYouLink(['metatrooper://needs-you/gate"1']), null);
  assert.equal(needsYouLink(['metatrooper://needs-you/gate\'1']), null);
  assert.equal(needsYouLink(['metatrooper://needs-you/gate-1?query=1']), null);

  const id64 = 'a'.repeat(64);
  const id65 = 'a'.repeat(65);
  assert.equal(needsYouLink([`metatrooper://needs-you/${id64}`]), id64);
  assert.equal(needsYouLink([`metatrooper://needs-you/${id65}`]), null);

  assert.equal(needsYouLink(['node', 'workbench', '--dev', 'metatrooper://needs-you/found-id', '--flag']), 'found-id');
  assert.equal(needsYouLink(['node', 'workbench', '--dev']), null);
  assert.equal(needsYouLink([]), null);
});

test('UI_METHODS contains all four notify.sink methods', () => {
  assert.ok(UI_METHODS.has('notify.sink.set'));
  assert.ok(UI_METHODS.has('notify.sink.list'));
  assert.ok(UI_METHODS.has('notify.sink.test'));
  assert.ok(UI_METHODS.has('notify.sink.remove'));
});

test('sink constants contain the expected default lists and hints', () => {
  assert.deepEqual(SINK_KINDS, ['ntfy', 'slack-webhook', 'discord-webhook', 'teams-workflow', 'webhook', 'command']);
  assert.deepEqual(SINK_DEFAULT_KINDS, ['gate', 'handoff', 'run-failed', 'budget', 'missing-secret', 'approval']);
  const schema = readFileSync(new URL('../../contracts/schema.sql', import.meta.url), 'utf8');
  const kinds = schema.match(/CREATE TABLE needs_you[^]*?kind\s+TEXT NOT NULL CHECK \(kind IN \(([^)]*)\)/)![1].split(',').map((k) => k.trim().replace(/'/g, ''));
  assert.deepEqual(SINK_ALL_KINDS, kinds);
  assert.equal(SINK_DEST_HINT.ntfy, 'https://ntfy.sh/your-topic');
});

test('renderSinks masks destination, renders empty password input, disables kind, and escapes names', () => {
  let html = '';
  const setHtml = (_id: string, h: string) => { html = h; };
  const secretDest = 'https://ntfy.sh/secret-destination';
  const secretHash = 'hash-abc-123';
  const ui: any = {
    sinks: [
      { id: 's1', name: 'Alerts', kind: 'ntfy', kinds: ['gate'], enabled: true, dest_hash: secretHash, destination: secretDest },
    ],
    sinkEdit: null,
  };
  const renderSinks = makeRenderSinks(ui, setHtml);

  renderSinks();
  assert.ok(!html.includes(secretDest));
  assert.ok(!html.includes(secretHash));

  ui.sinkEdit = { id: 's1', name: 'Alerts', kind: 'ntfy', kinds: ['gate'], enabled: true };
  renderSinks();
  assert.match(html, /<select id="sink-kind" disabled>/);
  assert.match(html, /<input id="sink-dest" type="password" autocomplete="off" placeholder="Enter it again; it is never shown">/);
  assert.ok(!html.includes('id="sink-dest" value='));

  ui.sinks = [
    { id: 's2', name: '<img src=x>', kind: 'ntfy', kinds: ['gate'], enabled: true },
  ];
  ui.sinkEdit = null;
  renderSinks();
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(!html.includes('<img src=x>'));
});

test('saveSink builds parameters, filters checked kinds, and calls notify.sink.list', async () => {
  const calls: Array<{ method: string; params: any }> = [];
  const rpc = async (method: string, params: any) => {
    calls.push({ method, params });
    if (method === 'notify.sink.set') return { result: { ok: true } };
    if (method === 'notify.sink.list') return { result: { sinks: [{ id: 's1' }] } };
    return { result: {} };
  };
  const toasts: string[] = [];
  const toast = (m: string) => toasts.push(m);
  let rendered = false;
  const renderSinks = () => { rendered = true; };

  const ui: any = {
    sinks: [],
    sinkEdit: { kinds: ['gate'], enabled: true },
  };
  const createDoc = createDocument({
    'sink-kind': { value: 'slack-webhook' },
    'sink-dest': { value: '  https://hooks.slack.com/services/test  ' },
    'sink-name': { value: '  Team Slack  ' },
    'sink-on': { checked: true },
    sinks: { hidden: true },
  }, {
    '.sink-k:checked': [{ value: 'gate' }, { value: 'run-failed' }],
  });

  const { saveSink } = makeSaveAndOpenSinks(ui, createDoc, rpc, toast, renderSinks);
  await saveSink();

  assert.equal(calls.length, 2);
  assert.equal(calls[0].method, 'notify.sink.set');
  assert.deepEqual(calls[0].params, {
    kind: 'slack-webhook',
    dest: 'https://hooks.slack.com/services/test',
    kinds: ['gate', 'run-failed'],
    enabled: true,
    name: 'Team Slack',
  });
  assert.equal('id' in calls[0].params, false);
  assert.equal(calls[1].method, 'notify.sink.list');
  assert.deepEqual(calls[1].params, {});
  assert.equal(rendered, true);
  assert.ok(toasts.includes('Sink saved.'));

  calls.length = 0;
  ui.sinkEdit = { id: 'sink-42', kind: 'ntfy', kinds: ['gate'], enabled: true };
  const editDoc = createDocument({
    'sink-kind': { value: 'command' },
    'sink-dest': { value: 'https://ntfy.sh/topic' },
    'sink-name': { value: '   ' },
    'sink-on': { checked: false },
    sinks: { hidden: true },
  }, {
    '.sink-k:checked': [{ value: 'budget' }],
  });

  const { saveSink: saveEditSink } = makeSaveAndOpenSinks(ui, editDoc, rpc, toast, renderSinks);
  await saveEditSink();

  assert.equal(calls[0].method, 'notify.sink.set');
  assert.deepEqual(calls[0].params, {
    id: 'sink-42',
    kind: 'ntfy',
    dest: 'https://ntfy.sh/topic',
    kinds: ['budget'],
    enabled: false,
  });
  assert.equal(calls[0].params.id, 'sink-42');
  assert.equal('name' in calls[0].params, false);
  assert.equal(calls[1].method, 'notify.sink.list');
});

test('openNeedsYou marks gates as read, opens sheets, and falls back to inbox', async () => {
  const calls: Array<{ method: string; params: any; quiet: boolean }> = [];
  const rpc = async (method: string, params: any, quiet = false) => {
    calls.push({ method, params, quiet });
    return { result: { ok: true } };
  };
  const wall = { sheet: false, setSheet(v: boolean) { this.sheet = v; } };
  const inbox = { hidden: true };
  let inboxRendered = false;
  const renderInbox = () => { inboxRendered = true; };
  const doc = { getElementById: (id: string) => (id === 'inbox' ? inbox : null) };
  const ui: any = {
    snap: {
      needs_you: [{ id: 'gate-row-1', kind: 'gate', text: 'Needs approval' }],
    },
  };
  const openNeedsYou = makeOpenNeedsYou(ui, doc, rpc, wall, renderInbox, async () => {}, async () => {});

  await openNeedsYou('gate-row-1');
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], { method: 'needs_you.mark-read', params: { id: 'gate-row-1' }, quiet: true });
  assert.equal(wall.sheet, true);
  assert.equal(inbox.hidden, true);
  assert.equal(inboxRendered, false);

  calls.length = 0;
  wall.sheet = false;
  inbox.hidden = true;
  inboxRendered = false;

  await openNeedsYou('unknown-gate');
  assert.equal(calls.length, 0);
  assert.equal(wall.sheet, false);
  assert.equal(inbox.hidden, false);
  assert.equal(inboxRendered, true);

  calls.length = 0;
  wall.sheet = false;
  inbox.hidden = true;
  inboxRendered = false;

  await openNeedsYou('unknown-gate', false);
  assert.equal(calls.length, 0);
  assert.equal(wall.sheet, false);
  assert.equal(inbox.hidden, true);
  assert.equal(inboxRendered, false);
});
