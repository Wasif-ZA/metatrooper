import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import http from 'node:http';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, root, until } from './helpers.ts';
import { revisionHarness } from './ui-revision-helpers.ts';
import { capturingEngine } from './pipeline-fixup-helpers.ts';

before(buildGenerated);

type Harness = Awaited<ReturnType<typeof revisionHarness>>;

function builtin(id: string, fake: Record<string, unknown>) {
  const def = JSON.parse(readFileSync(join(root, `pipelines/${id}.json`), 'utf8'));
  for (const step of def.steps) {
    if (step.kind !== 'agent') continue;
    step.engine = 'fake';
    step.prompt = `FAKE ${JSON.stringify(fake[step.id] ?? { outputs: { summary: step.id } })}\n${step.prompt}`;
    if (step.dev_command) step.dev_command = `"${process.execPath}" -e "require('http').createServer((q,s)=>s.end('ok')).listen({{port}})"`;
  }
  return def;
}

const steps = (h: Harness, runId: string) =>
  h.db.prepare('SELECT step_id, status FROM run_step WHERE run_id = ? ORDER BY rowid').all(runId).map((r: any) => `${r.step_id}:${r.status}`);

async function close(h: Harness) {
  try { await h.close(); } catch (error: any) { if (error?.code !== 'EPERM') throw error; }
}

test('M3-01 data-to-dashboard loads the CSV, runs every step and stops at the signoff gate', async () => {
  const h = await revisionHarness(undefined, capturingEngine);
  try {
    const csv = join(h.project, 'orders.csv');
    copyFileSync(join(root, 'tests/fixtures/data-to-dashboard/input/orders.csv'), csv);
    const def = builtin('data-to-dashboard', {
      clean: { outputs: { table: 'clean', rows: 19 } },
      qa: { outputs: { passed: true } },
      readback: { outputs: { verdict: 'pass' } },
    });
    const runId = await h.pipeline(def, { csv });
    const gate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'signoff' AND status = 'waiting'").get(runId), 60000);
    assert.equal(gate.kind, 'handoff');
    assert.equal((h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status, 'paused');
    assert.deepEqual(steps(h, runId).filter((s) => !s.startsWith('signoff')), ['load', 'clean', 'qa', 'plan', 'build', 'readback', 'narrate'].map((s) => `${s}:done`));
    const load = JSON.parse((h.db.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'load'").get(runId) as any).outputs);
    const [header, ...body] = readFileSync(csv, 'utf8').trim().split(/\r?\n/);
    assert.equal(load.rows, body.length);
    assert.deepEqual(load.columns, header.split(','));
    const data = new DatabaseSync(load.db, { readOnly: true });
    try { assert.equal((data.prepare('SELECT COUNT(*) n FROM raw').get() as any).n, body.length); } finally { data.close(); }
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined })).result, {});
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status === 'done', 30000);
  } finally { await close(h); }
});

async function research(report: string) {
  const h = await revisionHarness(undefined, capturingEngine);
  const def = builtin('deep-research-cited', {
    decompose: { outputs: { summary: 'six items' }, run_files: { 'plan.md': 'search: green roof indoor temperature' } },
    draft: { outputs: { document: 'report.md', sources: '[]' }, run_files: { 'report.md': report } },
    critics: { outputs: { findings: 'critics.json' } },
  });
  // The search action needs Exa over the network, so a fake step stands in; the fixture sources are copied in at the plan gate.
  def.steps[def.steps.findIndex((s: any) => s.id === 'sweep')] = { id: 'sweep', title: 'Search and save sources', role: 'research', kind: 'agent', engine: 'fake', approval: 'edits', outputs: ['count'], prompt: 'FAKE {"outputs":{"count":2}}\nSearch.' };
  try {
    const question = readFileSync(join(root, 'tests/fixtures/deep-research-cited/input/question.md'), 'utf8').trim();
    const runId = await h.pipeline(def, { question });
    const gate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve-plan' AND status = 'waiting'").get(runId), 60000);
    const runDir = (h.db.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId) as any).run_dir;
    assert.equal(gate.kind, 'approve');
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'sweep' AND status <> 'pending'").get(runId) as any).n, 0);
    cpSync(join(root, 'tests/fixtures/deep-research-cited/input/sources'), join(runDir, 'sources'), { recursive: true });
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined })).result, {});
    return { h, runId, runDir };
  } catch (error) { await close(h); throw error; }
}

const realQuotes = '# Green roofs\n\nIn one trial "the green roof reduced peak indoor temperature by 2.1 degrees on the top floor" [s01]. A review found "the largest effects in buildings that had little or no roof insulation" [s02].\n';

test('M3-01 deep-research-cited stops at the plan gate, then cite-check passes a report quoting the fixture sources', async () => {
  const { h, runId } = await research(realQuotes);
  try {
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status === 'done', 60000);
    const check = JSON.parse((h.db.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'cite-check' ORDER BY iteration DESC").get(runId) as any).outputs);
    assert.deepEqual([check.passed, check.claims_total, check.bound], [true, 2, 2]);
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'depth' AND status = 'done'").get(runId) as any).n, 4);
  } finally { await close(h); }
});

test('M3-01 deep-research-cited pauses at loop-max when a planted quote is not in its source', async () => {
  const { h, runId } = await research(realQuotes.replace('by 2.1 degrees', 'by 6 degrees'));
  try {
    await until(() => h.db.prepare("SELECT 1 FROM run WHERE id = ? AND status = 'paused' AND paused_why = 'loop-max'").get(runId), 60000);
    const check = JSON.parse((h.db.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'cite-check' ORDER BY iteration DESC").get(runId) as any).outputs);
    assert.equal(check.passed, false);
    assert.deepEqual(check.unbound.map((u: any) => u.reason.split(':')[0]), ['quote not found in s01']);
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'cite-check'").get(runId) as any).n, 2);
  } finally { await close(h); }
});

test('M3-01 study-notes-to-pdf reads the fixture lecture, exports a real PDF and stops at the signoff gate', async () => {
  const h = await revisionHarness(undefined, capturingEngine);
  try {
    const lecture = join(h.project, 'lecture.pdf');
    copyFileSync(join(root, 'tests/fixtures/study-notes-to-pdf/input/lecture.pdf'), lecture);
    const def = builtin('study-notes-to-pdf', {
      notes: { outputs: { summary: 'notes' }, run_files: { 'notes.md': '# Hash tables\n\n- Load factor is entries over buckets (p.3).\n', 'print.css': 'body { font: 11pt serif; }' } },
      check: { outputs: { passed: true, unsourced: 0 } },
      proof: { outputs: { passed: true } },
    });
    const runId = await h.pipeline(def, { lecture, name: 'week-3' });
    const gate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'signoff' AND status = 'waiting'").get(runId), 90000);
    assert.equal(gate.kind, 'handoff');
    const runDir = (h.db.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId) as any).run_dir;
    const ingest = JSON.parse((h.db.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'ingest'").get(runId) as any).outputs);
    assert.deepEqual([ingest.pages, ingest.empty], [3, []]);
    assert.match(readFileSync(join(runDir, 'slides', ingest.files[2]), 'utf8'), /6 entries in 8 buckets/);
    assert.equal(readFileSync(join(runDir, 'out/week-3.pdf')).subarray(0, 5).toString(), '%PDF-');
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined })).result, {});
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status === 'done', 30000);
  } finally { await close(h); }
});

async function fakeGmail(mailbox: any) {
  const calls: Array<{ method: string; url: string; body: string }> = [];
  const b64 = (s: string) => Buffer.from(s).toString('base64url');
  const headers = (m: any) => [{ name: 'From', value: m.from }, { name: 'Subject', value: m.subject }, { name: 'Message-ID', value: m.messageId }, ...(m.to ? [{ name: 'To', value: m.to }] : [])];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      calls.push({ method: req.method!, url: req.url!, body });
      const route = (req.url ?? '').replace(/^\/gmail\/v1\/users\/me\//, '');
      const msg = mailbox.messages.find((m: any) => route.startsWith(`messages/${m.id}?`));
      const sent = mailbox.sent.find((t: any) => route.startsWith(`threads/${t.id}?`));
      const reply = req.url === '/token' ? { access_token: 'fake-token' }
        : route === 'profile' ? { emailAddress: mailbox.me }
        : route.startsWith('messages?') ? { messages: mailbox.messages.map((m: any) => ({ id: m.id })) }
        : msg ? { id: msg.id, threadId: msg.threadId, snippet: msg.body.slice(0, 40), payload: { mimeType: 'text/plain', headers: headers(msg), body: { data: b64(msg.body) } } }
        : route.startsWith('threads?') ? { threads: mailbox.sent.map((t: any) => ({ id: t.id })) }
        : sent ? { id: sent.id, messages: [{ payload: { headers: headers(sent) } }] }
        : route === 'drafts' && req.method === 'POST' ? { id: `d${calls.length}` }
        : null;
      res.writeHead(reply ? 200 : 404, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply ?? { error: { message: `no route ${req.url}` } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  return { calls, url: `http://127.0.0.1:${(server.address() as any).port}`, close: () => server.close() };
}

async function gmailHarness(api: string) {
  const prev = process.env.TROOP_GMAIL_API;
  process.env.TROOP_GMAIL_API = api;
  try {
    const h = await revisionHarness(undefined, capturingEngine);
    for (const [name, value] of [['GMAIL_CLIENT_ID', 'id'], ['GMAIL_CLIENT_SECRET', 'secret'], ['GMAIL_REFRESH_TOKEN', 'refresh']]) {
      assert.deepEqual((await h.pipe.request('plugin.secret.set', { plugin_id: 'gmail', name, value })).result, {});
    }
    return h;
  } finally { if (prev === undefined) delete process.env.TROOP_GMAIL_API; else process.env.TROOP_GMAIL_API = prev; }
}

test('M3-01 inbox-triage-drafts reads the fixture mailbox and saves a reply draft only after approve', async () => {
  const mailbox = JSON.parse(readFileSync(join(root, 'tests/fixtures/inbox-triage-drafts/input/mailbox.json'), 'utf8'));
  const gmail = await fakeGmail(mailbox);
  const h = await gmailHarness(gmail.url);
  try {
    copyFileSync(join(root, 'tests/fixtures/inbox-triage-drafts/input/rules.md'), join(h.project, 'rules.md'));
    cpSync(join(root, 'pipelines/inbox-triage-drafts'), join(h.project, '.troop/pipelines/inbox-triage-drafts'), { recursive: true });
    const replies = [{ id: 'm1', thread: 't1', to: 'dana@crumb.example', subject: 'Re: Saturday order', body: 'Yes, 40 loaves are confirmed for Saturday.\nSam' }];
    const def = builtin('inbox-triage-drafts', {
      classify: { outputs: { items: 'classified.json' } },
      draft: { outputs: { count: 1 }, run_files: { 'replies.json': JSON.stringify(replies) } },
      check: { outputs: { passed: true, flag: 'none' } },
    });
    const runId = await h.pipeline(def, {});
    const gate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve' AND status = 'waiting'").get(runId)
      ?? (h.db.prepare("SELECT 1 FROM run WHERE id = ? AND status = 'failed'").get(runId) ? assert.fail('run failed') : null), 60000);
    assert.equal(gate.guards_step, 'drafts');
    const runDir = (h.db.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId) as any).run_dir;
    assert.match(readFileSync(join(runDir, 'rules.md'), 'utf8'), /Never draft/);
    const fetched = JSON.parse(readFileSync(join(runDir, 'messages.json'), 'utf8'));
    assert.deepEqual(fetched.messages.map((m: any) => [m.id, m.body]), mailbox.messages.map((m: any) => [m.id, m.body]));
    assert.deepEqual(fetched.followups.map((f: any) => f.thread), ['t3']);
    assert.equal(gmail.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/drafts')).length, 0);
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash })).result, {});
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status === 'done', 30000);
    const posts = gmail.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/drafts'));
    assert.equal(posts.length, 1);
    const message = JSON.parse(posts[0].body).message;
    assert.equal(message.threadId, 't1');
    assert.match(Buffer.from(message.raw, 'base64url').toString('utf8'), /In-Reply-To: <m1@crumb\.example>/);
  } finally { gmail.close(); await close(h); }
});

test('M3-01 prospect-list-to-drafts drops bad rows, gates the site fetch and saves new drafts only after approve', async () => {
  const gmail = await fakeGmail({ me: 'sam@crumb.example', messages: [], sent: [] });
  const h = await gmailHarness(gmail.url);
  try {
    for (const f of ['prospects.csv', 'do-not-contact.txt']) copyFileSync(join(root, 'tests/fixtures/prospect-list-to-drafts/input', f), join(h.project, f));
    cpSync(join(root, 'pipelines/prospect-list-to-drafts'), join(h.project, '.troop/pipelines/prospect-list-to-drafts'), { recursive: true });
    const emails = [
      { id: 'priya', to: 'priya@shahphysio.example', subject: 'Your Saturday clinic', body: 'You open Saturdays from 8am. Want a booking page for it?' },
      { id: 'marco', to: 'marco@rossibarbers.example', subject: 'Walk-ins', body: 'Your site says walk-ins only. Want a live queue page?' },
    ];
    const def = builtin('prospect-list-to-drafts', {
      hook: { outputs: { items: 'hooks.json' } },
      write: { outputs: { count: 2 }, run_files: { 'emails.json': JSON.stringify(emails) } },
      check: { outputs: { passed: true, flag: 'none' } },
    });
    // agent-reach/sources fetches the prospects' public sites, so a fake external step stands in with the same gate.
    def.steps[def.steps.findIndex((s: any) => s.id === 'sources')] = { id: 'sources', title: 'Fetch their sites', role: 'research', kind: 'agent', engine: 'fake', external: true, destination: 'prospect sites', approval: 'edits', outputs: ['count'], prompt: 'FAKE {"outputs":{"count":2}}\nFetch.' };
    const runId = await h.pipeline(def, { list: 'prospects.csv', do_not_contact: 'do-not-contact.txt', offer: 'booking pages' });
    const gateAt = (step: string) => until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = ? AND status = 'waiting'").get(runId, step)
      ?? (h.db.prepare("SELECT 1 FROM run WHERE id = ? AND status = 'failed'").get(runId) ? assert.fail('run failed') : null), 60000);
    const spend: any = await gateAt('approve-spend');
    assert.equal(spend.guards_step, 'sources');
    const load = JSON.parse((h.db.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'load'").get(runId) as any).outputs);
    assert.equal(load.kept, 2);
    assert.deepEqual(load.dropped.map((d: any) => d.why), ['no email', 'duplicate', 'do not contact']);
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'sources' AND status <> 'pending'").get(runId) as any).n, 0);
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: spend.id, decision: 'approve', action_hash: spend.action_hash })).result, {});
    const approve: any = await gateAt('approve');
    assert.equal(approve.guards_step, 'drafts');
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'hook' AND status = 'done'").get(runId) as any).n, 4);
    assert.equal(gmail.calls.length, 0);
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: approve.id, decision: 'approve', action_hash: approve.action_hash })).result, {});
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status === 'done', 30000);
    const posts = gmail.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/drafts')).map((c) => JSON.parse(c.body).message);
    assert.equal(posts.length, 2);
    assert.ok(posts.every((m) => m.threadId === undefined));
    assert.match(Buffer.from(posts[0].raw, 'base64url').toString('utf8'), /To: priya@shahphysio\.example/);
  } finally { gmail.close(); await close(h); }
});

test('gmail refuses a TROOP_GMAIL_API that is not loopback, so the refresh token never leaves the machine', async () => {
  const { endpoints } = await import('../../plugins/gmail/bin/gmail.js');
  assert.deepEqual(endpoints({}), { api: 'https://gmail.googleapis.com/gmail/v1/users/me', token: 'https://oauth2.googleapis.com/token' });
  assert.deepEqual(endpoints({ TROOP_GMAIL_API: 'http://127.0.0.1:9/' }), { api: 'http://127.0.0.1:9/gmail/v1/users/me', token: 'http://127.0.0.1:9/token' });
  assert.equal(endpoints({ TROOP_GMAIL_API: 'http://[::1]:9' }).token, 'http://[::1]:9/token');
  for (const bad of ['https://evil.example', 'http://10.0.0.1', 'http://localhost:9', 'http://127.0.0.1.evil.example']) {
    assert.throws(() => endpoints({ TROOP_GMAIL_API: bad }), /must be a loopback address/, bad);
  }
});

const whisper = process.env.TROOP_WHISPER || join(process.env.LOCALAPPDATA ?? '', 'whisper.cpp', 'Release', 'whisper-cli.exe');

test('M3-01 clips-to-scheduled-posts cuts only the picked moments and schedules nothing before approve', { skip: !existsSync(whisper) && 'whisper.cpp is not installed' }, async () => {
  const calls: string[] = [];
  const postiz = http.createServer((req, res) => {
    calls.push(`${req.method} ${req.url}`);
    req.resume();
    const body = req.url?.endsWith('/integrations') ? [{ id: 'tt1', identifier: 'tiktok', disabled: false }]
      : req.url?.endsWith('/upload') ? { id: `u${calls.length}`, path: `https://cdn.test/u${calls.length}.mp4` }
      : [{ postId: `p${calls.length}` }];
    req.on('end', () => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); });
  });
  await new Promise<void>((r) => postiz.listen(0, '127.0.0.1', () => r()));
  const h = await revisionHarness(undefined, capturingEngine);
  try {
    for (const [name, value] of [['POSTIZ_URL', `http://127.0.0.1:${(postiz.address() as any).port}/api/public/v1`], ['POSTIZ_API_KEY', 'test-key']]) {
      assert.deepEqual((await h.pipe.request('plugin.secret.set', { plugin_id: 'social-scheduler', name, value })).result, {});
    }
    const video = join(h.project, 'take-01.mp4');
    copyFileSync(join(root, 'tests/fixtures/footage-to-edit/input/takes/take-01.mp4'), video);
    const moments = [
      { id: 'intro', title: 'Meet Sam', preview: 'from Crumb Bakery', reason: 'hook', status: 'pending', src_start: 0.1, src_end: 3.1 },
      { id: 'restart', title: 'Take two', preview: 'start again', reason: 'blooper', status: 'pending', src_start: 7.5, src_end: 11.0 },
      { id: 'shape', title: 'Shape a loaf', preview: 'step by step', reason: 'how-to', status: 'pending', src_start: 11.0, src_end: 18.0 },
    ];
    const posts = [{ clip: 'styled/shape.mp4', platform: 'tiktok', title: 'Shape a loaf', caption: 'Sourdough shaping in one go', hashtags: ['sourdough'], slot: '2030-01-07T09:00:00+11:00' }];
    const def = builtin('clips-to-scheduled-posts', {
      moments: { outputs: { items: 'moments.json' }, run_files: { 'moments.json': JSON.stringify(moments) } },
      copy: { outputs: { posts: 'posts.json' }, run_files: { 'posts.json': JSON.stringify(posts) } },
      check: { outputs: { passed: true, flags: 'none' } },
    });
    mkdirSync(join(h.project, '.troop/pipelines'), { recursive: true });
    writeFileSync(join(h.project, '.troop/pipelines', `${def.id}.json`), JSON.stringify(def));
    const six = await h.pipe.request('run.start', { pipeline_id: def.id, project_id: h.projectId, inputs: { video, week_start: '2030-01-07', max_clips: 6 } });
    assert.match(JSON.stringify(six.error), /max_clips must be one of 1, 2, 3, 4/);
    const runId = await h.pipeline(def, { video, week_start: '2030-01-07', platforms: 'tiktok', max_clips: 4, tiktok_privacy: 'SELF_ONLY' });
    const pick: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'pick' AND status = 'waiting'").get(runId) ?? (h.db.prepare("SELECT 1 FROM run WHERE id = ? AND status = 'failed'").get(runId) ? assert.fail('run failed') : null), 120000);
    const runDir = (h.db.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId) as any).run_dir;
    assert.equal(existsSync(join(runDir, 'clips')), false);
    writeFileSync(join(runDir, 'moments.json'), JSON.stringify(moments.map((m) => ({ ...m, status: m.id === 'shape' ? 'approved' : 'dropped' }))));
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: pick.id, decision: 'approve' })).result, {});
    const approve: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve' AND status = 'waiting'").get(runId), 120000);
    assert.equal(approve.guards_step, 'schedule');
    assert.deepEqual(readdirSync(join(runDir, 'clips')).filter((f) => f.endsWith('.mp4')), ['shape.mp4']);
    assert.deepEqual(readdirSync(join(runDir, 'styled')).filter((f) => f.endsWith('.mp4')), ['shape.mp4']);
    assert.deepEqual(calls, []);
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: approve.id, decision: 'approve', action_hash: approve.action_hash })).result, {});
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status === 'done', 60000);
    assert.deepEqual(calls, ['GET /api/public/v1/integrations', 'POST /api/public/v1/upload', 'POST /api/public/v1/posts']);
  } finally { postiz.close(); await close(h); }
});

test('M3-01 footage-to-edit probes and transcribes the fixture takes, then stops at the plan and final gates', { skip: !existsSync(whisper) && 'whisper.cpp is not installed' }, async () => {
  const h = await revisionHarness(undefined, capturingEngine);
  try {
    const footage = join(h.project, 'takes');
    cpSync(join(root, 'tests/fixtures/footage-to-edit/input/takes'), footage, { recursive: true });
    const def = builtin('footage-to-edit', {
      edit: { outputs: { summary: 'rough cut', flags_left: 'none' } },
      'visual-check': { outputs: { passed: true, flags: 0 } },
    });
    const runId = await h.pipeline(def, { footage, brief: 'how we shape a loaf' });
    const plan: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve-plan' AND status = 'waiting'").get(runId), 120000);
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'edit' AND status <> 'pending'").get(runId) as any).n, 0);
    const out = (id: string) => JSON.parse((h.db.prepare('SELECT outputs FROM run_step WHERE run_id = ? AND step_id = ?').get(runId, id) as any).outputs);
    assert.equal(out('transcribe').files, 2);
    const { words } = JSON.parse(readFileSync(out('transcribe').out, 'utf8'));
    const said = (file: string) => words.filter((w: any) => w.file === file).map((w: any) => w.text).join(' ').toLowerCase();
    assert.match(said('take-01.mp4'), /start that again/);
    assert.match(said('take-02.mp4'), /(twenty|20) minutes/);
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: plan.id, decision: 'approve' })).result, {});
    const final: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve-final' AND status = 'waiting'").get(runId), 60000);
    assert.match(final.summary, /Flags left for you: none/);
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: final.id, decision: 'approve' })).result, {});
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status === 'done', 30000);
  } finally { await close(h); }
});

const typeInto = `param([string]$Handle, [string]$Json)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$w = @([System.Windows.Automation.AutomationElement]::RootElement.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { [string]$_.Current.NativeWindowHandle -eq $Handle })[0]
$values = $Json | ConvertFrom-Json
foreach ($p in $values.PSObject.Properties) {
  $box = @($w.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | Where-Object { $_.Current.Name -eq $p.Name -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit })[0]
  $box.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue([string]$p.Value)
}
`;

// Fill: each run takes the next entry of FAKE.sequence, types its values into that window and reports it.
const sequenceEngine = (typer: string) => `
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
const prompt = process.argv[2] ?? '';
const line = prompt.split(/\\r?\\n/).find((s) => s.startsWith('FAKE '));
const out = /^When you are done, write your result to:\\s*(.+)$/m.exec(prompt)?.[1]?.trim();
if (line) {
  const spec = JSON.parse(line.slice(5));
  for (const [name, value] of Object.entries(spec.run_files ?? {})) writeFileSync(join(dirname(out), name), String(value));
  if (spec.sequence) {
    const counter = join(process.env.METATROOPER_HOME, 'sequence-count.json');
    const n = existsSync(counter) ? JSON.parse(readFileSync(counter, 'utf8')) : 0;
    writeFileSync(counter, JSON.stringify(n + 1));
    const item = spec.sequence[Math.min(n, spec.sequence.length - 1)];
    spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ${JSON.stringify(typer)}, item.outputs.handle, JSON.stringify(item.type)], { windowsHide: true });
    process.argv[2] = prompt.replace(line, 'FAKE ' + JSON.stringify({ outputs: item.outputs }));
  }
}
await import(${JSON.stringify(pathToFileURL(join(root, 'core/test/fake-engine.js')).href)});
`;

test('M3-03 form-fill-batch hands a shown captcha to the user, skips the gate when there is none, and submits only after approve', { skip: process.platform !== 'win32' || process.env.METATROOPER_DESKTOP_E2E !== '1' }, async () => {
  const forms: ChildProcess[] = [];
  const open = (title: string, x: number, noCaptcha = false) => new Promise<string>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'tests/fixtures/form-fill-batch/input/form.ps1'), '-Title', title, '-X', String(x), '-Y', '40', ...(noCaptcha ? ['-NoCaptcha'] : [])]);
    forms.push(child);
    child.stdout.on('data', (d) => { const m = /handle=(\d+)/.exec(String(d)); if (m) resolve(m[1]); });
    child.on('exit', () => reject(new Error(`${title} closed before showing`)));
  });
  const typer = join(tmpdir(), `troop-type-${process.pid}.ps1`);
  writeFileSync(typer, typeInto);
  const type = (handle: string, values: object) => spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', typer, handle, JSON.stringify(values)], { windowsHide: true });
  const h = await revisionHarness(undefined, sequenceEngine(typer));
  try {
    const [rowA, rowB] = readFileSync(join(root, 'tests/fixtures/form-fill-batch/input/rows.csv'), 'utf8').trim().split(/\r?\n/).slice(1).map((l) => l.split(','));
    const a = await open('Troop test form A', 40); const b = await open('Troop test form B', 420, true);
    const row = (r: string[], handle: string, window: string) => ({ window, handle, values: r.join(' '), filled: true });
    const rowsJson = JSON.stringify([row(rowA, a, 'Troop test form A'), row(rowB, b, 'Troop test form B')]);
    const def = builtin('form-fill-batch', {
      map: { outputs: { rows: 2 }, run_files: { 'rows.json': rowsJson } },
      fill: { sequence: [
        { type: { Name: rowA[0], Email: rowA[1], Postcode: rowA[2] }, outputs: { window: 'Troop test form A', handle: a, values: rowA.join(' '), captcha: 'shown', rows_left: 1 } },
        { type: { Name: rowB[0], Email: rowB[1], Postcode: rowB[2] }, outputs: { window: 'Troop test form B', handle: b, values: rowB.join(' '), captcha: 'none', rows_left: 0 } },
      ] },
    });
    const sheet = join(h.project, 'rows.csv');
    copyFileSync(join(root, 'tests/fixtures/form-fill-batch/input/rows.csv'), sheet);
    const runId = await h.pipeline(def, { sheet, window: 'Troop test form' });
    for (const handle of [a]) {
      const gate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'captcha' AND status = 'waiting'").get(runId), 60000);
      assert.equal(gate.kind, 'handoff');
      assert.match(gate.summary, /captcha shown/);
      assert.equal((h.db.prepare('SELECT paused_why FROM run WHERE id = ?').get(runId) as any).paused_why, 'handoff');
      type(handle, { 'Captcha answer': 'harbour' });
      assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve' })).result, {});
      await until(() => !h.db.prepare("SELECT 1 FROM gate WHERE id = ? AND status = 'waiting'").get(gate.id));
    }
    const approve: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve' AND status = 'waiting'").get(runId), 60000);
    assert.equal(approve.guards_step, 'submit');
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM gate WHERE run_id = ? AND step_id = 'captcha'").get(runId) as any).n, 1);
    assert.equal((h.db.prepare("SELECT status FROM run_step WHERE run_id = ? AND step_id = 'captcha' AND iteration = 1").get(runId) as any).status, 'skipped');
    const runDir = (h.db.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId) as any).run_dir;
    assert.equal(readdirSync(join(runDir, 'shots')).filter((f) => f.endsWith('.png')).length, 2);
    assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'submit' AND status <> 'pending'").get(runId) as any).n, 0);
    assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: approve.id, decision: 'approve', action_hash: approve.action_hash })).result, {});
    await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status === 'done', 60000);
    const confirmations = JSON.parse(readFileSync(join(runDir, 'confirmations.json'), 'utf8'));
    assert.deepEqual(confirmations.map((c: any) => c.text.find((t: string) => t.startsWith('Received'))), [`Received: ${rowA[0]}`, `Received: ${rowB[0]}`], JSON.stringify(confirmations));
  } finally {
    for (const f of forms) f.kill();
    await close(h);
  }
});

function fakeVercel(h: Harness) {
  const log = join(h.iso.home, 'vercel.log');
  writeFileSync(join(h.iso.home, 'bin', process.platform === 'win32' ? 'vercel.cmd' : 'vercel'), process.platform === 'win32'
    ? `@echo off\r\necho %*>>"${log}"\r\necho https://prod.test/site\r\n`
    : `#!/bin/sh\necho "$@" >> '${log}'\necho https://prod.test/site\n`, { mode: 0o755 });
  return () => existsSync(log) ? readFileSync(log, 'utf8').trim().split(/\r?\n/) : [];
}

test('M3-01 seo-audit-fix audits five areas, fixes in a worktree and deploys only after approve', async () => {
  const h = await revisionHarness(undefined, capturingEngine);
  try {
    mkdirSync(join(h.project, '.vercel'), { recursive: true }); writeFileSync(join(h.project, '.vercel/project.json'), '{}');
    const calls = fakeVercel(h);
    const def = builtin('seo-audit-fix', {
      audit: { outputs: { findings: 'audit.json' } },
      prioritise: { outputs: { summary: 'ranked', key_pages: '/, /menu, /contact' } },
      fix: { outputs: { summary: 'titles and alt text fixed' } },
      speed: { outputs: { passed: true, scores: '/ 96, /menu 93, /contact 98' } },
    });
    const siteDir = join(root, 'tests/fixtures/seo-audit-fix/input/site');
    const site = http.createServer((req, res) => {
      const file = join(siteDir, req.url === '/' ? 'index.html' : (req.url ?? '').slice(1));
      if (!/^\/[a-z-]*(\.html)?$/.test(req.url ?? '') || !existsSync(file)) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(readFileSync(file));
    });
    await new Promise<void>((r) => site.listen(0, '127.0.0.1', () => r()));
    const url = `http://127.0.0.1:${(site.address() as any).port}/`;
    try {
      const runId = await h.pipeline(def, { url, market: 'bakery' });
      const gate: any = await until(() => h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND step_id = 'approve' AND status = 'waiting'").get(runId), 60000);
      const crawled = JSON.parse(readFileSync(JSON.parse((h.db.prepare("SELECT outputs FROM run_step WHERE run_id = ? AND step_id = 'crawl'").get(runId) as any).outputs).crawl, 'utf8'));
      assert.deepEqual(crawled.broken.map((b: any) => [new URL(b.url).pathname, b.status]), [['/old-specials.html', 404]]);
      const home = crawled.pages.find((p: any) => p.url === url);
      assert.ok(home && home.status === 200, JSON.stringify(crawled.pages));
      assert.equal(gate.guards_step, 'deploy'); assert.match(gate.action_hash, /^[0-9a-f]{64}$/);
      assert.match(gate.summary, /titles and alt text fixed/); assert.match(gate.summary, /\/menu 93/);
      assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'audit' AND status = 'done'").get(runId) as any).n, 5);
      assert.deepEqual(calls(), []);
      assert.equal((h.db.prepare("SELECT COUNT(*) n FROM run_step WHERE run_id = ? AND step_id = 'deploy' AND status = 'done'").get(runId) as any).n, 0);
      assert.deepEqual((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash })).result, {});
      await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as any).status === 'done', 30000);
      assert.deepEqual(calls(), ['deploy --yes --prod']);
    } finally { site.close(); }
  } finally { await close(h); }
});
