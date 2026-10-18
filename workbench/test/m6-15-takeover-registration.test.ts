import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerHooks } from 'node:module';

let sequence = 0;

// Load the complete main module with synthetic Electron, core and timer dependencies.
async function startup(t: any, outcome: 'true' | 'false' | 'throw') {
  const home = mkdtempSync(join(tmpdir(), 'm6-15-registration-'));
  const id = sequence++;
  const state: any = { sent: [], registered: [], ready: null, home };
  state.register = (key: string) => {
    state.registered.push(key);
    if (outcome === 'throw') throw new Error('synthetic invalid key');
    return outcome === 'true';
  };
  (globalThis as any).__takeoverTest = state;
  const sources: Record<string, string> = {
    'electron': `const s = globalThis.__takeoverTest;
      export const app = { on() {}, setPath() {}, requestSingleInstanceLock: () => true, whenReady: () => ({ then: fn => { s.ready = fn; } }), quit() {}, setAsDefaultProtocolClient() {} };
      export const clipboard = {}, desktopCapturer = {}, dialog = {}, shell = {}, Notification = {};
      export const globalShortcut = { register: key => s.register(key), unregisterAll() {} };
      export const ipcMain = { handle() {} }, Menu = { setApplicationMenu() {} };
      export const session = { defaultSession: { webRequest: { onBeforeRequest() {} }, setPermissionRequestHandler() {} } };
      export class BrowserWindow { webContents = { once() {}, on() {}, send() {}, isLoading: () => false }; once() {} on() {} loadFile() { return Promise.resolve(); } isDestroyed() { return false; } }`,
    'node:net': "import { EventEmitter } from 'node:events'; export const connect = () => { const s = new EventEmitter(); s.setTimeout = () => {}; s.destroy = () => {}; queueMicrotask(() => s.emit('connect')); return s; };",
    '../../core/src/terminal/parent-env.ts': 'export const PARENT_SESSION_ENV = new Set();',
    '../../core/src/terminal/windows-build.ts': 'export const windowsBuild = () => 0;',
    '../../core/src/hook/resolve.ts': 'export const resolveLaunch = () => null;',
    './terminals.ts': 'export const termAck = () => {}, attachTerm = () => {}, detachAll = () => {}, detachTerm = () => {}, termInput = () => {}, termResize = () => {};',
    './desktop-frames.ts': 'export const syncFrames = Object.assign(() => {}, { count: () => 0 });',
    '../../core/src/paths.ts': 'export const homeDir = () => globalThis.__takeoverTest.home, dbFile = () => homeDir() + "/synthetic.sqlite", browserPipe = () => "synthetic", corePipe = () => "synthetic", logsDir = homeDir, uiKeyFile = () => homeDir() + "/key";',
    '../../core/src/log.ts': 'export const captureProcessLog = () => {};',
    '../../core/src/time.ts': 'export const ulid = () => "synthetic";',
    './browser/panes.ts': 'export class PaneManager { sync() {} } export class ToolError extends Error {}',
    './browser/server.ts': 'export const startBrowserServer = async () => {};',
    '../../core/src/browser/policy.ts': 'export const typedUrl = x => x;',
    '../../core/src/store/db.ts': 'export const openReaderDb = () => ({ exec() {} });',
    '../../core/src/pipe/client.ts': 'export const call = async (method, params, options) => { globalThis.__takeoverTest.sent.push({ method, params, options }); return { kind: "reply", reply: { result: {} } }; };',
    './queries.ts': 'export const snapshot = () => ({ core: { pid: 1234, online: true }, sessions: [], needs_you: [], grants: [] }), withContext = x => x, withLiveText = x => x, dataVersion = () => 0, freshNeeds = () => ({ seen: new Set(), fresh: [] }), crashAction = () => "none", watchDb = () => {}, browserAudit = () => [], toastFor = () => null;',
    './handback.ts': 'export const fileDiff = () => {}, gitIn = () => {}, handback = () => {}, sessionChanges = () => {};',
    './gitpane.ts': 'export const gitAct = () => {}, gitView = () => {}, ownerGroups = () => {}, runIn = () => {};',
    '../../core/src/sessions/owners.ts': 'export const ownersAsync = async () => ({}), repoOfAsync = async () => null;',
    './comments.ts': 'export const copied = () => false, diffLineBody = () => "", elementBody = () => "", filesBody = () => "";',
    '../../core/src/settings.ts': 'export const settings = () => ({ desktop: { takeover_key: "Control+Shift+F9" }, terminal: { git_every_ms: 10000 }, ui: {} }), activeTheme = () => ({ bg: "#000000" }), settingsError = () => null, settingsFile = () => globalThis.__takeoverTest.home + "/settings.json";',
    './rowgit.ts': 'export const ownedIn = async () => ({}), refreshRowGit = async () => false, rowGit = () => ({});',
  };
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.includes('/src/main.ts?registration=') && sources[specifier]) return { url: 'test:registration-' + id + '/' + specifier, shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (url.includes('/src/main.ts?registration=')) {
        const loaded = next(url, context);
        return { ...loaded, source: loaded.source + '\nexport { tellCoreOurPid };\n' };
      }
      const key = Object.keys(sources).find(k => url === 'test:registration-' + id + '/' + k);
      return key ? { format: 'module', shortCircuit: true, source: sources[key] } : next(url, context);
    },
  });
  const interval = globalThis.setInterval;
  const timeout = globalThis.setTimeout;
  const listeners = process.listeners('uncaughtException');
  globalThis.setInterval = (() => ({ unref() {} })) as any;
  globalThis.setTimeout = (() => ({ unref() {} })) as any;
  t.after(() => { delete (globalThis as any).__takeoverTest; rmSync(home, { recursive: true, force: true }); });
  try {
    const main = await import('../src/main.ts?registration=' + id);
    await main.tellCoreOurPid(1234);
    assert.deepEqual(state.sent.filter((r: any) => r.method === 'desktop.ui-window'), []);
    assert.deepEqual(state.registered, []);
    assert.equal(typeof state.ready, 'function');
    state.ready();
    await main.tellCoreOurPid(1234);
    await main.tellCoreOurPid(1234);
    await Promise.resolve();
    await Promise.resolve();
    return state;
  } finally {
    hooks.deregister();
    globalThis.setInterval = interval;
    globalThis.setTimeout = timeout;
    for (const listener of process.listeners('uncaughtException')) if (!listeners.includes(listener)) process.removeListener('uncaughtException', listener);
  }
}

for (const outcome of ['false', 'throw', 'true'] as const) test('M6-15 take-over registration reports ' + outcome + ' only after registration is tried', async t => {
  const state = await startup(t, outcome);
  assert.deepEqual(state.registered, ['Control+Shift+F9']);
  const sent = state.sent.filter((r: any) => r.method === 'desktop.ui-window');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].params.pid, process.pid);
  assert.equal(sent[0].params.takeover_key, 'Control+Shift+F9');
  assert.deepEqual(sent[0].options, { ui: true });
  if (outcome === 'throw') assert.match(sent[0].params.takeover_error, /^not a valid accelerator/);
  else assert.equal(sent[0].params.takeover_error, outcome === 'false' ? 'held by another program' : null);
});
