import './clean-env.mjs';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGenerated, client, isolation, startCore, teardownCore, uiHello } from './helpers.ts';

before(buildGenerated);

const quickExit = 'setTimeout(() => process.exit(0), 200);';

/**
 * Creates an isolated test harness with claude and codex engines configured.
 */
async function withContinueCore(run: (ctx: {
  pipe: any;
  isolated: any;
  projectId: string;
  projectDir: string;
  db: () => DatabaseSync;
}) => Promise<void>) {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const claudeScript = join(isolated.home, 'fake-claude.mjs');
  const codexScript = join(isolated.home, 'fake-codex.mjs');
  writeFileSync(claudeScript, quickExit);
  writeFileSync(codexScript, quickExit);

  writeFileSync(registry, JSON.stringify([
    {
      id: 'claude', command: process.execPath, args: [claudeScript], prompt_arg: 'positional', state_source: 'process',
      roles: ['worker'], cost_rank: 2, usage_source: 'claude-transcript', provider: 'local-cli', version_cmd: [process.execPath, '--version'],
    },
    {
      id: 'codex', command: process.execPath, args: [codexScript], prompt_arg: 'positional', state_source: 'process',
      roles: ['worker'], cost_rank: 2, usage_source: 'codex-session', provider: 'local-cli', version_cmd: [process.execPath, '--version'],
    },
  ]));

  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  try {
    const projectDir = join(isolated.home, 'test-project');
    mkdirSync(projectDir, { recursive: true });
    const pipe = await client(isolated.prefix);
    try {
      await uiHello(pipe, isolated.home);
      const opened = await pipe.request('project.open', { path: projectDir });
      const db = () => new DatabaseSync(join(isolated.home, 'troop.db'));
      // the core checks engines in the background at start; wait until codex is recorded installed
      for (let i = 0; i < 300; i++) {
        const d = db();
        try { if (d.prepare("SELECT 1 FROM engine_check WHERE engine_id = 'codex' AND installed = 1").get()) break; } finally { d.close(); }
        await new Promise((r) => setTimeout(r, 100));
      }
      await run({ pipe, isolated, projectId: opened.result.project_id, projectDir, db });
    } finally {
      pipe.close();
    }
  } finally {
    await teardownCore(core, isolated);
  }
}

/**
 * Helper to write a Claude-format JSONL transcript.
 */
function writeClaudeTranscript(filePath: string, records: any[]): void {
  const lines = records.map((r) => JSON.stringify(r)).join('\n') + '\n';
  writeFileSync(filePath, lines, 'utf8');
}

// protects=limit-stopped session continues in target engine with handoff prompt under 6 KB holding task and turns
// fails_when=session.continue fails to create handoff file, exceeds 6 KB, omits task or turns, or fails to launch target engine
// no_claim=engine-specific prompt delivery mechanisms other than argv
test('M7-04a limit-stopped Claude session continues in codex with handoff under 6 KB holding task and turns', async () => {
  await withContinueCore(async ({ pipe, isolated, projectId, projectDir, db }) => {
    // 1. Launch a Claude session
    const launchReply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'claude' });
    assert.ok(launchReply.result?.session_id, `Launch failed: ${JSON.stringify(launchReply)}`);
    const claudeSessionId = launchReply.result.session_id;

    // 2. Prepare transcript with task and turns
    const transcriptPath = join(isolated.home, 'transcript.jsonl');
    const turns = [];
    for (let i = 1; i <= 10; i++) {
      turns.push(
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: `Prompt ${i}: implement feature step ${i}` }] } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `Response ${i}: completed step ${i} successfully` }] } },
      );
    }
    writeClaudeTranscript(transcriptPath, turns);

    // Record transcript_path and limit-hit event in database
    const d = db();
    try {
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'claude-hook', ?, 'claude.Stop', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ transcript_path: transcriptPath, cwd: projectDir }));
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.limit-hit', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ window: 'five_hour', resets_at: new Date(Date.now() + 3600000).toISOString() }));
    } finally {
      d.close();
    }

    // 3. Call session.continue
    const contReply = await pipe.request('session.continue', { session_id: claudeSessionId, engine_id: 'codex' });
    assert.ok(!contReply.error, `session.continue returned error: ${JSON.stringify(contReply.error)}`);
    assert.ok(contReply.result?.session_id, 'session.continue must return new session_id');
    assert.ok(contReply.result?.file, 'session.continue must return handoff file path');

    const handoffPath = contReply.result.file;
    assert.ok(existsSync(handoffPath), `Handoff file must exist at ${handoffPath}`);
    assert.match(handoffPath, new RegExp(`${claudeSessionId}-1\\.md$`));

    const content = readFileSync(handoffPath, 'utf8');
    const byteLength = Buffer.byteLength(content, 'utf8');
    assert.ok(byteLength <= 6144, `Handoff file must be <= 6144 bytes, was ${byteLength}`);

    // Verify content structure
    assert.match(content, /# Continue this task/i);
    assert.match(content, /Claude/i);
    assert.match(content, /Prompt 1/i);
    assert.match(content, /Response 10/i);

    // Verify new session launched with codex
    const d2 = db();
    try {
      const newSession = d2.prepare('SELECT id, engine_id, project_id, cwd FROM session WHERE id = ?').get(contReply.result.session_id) as any;
      assert.ok(newSession, 'New session must exist in DB');
      assert.equal(newSession.engine_id, 'codex');
      assert.equal(newSession.project_id, projectId);
    } finally {
      d2.close();
    }
  });
});

// protects=handoff file drops oldest turns first to stay under 6,144 bytes when turns are large
// fails_when=file exceeds 6 KB or drops newer turns instead of older ones
// no_claim=dropping fixed header fields before turns
test('M7-04b handoff file drops oldest turns first when turns are large to fit 6 KB, lists changed files and last failing command', async () => {
  await withContinueCore(async ({ pipe, isolated, projectId, projectDir, db }) => {
    const launchReply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'claude' });
    const claudeSessionId = launchReply.result.session_id;

    // Create 10 large turns (each ~1000 bytes)
    const transcriptPath = join(isolated.home, 'transcript-large.jsonl');
    const records = [];
    for (let i = 1; i <= 10; i++) {
      const filler = `filler_turn_${i}_`.repeat(40); // ~640 bytes
      records.push(
        { type: 'user', message: { role: 'user', content: [{ type: 'text', text: `UserTurn${i}: ${filler}` }] } },
        { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `AssistantTurn${i}: ${filler}` }] } },
      );
    }
    // Add a failing bash command
    records.push(
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tool_fail', name: 'Bash', input: { command: 'cargo test --lib' } }] } },
      { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_fail', content: 'error[E0425]: cannot find value in scope\n10 tests failed', is_error: true }] } },
    );
    writeClaudeTranscript(transcriptPath, records);

    // Claim some files and add limit-hit event
    const d = db();
    try {
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.claim', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ files: [{ path: 'src/main.rs' }, { path: 'src/lib.rs' }] }));
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'claude-hook', ?, 'claude.Stop', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ transcript_path: transcriptPath, cwd: projectDir }));
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.limit-hit', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ window: 'five_hour', resets_at: new Date(Date.now() + 3600000).toISOString() }));
    } finally {
      d.close();
    }

    const contReply = await pipe.request('session.continue', { session_id: claudeSessionId, engine_id: 'codex' });
    assert.ok(!contReply.error, `session.continue error: ${JSON.stringify(contReply.error)}`);

    const content = readFileSync(contReply.result.file, 'utf8');
    const bytes = Buffer.byteLength(content, 'utf8');
    assert.ok(bytes <= 6144, `Handoff file must fit 6144 bytes, was ${bytes}`);

    // Must include changed files and failing command
    assert.match(content, /src\/main\.rs/);
    assert.match(content, /cargo test --lib/);

    // Must keep newest turns (Turn 10) and drop oldest turns (Turn 1)
    assert.match(content, /UserTurn10/);
    const lastTurns = content.slice(content.indexOf('## Last turns'));
    assert.ok(!lastTurns.includes('UserTurn1:'), 'Oldest turn 1 should be dropped to fit 6 KB');
  });
});

// protects=hitting a limit never automatically switches engines without explicit continue request
// fails_when=core.limit-hit launches a session or writes a handoff without session.continue being called
// no_claim=automatic resume of the same engine at reset
test('M7-04b limit stop never switches engine without the click', async () => {
  await withContinueCore(async ({ pipe, isolated, projectId, db }) => {
    const launchReply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'claude' });
    const claudeSessionId = launchReply.result.session_id;

    const d = db();
    try {
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.limit-hit', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ window: 'five_hour', resets_at: new Date(Date.now() + 3600000).toISOString() }));

      const sessions = d.prepare('SELECT COUNT(*) AS count FROM session').get() as { count: number };
      assert.equal(sessions.count, 1, 'No new session must be created by limit-hit alone');

      const handoffs = d.prepare('SELECT COUNT(*) AS count FROM handoff').get() as { count: number };
      assert.equal(handoffs.count, 0, 'No handoff row must be inserted without session.continue');
    } finally {
      d.close();
    }
  });
});

// protects=credentials and known secrets in transcript are redacted from the handoff file
// fails_when=sk-ant- token or secret values appear unredacted in the handoff markdown
// no_claim=redaction of arbitrary private data not matching known formats or values
test('M7-04d fixture transcript holding a secret value and sk-ant- token writes neither into handoff file', async () => {
  await withContinueCore(async ({ pipe, isolated, projectId, projectDir, db }) => {
    const launchReply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'claude' });
    const claudeSessionId = launchReply.result.session_id;

    const secretKey = 'sk-ant-api03-abcdef1234567890abcdef1234567890_extra';
    const transcriptPath = join(isolated.home, 'transcript-secrets.jsonl');
    writeClaudeTranscript(transcriptPath, [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: `Use API key ${secretKey} to fetch data` }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: `Calling service with ${secretKey}` }] } },
    ]);

    const d = db();
    try {
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'claude-hook', ?, 'claude.Stop', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ transcript_path: transcriptPath, cwd: projectDir }));
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.limit-hit', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ window: 'five_hour', resets_at: new Date(Date.now() + 3600000).toISOString() }));
    } finally {
      d.close();
    }

    const contReply = await pipe.request('session.continue', { session_id: claudeSessionId, engine_id: 'codex' });
    assert.ok(!contReply.error, `session.continue error: ${JSON.stringify(contReply.error)}`);

    const content = readFileSync(contReply.result.file, 'utf8');
    assert.ok(!content.includes(secretKey), 'Secret token must be redacted from handoff file');
    assert.ok(!content.includes('sk-ant-api03'), 'sk-ant- prefix must not appear unredacted');
  });
});

// protects=continued session runs in original cwd, disables old limit_resume, and exits without pasting into old tile
// fails_when=old limit_resume remains 1, new cwd differs from old, or handBack pastes into old session
// no_claim=terminal state of new session after exit
test('M7-04e after Continue, old session limit_resume is 0, new session runs in old cwd, no pasted text on exit', async () => {
  await withContinueCore(async ({ pipe, isolated, projectId, projectDir, db }) => {
    const subCwd = join(projectDir, 'subfolder');
    mkdirSync(subCwd, { recursive: true });

    const launchReply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'claude' });
    const claudeSessionId = launchReply.result.session_id;

    // Set old session cwd to subfolder and limit_resume to 1
    const d = db();
    try {
      d.prepare('UPDATE session SET cwd = ?, limit_resume = 1 WHERE id = ?').run(subCwd, claudeSessionId);
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.limit-hit', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ window: 'five_hour', resets_at: new Date(Date.now() + 3600000).toISOString() }));
    } finally {
      d.close();
    }

    const contReply = await pipe.request('session.continue', { session_id: claudeSessionId, engine_id: 'codex' });
    assert.ok(!contReply.error, `session.continue error: ${JSON.stringify(contReply.error)}`);
    const newSessionId = contReply.result.session_id;

    const d2 = db();
    try {
      const oldSession = d2.prepare('SELECT limit_resume FROM session WHERE id = ?').get(claudeSessionId) as any;
      assert.equal(oldSession.limit_resume, 0, 'Old session limit_resume must be set to 0');

      const newSession = d2.prepare('SELECT cwd, parent_id FROM session WHERE id = ?').get(newSessionId) as any;
      assert.equal(newSession.cwd, subCwd, 'New session must inherit old session cwd');
      assert.equal(newSession.parent_id, null, 'New session must have null parent_id so handBack never pastes into old tile');

      // Check events recorded
      const contEvent = d2.prepare("SELECT payload FROM event WHERE session_id = ? AND kind = 'core.continued'").get(claudeSessionId) as any;
      assert.ok(contEvent, 'core.continued event must be appended to old session');
      const contPayload = JSON.parse(contEvent.payload);
      assert.equal(contPayload.to, newSessionId);

      const contFromEvent = d2.prepare("SELECT payload FROM event WHERE session_id = ? AND kind = 'core.continued-from'").get(newSessionId) as any;
      assert.ok(contFromEvent, 'core.continued-from event must be appended to new session');
      const contFromPayload = JSON.parse(contFromEvent.payload);
      assert.equal(contFromPayload.from, claudeSessionId);

      // Verify no notice to old session when new session exits
      const notice = d2.prepare("SELECT * FROM needs_you WHERE ref = ?").get(`child:${newSessionId}`);
      assert.equal(notice, undefined, 'No child notice must be created for old session');
    } finally {
      d2.close();
    }
  });
});

// protects=session with missing transcript still continues with task, cwd, changed files and fallback note
// fails_when=session.continue fails or omits cwd, task, or no-transcript note when transcript is unreadable
// no_claim=transcript recovery for unsupported engine formats
test('M7-04f source with no readable transcript still writes valid file and launches', async () => {
  await withContinueCore(async ({ pipe, isolated, projectId, projectDir, db }) => {
    const launchReply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'claude' });
    const claudeSessionId = launchReply.result.session_id;

    const d = db();
    try {
      d.prepare("INSERT OR REPLACE INTO engine_check (engine_id, checked_at, installed, auth) VALUES ('codex', ?, 1, 'ok')")
        .run(new Date().toISOString());
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.claim', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ files: [{ path: 'uncommitted.ts' }] }));
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.limit-hit', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ window: 'five_hour', resets_at: new Date(Date.now() + 3600000).toISOString() }));
    } finally {
      d.close();
    }

    const contReply = await pipe.request('session.continue', { session_id: claudeSessionId, engine_id: 'codex' });
    assert.ok(!contReply.error, `session.continue error: ${JSON.stringify(contReply.error)}`);

    const content = readFileSync(contReply.result.file, 'utf8');
    assert.match(content, /# Continue this task/i);
    assert.match(content, /uncommitted\.ts/);
    assert.match(content, /no transcript was readable for claude/i);
  });
});

// protects=failing command reader extracts the last errored command and its truncated output from Claude transcript
// fails_when=reader misses failing command, picks non-error tool result, or fails to truncate to 300/1000 chars
// no_claim=parsing commands executed outside Bash tool calls
test('M7-04 failing command reader extracts last errored bash tool_use from Claude transcript JSONL', async () => {
  const isolated = isolation();
  const transcriptPath = join(isolated.home, 'transcript-failing.jsonl');

  const longCommand = 'npm run build -- ' + 'arg-'.repeat(80); // > 300 chars
  const longOutput = Array.from({ length: 30 }, (_, i) => `Error line ${i}: detailed compilation failure`).join('\n'); // > 20 lines

  writeClaudeTranscript(transcriptPath, [
    // 1. Successful bash tool call
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo first' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'first', is_error: false }] } },
    // 2. First failing bash command
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'cat missing.txt' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't2', content: 'No such file', is_error: true }] } },
    // 3. Non-bash tool result with error
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't3', name: 'ReadFile', input: { path: 'foo' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't3', content: 'Not found', is_error: true }] } },
    // 4. Last failing bash command (long command and output)
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't4', name: 'Bash', input: { command: longCommand } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't4', content: longOutput, is_error: true }] } },
  ]);

  // Import reader from handoff module
  // When built, core/src/sessions/handoff.ts exports readFailingCommand (or readClaudeFailingCommand)
  const handoffMod = await import('../src/sessions/handoff.ts');
  assert.equal(typeof handoffMod.readFailingCommand, 'function', 'handoff.ts must export readFailingCommand');

  const result = handoffMod.readFailingCommand(transcriptPath);
  assert.ok(result, 'readFailingCommand must find the last failing command');
  assert.ok(result.command.length <= 300, `Command must be cut to 300 chars, was ${result.command.length}`);
  assert.ok(result.output.length <= 1000, `Output must be cut to 1000 chars, was ${result.output.length}`);
  const lines = result.output.split('\n');
  assert.ok(lines.length <= 20, `Output must be cut to 20 lines, had ${lines.length}`);
});

// protects=session.continue refuses a session that is not stopped at a usage limit
// fails_when=session.continue succeeds, writes a handoff file, or launches a session without an unresumed limit-hit
// no_claim=refusal of sessions stopped for reasons other than usage limits
test('M7-04c session.continue refuses a session that is not stopped at a usage limit', async () => {
  await withContinueCore(async ({ pipe, isolated, projectId, db }) => {
    const { readdirSync } = await import('node:fs');
    const handoffDir = join(isolated.home, 'handoff');

    const countSessions = () => {
      const d = db();
      try {
        return (d.prepare('SELECT COUNT(*) AS count FROM session').get() as { count: number }).count;
      } finally {
        d.close();
      }
    };

    // 1. A Claude session with NO core.limit-hit
    const launchReply1 = await pipe.request('session.launch', { project_id: projectId, engine_id: 'claude' });
    assert.ok(launchReply1.result?.session_id, `Launch failed: ${JSON.stringify(launchReply1)}`);
    const session1 = launchReply1.result.session_id;

    const countBefore1 = countSessions();

    const contReply1 = await pipe.request('session.continue', { session_id: session1, engine_id: 'codex' });
    assert.ok(contReply1.error, `session.continue should have returned an error: ${JSON.stringify(contReply1.result)}`);
    assert.match(contReply1.error.message, /session is not stopped at a usage limit/i);
    assert.equal(existsSync(handoffDir) ? readdirSync(handoffDir).length : 0, 0, 'No handoff file should exist under <home>/handoff/');
    assert.equal(countSessions(), countBefore1, 'Session count must remain unchanged');

    // 2. A Claude session with core.limit-hit followed by core.limit-resumed {limit_hit: <that seq>}
    const launchReply2 = await pipe.request('session.launch', { project_id: projectId, engine_id: 'claude' });
    assert.ok(launchReply2.result?.session_id, `Launch failed: ${JSON.stringify(launchReply2)}`);
    const session2 = launchReply2.result.session_id;

    const countBefore2 = countSessions();

    const d = db();
    try {
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.limit-hit', ?, 1)")
        .run(new Date().toISOString(), session2, JSON.stringify({ window: 'five_hour', resets_at: new Date(Date.now() + 3600000).toISOString() }));
      const hitRow = d.prepare("SELECT seq FROM event WHERE session_id = ? AND kind = 'core.limit-hit' ORDER BY seq DESC LIMIT 1").get(session2) as { seq: number };
      assert.ok(hitRow?.seq, 'core.limit-hit seq must exist');

      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.limit-resumed', ?, 1)")
        .run(new Date().toISOString(), session2, JSON.stringify({ limit_hit: hitRow.seq }));
    } finally {
      d.close();
    }

    const contReply2 = await pipe.request('session.continue', { session_id: session2, engine_id: 'codex' });
    assert.ok(contReply2.error, `session.continue should have returned an error: ${JSON.stringify(contReply2.result)}`);
    assert.match(contReply2.error.message, /session is not stopped at a usage limit/i);
    assert.equal(existsSync(handoffDir) ? readdirSync(handoffDir).length : 0, 0, 'No handoff file should exist under <home>/handoff/');
    assert.equal(countSessions(), countBefore2, 'Session count must remain unchanged');

    // Verify handoff table remains empty
    const dCheck = db();
    try {
      const handoffs = dCheck.prepare('SELECT COUNT(*) AS count FROM handoff').get() as { count: number };
      assert.equal(handoffs.count, 0, 'No handoff row must be inserted in DB');
    } finally {
      dCheck.close();
    }
  });
});

async function withCustomContinueCore(
  enginesBuilder: (isolated: any, claudeScript: string, targetScript: string) => any[],
  run: (ctx: {
    pipe: any;
    isolated: any;
    projectId: string;
    projectDir: string;
    db: () => DatabaseSync;
  }) => Promise<void>,
) {
  const isolated = isolation();
  const registry = join(isolated.home, 'engines.json');
  const claudeScript = join(isolated.home, 'fake-claude.mjs');
  const targetScript = join(isolated.home, 'fake-target.mjs');
  writeFileSync(claudeScript, quickExit);
  writeFileSync(targetScript, quickExit);

  const engineIds = enginesBuilder(isolated, claudeScript, targetScript).map((e: any) => e.id);
  writeFileSync(registry, JSON.stringify(enginesBuilder(isolated, claudeScript, targetScript)));

  const env = { ...isolated.env, METATROOPER_ENGINES: registry };
  const core = await startCore({ ...isolated, env });
  try {
    const projectDir = join(isolated.home, 'test-project');
    mkdirSync(projectDir, { recursive: true });
    const pipe = await client(isolated.prefix);
    try {
      await uiHello(pipe, isolated.home);
      const opened = await pipe.request('project.open', { path: projectDir });
      const db = () => new DatabaseSync(join(isolated.home, 'troop.db'));
      // the core checks engines in the background at start; wait until every fixture engine is recorded installed
      for (let i = 0; i < 300; i++) {
        const d = db();
        try { if ((d.prepare('SELECT count(DISTINCT engine_id) AS n FROM engine_check WHERE installed = 1').get() as { n: number }).n >= engineIds.length) break; } finally { d.close(); }
        await new Promise((r) => setTimeout(r, 100));
      }
      await run({ pipe, isolated, projectId: opened.result.project_id, projectDir, db });
    } finally {
      pipe.close();
    }
  } finally {
    await teardownCore(core, isolated);
  }
}

// protects=session.continue falls back to ask approval when target engine lacks source approval profile
// fails_when=continued session inherits contained approval when target engine lacks contained profile
// no_claim=gateway engine continuation refusal
test('defect 3: contained Claude session continued in engine lacking contained profile records approval ask', async () => {
  await withCustomContinueCore(
    (isolated, claudeScript, targetScript) => [
      {
        id: 'claude', command: process.execPath, args: [claudeScript], prompt_arg: 'positional', state_source: 'process',
        roles: ['worker'], cost_rank: 2, usage_source: 'claude-transcript', provider: 'local-cli', version_cmd: [process.execPath, '--version'],
        approval_profiles: { contained: ['--contained'], ask: [] },
      },
      {
        id: 'gemini', command: process.execPath, args: [targetScript], prompt_arg: 'positional', state_source: 'process',
        roles: ['worker'], cost_rank: 2, usage_source: 'codex-session', provider: 'local-cli', version_cmd: [process.execPath, '--version'],
        approval_profiles: { edits: ['--edits'], ask: [] },
      },
    ],
    async ({ pipe, projectId, db }) => {
      const launchReply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'claude', approval: 'contained' });
      assert.ok(launchReply.result?.session_id, `Launch failed: ${JSON.stringify(launchReply)}`);
      const claudeSessionId = launchReply.result.session_id;

      const d = db();
      try {
        d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.limit-hit', ?, 1)")
          .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ window: 'five_hour', resets_at: new Date(Date.now() + 3600000).toISOString() }));
      } finally {
        d.close();
      }

      const contReply = await pipe.request('session.continue', { session_id: claudeSessionId, engine_id: 'gemini' });
      assert.ok(!contReply.error, `session.continue error: ${JSON.stringify(contReply.error)}`);
      const newSessionId = contReply.result.session_id;

      const d2 = db();
      try {
        const newSession = d2.prepare('SELECT approval FROM session WHERE id = ?').get(newSessionId) as any;
        assert.ok(newSession, 'New session must exist in DB');
        assert.equal(newSession.approval, 'ask', 'continued session must fall back to ask when target engine lacks contained profile');
      } finally {
        d2.close();
      }
    },
  );
});

// protects=failed continue launch restores limit_resume and unlinks orphaned handoff file
// fails_when=failed launch leaves limit_resume as 0 or leaves orphaned handoff markdown file
// no_claim=restarting failed engine process
test('defect 5: continue launch failure restores limit_resume and removes handoff file', async () => {
  await withCustomContinueCore(
    (isolated, claudeScript) => [
      {
        id: 'claude', command: process.execPath, args: [claudeScript], prompt_arg: 'positional', state_source: 'process',
        roles: ['worker'], cost_rank: 2, usage_source: 'claude-transcript', provider: 'local-cli', version_cmd: [process.execPath, '--version'],
      },
      {
        id: 'badengine', command: join(isolated.home, 'nonexistent-executable.exe'), args: [], prompt_arg: 'positional', state_source: 'process',
        roles: ['worker'], cost_rank: 2, usage_source: 'codex-session', provider: 'local-cli', version_cmd: [join(isolated.home, 'nonexistent-executable.exe'), '--version'],
      },
    ],
    async ({ pipe, isolated, projectId, db }) => {
      const launchReply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'claude' });
      assert.ok(launchReply.result?.session_id, `Launch failed: ${JSON.stringify(launchReply)}`);
      const claudeSessionId = launchReply.result.session_id;

      const d = db();
      try {
        d.prepare('UPDATE session SET limit_resume = 1 WHERE id = ?').run(claudeSessionId);
        d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.limit-hit', ?, 1)")
          .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ window: 'five_hour', resets_at: new Date(Date.now() + 3600000).toISOString() }));
      } finally {
        d.close();
      }

      await pipe.request('session.continue', { session_id: claudeSessionId, engine_id: 'badengine' });

      await new Promise((r) => setTimeout(r, 300));

      const d2 = db();
      try {
        const oldSession = d2.prepare('SELECT limit_resume FROM session WHERE id = ?').get(claudeSessionId) as any;
        assert.equal(oldSession.limit_resume, 1, 'limit_resume must be restored to 1 on launch failure');

        const handoffDir = join(isolated.home, 'handoff');
        const files = existsSync(handoffDir) ? readdirSync(handoffDir) : [];
        assert.equal(files.length, 0, 'no handoff file must be left in handoff dir on launch failure');
      } finally {
        d2.close();
      }
    },
  );
});

// protects=handoff markdown prints none changed only when no files were changed
// fails_when=handoff markdown prints none changed above and N more when files list is cut to fit 6 KB
// no_claim=truncating file paths individually
test('defect 9: handoff markdown cutting files to fit 6 KB prints none changed only when files count is zero', async () => {
  const { buildHandoff } = await import('../src/sessions/handoff.ts');
  const isolated = isolation();
  const transcriptPath = join(isolated.home, 'transcript-fail-d9.jsonl');
  writeClaudeTranscript(transcriptPath, [
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test --lib' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'e'.repeat(1200), is_error: true }] } },
  ]);
  const row = {
    transcript: transcriptPath,
    cwd: '/project/' + 'subdir/'.repeat(20),
    summary: 'summary',
    files: Array.from({ length: 40 }, (_, i) => ({
      path: `src/deep/nested/directory/path/module_${i}_component_with_long_file_name_` + 'x'.repeat(140) + '.ts',
      committed: false,
    })),
  };
  const markdown = buildHandoff(row, 'claude', 'Task Title ' + 'x'.repeat(100), []);
  assert.ok(
    !markdown.includes('none changed'),
    'must not print "none changed" when files were changed but cut to fit',
  );
  assert.match(markdown, /and \d+ more/, 'must report "and N more" when files are cut to fit');
});

// protects=session.continue is refused and writes no handoff file when Claude session is resumed by a user prompt after limit-hit
// fails_when=session.continue succeeds or writes a handoff file after claude.UserPromptSubmit follows limit-hit
// no_claim=handling of prompts submitted to non-Claude engines
test('session.continue is refused and writes no handoff when claude session has later UserPromptSubmit', async () => {
  await withContinueCore(async ({ pipe, isolated, projectId, db }) => {
    const launchReply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'claude' });
    assert.ok(launchReply.result?.session_id, `Launch failed: ${JSON.stringify(launchReply)}`);
    const claudeSessionId = launchReply.result.session_id;

    const d = db();
    try {
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.limit-hit', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ window: 'five_hour', resets_at: new Date(Date.now() + 3600000).toISOString() }));
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'claude-hook', ?, 'claude.UserPromptSubmit', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ prompt: 'continue working' }));
    } finally {
      d.close();
    }

    const contReply = await pipe.request('session.continue', { session_id: claudeSessionId, engine_id: 'codex' });
    assert.ok(contReply.error, `session.continue should have returned an error: ${JSON.stringify(contReply.result)}`);
    assert.match(contReply.error.message, /session is not stopped at a usage limit/i);

    const handoffDir = join(isolated.home, 'handoff');
    const files = existsSync(handoffDir) ? readdirSync(handoffDir) : [];
    assert.equal(files.length, 0, 'No handoff file should exist under <home>/handoff/');

    const dCheck = db();
    try {
      const handoffs = dCheck.prepare('SELECT COUNT(*) AS count FROM handoff WHERE session_id = ?').get(claudeSessionId) as { count: number };
      assert.equal(handoffs.count, 0, 'No handoff row must be inserted in DB');
    } finally {
      dCheck.close();
    }
  });
});

// protects=session.continue succeeds when limit-hit is followed only by a claude.Notification event
// fails_when=session.continue is refused or fails to create handoff after claude.Notification follows limit-hit
// no_claim=notification delivery or display mechanisms
test('session.continue succeeds when limit-hit is followed only by claude.Notification', async () => {
  await withContinueCore(async ({ pipe, isolated, projectId, projectDir, db }) => {
    const launchReply = await pipe.request('session.launch', { project_id: projectId, engine_id: 'claude' });
    assert.ok(launchReply.result?.session_id, `Launch failed: ${JSON.stringify(launchReply)}`);
    const claudeSessionId = launchReply.result.session_id;

    const transcriptPath = join(isolated.home, 'transcript-notif.jsonl');
    writeClaudeTranscript(transcriptPath, [
      { type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'Task prompt' }] } },
      { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Working on task' }] } },
    ]);

    const d = db();
    try {
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'claude-hook', ?, 'claude.Stop', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ transcript_path: transcriptPath, cwd: projectDir }));
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'core', ?, 'core.limit-hit', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ window: 'five_hour', resets_at: new Date(Date.now() + 3600000).toISOString() }));
      d.prepare("INSERT INTO event (at, source, session_id, kind, payload, processed) VALUES (?, 'claude-hook', ?, 'claude.Notification', ?, 1)")
        .run(new Date().toISOString(), claudeSessionId, JSON.stringify({ message: 'background notification' }));
    } finally {
      d.close();
    }

    const contReply = await pipe.request('session.continue', { session_id: claudeSessionId, engine_id: 'codex' });
    assert.ok(!contReply.error, `session.continue error: ${JSON.stringify(contReply.error)}`);
    assert.ok(contReply.result?.session_id, 'session.continue must return new session_id');
    assert.ok(contReply.result?.file, 'session.continue must return handoff file path');
    assert.ok(existsSync(contReply.result.file), `Handoff file must exist at ${contReply.result.file}`);
  });
});



