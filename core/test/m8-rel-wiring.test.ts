import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { DatabaseSync } from 'node:sqlite';
import { schemaFile } from '../src/paths.ts';
import { DEFAULTS, setSetting } from '../src/settings.ts';
import { watchTranscripts, readClaudeTranscript } from '../src/meter.ts';
import { watchRecord, chooseLoop, falseAlarms, checkBudgets, proveDone } from '../src/reliability.ts';
import { buildMethods } from '../src/methods.ts';
import * as term from '../src/terminal/index.ts';

const require = createRequire(import.meta.url);
const at = '2026-11-10T00:00:00.000Z';
function fixture(t: any, onDisk = false) {
  const home = mkdtempSync(join(tmpdir(), 'rel-wiring-'));
  const previous = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = home;
  setSetting('reliability', 'checks', {});
  const db = new DatabaseSync(onDisk ? join(home, 'fixture.db') : ':memory:');
  db.exec(readFileSync(schemaFile, 'utf8'));
  db.prepare('INSERT INTO project (id,path,name,opened_at,last_opened) VALUES (?,?,?,?,?)').run('p', home, 'Synthetic', at, at);
  db.prepare('INSERT INTO engine (id,spec_json,cost_rank,provider) VALUES (?,?,?,?)').run('synthetic', '{}', 1, 'local-cli');
  const writes: any[] = [];
  const exits: Function[] = [];
  t.mock.method(require('node-pty'), 'spawn', () => ({ pid: 123, write: (data: string) => writes.push(data), onData() {}, onExit(fn: Function) { exits.push(fn); }, kill() {}, pause() {}, resume() {} }));
  const session = (state = 'working', cwd: string | null = home) => {
    const id = randomUUID();
    db.prepare('INSERT INTO session (id,project_id,engine_id,host,state,state_at,started_at,cwd) VALUES (?,?,?,?,?,?,?,?)').run(id, 'p', 'synthetic', 'pty', state, at, at, cwd);
    term.open(id, ['synthetic'], home, {});
    return id;
  };
  const rows = () => db.prepare('SELECT * FROM needs_you ORDER BY at,id').all() as any[];
  const events = (kind = 'core.loop') => db.prepare('SELECT payload FROM event WHERE kind = ? ORDER BY seq').all(kind).map((r: any) => JSON.parse(r.payload));
  const setting = (key: string, value: any) => setSetting('reliability', key, value);
  t.after(async () => {
    watchTranscripts(null);
    for (const exit of exits) exit({ exitCode: 0 });
    await new Promise((r) => setImmediate(r));
    db.close();
    if (previous === undefined) delete process.env.METATROOPER_HOME; else process.env.METATROOPER_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  });
  return { db, home, session, writes, rows, events, setting };
}
function pair(h: any, sid: string, input: any = { path: 'a' }, output: any = 'same', timestamp = new Date().toISOString(), tool = 'Read') {
  const id = randomUUID();
  watchRecord(h.db, sid, { timestamp, message: { content: [{ type: 'tool_use', id, name: tool, input }] } });
  watchRecord(h.db, sid, { timestamp, message: { content: [{ type: 'tool_result', tool_use_id: id, content: output }] } });
}
function usage(h: any, sid: string, i: number, o = 0, cw = 0, cr = 0) {
  h.db.prepare('INSERT INTO usage (at,session_id,engine_id,provider,tokens_in,tokens_out,cache_write,cache_read,source,dedupe_key) VALUES (?,?,?,?,?,?,?,?,?,?)').run(at, sid, 'synthetic', 'local-cli', i, o, cw, cr, 'transcript', randomUUID());
}
function doneRow(h: any, sid: string) {
  h.db.prepare("INSERT INTO needs_you (id,at,kind,ref,text) VALUES (?,?,'done',?,'Original finish')").run(randomUUID(), at, sid);
}

// Build a synthetic Git fixture without staging or committing commands.
function repository(home: string) {
  const git = join(home, '.git');
  mkdirSync(join(git, 'objects'), { recursive: true });
  mkdirSync(join(git, 'refs', 'heads'), { recursive: true });
  const object = (type: string, text: string) => {
    const bytes = Buffer.concat([Buffer.from(type + ' ' + Buffer.byteLength(text) + '\0'), Buffer.from(text)]);
    const sha = createHash('sha1').update(bytes).digest('hex');
    mkdirSync(join(git, 'objects', sha.slice(0, 2)), { recursive: true });
    writeFileSync(join(git, 'objects', sha.slice(0, 2), sha.slice(2)), deflateSync(bytes));
    return sha;
  };
  const tree = object('tree', '');
  const revision = object('commit', 'tree ' + tree + '\nauthor Test <test@example.invalid> 1 +0000\ncommitter Test <test@example.invalid> 1 +0000\n\nSynthetic fixture\n');
  writeFileSync(join(git, 'HEAD'), 'ref: refs/heads/fixture\n');
  writeFileSync(join(git, 'refs', 'heads', 'fixture'), revision + '\n');
  writeFileSync(join(git, 'config'), '[core]\nrepositoryformatversion = 0\nbare = false\n');
  const header = Buffer.from('444952430000000200000000', 'hex');
  writeFileSync(join(git, 'index'), Buffer.concat([header, createHash('sha1').update(header).digest()]));
}

test('reliability defaults match the literal contract', () => {
  assert.deepEqual(DEFAULTS.reliability, { loop_alarm: true, loop_nudge_at: 3, loop_stop_at: 5, token_limit: 0, done_needs_check: true, checks: {} });
});

test('transcript watcher replaces its predecessor, sees nonusage lines before usage and tolerates exceptions', (t) => {
  const h = fixture(t), sid = h.session();
  const file = join(h.home, 'transcript.jsonl');
  const records = [{ timestamp: at, message: { content: [{ type: 'text', text: 'hello' }] } }, { timestamp: at, message: { id: 'usage-one', usage: { input_tokens: 7, output_tokens: 2, cache_creation_input_tokens: 3, cache_read_input_tokens: 90 } } }];
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\ninvalid json\n');
  let old = 0;
  const seen: unknown[] = [];
  watchTranscripts(() => { old++; });
  watchTranscripts((db, id, rec) => { assert.equal(db, h.db); assert.equal(id, sid); assert.equal(db.prepare('SELECT COUNT(*) AS n FROM usage').get()!.n, 0); seen.push(rec); throw Error('watcher failure'); });
  assert.equal(readClaudeTranscript(h.db, sid, file), 1);
  assert.equal(old, 0);
  assert.deepEqual(seen, records);
  assert.deepEqual({ ...h.db.prepare('SELECT tokens_in,tokens_out,cache_write,cache_read FROM usage').get() }, { tokens_in: 7, tokens_out: 2, cache_write: 3, cache_read: 90 });
  assert.equal(readClaudeTranscript(h.db, sid, file), 0);
});

test('transcript pairing nudges at three, updates one row at four and stops at five', (t) => {
  const h = fixture(t), sid = h.session();
  watchTranscripts(watchRecord);
  const file = join(h.home, 'loop.jsonl');
  const records: any[] = [];
  for (let i = 1; i <= 3; i++) records.push({ timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_use', id: String(i), name: 'Read', input: { path: 'a' } }, { type: 'tool_result', tool_use_id: String(i), content: 'same' }] } });
  writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  readClaudeTranscript(h.db, sid, file);
  assert.equal(h.rows().length, 1);
  assert.equal(h.rows()[0].kind, 'other');
  assert.equal(h.rows()[0].ref, 'loop:' + sid);
  assert.equal(h.rows()[0].text, 'Read ran 3 times with the same result');
  assert.equal(h.rows()[0].resolved_at, null);
  assert.deepEqual(h.events(), [{ verdict: 'nudge', streak: 3, tool: 'Read' }]);
  assert.deepEqual(h.writes, []);
  const rowId = h.rows()[0].id;
  pair(h, sid);
  assert.equal(h.rows().length, 1);
  assert.equal(h.rows()[0].id, rowId);
  assert.equal(h.rows()[0].text, 'Read ran 4 times with the same result');
  pair(h, sid);
  assert.equal(h.rows().length, 1);
  assert.equal(h.rows()[0].text, 'Stopped: Read ran 5 times with the same result');
  assert.deepEqual(h.events().at(-1), { verdict: 'stop', streak: 5, tool: 'Read' });
  assert.deepEqual(h.writes, ['\x1b']);
});

for (const change of ['input', 'output', 'tool']) test('changed ' + change + ' resets the identical-call streak', (t) => {
  const h = fixture(t), sid = h.session();
  pair(h, sid); pair(h, sid);
  const next = () => pair(h, sid, change === 'input' ? { path: 'b' } : { path: 'a' }, change === 'output' ? 'new' : 'same', new Date().toISOString(), change === 'tool' ? 'Write' : 'Read');
  next(); next();
  assert.deepEqual(h.rows(), []);
  next();
  assert.equal(h.rows().length, 1);
  assert.deepEqual(h.events(), [{ verdict: 'nudge', streak: 3, tool: change === 'tool' ? 'Write' : 'Read' }]);
});

test('unmatched results, incomplete uses and malformed records do not count', (t) => {
  const h = fixture(t), sid = h.session();
  for (const rec of [null, {}, { message: { content: 'text' } }, { message: { content: [null] } }]) watchRecord(h.db, sid, rec);
  for (let i = 0; i < 5; i++) watchRecord(h.db, sid, { timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_result', tool_use_id: 'missing', content: 'same' }, { type: 'tool_use', id: 'pending-' + i, name: 'Read', input: { path: 'a' } }] } });
  pair(h, sid); pair(h, sid);
  assert.deepEqual(h.rows(), []);
  assert.deepEqual(h.events(), []);
  assert.deepEqual(h.writes, []);
});

test('disabled alarm observes nothing and enabling starts at one', (t) => {
  const h = fixture(t), sid = h.session();
  h.setting('loop_alarm', false);
  for (let i = 0; i < 5; i++) pair(h, sid);
  assert.deepEqual(h.rows(), []); assert.deepEqual(h.events(), []); assert.deepEqual(h.writes, []);
  h.setting('loop_alarm', true);
  pair(h, sid); pair(h, sid);
  assert.deepEqual(h.rows(), []);
  pair(h, sid);
  assert.equal(h.rows()[0].text, 'Read ran 3 times with the same result');
});

test('five stale calls count silently and the sixth fresh call stops', (t) => {
  const h = fixture(t), sid = h.session();
  const stale = new Date(Date.now() - 61000).toISOString();
  for (let i = 0; i < 5; i++) pair(h, sid, { path: 'a' }, 'same', stale);
  assert.deepEqual(h.rows(), []); assert.deepEqual(h.events(), []); assert.deepEqual(h.writes, []);
  pair(h, sid);
  assert.equal(h.rows()[0].text, 'Stopped: Read ran 6 times with the same result');
  assert.deepEqual(h.events(), [{ verdict: 'stop', streak: 6, tool: 'Read' }]);
  assert.deepEqual(h.writes, ['\x1b']);
});

test('sessions keep separate streaks and matching tool ids', (t) => {
  const h = fixture(t), a = h.session(), b = h.session();
  pair(h, a); pair(h, b); pair(h, a); pair(h, b);
  assert.deepEqual(h.rows(), []);
  pair(h, a);
  assert.equal(h.rows()[0].ref, 'loop:' + a);
  assert.equal(h.rows().length, 1);
  pair(h, b);
  assert.deepEqual(h.rows().map((r) => r.ref).sort(), ['loop:' + a, 'loop:' + b].sort());
});

test('configured nudge four and stop four clamps stop to five', (t) => {
  const h = fixture(t), sid = h.session();
  h.setting('loop_nudge_at', 4); h.setting('loop_stop_at', 4);
  pair(h, sid); pair(h, sid); pair(h, sid);
  assert.deepEqual(h.rows(), []);
  pair(h, sid);
  assert.equal(h.rows()[0].text, 'Read ran 4 times with the same result');
  assert.deepEqual(h.writes, []);
  pair(h, sid);
  assert.equal(h.rows()[0].text, 'Stopped: Read ran 5 times with the same result');
  assert.deepEqual(h.writes, ['\x1b']);
});

for (const choice of ['pause', 'try-another-way', 'not-a-loop']) test('loop.choose accepts ' + choice + ' and resolves its open alarm', (t) => {
  const h = fixture(t), sid = h.session();
  pair(h, sid); pair(h, sid); pair(h, sid);
  const method = buildMethods(h.db, { engines: () => [], stop() {}, uiKey: 'synthetic' }).get('loop.choose')!;
  assert.equal(method.needsUi, true);
  assert.deepEqual(method.handler({ session_id: sid, choice }, { ui: true, origin: 'test' }), { false_alarms: choice === 'not-a-loop' ? 1 : 0 });
  assert.ok(h.rows()[0].resolved_at);
  if (choice === 'pause') assert.deepEqual(h.writes, ['\x1b']);
  if (choice === 'try-another-way') assert.deepEqual(h.writes, ['You have made the same call several times and got the same result each time. Stop repeating it and try a different way.', '\r']);
  if (choice === 'not-a-loop') { pair(h, sid); pair(h, sid); assert.equal(h.rows().length, 1); pair(h, sid); assert.equal(h.rows().length, 2); assert.deepEqual(h.writes, []); }
});

test('false alarms persist in meta across choices and database reopen', (t) => {
  const h = fixture(t, true), sid = h.session();
  assert.equal(falseAlarms(h.db), 0);
  assert.deepEqual(chooseLoop(h.db, sid, 'not-a-loop'), { false_alarms: 1 });
  assert.deepEqual(chooseLoop(h.db, sid, 'pause'), { false_alarms: 1 });
  assert.deepEqual(chooseLoop(h.db, sid, 'not-a-loop'), { false_alarms: 2 });
  const reopened = new DatabaseSync(join(h.home, 'fixture.db'));
  try { assert.equal(falseAlarms(reopened), 2); } finally { reopened.close(); }
});

test('loop.choose refuses rewind, unknown choices and missing sessions without resolving', (t) => {
  const h = fixture(t), sid = h.session();
  pair(h, sid); pair(h, sid); pair(h, sid);
  const method = buildMethods(h.db, { engines: () => [], stop() {}, uiKey: 'synthetic' }).get('loop.choose')!;
  for (const choice of ['rewind', 'unknown', '', 42, null]) assert.throws(() => method.handler({ session_id: sid, choice }, { ui: true, origin: 'test' }), (e: any) => e.code === -32602);
  assert.throws(() => chooseLoop(h.db, 'missing', 'pause'), (e: any) => e.code === -32002);
  assert.equal(h.rows()[0].resolved_at, null);
  assert.equal(falseAlarms(h.db), 0);
  assert.deepEqual(h.writes, []);
});

test('budget boundaries sum input output and writes, exclude reads and raise once', (t) => {
  const h = fixture(t), sid = h.session();
  h.setting('token_limit', 100000);
  usage(h, sid, 50000, 20000, 9999, 900000);
  checkBudgets(h.db);
  assert.deepEqual(h.events('core.budget'), []);
  usage(h, sid, 1);
  checkBudgets(h.db); checkBudgets(h.db);
  assert.deepEqual(h.events('core.budget'), [{ step: 'log', used: 80000, cap: 100000 }]);
  assert.deepEqual(h.rows(), []); assert.deepEqual(h.writes, []);
  usage(h, sid, 19999); checkBudgets(h.db);
  assert.equal(h.events('core.budget').length, 1);
  usage(h, sid, 1); checkBudgets(h.db); checkBudgets(h.db);
  assert.deepEqual(h.events('core.budget'), [{ step: 'log', used: 80000, cap: 100000 }, { step: 'gate', used: 100000, cap: 100000 }]);
  assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].kind, 'budget'); assert.equal(h.rows()[0].ref, sid);
  assert.match(h.rows()[0].text, /100k of 100k tokens$/);
  assert.deepEqual(h.writes, ['\x1b']);
});

test('zero budget, done and ended sessions do nothing', (t) => {
  const h = fixture(t), working = h.session(), done = h.session('done'), ended = h.session();
  h.db.prepare('UPDATE session SET ended_at=? WHERE id=?').run(at, ended);
  for (const sid of [working, done, ended]) usage(h, sid, 200000);
  checkBudgets(h.db);
  assert.deepEqual(h.events('core.budget'), []);
  h.setting('token_limit', 100000);
  h.db.prepare("UPDATE session SET state='idle' WHERE id=?").run(working);
  checkBudgets(h.db);
  assert.deepEqual(h.events('core.budget'), []); assert.deepEqual(h.rows(), []); assert.deepEqual(h.writes, []);
});

for (const resolved of [false, true]) test('an existing ' + (resolved ? 'resolved' : 'open') + ' budget row prevents another gate', (t) => {
  const h = fixture(t), sid = h.session();
  h.setting('token_limit', 100000); usage(h, sid, 164499);
  h.db.prepare("INSERT INTO needs_you (id,at,kind,ref,text,resolved_at) VALUES (?,?,'budget',?,'Old budget',?)").run(randomUUID(), at, sid, resolved ? at : null);
  checkBudgets(h.db); checkBudgets(h.db);
  assert.equal(h.rows().length, 1); assert.equal(h.rows()[0].text, 'Old budget');
  assert.deepEqual(h.events('core.budget'), []); assert.deepEqual(h.writes, []);
});

test('budget gate above the cap rounds footer to thousands', (t) => {
  const h = fixture(t), sid = h.session();
  h.setting('token_limit', 100000); usage(h, sid, 164600); checkBudgets(h.db);
  assert.match(h.rows()[0].text, /165k of 100k tokens$/);
  assert.deepEqual(h.events('core.budget'), [{ step: 'gate', used: 164600, cap: 100000 }]);
});

for (const mode of ['disabled', 'run', 'no-cwd']) test('proveDone skips ' + mode, async (t) => {
  const h = fixture(t), sid = h.session('done', mode === 'no-cwd' ? null : h.home);
  doneRow(h, sid); h.setting('checks', { p: 'node -e "process.exit(1)"' });
  if (mode === 'disabled') h.setting('done_needs_check', false);
  if (mode === 'run') {
    h.db.prepare('INSERT INTO pipeline (id,source,path,version,valid) VALUES (?,?,?,?,?)').run('fixture', 'project', h.home, 1, 1);
    h.db.prepare('INSERT INTO run (id,pipeline_id,project_id,inputs,run_dir,status,trigger,max_tokens,max_usd,max_minutes,started_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run('synthetic-run', 'fixture', 'p', '{}', h.home, 'done', 'manual', 0, 0, 0, at);
    h.db.prepare('UPDATE session SET run_id=? WHERE id=?').run('synthetic-run', sid);
  }
  await proveDone(h.db, sid);
  assert.equal(h.rows()[0].text, 'Original finish');
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM done_proof').get()!.n, 0);
});

test('proveDone with no command asks for review and preserves resolved done rows', async (t) => {
  const h = fixture(t), sid = h.session('done'); doneRow(h, sid);
  h.db.prepare("INSERT INTO needs_you (id,at,kind,ref,text,resolved_at) VALUES (?,?,'done',?,'Resolved finish',?)").run(randomUUID(), at, sid, at);
  await proveDone(h.db, sid);
  assert.equal(h.rows().find((r) => !r.resolved_at).text, 'synthetic finished: needs your review (no check is set for this project)');
  assert.equal(h.rows().find((r) => r.resolved_at).text, 'Resolved finish');
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM done_proof').get()!.n, 0);
});

test('proveDone runs the project check in cwd, records pass and invalidates after an edit', async (t) => {
  const h = fixture(t); repository(h.home);
  writeFileSync(join(h.home, 'fixture.txt'), 'before');
  const sid = h.session('done'); doneRow(h, sid);
  h.setting('checks', { p: `node -e "process.exit(require('fs').readFileSync('fixture.txt','utf8')==='before'?0:2)"` });
  await proveDone(h.db, sid);
  assert.equal(h.rows()[0].text, 'synthetic finished: checks passed');
  const proof: any = h.db.prepare('SELECT * FROM done_proof').get();
  assert.equal(proof.exit_code, 0); assert.equal(proof.session_id, sid); assert.ok(proof.tree);
  writeFileSync(join(h.home, 'fixture.txt'), 'after'); h.setting('checks', {});
  await proveDone(h.db, sid);
  assert.equal(h.rows()[0].text, 'synthetic finished: needs your review (no check is set for this project)');
  assert.equal(h.db.prepare('SELECT COUNT(*) AS n FROM done_proof').get()!.n, 1);
});

test('proveDone failed check stores its exit and asks for review', async (t) => {
  const h = fixture(t); repository(h.home);
  const sid = h.session('done'); doneRow(h, sid);
  h.setting('checks', { p: 'node -e "process.exit(7)"' });
  await proveDone(h.db, sid);
  assert.equal(h.rows()[0].text, 'synthetic finished: needs your review (the check failed)');
  assert.equal(h.db.prepare('SELECT exit_code FROM done_proof').get()!.exit_code, 7);
});

test('the latest failed check overrides a passing check on the same folder', async (t) => {
  const h = fixture(t); repository(h.home);
  const sid = h.session('done'); doneRow(h, sid);
  h.setting('checks', { p: 'node -e "process.exit(0)"' });
  await proveDone(h.db, sid);
  assert.equal(h.rows()[0].text, 'synthetic finished: checks passed');
  h.setting('checks', { p: 'node -e "process.exit(4)"' });
  await proveDone(h.db, sid);
  assert.equal(h.rows()[0].text, 'synthetic finished: needs your review (the check failed)');
  assert.deepEqual(h.db.prepare('SELECT exit_code FROM done_proof ORDER BY at,id').all().map((r: any) => r.exit_code), [0, 4]);
});

test('a passing project check in a folder without Git still reports checks passed', async (t) => {
  const h = fixture(t), sid = h.session('done'); doneRow(h, sid);
  h.setting('checks', { p: 'node -e "process.exit(0)"' });
  await proveDone(h.db, sid);
  assert.equal(h.db.prepare('SELECT exit_code FROM done_proof').get()!.exit_code, 0);
  assert.equal(h.rows()[0].text, 'synthetic finished: checks passed');
});
