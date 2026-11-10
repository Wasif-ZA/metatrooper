import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const app = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const inbox = readFileSync(new URL('../renderer/inbox.js', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../renderer/settings.js', import.meta.url), 'utf8');
function declaration(name: string) {
  const start = app.indexOf('function ' + name + '(');
  assert.notEqual(start, -1);
  const end = app.indexOf('\n}', start);
  assert.notEqual(end, -1);
  return app.slice(start, end + 2);
}
const esc = (value: unknown) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

test('M8-S4b lent pane and signed_in server contracts with fake Electron', t => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', '--test', '--test-reporter=tap', fileURLToPath(new URL('./fixtures/m8-s4b-lent-pane.ts', import.meta.url))], { env, encoding: 'utf8', timeout: 30000 });
  const output = result.stdout + result.stderr;
  t.diagnostic(output);
  assert.ifError(result.error);
  assert.equal(result.status, 0, output);
  assert.match(output, /^# pass 17$/m);
  assert.match(output, /^# fail 0$/m);
  assert.match(output, /^# todo 0$/m);
});

test('lend requests count as Needs you and render project, origin and dismiss actions', () => {
  let html = '';
  const context: any = {
    ui: { view: 'inbox', projectId: 'B', snap: { projects: [], live: [], approvals: [], needs_you: [{ id: 'need-1', kind: 'other', ref: 'lend:A https://shop.example', text: 'codex wants to use your sign-in on https://shop.example', at: 'x', read_at: null }] } },
    document: { getElementById: () => ({ hidden: false }), addEventListener() {} },
    esc, ago: () => 'now', taskOf: () => '', approvalCard: () => '', setHtml: (_id: string, value: string) => { html = value; },
  };
  const helpers = app.slice(app.indexOf('const INFO_KINDS'), app.indexOf('const NEEDS_COUNTS'));
  runInNewContext(helpers + '\n' + declaration('needsCount') + '\n' + declaration('waitingAll') + '\n' + inbox, context);
  assert.equal(runInNewContext('needsCount()', context), 1);
  context.inboxView.draw();
  assert.match(html, /1 waiting on you/);
  assert.match(html, /data-action="lend-set" data-project="A" data-origin="https:\/\/shop.example"/);
  assert.match(html, /data-action="dismiss" data-id="need-1"/);
  context.ui.snap.needs_you[0].read_at = 'x';
  assert.equal(runInNewContext('needsCount()', context), 0);
  context.ui.snap.needs_you[0].ref = 'ordinary-info';
  context.ui.snap.needs_you[0].read_at = null;
  assert.equal(runInNewContext('needsCount()', context), 0);
});

test('the lend-set renderer action sends literal lend.set parameters', async () => {
  const calls: unknown[] = [];
  const onClick = runInNewContext('(async ' + declaration('onClick') + ')', { rpc: async (...args: unknown[]) => { calls.push(args); } });
  await onClick({ stopPropagation() {}, target: { closest: () => ({ tagName: 'BUTTON', dataset: { action: 'lend-set', project: 'A', origin: 'https://shop.example' }, closest: () => null }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['lend.set', { project_id: 'A', origin: 'https://shop.example', on: true }]]);
});

test('Safety lists only the current projects lent origins, removes through lend.set, and shows None when empty', async () => {
  const listeners: Record<string, (e: any) => void> = {};
  const element = { hidden: true, innerHTML: '', focus() {}, addEventListener(name: string, fn: any) { listeners[name] = fn; } };
  const calls: unknown[] = [];
  let data = { desktop: { watch_pause: true, takeover_key: 'Control+Alt+Q' }, browser: { allow_origins: [], lent: { A: ['https://shop.example'], B: ['https://private.example'] } } };
  const context: any = {
    document: { getElementById: () => element, addEventListener: (_name: string, fn: () => void) => fn() },
    ui: { projectId: 'A' }, esc, render() {},
    api: { settingsPage: async () => data },
    rpc: async (...args: unknown[]) => { calls.push(args); data.browser.lent.A = []; },
  };
  runInNewContext(settings, context);
  await context.settingsView.open('safety');
  assert.match(element.innerHTML, /<h1>Safety<\/h1>/);
  assert.match(element.innerHTML, /data-unlend="https:\/\/shop.example"/);
  assert.doesNotMatch(element.innerHTML, /private\.example/);
  listeners.click({ target: { closest: () => ({ dataset: { unlend: 'https://shop.example' } }) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['lend.set', { project_id: 'A', origin: 'https://shop.example', on: false }]]);
  assert.match(element.innerHTML, /Sites where agents may use my sign-in[\s\S]*?<span class="sval">None<\/span>/);
  assert.doesNotMatch(element.innerHTML, /data-unlend=/);
});
