import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('M6-09 last_tool is cleared once the tool finishes or the turn ends, so a later bell or input wait is not shown as its permission prompt', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-waitreason-'));
  const prev = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE, METATROOPER_HOME: process.env.METATROOPER_HOME };
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.METATROOPER_HOME = path.join(home, 'mt');
  const { openCoreDb } = await import('../src/store/db.ts');
  const { syncEngines, BUILT_IN } = await import('../src/engines/registry.ts');
  const { processEvents } = await import('../src/events/processor.ts');
  const db = openCoreDb();
  try {
    syncEngines(db, BUILT_IN);
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p', ?, 'p', 'x', 'x')").run(home);
    db.prepare("INSERT INTO session (id, project_id, engine_id, host, native_id, state, state_at, started_at) VALUES ('w1', 'p', 'claude', 'pty', 'conv', 'starting', 'x', 'x')").run();
    const add = db.prepare("INSERT INTO event (at, source, session_id, kind, payload) VALUES ('x', 'claude-hook', 'w1', ?, ?)");
    const row = () => ({ ...(db.prepare("SELECT state, last_tool FROM session WHERE id = 'w1'").get() as object) });
    const send = (kind: string, payload: Record<string, unknown> = {}) => { add.run(kind, JSON.stringify({ session_id: 'conv', ...payload })); processEvents(db); return row(); };

    send('claude.UserPromptSubmit');
    assert.deepEqual(send('claude.PreToolUse', { tool_name: 'Bash' }), { state: 'working', last_tool: 'Bash' });
    assert.deepEqual(send('claude.Notification', { class: 'permission' }), { state: 'waiting_for_you', last_tool: 'Bash' });
    assert.deepEqual(send('claude.PostToolUse', { tool_name: 'Bash' }), { state: 'working', last_tool: null });
    assert.deepEqual(send('term.bell'), { state: 'waiting_for_you', last_tool: null });

    send('claude.PreToolUse', { tool_name: 'Edit' });
    assert.deepEqual(send('claude.Stop'), { state: 'done', last_tool: null });
    assert.deepEqual(send('claude.PreToolUse', { tool_name: 'Read' }), { state: 'done', last_tool: null }, 'a phantom PreToolUse after Stop names no tool');
    send('claude.UserPromptSubmit');
    send('claude.PreToolUse', { tool_name: 'Grep' });
    assert.deepEqual(send('claude.UserPromptSubmit'), { state: 'working', last_tool: null }, 'an interrupted tool does not outlive the next prompt');
  } finally {
    db.close();
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
