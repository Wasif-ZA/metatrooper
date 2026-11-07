import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGenerated, client, isolation, startCore, teardownCore } from './helpers.ts';

before(buildGenerated);

// A fake engine that exits at once; the session row is what these tests read.
const quickExit = 'setTimeout(() => process.exit(0), 200);';

/**
 * Starts a core with one fake engine and one opened project. `config` is written to
 * the project's .troop/config.json before the project is opened. `run` gets the pipe,
 * the project id and a read-only view of the session table.
 */
async function withLaunchCore(config: object | null, run: (ctx: { pipe: any; projectId: string; sessionRow: (id: string) => any; sessionCount: () => number }) => Promise<void>) {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const script = join(isolated.home, 'm7-01-quick-exit.mjs');
  writeFileSync(script, quickExit);
  writeFileSync(registry, JSON.stringify([{
    id: 'm7-fake', command: process.execPath, args: [script], prompt_arg: 'positional', state_source: 'process',
    roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli', version_cmd: [process.execPath, '--version'],
  }]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  try {
    const project = join(isolated.home, 'm7-01-project');
    mkdirSync(project);
    if (config) {
      mkdirSync(join(project, '.troop'));
      writeFileSync(join(project, '.troop', 'config.json'), JSON.stringify(config));
    }
    const pipe = await client(isolated.prefix);
    try {
      const opened = await pipe.request('project.open', { path: project });
      const sessionRow = (id: string) => {
        const db = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
        try { return db.prepare('SELECT id, browser_grant FROM session WHERE id = ?').get(id); }
        finally { db.close(); }
      };
      const sessionCount = () => {
        const db = new DatabaseSync(join(isolated.home, 'troop.db'), { readOnly: true });
        try { return Number(db.prepare('SELECT COUNT(*) AS n FROM session').get()!.n); }
        finally { db.close(); }
      };
      await run({ pipe, projectId: opened.result.project_id, sessionRow, sessionCount });
    } finally { pipe.close(); }
  } finally { await teardownCore(core, isolated); }
}

// protects=an unknown grant name fails the launch with -32602, not a session with a bogus grant
// fails_when=the launch accepts 'evalute' or starts a session with it
// no_claim=the -32602 check of a grant read from .troop/config.json (not covered here)
test('M7-01a launch with browser_grant evalute fails -32602 and names look, act and debug', async () => {
  await withLaunchCore(null, async ({ pipe, projectId, sessionCount }) => {
    const reply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'm7-fake', browser_grant: 'evalute' });
    assert.equal(reply.error?.code, -32602, JSON.stringify(reply));
    for (const name of ['look', 'act', 'debug']) assert.match(reply.error.message, new RegExp(name), name);
    assert.equal(reply.result, undefined);
    assert.equal(sessionCount(), 0, 'no session row is written for a refused launch');
  });
});

// protects=a launch with 'look' stores the grant on the session row
// fails_when=the grant is dropped on the way to session.browser_grant
// no_claim=what the session can then call (the workbench test checks the server side)
test('M7-01a launch with browser_grant look stores look on the session row', async () => {
  await withLaunchCore(null, async ({ pipe, projectId, sessionRow }) => {
    const reply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'm7-fake', browser_grant: 'look' });
    assert.ok(reply.result?.session_id, JSON.stringify(reply));
    assert.equal(sessionRow(reply.result.session_id).browser_grant, 'look');
  });
});

// protects=no grant anywhere leaves the session with no preset, which means every tool
// fails_when=a launch with no grant stores a preset (for example look) or a value other than null
// no_claim=the every-tool behaviour of tools/list (MCP side, not covered here)
test('M7-01a launch with no browser grant stores null on the session row', async () => {
  await withLaunchCore(null, async ({ pipe, projectId, sessionRow }) => {
    const reply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'm7-fake' });
    assert.ok(reply.result?.session_id, JSON.stringify(reply));
    assert.equal(sessionRow(reply.result.session_id).browser_grant, null);
  });
});

// protects=the project's .troop/config.json browser.grant applies when the launch names none
// fails_when=a project config of act is ignored, or the launch falls back to every tool
// no_claim=config values other than browser.grant
test('M7-01a launch with no grant takes browser.grant act from the project config', async () => {
  await withLaunchCore({ browser: { grant: 'act' } }, async ({ pipe, projectId, sessionRow }) => {
    const reply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'm7-fake' });
    assert.ok(reply.result?.session_id, JSON.stringify(reply));
    assert.equal(sessionRow(reply.result.session_id).browser_grant, 'act');
  });
});

// protects=the grant named on the launch wins over the project config (the spec says "else" the config)
// fails_when=the config grant overrides the one the launch passed
// no_claim=an invalid config grant (the spec does not state that case)
test('M7-01a a browser_grant on the launch beats the project config', async () => {
  await withLaunchCore({ browser: { grant: 'act' } }, async ({ pipe, projectId, sessionRow }) => {
    const reply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'm7-fake', browser_grant: 'look' });
    assert.ok(reply.result?.session_id, JSON.stringify(reply));
    assert.equal(sessionRow(reply.result.session_id).browser_grant, 'look');
  });
});
