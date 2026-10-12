import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { actionHash, riskReason, Approvals } from '../src/approvals.ts';
import { looksLikeCredential, redactCredentials } from '../src/redact.ts';
import { isolation, startCore, teardownCore, client, uiHello, until } from './helpers.ts';

test('action hash matches contract vectors and handles text sha256 and key order', () => {
  // Vector 1 from contracts/approvals.md
  const vec1 = {
    action: 'type',
    args: { pane_id: 'bp_agent_1', ref: 'e7', text: 'hunter2' },
    control: { role: 'textbox', name: 'Password', automation_id: 'pw' },
    session_id: 's_01J0000000000000000000000',
    surface: 'browser',
    target: 'http://127.0.0.1:5173',
  };
  const expectedHash1 = '2bc66d4862c28c52d492ee0ef5c8f4ca335a0ada3b0bf7d05ad0fc69e9067380';
  assert.equal(actionHash(vec1), expectedHash1);

  // Vector 2 from contracts/approvals.md
  const vec2 = {
    action: 'click',
    args: { ref: 'e3' },
    control: null,
    session_id: 's1',
    surface: 'browser',
    target: 'https://example.com',
  };
  const expectedHash2 = 'c404f4dab0098ef9509fe95259dedae2df269451201bd44cadeea770ac326d0c';
  assert.equal(actionHash(vec2), expectedHash2);

  // Text differs produces different hash
  const vec1Diff = { ...vec1, args: { ...vec1.args, text: 'hunter3' } };
  assert.notEqual(actionHash(vec1Diff), expectedHash1);

  // Key order differences produce identical hash
  const vec1Reordered = {
    target: vec1.target,
    surface: vec1.surface,
    session_id: vec1.session_id,
    control: { automation_id: 'pw', role: 'textbox', name: 'Password' },
    args: { text: 'hunter2', ref: 'e7', pane_id: 'bp_agent_1' },
    action: vec1.action,
  };
  assert.equal(actionHash(vec1Reordered), expectedHash1);
});

test('rule table matches risky actions and allows safe actions', () => {
  const base = { session_id: 's1', surface: 'browser', target: 'http://127.0.0.1', args: {} };

  // Send button click asks
  assert.ok(riskReason({ ...base, action: 'click', control: { name: 'Send', automation_id: '', role: 'button' } }));

  // sendButton automation_id asks
  assert.ok(riskReason({ ...base, action: 'click', control: { name: '', automation_id: 'sendButton', role: 'button' } }));

  // Send2 style name does not ask
  assert.equal(riskReason({ ...base, action: 'click', control: { name: 'Send2', automation_id: '', role: 'button' } }), null);

  // Sender info style name does not ask
  assert.equal(riskReason({ ...base, action: 'click', control: { name: 'Sender info', automation_id: '', role: 'button' } }), null);

  // Tab key on Send button is allowed
  assert.equal(riskReason({ ...base, action: 'key', args: { keys: 'Tab' }, control: { name: 'Send', automation_id: '', role: 'button' } }), null);

  // Enter key on Send button asks
  assert.ok(riskReason({ ...base, action: 'key', args: { keys: 'Enter' }, control: { name: 'Send', automation_id: '', role: 'button' } }));

  // Space key on Send button asks
  assert.ok(riskReason({ ...base, action: 'key', args: { keys: 'Space' }, control: { name: 'Send', automation_id: '', role: 'button' } }));

  // Control+Enter key chord on Send button asks
  assert.ok(riskReason({ ...base, action: 'key', args: { keys: 'Control+Enter' }, control: { name: 'Send', automation_id: '', role: 'button' } }));

  // Enter key on a plain button is allowed
  assert.equal(riskReason({ ...base, action: 'key', args: { keys: 'Enter' }, control: { name: 'Plain Button', automation_id: 'btn', role: 'button' } }), null);

  // Type into password field asks
  assert.equal(riskReason({ ...base, action: 'type', args: { text: 'hunter2' }, password: true, control: { name: 'Password', automation_id: 'pw', role: 'textbox' } }), 'password field');

  // Type of ghp_ token into Notes asks
  const ghpToken = 'ghp_' + 'A'.repeat(36);
  assert.equal(riskReason({ ...base, action: 'type', args: { text: ghpToken }, control: { name: 'Notes', automation_id: 'notes', role: 'textbox' } }), 'credential text');

  // Type into API key field asks
  assert.equal(riskReason({ ...base, action: 'type', args: { text: 'my-value' }, control: { name: 'API key', automation_id: 'api_key', role: 'textbox' } }), 'credential field');

  // Plain text into Notes is allowed
  assert.equal(riskReason({ ...base, action: 'type', args: { text: 'plain notes text' }, control: { name: 'Notes', automation_id: 'notes', role: 'textbox' } }), null);

  // File dialog asks
  assert.equal(riskReason({ ...base, surface: 'desktop', action: 'click', file_dialog: true, control: null }), 'file dialog');
});

test('M6-02a: Send click creates waiting approval and needs_you, rejecting resolves both', async () => {
  const iso = isolation();
  const core = await startCore(iso);
  const pipes: Array<{ close: () => void }> = [];
  let db: DatabaseSync | null = null;
  try {
    const pipe = await client(iso.prefix);
    pipes.push(pipe);

    db = new DatabaseSync(join(iso.home, 'troop.db'));
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF');
    const now = new Date().toISOString();
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
    db.prepare(`
      INSERT INTO session (id, project_id, engine_id, host, state, state_at, hidden, started_at)
      VALUES ('s1', 'p1', 'fake', 'pty', 'working', ?, 0, ?)
    `).run(now, now);

    let checkReplied = false;
    const checkPromise = pipe.request('approval.check', {
      session_id: 's1',
      surface: 'browser',
      target: 'http://127.0.0.1:8080',
      action: 'click',
      args: {},
      control: { automation_id: 'send_btn', name: 'Send', role: 'button' },
    }, { timeout: 15_000 }).then((r) => {
      checkReplied = true;
      return r;
    });

    // Wait until approval row appears in database
    const approval = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 5000);

    assert.ok(approval);
    assert.equal(checkReplied, false);

    // Verify exactly one waiting approval and one open needs_you row
    const waitingApprovals = db.prepare("SELECT * FROM approval WHERE status = 'waiting'").all();
    const openNeedsYou = db.prepare("SELECT * FROM needs_you WHERE kind = 'approval' AND resolved_at IS NULL").all() as any[];

    assert.equal(waitingApprovals.length, 1);
    assert.equal(openNeedsYou.length, 1);
    assert.equal(openNeedsYou[0].ref, approval.id);

    // Resolve as reject over a ui.hello connection
    const uiPipe = await client(iso.prefix);
    pipes.push(uiPipe);
    await uiHello(uiPipe, iso.home);
    const resolveReply = await uiPipe.request('approval.resolve', { approval_id: approval.id, decision: 'reject' });
    assert.deepEqual(resolveReply.result, { status: 'rejected', scope: 'once' });

    const checkReply = await checkPromise;
    assert.deepEqual(checkReply.result, { decision: 'rejected', approval_id: approval.id });

    // Verify needs_you row is resolved
    const resolvedNeedsYou = db.prepare("SELECT resolved_at FROM needs_you WHERE kind = 'approval' AND ref = ?").get(approval.id) as any;
    assert.ok(resolvedNeedsYou.resolved_at);
  } finally {
    for (const p of pipes) {
      try { p.close(); } catch {}
    }
    try { db?.close(); } catch {}
    await teardownCore(core, iso);
  }
});

test('M6-02c: resolve without ui.hello, resolve twice, unknown id, and 120s expiry', async () => {
  const iso = isolation();
  const core = await startCore(iso);
  const pipes: Array<{ close: () => void }> = [];
  let db: DatabaseSync | null = null;
  try {
    const pipe = await client(iso.prefix);
    pipes.push(pipe);

    db = new DatabaseSync(join(iso.home, 'troop.db'));
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF');
    const now = new Date().toISOString();
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
    db.prepare(`
      INSERT INTO session (id, project_id, engine_id, host, state, state_at, hidden, started_at)
      VALUES ('s1', 'p1', 'fake', 'pty', 'working', ?, 0, ?)
    `).run(now, now);

    // Start a waiting approval
    const checkPromise = pipe.request('approval.check', {
      session_id: 's1',
      surface: 'browser',
      target: 'http://127.0.0.1:8080',
      action: 'click',
      args: {},
      control: { automation_id: 'send_btn', name: 'Send', role: 'button' },
    }, { timeout: 15_000 });

    const approval = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 5000);

    // Resolve without ui.hello returns -32012
    const unauthedPipe = await client(iso.prefix);
    pipes.push(unauthedPipe);
    const noHelloReply = await unauthedPipe.request('approval.resolve', { approval_id: approval.id, decision: 'approve' });
    assert.equal(noHelloReply.error?.code, -32012);

    // Authenticated pipe
    const uiPipe = await client(iso.prefix);
    pipes.push(uiPipe);
    await uiHello(uiPipe, iso.home);

    // Resolve unknown id returns -32002
    const unknownReply = await uiPipe.request('approval.resolve', { approval_id: 'ap_nonexistent', decision: 'approve' });
    assert.equal(unknownReply.error?.code, -32002);

    // First resolve succeeds
    const firstResolve = await uiPipe.request('approval.resolve', { approval_id: approval.id, decision: 'approve' });
    assert.deepEqual(firstResolve.result, { status: 'approved', scope: 'once' });

    // Resolve twice returns -32010
    const secondResolve = await uiPipe.request('approval.resolve', { approval_id: approval.id, decision: 'approve' });
    assert.equal(secondResolve.error?.code, -32010);

    await checkPromise;
  } finally {
    for (const p of pipes) {
      try { p.close(); } catch {}
    }
    try { db?.close(); } catch {}
    await teardownCore(core, iso);
  }

  // Construct Approvals directly with a short timeoutMs for expiry test
  const memDb = new DatabaseSync(':memory:');
  try {
    memDb.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, ended_at TEXT);
      CREATE TABLE approval (id TEXT PRIMARY KEY, session_id TEXT, surface TEXT, target TEXT, control TEXT, action TEXT, action_hash TEXT, summary TEXT, reason TEXT, status TEXT, scope TEXT, created_at TEXT, decided_at TEXT);
      CREATE TABLE needs_you (id TEXT PRIMARY KEY, at TEXT, kind TEXT, ref TEXT, text TEXT, resolved_at TEXT);
    `);
    memDb.prepare("INSERT INTO session (id) VALUES ('s_exp')").run();

    const shortTimeoutApprovals = new Approvals(memDb, 50);
    const expiryDecision = await shortTimeoutApprovals.check({
      session_id: 's_exp',
      surface: 'browser',
      target: 'http://127.0.0.1:8080',
      action: 'click',
      args: {},
      control: { automation_id: 'send_btn', name: 'Send', role: 'button' },
    });

    assert.equal(expiryDecision.decision, 'expired');
    if ('approval_id' in expiryDecision) {
      const row = memDb.prepare("SELECT status FROM approval WHERE id = ?").get(expiryDecision.approval_id) as any;
      assert.equal(row.status, 'expired');
    }
  } finally {
    memDb.close();
  }
});

test('M6-02d: session scope allows second check, renamed control asks, password field asks every time', async () => {
  const iso = isolation();
  const core = await startCore(iso);
  const pipes: Array<{ close: () => void }> = [];
  let db: DatabaseSync | null = null;
  try {
    const pipe = await client(iso.prefix);
    pipes.push(pipe);

    db = new DatabaseSync(join(iso.home, 'troop.db'));
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF');
    const now = new Date().toISOString();
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
    db.prepare(`
      INSERT INTO session (id, project_id, engine_id, host, state, state_at, hidden, started_at)
      VALUES ('s1', 'p1', 'fake', 'pty', 'working', ?, 0, ?)
    `).run(now, now);

    const uiPipe = await client(iso.prefix);
    pipes.push(uiPipe);
    await uiHello(uiPipe, iso.home);

    const sendParams = {
      session_id: 's1',
      surface: 'browser',
      target: 'http://127.0.0.1:8080',
      action: 'click',
      args: {},
      control: { automation_id: 'send_btn', name: 'Send', role: 'button' },
    };

    // First check asks
    const check1Promise = pipe.request('approval.check', sendParams, { timeout: 15_000 });
    const approval1 = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 5000);

    // Approve with scope session
    const res1 = await uiPipe.request('approval.resolve', { approval_id: approval1.id, decision: 'approve', scope: 'session' });
    assert.deepEqual(res1.result, { status: 'approved', scope: 'session' });
    await check1Promise;

    // Check count of approval rows
    const countAfterFirst = db.prepare("SELECT count(*) as count FROM approval").get() as any;

    // Second identical check replies allow immediately and row count is unchanged
    const check2Reply = await pipe.request('approval.check', sendParams);
    assert.deepEqual(check2Reply.result, { decision: 'allow' });

    const countAfterSecond = db.prepare("SELECT count(*) as count FROM approval").get() as any;
    assert.equal(countAfterSecond.count, countAfterFirst.count);

    // Renamed control asks again
    const renamedParams = {
      ...sendParams,
      control: { automation_id: 'send_btn', name: 'Submit', role: 'button' },
    };
    const renamedPromise = pipe.request('approval.check', renamedParams, { timeout: 15_000 });
    const approvalRenamed = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 5000);
    assert.ok(approvalRenamed);
    await uiPipe.request('approval.resolve', { approval_id: approvalRenamed.id, decision: 'approve' });
    await renamedPromise;

    // Password field check asks and is stored as once even when session is requested
    const pwParams = {
      session_id: 's1',
      surface: 'browser',
      target: 'http://127.0.0.1:8080',
      action: 'type',
      args: { text: 'secretpass' },
      password: true,
      control: { automation_id: 'pw', name: 'Password', role: 'textbox' },
    };
    const pw1Promise = pipe.request('approval.check', pwParams, { timeout: 15_000 });
    const approvalPw1 = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 5000);

    const resolvePw1 = await uiPipe.request('approval.resolve', { approval_id: approvalPw1.id, decision: 'approve', scope: 'session' });
    assert.deepEqual(resolvePw1.result, { status: 'approved', scope: 'once' });
    await pw1Promise;

    // Second password check asks again
    const pw2Promise = pipe.request('approval.check', pwParams, { timeout: 15_000 });
    const approvalPw2 = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 5000);
    assert.ok(approvalPw2);
    await uiPipe.request('approval.resolve', { approval_id: approvalPw2.id, decision: 'approve' });
    await pw2Promise;
  } finally {
    for (const p of pipes) {
      try { p.close(); } catch {}
    }
    try { db?.close(); } catch {}
    await teardownCore(core, iso);
  }
});

test('M6-02e: MCP action_hash is accepted, tampered action_hash returns -32602', async () => {
  const iso = isolation();
  const core = await startCore(iso);
  const pipes: Array<{ close: () => void }> = [];
  let db: DatabaseSync | null = null;
  try {
    const pipe = await client(iso.prefix);
    pipes.push(pipe);

    db = new DatabaseSync(join(iso.home, 'troop.db'));
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF');
    const now = new Date().toISOString();
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
    db.prepare(`
      INSERT INTO session (id, project_id, engine_id, host, state, state_at, hidden, started_at)
      VALUES ('s1', 'p1', 'fake', 'pty', 'working', ?, 0, ?)
    `).run(now, now);

    const uiPipe = await client(iso.prefix);
    pipes.push(uiPipe);
    await uiHello(uiPipe, iso.home);

    const check = {
      session_id: 's1',
      surface: 'browser',
      target: 'http://127.0.0.1:8080',
      action: 'click',
      args: { ref: 'e1' },
      control: { automation_id: 'btn1', name: 'Send', role: 'button' },
    };
    const validHash = actionHash(check);

    // Accepted hash
    const validPromise = pipe.request('approval.check', { ...check, action_hash: validHash }, { timeout: 15_000 });
    const approval = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 5000);
    assert.ok(approval);
    assert.equal(approval.action_hash, validHash);
    await uiPipe.request('approval.resolve', { approval_id: approval.id, decision: 'approve' });
    await validPromise;

    // Tampered hash gets -32602
    const tamperedReply = await pipe.request('approval.check', { ...check, action_hash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' });
    assert.equal(tamperedReply.error?.code, -32602);
  } finally {
    for (const p of pipes) {
      try { p.close(); } catch {}
    }
    try { db?.close(); } catch {}
    await teardownCore(core, iso);
  }
});

test('startup: waiting row present when Approvals is constructed becomes expired', () => {
  const memDb = new DatabaseSync(':memory:');
  try {
    memDb.exec(`
      CREATE TABLE session (id TEXT PRIMARY KEY, ended_at TEXT);
      CREATE TABLE approval (id TEXT PRIMARY KEY, session_id TEXT, surface TEXT, target TEXT, control TEXT, action TEXT, action_hash TEXT, summary TEXT, reason TEXT, status TEXT, scope TEXT, created_at TEXT, decided_at TEXT);
      CREATE TABLE needs_you (id TEXT PRIMARY KEY, at TEXT, kind TEXT, ref TEXT, text TEXT, resolved_at TEXT);
    `);
    memDb.prepare("INSERT INTO session (id) VALUES ('s1')").run();
    memDb.prepare(`
      INSERT INTO approval (id, session_id, surface, target, control, action, action_hash, summary, reason, status, created_at)
      VALUES ('ap_stale', 's1', 'browser', 'http://127.0.0.1', null, 'click', 'hash', 'summary', 'risky control: Send', 'waiting', '2026-10-11T00:00:00Z')
    `).run();
    memDb.prepare("INSERT INTO needs_you (id, at, kind, ref, text) VALUES ('ny_stale', '2026-10-11T00:00:00Z', 'approval', 'ap_stale', 'summary')").run();

    // Construct Approvals
    new Approvals(memDb);

    const row = memDb.prepare("SELECT status, decided_at FROM approval WHERE id = 'ap_stale'").get() as any;
    assert.equal(row.status, 'expired');
    assert.ok(row.decided_at);

    const ny = memDb.prepare("SELECT resolved_at FROM needs_you WHERE ref = 'ap_stale'").get() as any;
    assert.ok(ny.resolved_at);
  } finally {
    memDb.close();
  }
});

test('typed text never appears in approval, needs_you or command rows', async () => {
  const iso = isolation();
  const core = await startCore(iso);
  const pipes: Array<{ close: () => void }> = [];
  let db: DatabaseSync | null = null;
  try {
    const pipe = await client(iso.prefix);
    pipes.push(pipe);

    db = new DatabaseSync(join(iso.home, 'troop.db'));
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = OFF');
    const now = new Date().toISOString();
    db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('p1', '/p1', 'p1', ?, ?)").run(now, now);
    db.prepare(`
      INSERT INTO session (id, project_id, engine_id, host, state, state_at, hidden, started_at)
      VALUES ('s1', 'p1', 'fake', 'pty', 'working', ?, 0, ?)
    `).run(now, now);

    const uiPipe = await client(iso.prefix);
    pipes.push(uiPipe);
    await uiHello(uiPipe, iso.home);

    const secretMarker = 'MARKER_TOP_SECRET_PHRASE_98765';
    const typePromise = pipe.request('approval.check', {
      session_id: 's1',
      surface: 'browser',
      target: 'http://127.0.0.1:8080/login',
      action: 'type',
      args: { ref: 'e2', text: secretMarker },
      password: true,
      control: { automation_id: 'pw', name: 'Password', role: 'textbox' },
    }, { timeout: 15_000 });

    const approval = await until(() => {
      return db!.prepare("SELECT * FROM approval WHERE status = 'waiting'").get() as any;
    }, 5000);

    await uiPipe.request('approval.resolve', { approval_id: approval.id, decision: 'reject' });
    await typePromise;

    // Scan approval, needs_you, and command tables
    const approvalRows = db.prepare("SELECT * FROM approval").all();
    const needsYouRows = db.prepare("SELECT * FROM needs_you").all();
    let commandRows: any[] = [];
    try { commandRows = db.prepare("SELECT * FROM command").all(); } catch {}

    const allDump = JSON.stringify({ approvalRows, needsYouRows, commandRows });
    assert.equal(allDump.includes(secretMarker), false);
  } finally {
    for (const p of pipes) {
      try { p.close(); } catch {}
    }
    try { db?.close(); } catch {}
    await teardownCore(core, iso);
  }
});

test('a long token-character run is checked in linear time and a mixed-case run is still a credential', () => {
  const start = Date.now();
  for (const run of ['a'.repeat(100_000), 'eyJ'.repeat(33_000), 'ghp_'.repeat(25_000)]) {
    assert.equal(looksLikeCredential(run), false);
    assert.equal(redactCredentials(run), run);
  }
  assert.ok(Date.now() - start < 500, `took ${Date.now() - start} ms`);
  const secret = 'Ab1' + 'x'.repeat(29);
  assert.equal(looksLikeCredential(`token ${secret} here`), true);
  assert.equal(redactCredentials(`token ${secret} here`), 'token [secret] here');
  assert.equal(looksLikeCredential('Ab1' + 'x'.repeat(28)), false);
});
