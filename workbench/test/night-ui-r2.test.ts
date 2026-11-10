import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { gitAct, namedPaths, parseStatusV2, type Run } from '../src/gitpane.ts';

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const extract = (re: RegExp) => {
  const m = source.match(re);
  assert.ok(m, String(re));
  return m[0];
};

const gitHandlerCode = extract(/^  on\('git', async[^]*?\n  \}\);/m);
const runCheckHandlerCode = extract(/^  on\('runCheck', async[^]*?\n  \}\);/m);

// --- 1. gitAct direct tests ---

test('gitAct commit returns trimmed rev-parse output and other ops return undefined', async () => {
  const calls: Array<{ args: string[]; input?: string }> = [];
  const fakeRun: Run = async (args: string[], input?: string) => {
    calls.push({ args, input });
    if (args[0] === 'diff' && args.includes('--cached')) return 'staged.txt\n';
    if (args[0] === 'rev-parse' && args.includes('--short')) return '  a1b2c3d \n';
    if (args[0] === 'rev-parse' && args.includes('--verify')) return 'HEAD\n';
    return '';
  };

  // 'commit' op returns trimmed rev-parse HEAD output ('  a1b2c3d \n' -> 'a1b2c3d')
  const commitRes = await gitAct(fakeRun, 'commit', 'test message');
  assert.equal(commitRes, 'a1b2c3d');

  // every other op returns undefined
  const otherOps: Array<{ op: string; arg: unknown }> = [
    { op: 'stage-paths', arg: ['file.ts'] },
    { op: 'unstage-paths', arg: ['file.ts'] },
    { op: 'stage', arg: 'file.ts' },
    { op: 'stage-group', arg: ['file.ts'] },
    { op: 'unstage', arg: 'file.ts' },
    { op: 'push', arg: null },
    { op: 'pull', arg: null },
  ];

  for (const { op, arg } of otherOps) {
    const res = await gitAct(fakeRun, op, arg);
    assert.equal(res, undefined, `op '${op}' must return undefined`);
  }
});

// --- 2. git channel in main.ts tests ---

function setupGitHandler(fakeRun: Run, gitActFn = gitAct) {
  const handlers: Record<string, Function> = {};
  const gitViews = new Map();
  const ctx = vm.createContext({
    on: (name: string, fn: Function) => { handlers[name] = fn; },
    db: () => ({
      prepare: (_sql: string) => ({
        get: (id: unknown) => (id === 'p1' ? { path: '/mock/project' } : undefined),
      }),
    }),
    runIn: (_cwd: string) => fakeRun,
    gitAct: gitActFn,
    namedPaths,
    parseStatusV2,
    gitViews,
    viewOf: async (_dir: string) => ({
      branch: 'main',
      ahead: 0,
      behind: 0,
      staged: [],
      changes: [],
      log: '',
    }),
    repoOfAsync: async () => null,
    ownersAsync: async () => [],
    ownerGroups: () => [],
    console: { log: () => {} },
  });

  vm.runInContext(stripTypeScriptTypes(gitHandlerCode), ctx);
  return (projectId: unknown, op: unknown, arg: unknown) => handlers.git(projectId, op, arg);
}

test('git channel in main.ts carries commit only after a commit', async () => {
  const fakeRun: Run = async (args: string[]) => {
    if (args[0] === 'diff' && args.includes('--cached')) return 'staged.txt\n';
    if (args[0] === 'rev-parse' && args.includes('--short')) return '  a1b2c3d \n';
    if (args[0] === 'rev-parse' && args.includes('--verify')) return 'HEAD\n';
    return '';
  };

  const git = setupGitHandler(fakeRun);

  // op 'commit' carries commit short hash
  const commitReply = await git('p1', 'commit', 'feat: cool feature');
  assert.equal(commitReply.commit, 'a1b2c3d');
  assert.equal(commitReply.error, undefined);

  // other ops do not carry commit
  const viewReply = await git('p1', 'view', null);
  assert.equal(viewReply.commit, undefined);

  const stageReply = await git('p1', 'stage', 'src/app.ts');
  assert.equal(stageReply.commit, undefined);

  const stagePathsReply = await git('p1', 'stage-paths', ['src/app.ts']);
  assert.equal(stagePathsReply.commit, undefined);

  const unstageReply = await git('p1', 'unstage', 'src/app.ts');
  assert.equal(unstageReply.commit, undefined);

  const unstagePathsReply = await git('p1', 'unstage-paths', ['src/app.ts']);
  assert.equal(unstagePathsReply.commit, undefined);

  const stageGroupReply = await git('p1', 'stage-group', ['src/app.ts']);
  assert.equal(stageGroupReply.commit, undefined);

  const pushReply = await git('p1', 'push', null);
  assert.equal(pushReply.commit, undefined);

  const pullReply = await git('p1', 'pull', null);
  assert.equal(pullReply.commit, undefined);
});

// --- 3. runCheck channel in main.ts tests ---

function setupRunCheckHandler(options: {
  dbSession?: { project_id: string } | null;
  settingsObj?: any;
  callFn?: (method: string, params: any, opts: any) => Promise<any>;
}) {
  const handlers: Record<string, Function> = {};
  const currentDbSession = options.dbSession !== undefined ? options.dbSession : { project_id: 'p1' };
  const currentSettings = options.settingsObj !== undefined ? options.settingsObj : { reliability: { checks: { p1: 'npm test' } } };
  const defaultCall = async (_method: string, _params: any, _opts: any) => ({
    kind: 'reply',
    reply: {
      result: {
        exit_code: 0,
        command: 'npm test',
        output_tail: 'ok',
      },
    },
  });
  const callFn = options.callFn || defaultCall;

  const ctx = vm.createContext({
    on: (name: string, fn: Function) => { handlers[name] = fn; },
    db: () => ({
      prepare: (_sql: string) => ({
        get: (id: unknown) => (id === 's1' ? currentDbSession : undefined),
      }),
    }),
    settings: () => currentSettings,
    call: callFn,
    console: { log: () => {} },
  });

  vm.runInContext(stripTypeScriptTypes(runCheckHandlerCode), ctx);
  return (sessionId: unknown, ...extra: any[]) => handlers.runCheck(sessionId, ...extra);
}

test('runCheck: unknown session returns session not found error', async () => {
  let callInvoked = false;
  const runCheck = setupRunCheckHandler({
    dbSession: null,
    callFn: async () => { callInvoked = true; return {}; },
  });

  const resUnknown = await runCheck('unknown-session-id');
  assert.deepEqual(structuredClone(resUnknown), { error: 'session not found' });

  const resNull = await runCheck(null);
  assert.deepEqual(structuredClone(resNull), { error: 'session not found' });

  const resUndef = await runCheck(undefined);
  assert.deepEqual(structuredClone(resUndef), { error: 'session not found' });

  const resNum = await runCheck(12345);
  assert.deepEqual(structuredClone(resNum), { error: 'session not found' });

  assert.equal(callInvoked, false);
});

test('runCheck: settings with no saved check or no reliability returns error naming Settings', async () => {
  let callInvoked = false;
  const noCall = async () => { callInvoked = true; return {}; };

  // 1. checks is empty object
  const runCheckEmptyChecks = setupRunCheckHandler({
    settingsObj: { reliability: { checks: {} } },
    callFn: noCall,
  });
  const resEmptyChecks = await runCheckEmptyChecks('s1');
  assert.equal(typeof resEmptyChecks?.error, 'string');
  assert.match(resEmptyChecks.error, /Settings/);
  assert.equal(resEmptyChecks.error, 'no check command saved for this project; add one in Settings, Reliability');

  // 2. checks has command for different project, but none for p1
  const runCheckOtherProject = setupRunCheckHandler({
    settingsObj: { reliability: { checks: { p2: 'cargo test' } } },
    callFn: noCall,
  });
  const resOther = await runCheckOtherProject('s1');
  assert.equal(typeof resOther?.error, 'string');
  assert.match(resOther.error, /Settings/);

  // 3. settings() returns {} with no reliability at all (protects against dropping ?.)
  const runCheckNoReliability = setupRunCheckHandler({
    settingsObj: {},
    callFn: noCall,
  });
  const resNoRel = await runCheckNoReliability('s1');
  assert.equal(typeof resNoRel?.error, 'string');
  assert.match(resNoRel.error, /Settings/);
  assert.equal(resNoRel.error, 'no check command saved for this project; add one in Settings, Reliability');

  // 4. settings() returns { reliability: undefined }
  const runCheckUndefRel = setupRunCheckHandler({
    settingsObj: { reliability: undefined },
    callFn: noCall,
  });
  const resUndefRel = await runCheckUndefRel('s1');
  assert.equal(typeof resUndefRel?.error, 'string');
  assert.match(resUndefRel.error, /Settings/);

  // 5. check command is blank / whitespace
  const runCheckWhitespace = setupRunCheckHandler({
    settingsObj: { reliability: { checks: { p1: '   \t  ' } } },
    callFn: noCall,
  });
  const resWs = await runCheckWhitespace('s1');
  assert.equal(typeof resWs?.error, 'string');
  assert.match(resWs.error, /Settings/);

  assert.equal(callInvoked, false);
});

test('runCheck: calls done.check with only saved command even when window passes extra arguments', async () => {
  const recordedCalls: Array<{ method: string; params: any; options: any }> = [];
  const runCheck = setupRunCheckHandler({
    settingsObj: { reliability: { checks: { p1: 'pytest -v' } } },
    callFn: async (method, params, options) => {
      recordedCalls.push({ method, params, options });
      return {
        kind: 'reply',
        reply: {
          result: {
            exit_code: 0,
            command: params.command,
            output_tail: 'passed',
          },
        },
      };
    },
  });

  const res = await runCheck('s1', 'malicious-command --drop-db', { evil: true }, 'more');
  assert.equal(res.ok, true);
  assert.equal(res.command, 'pytest -v');
  assert.equal(recordedCalls.length, 1);
  assert.equal(recordedCalls[0].method, 'done.check');
  assert.deepEqual(structuredClone(recordedCalls[0].params), { session_id: 's1', command: 'pytest -v' });
  assert.deepEqual(structuredClone(recordedCalls[0].options), { ui: true, waitMs: 610_000 });
});

test('runCheck: output_tail is capped at 2000 characters', async () => {
  const longTail = 'HEAD_TRUNCATED_' + 'a'.repeat(2500) + 'TAIL_END';
  const expectedTail = longTail.slice(-2000);

  const runCheck = setupRunCheckHandler({
    settingsObj: { reliability: { checks: { p1: 'npm test' } } },
    callFn: async () => ({
      kind: 'reply',
      reply: {
        result: {
          exit_code: 1,
          command: 'npm test',
          output_tail: longTail,
        },
      },
    }),
  });

  const res = await runCheck('s1');
  assert.equal(res.ok, true);
  assert.equal(res.exit_code, 1);
  assert.equal(res.command, 'npm test');
  assert.equal(res.output_tail.length, 2000);
  assert.equal(res.output_tail, expectedTail);
  assert.equal(res.output_tail.endsWith('TAIL_END'), true);
  assert.equal(res.output_tail.includes('HEAD_TRUNCATED_'), false);

  // Short output is preserved
  const runCheckShort = setupRunCheckHandler({
    settingsObj: { reliability: { checks: { p1: 'npm test' } } },
    callFn: async () => ({
      kind: 'reply',
      reply: {
        result: {
          exit_code: 0,
          command: 'npm test',
          output_tail: 'short output',
        },
      },
    }),
  });
  const resShort = await runCheckShort('s1');
  assert.equal(resShort.output_tail, 'short output');

  // Null/undefined output_tail becomes empty string
  const runCheckNull = setupRunCheckHandler({
    settingsObj: { reliability: { checks: { p1: 'npm test' } } },
    callFn: async () => ({
      kind: 'reply',
      reply: {
        result: {
          exit_code: 0,
          command: 'npm test',
          output_tail: null,
        },
      },
    }),
  });
  const resNull = await runCheckNull('s1');
  assert.equal(resNull.output_tail, '');
});

test('runCheck: propagates core offline and error replies', async () => {
  const runCheckOffline = setupRunCheckHandler({
    settingsObj: { reliability: { checks: { p1: 'npm test' } } },
    callFn: async () => ({ kind: 'timeout' }),
  });
  const resOffline = await runCheckOffline('s1');
  assert.deepEqual(structuredClone(resOffline), { error: 'the core is offline or the check ran out of time' });

  const runCheckError = setupRunCheckHandler({
    settingsObj: { reliability: { checks: { p1: 'npm test' } } },
    callFn: async () => ({
      kind: 'reply',
      reply: { error: { message: 'command execution failed' } },
    }),
  });
  const resError = await runCheckError('s1');
  assert.deepEqual(structuredClone(resError), { error: 'command execution failed' });
});

test('done.check is not in UI_METHODS and preload.cjs exposes runCheck but never done.check', () => {
  // 1. UI_METHODS does not include done.check
  const decl = extract(/export const UI_METHODS = new Set\([^]*?\n\]\);/).replace('export ', '');
  const uiMethods: Set<string> = vm.runInNewContext(stripTypeScriptTypes(decl) + '\nUI_METHODS;');
  assert.equal(Object.prototype.toString.call(uiMethods), "[object Set]");
  assert.equal(uiMethods.has('done.check'), false);
  assert.equal(uiMethods.has('runCheck'), false);

  // 2. preload.cjs exposes runCheck and never done.check
  const preloadSource = readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8');
  let exposed: any;
  vm.runInNewContext(preloadSource, {
    require: (name: string) => {
      assert.equal(name, 'electron');
      return {
        contextBridge: {
          exposeInMainWorld: (name: string, api: any) => {
            if (name === 'troop') exposed = api;
          },
        },
        ipcRenderer: { on() {}, invoke: () => {} },
        webUtils: {},
      };
    },
  });

  assert.equal(typeof exposed?.runCheck, 'function');
  assert.equal('done.check' in exposed, false);
  assert.equal(exposed['done.check'], undefined);
  assert.equal(exposed['done'], undefined);

  // Verify preload source text directly
  assert.match(preloadSource, /\brunCheck\s*:\s*\(/);
  assert.doesNotMatch(preloadSource, /\bdone\.check\b/);
});
