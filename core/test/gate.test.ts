import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { measureGate } from '../src/gate.ts';
import { root, runNode } from './helpers.ts';

const SINCE = new Date('2026-10-01T00:00:00.000Z');
const UNTIL = new Date('2026-10-15T00:00:00.000Z');
const SINCE_ARG = '2026-10-01T00:00:00Z';
const UNTIL_ARG = '2026-10-15T00:00:00Z';
const INSIDE = '2026-10-02T03:04:05.000Z';
const schema = fs.readFileSync(path.join(root, 'contracts', 'schema.sql'), 'utf8');

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'troop-gate-'));
  const databases: DatabaseSync[] = [];
  t.after(() => {
    for (const db of databases) {
      try { db.close(); } catch {}
    }
    fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  return {
    home,
    database(nativeIds: string[] = [], file = path.join(home, 'troop.db')) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const db = new DatabaseSync(file);
      databases.push(db);
      db.exec(schema);
      db.prepare("INSERT INTO engine (id, plugin_id, spec_json, cost_rank, provider) VALUES ('claude', NULL, '{}', 1, 'local-cli')").run();
      db.prepare("INSERT INTO project (id, path, name, opened_at, last_opened) VALUES ('project', ?, 'fixture', ?, ?)")
        .run(path.join(home, 'project'), SINCE.toISOString(), SINCE.toISOString());
      const insert = db.prepare("INSERT INTO session (id, project_id, engine_id, host, native_id, state, state_at, started_at) VALUES (?, 'project', 'claude', 'pty', ?, 'done', ?, ?)");
      nativeIds.forEach((nativeId, index) => insert.run(`session-${index}`, nativeId, INSIDE, INSIDE));
      return db;
    }
  };
}

function writeJsonl(file: string, lines: unknown[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.map(line => typeof line === 'string' ? line : JSON.stringify(line)).join('\n') + '\n');
}

function writeHistory(home: string, lines: unknown[]) {
  writeJsonl(path.join(home, '.claude', 'history.jsonl'), lines);
}

function writeClaudeTranscript(home: string, sessionId: string, lines: unknown[]) {
  writeJsonl(path.join(home, '.claude', 'projects', 'fixture', `${sessionId}.jsonl`), lines);
}

function writeCodexRun(home: string, name: string, lines: unknown[]) {
  writeJsonl(path.join(home, '.codex', 'sessions', '2026', '10', '01', `${name}.jsonl`), lines);
}

function writeAgyRun(home: string, id: string, lines: unknown[]) {
  writeJsonl(path.join(home, '.gemini', 'antigravity-cli', 'brain', id, '.system_generated', 'logs', 'transcript.jsonl'), lines);
}

function codexMeta(timestamp: string, cwd: string) {
  return { type: 'session_meta', timestamp, payload: { cwd } };
}

function codexUser(text: string) {
  return {
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
  };
}

function metric(num: number, den: number, target: string, passes: (value: number) => boolean) {
  const value = den === 0 ? null : num / den * 100;
  return { num, den, value, target, pass: value === null ? null : passes(value) };
}

function cliEnv(home: string) {
  const emptyPath = path.join(home, 'empty-path');
  fs.mkdirSync(emptyPath, { recursive: true });
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'path') delete env[key];
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    METATROOPER_HOME: path.join(home, '.metatrooper'),
    PATH: emptyPath
  };
}

test('#13 gate: reports exact counts and raw values for all five metrics', t => {
  const f = fixture(t);
  const tracked = new Set(['claude-tracked']);
  const prompts = [
    { sessionId: 'claude-tracked', display: 'status?', timestamp: Date.parse(INSIDE) },
    { sessionId: 'claude-tracked', display: 'Review this [Image #1]', timestamp: Date.parse('2026-10-03T00:00:00Z') },
    { sessionId: 'claude-untracked', display: 'Implement the feature', timestamp: Date.parse('2026-10-04T00:00:00Z') }
  ];
  const historyNoise = ['not json', '"scalar"', { sessionId: 'missing-time', display: 'ignored' }];
  writeHistory(f.home, [
    ...prompts,
    { sessionId: 'claude-tracked', display: 'at until', timestamp: UNTIL.getTime() },
    ...historyNoise
  ]);
  for (const sessionId of new Set(prompts.map(prompt => prompt.sessionId))) {
    writeClaudeTranscript(f.home, sessionId, [{ cwd: path.join(f.home, 'project') }]);
  }

  const codexRuns = [
    {
      name: 'smoke', start: INSIDE, valid: true, smoke: true, skipped: 0,
      lines: [
        codexMeta(INSIDE, path.join(f.home, 'project')),
        codexUser('<environment_context>fixture</environment_context>'),
        codexUser('# AGENTS.md fixture'),
        codexUser('reply ok')
      ]
    },
    {
      name: 'work', start: '2026-10-05T00:00:00Z', valid: true, smoke: false, skipped: 1,
      lines: [codexMeta('2026-10-05T00:00:00Z', path.join(f.home, 'project')), 'not json', codexUser('Implement the requested feature')]
    },
    {
      name: 'at-until', start: UNTIL.toISOString(), valid: true, smoke: true, skipped: 0,
      lines: [codexMeta(UNTIL.toISOString(), path.join(f.home, 'project')), codexUser('ping')]
    },
    {
      name: 'missing-meta', start: null, valid: false, smoke: false, skipped: 1,
      lines: [codexUser('reply ready')]
    }
  ];
  for (const run of codexRuns) writeCodexRun(f.home, run.name, run.lines);

  const agyRuns = [
    {
      id: 'smoke', start: SINCE.toISOString(), valid: true, smoke: true, skipped: 0,
      lines: [{ type: 'USER_INPUT', content: 'ping', created_at: SINCE.toISOString() }]
    },
    {
      id: 'missing-start', start: null, valid: false, smoke: false, skipped: 1,
      lines: [{ type: 'USER_INPUT', content: 'reply ok' }]
    }
  ];
  for (const run of agyRuns) writeAgyRun(f.home, run.id, run.lines);

  const routerTotals = { ok: true, shell_read_tokens: 120, saved_tokens: 30 };
  const routerFile = path.join(f.home, 'toolrouter-fixture.js');
  fs.writeFileSync(routerFile, `process.stdout.write(${JSON.stringify(JSON.stringify(routerTotals))});\n`);
  const db = f.database([...tracked]);
  const report = measureGate({ since: SINCE, until: UNTIL, home: f.home, db, toolrouter: [process.execPath, routerFile] });

  const inWindowPrompts = prompts.filter(prompt => prompt.timestamp >= SINCE.getTime() && prompt.timestamp < UNTIL.getTime());
  const promptSessions = new Set(inWindowPrompts.map(prompt => prompt.sessionId));
  const engineRuns = [...codexRuns, ...agyRuns].filter(run => run.valid && run.start !== null && Date.parse(run.start) >= SINCE.getTime() && Date.parse(run.start) < UNTIL.getTime());
  const a01Num = [...promptSessions].filter(sessionId => tracked.has(sessionId)).length;
  const a02Num = inWindowPrompts.filter(prompt => /what are you doing|how long|\beta\b|\/btw eta|status\?/i.test(prompt.display)).length;
  const a03Num = engineRuns.filter(run => run.smoke).length;
  const a04Num = inWindowPrompts.filter(prompt => prompt.display.includes('[Image #')).length;
  const skippedLines = historyNoise.length + codexRuns.reduce((sum, run) => sum + run.skipped, 0) + agyRuns.reduce((sum, run) => sum + run.skipped, 0);

  assert.deepEqual(report, {
    window: { since: SINCE.toISOString(), until: UNTIL.toISOString() },
    counts: {
      prompts: inWindowPrompts.length,
      acu: 0,
      unclassified: 0,
      engine_runs: engineRuns.length,
      skipped_lines: skippedLines,
      unreadable_files: 0
    },
    A01: metric(a01Num, promptSessions.size, '>= 70', value => value >= 70),
    A02: metric(a02Num, inWindowPrompts.length, '< 1', value => value < 1),
    A03: metric(a03Num, engineRuns.length, '< 3', value => value < 3),
    A04: metric(a04Num, inWindowPrompts.length, '< 0.5', value => value < 0.5),
    A05: metric(routerTotals.saved_tokens, routerTotals.shell_read_tokens + routerTotals.saved_tokens, '>= 20', value => value >= 20)
  });
});

test('#13 gate: excludes ACU Claude, Codex, and agy activity from every metric', t => {
  const f = fixture(t);
  const claudePrompts = [{ sessionId: 'claude-acu', display: 'status? [Image #1]', timestamp: Date.parse(INSIDE) }];
  writeHistory(f.home, claudePrompts);
  writeClaudeTranscript(f.home, 'claude-acu', [{
    cwd: path.join(f.home, 'project'),
    message: { content: [{ type: 'tool_use', input: { file_path: 'work/ACU/x.csv' } }] }
  }]);
  writeCodexRun(f.home, 'acu', [codexMeta(INSIDE, path.join(f.home, 'work', 'ACU', 'project')), codexUser('reply ok')]);
  writeAgyRun(f.home, 'acu', [{
    type: 'USER_INPUT', content: 'ping', created_at: INSIDE,
    tool_calls: [{ name: 'Read', input: { path: 'work\\ACU\\x.csv' } }]
  }]);
  const report = measureGate({ since: SINCE, until: UNTIL, home: f.home, db: f.database(['claude-acu']), toolrouter: null });

  assert.deepEqual(report.counts, {
    prompts: 0,
    acu: claudePrompts.length,
    unclassified: 0,
    engine_runs: 0,
    skipped_lines: 0,
    unreadable_files: 0
  });
  for (const key of ['A01', 'A02', 'A03', 'A04'] as const) {
    assert.equal(report[key].num, 0);
    assert.equal(report[key].den, 0);
    assert.equal(report[key].value, null);
    assert.equal(report[key].pass, null);
  }
});

test('#13 gate: counts a Claude prompt with no transcript only as unclassified', t => {
  const f = fixture(t);
  const prompts = [{ sessionId: 'missing-transcript', display: 'status? [Image #1]', timestamp: Date.parse(INSIDE) }];
  writeHistory(f.home, prompts);
  const report = measureGate({ since: SINCE, until: UNTIL, home: f.home, db: f.database(['missing-transcript']), toolrouter: null });

  assert.deepEqual(report.counts, {
    prompts: 0,
    acu: 0,
    unclassified: prompts.length,
    engine_runs: 0,
    skipped_lines: 0,
    unreadable_files: 0
  });
  for (const key of ['A01', 'A02', 'A04'] as const) assert.equal(report[key].den, 0);
});

test('#13 gate: never prints prompt or engine message content in JSON or text output', async t => {
  const f = fixture(t);
  const marker = 'PRIVATE_MARKER_6f0f9f98';
  writeHistory(f.home, [{ sessionId: 'claude', display: marker, timestamp: Date.parse(INSIDE) }]);
  writeClaudeTranscript(f.home, 'claude', [{ cwd: path.join(f.home, 'project') }]);
  writeCodexRun(f.home, 'marker', [codexMeta(INSIDE, path.join(f.home, 'project')), codexUser(marker)]);
  writeAgyRun(f.home, 'marker', [{ type: 'USER_INPUT', content: marker, created_at: INSIDE }]);
  const env = cliEnv(f.home);
  const args = ['core/cli.ts', 'gate', '--since', SINCE_ARG, '--until', UNTIL_ARG];

  const json = await runNode([...args, '--json'], env);
  const text = await runNode(args, env);

  assert.equal(json.code, 0, json.stderr);
  assert.equal(text.code, 0, text.stderr);
  assert.doesNotMatch(json.stdout + json.stderr + text.stdout + text.stderr, new RegExp(marker));
  assert.doesNotThrow(() => JSON.parse(json.stdout));
});

test('#13 gate: skips injected context before classifying the first Codex user message', t => {
  const f = fixture(t);
  const userTexts = ['<environment_context>fixture</environment_context>', '# AGENTS.md fixture', 'reply ok'];
  writeCodexRun(f.home, 'context-first', [
    codexMeta(INSIDE, path.join(f.home, 'project')),
    ...userTexts.map(codexUser)
  ]);
  const report = measureGate({ since: SINCE, until: UNTIL, home: f.home, db: f.database(), toolrouter: null });

  assert.equal(report.counts.engine_runs, 1);
  assert.deepEqual(report.A03, metric(userTexts.at(-1) === 'reply ok' ? 1 : 0, 1, '< 3', value => value < 3));
});

test('#13 gate: counts matching smoke messages only when they are under 80 characters', t => {
  const f = fixture(t);
  const runs = [
    { engine: 'codex', id: 'codex-under', text: `reply ok${'x'.repeat(71)}` },
    { engine: 'codex', id: 'codex-at-limit', text: `reply ok${'x'.repeat(72)}` },
    { engine: 'agy', id: 'agy-under', text: `ping${'x'.repeat(75)}` },
    { engine: 'agy', id: 'agy-at-limit', text: `ping${'x'.repeat(76)}` }
  ];
  for (const run of runs) {
    if (run.engine === 'codex') {
      writeCodexRun(f.home, run.id, [codexMeta(INSIDE, path.join(f.home, 'project')), codexUser(run.text)]);
    } else {
      writeAgyRun(f.home, run.id, [{ type: 'USER_INPUT', content: run.text, created_at: INSIDE }]);
    }
  }
  const report = measureGate({ since: SINCE, until: UNTIL, home: f.home, db: f.database(), toolrouter: null });
  const smokePattern = /reply (ready|ok)|name the model|which model|echo|ping|say ok|are you (there|working)/i;
  const expectedSmoke = runs.filter(run => run.text.length < 80 && smokePattern.test(run.text)).length;

  assert.equal(report.counts.engine_runs, runs.length);
  assert.deepEqual(report.A03, metric(expectedSmoke, runs.length, '< 3', value => value < 3));
});

test('#13 gate: extracts agy USER_REQUEST text before wrapper metadata', t => {
  const f = fixture(t);
  const runs = [
    {
      id: 'closed-request',
      request: 'reply ok',
      content: '<USER_REQUEST>reply ok</USER_REQUEST><ADDITIONAL_METADATA>x</ADDITIONAL_METADATA>'
    },
    {
      id: 'open-request',
      request: 'reply ok',
      content: '<USER_REQUEST>reply ok<USER_SETTINGS_CHANGE>x</USER_SETTINGS_CHANGE>'
    }
  ];
  for (const run of runs) {
    writeAgyRun(f.home, run.id, [{ type: 'USER_INPUT', content: run.content, created_at: INSIDE }]);
  }
  const report = measureGate({ since: SINCE, until: UNTIL, home: f.home, db: f.database(), toolrouter: null });
  const smokePattern = /reply (ready|ok)|name the model|which model|echo|ping|say ok|are you (there|working)/i;
  const expectedSmoke = runs.filter(run => run.request.length < 80 && smokePattern.test(run.request)).length;

  assert.equal(report.counts.engine_runs, runs.length);
  assert.deepEqual(report.A03, metric(expectedSmoke, runs.length, '< 3', value => value < 3));
});

test('#13 gate: includes prompts at since and excludes prompts at until', t => {
  const f = fixture(t);
  const sessionId = 'boundary-session';
  const boundaryPrompts = [
    { sessionId, display: 'at since', timestamp: SINCE.getTime() },
    { sessionId, display: 'at until', timestamp: UNTIL.getTime() }
  ];
  writeHistory(f.home, boundaryPrompts);
  writeClaudeTranscript(f.home, sessionId, [{ cwd: path.join(f.home, 'project') }]);
  const report = measureGate({ since: SINCE, until: UNTIL, home: f.home, db: f.database([sessionId]), toolrouter: null });
  const expected = boundaryPrompts.filter(prompt => prompt.timestamp >= SINCE.getTime() && prompt.timestamp < UNTIL.getTime());

  assert.equal(report.counts.prompts, expected.length);
  assert.deepEqual(report.A01, metric(new Set(expected.map(prompt => prompt.sessionId)).size, new Set(expected.map(prompt => prompt.sessionId)).size, '>= 70', value => value >= 70));
  assert.equal(report.A02.den, expected.length);
  assert.equal(report.A04.den, expected.length);
});

test('#13 gate: reports missing toolrouter as a null A-05 metric and exits zero', async t => {
  const f = fixture(t);
  const result = await runNode([
    'core/cli.ts', 'gate', '--since', SINCE_ARG, '--until', UNTIL_ARG, '--json'
  ], cliEnv(f.home));

  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.A05, {
    num: null,
    den: null,
    value: null,
    target: '>= 20',
    pass: null,
    reason: 'toolrouter not found'
  });
});

test('#13 gate: rejects reversed, malformed, repeated, and unknown gate arguments', async t => {
  const f = fixture(t);
  const cases = [
    ['--since', '2026-10-02', '--until', '2026-10-01'],
    ['--since', 'x'],
    ['--since', 'a', '--since', 'b'],
    ['--bogus']
  ];

  for (const args of cases) {
    const result = await runNode(['core/cli.ts', 'gate', ...args], cliEnv(f.home));
    assert.equal(result.code, 1, `args: ${args.join(' ')}\n${result.stderr}`);
    assert.equal(result.stdout, '');
    const lines = result.stderr.trim().split(/\r?\n/);
    assert.equal(lines.length, 1, result.stderr);
    assert.match(lines[0], /^troop gate: .+$/);
  }
});
