import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { checkUrl } from '../../core/src/browser/policy.ts';

test('M6-1 pane dev_port does not grant an agent loopback access', async () => {
  // Stub the Electron import so the real policy can run without a browser process.
  const hook = registerHooks({
    resolve(specifier, context, nextResolve) {
      return specifier === 'electron' ? { url: 'test:electron', shortCircuit: true } : nextResolve(specifier, context);
    },
    load(url, context, nextLoad) {
      return url === 'test:electron'
        ? { format: 'module', source: 'export const app = {}, clipboard = {}, Menu = {}, session = {}, WebContentsView = {};', shortCircuit: true }
        : nextLoad(url, context);
    },
  });
  let PaneManager;
  try {
    ({ PaneManager } = await import('../src/browser/panes.ts'));
  } finally {
    hook.deregister();
  }
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`
      CREATE TABLE project (id TEXT PRIMARY KEY, path TEXT);
      CREATE TABLE browser_pane (id TEXT PRIMARY KEY, project_id TEXT, session_id TEXT, dev_port INTEGER);
      INSERT INTO project VALUES ('project-test', '/synthetic/missing-project');
      INSERT INTO browser_pane VALUES ('bp_agent_test', 'project-test', 'session-test', 5173);
      INSERT INTO browser_pane VALUES ('bp_user_test', 'project-test', 'session-test', 3001);
    `);
    const manager = new PaneManager({} as any, { db: () => db } as any);
    const context = (manager as any).policy('project-test');
    for (const url of [
      'http://127.0.0.1:5173/',
      'http://localhost:5173/',
      'http://[::1]:5173/',
      'http://127.0.0.1:3001/',
      'http://localhost:3001/',
    ]) {
      assert.equal((await checkUrl(url, context)).allow, false, url);
    }
  } finally {
    db.close();
  }
});
