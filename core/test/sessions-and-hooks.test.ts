import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, harness, isolation, root, runNode, startCore, stopCore, teardownCore, until } from './helpers.ts';

before(buildGenerated);

function db(home) {
  const connection = new DatabaseSync(join(home, 'troop.db'));
  connection.exec('PRAGMA busy_timeout = 2000');
  return connection;
}

async function launchFake(h) {
  const project = join(h.home, 'fixture-project');
  mkdirSync(project, { recursive: true });
  const pipe = await client(h.prefix);
  try {
    const opened = await pipe.request('project.open', { path: project });
    assert.ok(opened.result?.project_id, JSON.stringify(opened));
    const launched = await pipe.request('session.launch', { project_id: opened.result.project_id, engine_id: 'fake', prompt: join(root, 'core/test/fake-engine.js') });
    assert.ok(launched.result?.session_id, JSON.stringify(launched));
    return launched.result.session_id;
  } finally { pipe.close(); }
}

async function fakeHarness() {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  writeFileSync(registry, JSON.stringify([{
    id: 'fake', command: process.execPath, prompt_arg: 'positional', state_source: 'hooks',
    roles: ['worker'], cost_rank: 1, usage_source: 'none', provider: 'local-cli',
    version_cmd: [process.execPath, '--version']
  }]));
  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  return { ...isolated, core, env,
    async teardown() {
      await teardownCore(core, isolated);
    }
  };
}

test('processed Claude events move a fake session through working, waiting, done, and seen idle', async () => {
  const h = await fakeHarness();
  try {
    const sessionId = await launchFake(h);
    const store = db(h.home);
    try {
      for (const [kind, body, expected] of [
        ['PreToolUse', { tool_name: 'Read', tool_input: { file_path: '/safe' } }, 'working'],
        ['Notification', { message: 'Claude requests permission to use a tool' }, 'waiting_for_you'],
        ['Stop', { stop_hook_active: false }, 'done']
      ]) {
        const result = await runNode(['core/event.js', `claude.${kind}`], { ...h.env, TROOP_SESSION_ID: sessionId }, JSON.stringify({ session_id: 'native-1', cwd: h.home, ...body }));
        assert.equal(result.code, 0);
        await until(() => store.prepare('SELECT state FROM session WHERE id = ?').get(sessionId)?.state === expected, 2000);
      }
      assert.equal(store.prepare('SELECT native_id FROM session WHERE id = ?').get(sessionId).native_id, 'native-1');
      const pipe = await client(h.prefix);
      try {
        assert.deepEqual((await pipe.request('session.seen', { session_id: sessionId })).result, {});
      } finally { pipe.close(); }
      await until(() => store.prepare('SELECT state FROM session WHERE id = ?').get(sessionId)?.state === 'idle');
    } finally { store.close(); }
  } finally { await h.teardown(); }
});

test('a queued session.launch and the same pipe request create one session', async () => {
  const h = await fakeHarness();
  let restarted;
  try {
    const project = join(h.home, 'queued-session-project');
    mkdirSync(project);
    const firstPipe = await client(h.prefix);
    let projectId;
    try { projectId = (await firstPipe.request('project.open', { path: project })).result.project_id; }
    finally { firstPipe.close(); }
    await stopCore(h.core, h);
    const id = randomUUID();
    const params = { project_id: projectId, engine_id: 'fake', prompt: join(root, 'core/test/fake-engine.js') };
    const store = db(h.home);
    store.prepare('INSERT INTO command (id, at, origin, method, params, status) VALUES (?, ?, ?, ?, ?, ?)').run(id, new Date().toISOString(), 'cli', 'session.launch', JSON.stringify(params), 'queued');
    store.close();
    restarted = await startCore(h);
    const pipe = await client(h.prefix);
    try {
      const reply = await pipe.request('session.launch', params, { id });
      assert.ok(reply.result?.session_id, JSON.stringify(reply));
      const check = db(h.home);
      try {
        assert.equal(check.prepare('SELECT count(*) AS n FROM session WHERE project_id = ?').get(projectId).n, 1);
        assert.equal(check.prepare('SELECT status FROM command WHERE id = ?').get(id).status, 'ok');
      } finally { check.close(); }
    } finally { pipe.close(); }
  } finally { await stopCore(restarted, h); await h.teardown(); }
});

test('UserPromptSubmit prints one exact comment envelope and marks only delivered comments', async () => {
  const h = await fakeHarness();
  try {
    const sessionId = await launchFake(h);
    const store = db(h.home);
    try {
      const ids = [randomUUID(), randomUUID()];
      const bodies = ids.map((id, index) => `[comment ${id}] Comment ${index + 1}`);
      for (let i = 0; i < 2; i++) store.prepare('INSERT INTO comment (id, at, session_id, kind, body) VALUES (?, ?, ?, ?, ?)').run(ids[i], new Date(Date.now() + i).toISOString(), sessionId, 'file', bodies[i]);
      const env = { ...h.env, TROOP_SESSION_ID: sessionId };
      const input = JSON.stringify({ session_id: 'native-1', cwd: h.home, prompt: 'PRIVATE_MARKER' });
      const first = await runNode(['core/event.js', 'claude.UserPromptSubmit'], env, input);
      assert.equal(first.code, 0);
      const expected = { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `Comments from the MetaTrooper browser:\n\n${bodies.join('\n\n')}` } };
      assert.equal(first.stdout, JSON.stringify(expected) + '\n');
      assert.equal(store.prepare('SELECT count(*) AS n FROM comment WHERE prompt_at IS NOT NULL').get().n, 2);
      const second = await runNode(['core/event.js', 'claude.UserPromptSubmit'], env, input);
      assert.equal(second.code, 0);
      assert.equal(second.stdout, '');
    } finally { store.close(); }
  } finally { await h.teardown(); }
});

test('hooks install and uninstall preserve fixture settings and config byte for byte', async () => {
  const h = await harness();
  try {
    const settingsPath = join(h.home, 'settings.json');
    const configPath = join(h.home, 'config.toml');
    const settings = Buffer.from('{\n  "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "echo existing"}]}]},\n  "theme": "dark"\n}\n');
    const config = Buffer.from('notify = ["node", "old-notify.js"]\nmodel = "fixture"\n');
    writeFileSync(settingsPath, settings);
    writeFileSync(configPath, config);
    const env = { ...h.env, METATROOPER_CLAUDE_SETTINGS: settingsPath, METATROOPER_CODEX_CONFIG: configPath };
    for (const args of [['hooks', 'install', '--yes'], ['hooks', 'install', '--codex', '--yes']]) {
      const result = await runNode(['core/cli.ts', ...args], env);
      assert.equal(result.code, 0, result.stderr);
    }
    const installed = JSON.parse(readFileSync(settingsPath, 'utf8'));
    for (const event of ['PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'Notification', 'Stop', 'SessionEnd']) {
      const groups = installed.hooks[event];
      assert.ok(Array.isArray(groups), event);
      const troop = groups.find(group => group.hooks?.some(hook => hook.command?.includes('event.js')));
      assert.ok(troop, event);
      assert.equal(Object.hasOwn(troop, 'matcher'), event === 'PreToolUse' || event === 'PostToolUse', event);
    }
    assert.deepEqual(installed.hooks.Stop[0], { hooks: [{ type: 'command', command: 'echo existing' }] });
    for (const args of [['hooks', 'uninstall', '--yes'], ['hooks', 'uninstall', '--codex', '--yes']]) {
      const result = await runNode(['core/cli.ts', ...args], env);
      assert.equal(result.code, 0, result.stderr);
    }
    assert.deepEqual(readFileSync(settingsPath), settings);
    assert.deepEqual(readFileSync(configPath), config);
  } finally { await h.teardown(); }
});

test('M2-06 a diff-line comment and a dropped-file comment reach a Claude session on its next prompt', async () => {
  const { diffLineBody, filesBody } = await import('../../workbench/src/comments.ts');
  const h = await fakeHarness();
  try {
    const sessionId = await launchFake(h);
    const store = db(h.home);
    try {
      const line = diffLineBody('c-line', 'rename this', 'src/app.js', 42, '+  const x = 1;');
      const files = filesBody('c-files', [String.raw`C:\Users\me\shot.png`, '/tmp/spec.md']);
      assert.equal(files, '[comment c-files] Files dropped for you:\n- C:/Users/me/shot.png\n- /tmp/spec.md');
      store.prepare('INSERT INTO comment (id, at, session_id, kind, body) VALUES (?, ?, ?, ?, ?)').run('c-line', new Date().toISOString(), sessionId, 'diff-line', line);
      store.prepare('INSERT INTO comment (id, at, session_id, kind, body) VALUES (?, ?, ?, ?, ?)').run('c-files', new Date().toISOString(), sessionId, 'file', files);
      const env = { ...h.env, TROOP_SESSION_ID: sessionId };
      const out = await runNode(['core/event.js', 'claude.UserPromptSubmit'], env, JSON.stringify({ session_id: 'native-1', cwd: h.home, prompt: 'go' }));
      assert.equal(out.code, 0);
      const context = JSON.parse(out.stdout).hookSpecificOutput.additionalContext;
      assert.ok(context.includes('[comment c-line] rename this\nFile: src/app.js:42\nLine: +  const x = 1;'), context);
      assert.ok(context.indexOf('c-line') < context.indexOf('c-files'), 'delivered in the order they were made');
      assert.ok(context.includes(files));
    } finally { store.close(); }
  } finally { await h.teardown(); }
});
