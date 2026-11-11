import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const source = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const extract = (re: RegExp) => { const m = source.match(re); assert.ok(m, String(re)); return m[0]; };

test('snapshot session rows populate branch from rowGit and retain git map', () => {
  const gitCache = {
    s1: { branch: 'feat/test-branch' },
  };
  const inputSnapshot = {
    at: 1000,
    core: { online: true, pid: 1, heartbeat_age_ms: 0 },
    projects: [],
    engines: [],
    sessions: [
      { id: 's1' },
      { id: 's2' },
    ],
    needs_you: [],
    approvals: [],
    panes: [],
    snapshots: [],
    limits: [],
    selected: null,
    git: {},
  };

  const contextObj = {
    readFromDb: false,
    demo: false,
    iconOverrides: null,
    readOverrides: () => ({}),
    iconFile: () => '',
    resolveProjectIcon: () => null,
    db: () => ({}),
    emptySnapshot: () => ({}),
    withLiveText: (s: any) => s,
    withContext: (s: any) => s,
    snapshot: () => JSON.parse(JSON.stringify(inputSnapshot)),
    path: { join: (...args: string[]) => args.join('/') },
    homeDir: () => '/tmp',
    liveText: {},
    view: { projectId: null },
    rowGit: () => gitCache,
    sessionColour: () => '#ffffff',
    settingsError: () => null,
    coreMismatch: null,
    coreLog: null,
    reader: null,
    lastGood: null,
  };

  const c = vm.createContext(contextObj);
  const code = extract(/function read\(\): Snapshot \{[^]*?\n\}/m);
  vm.runInContext(stripTypeScriptTypes(code), c);

  const raw = vm.runInContext('read()', c);
  const result = JSON.parse(JSON.stringify(raw));

  // Verify session with cached branch gets the branch string.
  assert.equal(result.sessions[0].branch, 'feat/test-branch');
  // Verify session missing from git cache gets null.
  assert.equal(result.sessions[1].branch, null);
  // Verify the git map is preserved on snapshot.
  assert.deepEqual(result.git, gitCache);
});
