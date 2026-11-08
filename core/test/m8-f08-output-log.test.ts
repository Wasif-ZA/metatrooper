import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildMethods } from '../src/methods.ts';
import * as term from '../src/terminal/index.ts';
import { isolation, runNode, until } from './helpers.ts';

function fixture(t: TestContext) {
  const isolated = isolation();
  const previous = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = isolated.home;
  const output = join(isolated.home, 'output');
  mkdirSync(output);
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE approval (id TEXT, status TEXT)');
  const ids: string[] = [];
  const chunks: string[] = [];
  let firstOutput!: () => void;
  const firstChunk = new Promise<void>(resolve => { firstOutput = resolve; });
  term.setTermHooks({ onOutput: (id, data) => { if (ids.includes(id)) { chunks.push(data); firstOutput(); } } });
  t.after(async () => {
    try {
      for (const id of ids) term.kill(id);
      await until(() => ids.every(id => term.ptyPid(id) === null), 8000);
    } finally {
      term.setTermHooks({});
      db.close();
      if (previous === undefined) delete process.env.METATROOPER_HOME;
      else process.env.METATROOPER_HOME = previous;
      rmSync(isolated.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
  const handler = buildMethods(db, { engines: () => [], stop: () => {}, uiKey: 'output-test' }).get('session.output')!.handler;
  return {
    ...isolated, output, ids, chunks, firstChunk,
    call: (session_id: string, tail_bytes?: number) => handler({ session_id, ...(tail_bytes === undefined ? {} : { tail_bytes }) }, { ui: false, origin: 'test' }),
  };
}

test('raw pty chunks append in order with escape codes and survive a fresh reader process', async (t) => {
  const f = fixture(t);
  const id = 'output-' + randomUUID();
  const file = join(f.output, id + '.log');
  const prefix = 'previous-output\x1b[0m\r\n';
  writeFileSync(file, prefix);
  f.ids.push(id);
  const script = "process.stdout.write('\\x1b[31mFIRST-MARKER\\x1b[0m\\r\\n'); setTimeout(() => { process.stdout.write('SECOND-MARKER\\r\\n'); setTimeout(() => process.exit(0), 200); }, 250)";
  term.open(id, [process.execPath, '-e', script], f.home, f.env, 80, 24);
  await until(() => term.ptyPid(id) === null, 10000);
  assert.ok(f.chunks.length >= 2, 'the real pty must deliver multiple chunks');
  const raw = f.chunks.join('');
  assert.ok(raw.includes('\x1b['), 'escape codes must be preserved');
  assert.ok(raw.indexOf('FIRST-MARKER') >= 0);
  assert.ok(raw.indexOf('SECOND-MARKER') > raw.indexOf('FIRST-MARKER'));
  const expected = prefix + raw;
  assert.deepEqual(readFileSync(file), Buffer.from(expected));
  assert.deepEqual(await f.call(id), { text: expected, bytes: Buffer.byteLength(expected), truncated: false });
  const freshReader = [
    "const { DatabaseSync } = await import('node:sqlite');",
    "const { buildMethods } = await import('./core/src/methods.ts');",
    "const db = new DatabaseSync(':memory:');",
    "db.exec('CREATE TABLE approval (id TEXT, status TEXT)');",
    "const handler = buildMethods(db, { engines: () => [], stop() {}, uiKey: 'fresh' }).get('session.output').handler;",
    'console.log(JSON.stringify(await handler({ session_id: ' + JSON.stringify(id) + " }, { ui: false, origin: 'test' })));",
    'db.close();',
  ].join('\n');
  const result = await runNode(['--input-type=module', '-e', freshReader], f.env);
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), { text: expected, bytes: Buffer.byteLength(expected), truncated: false });
});

test('session.output joins .log.1 before .log and counts kept UTF-8 bytes', async (t) => {
  const f = fixture(t);
  const id = 'kept_utf8-1';
  const older = 'older:é\x1b[31m';
  const current = 'newer:雪\x1b[0m';
  writeFileSync(join(f.output, id + '.log.1'), older);
  writeFileSync(join(f.output, id + '.log'), current);
  const all = Buffer.from(older + current);
  assert.deepEqual(await f.call(id, all.length), { text: older + current, bytes: all.length, truncated: false });
  const tail = Buffer.byteLength(current) + 4;
  assert.deepEqual(await f.call(id, tail), { text: all.subarray(-tail).toString('utf8'), bytes: all.length, truncated: true });
});

test('session.output reads a retained .log.1 when the current .log is absent', async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.output, 'rotated-only.log.1'), 'retained');
  assert.deepEqual(await f.call('rotated-only'), { text: 'retained', bytes: 8, truncated: false });
});

test('session.output defaults tail_bytes to 65536 across both kept files', async (t) => {
  const f = fixture(t);
  const older = 'o'.repeat(40000);
  const current = 'n'.repeat(40000);
  writeFileSync(join(f.output, 'default-tail.log.1'), older);
  writeFileSync(join(f.output, 'default-tail.log'), current);
  assert.deepEqual(await f.call('default-tail'), { text: (older + current).slice(-65536), bytes: 80000, truncated: true });
});

for (const tail of [-100, 0, 1, 5, 6, 99]) {
  test('session.output clamps lower tail_bytes and reports total bytes for tail ' + tail, async (t) => {
    const f = fixture(t);
    writeFileSync(join(f.output, 'small-tail.log.1'), 'abc');
    writeFileSync(join(f.output, 'small-tail.log'), 'def');
    const n = Math.min(6, Math.max(0, tail));
    assert.deepEqual(await f.call('small-tail', tail), { text: 'abcdef'.slice(6 - n), bytes: 6, truncated: n < 6 });
  });
}

for (const tail of [1048576, 1048577, Number.MAX_SAFE_INTEGER]) {
  test('session.output caps tail_bytes at 1048576 for request ' + tail, async (t) => {
    const f = fixture(t);
    const text = 'old-prefix:' + 'x'.repeat(1048576);
    writeFileSync(join(f.output, 'large-tail.log'), text);
    assert.deepEqual(await f.call('large-tail', tail), { text: 'x'.repeat(1048576), bytes: Buffer.byteLength(text), truncated: true });
  });
}

test('session.output reports lost output even when all kept bytes are returned', async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.output, 'lost.log.1'), 'old');
  writeFileSync(join(f.output, 'lost.log'), 'new');
  writeFileSync(join(f.output, 'lost.log.lost'), '');
  assert.deepEqual(await f.call('lost', 100), { text: 'oldnew', bytes: 6, truncated: true });
});

test('session.output reports a lost marker even when no kept bytes remain', async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.output, 'lost-only.log.lost'), '');
  assert.deepEqual(await f.call('lost-only'), { text: '', bytes: 0, truncated: true });
});

test('session.output returns an empty result for an unknown valid id', async (t) => {
  const f = fixture(t);
  assert.deepEqual(await f.call('unknown_session-123'), { text: '', bytes: 0, truncated: false });
  assert.deepEqual(await f.call('unknown_session-123', 0), { text: '', bytes: 0, truncated: false });
});

for (const id of ['../x', 'a/b', 'a\\b', '..', 'has.dot', 'has space', '']) {
  test('session.output rejects invalid id ' + JSON.stringify(id) + ' with INVALID_PARAMS', async (t) => {
    const f = fixture(t);
    await assert.rejects(async () => f.call(id), (error: any) => error.code === -32602);
  });
}

test('OUTPUT_LOG_MAX is the contracted 8 MiB', () => {
  assert.equal(term.OUTPUT_LOG_MAX, 8 * 1024 * 1024);
});

for (const replaceOlder of [false, true]) {
  test('a real pty rotates an oversized existing log' + (replaceOlder ? ', replaces .1 and marks lost output' : ' without marking loss'), async (t) => {
    const f = fixture(t);
    const id = 'output-' + randomUUID();
    f.ids.push(id);
    const file = join(f.output, id + '.log');
    const seeded = Buffer.alloc(term.OUTPUT_LOG_MAX + 1, 'p');
    writeFileSync(file, seeded);
    if (replaceOlder) writeFileSync(file + '.1', 'obsolete-output');
    term.open(id, [process.execPath, '-e', "process.stdout.write('ROTATION-MARKER'); setTimeout(() => process.exit(0), 200)"], f.home, f.env, 80, 24);
    await until(() => term.ptyPid(id) === null, 10000);
    assert.ok(f.chunks.join('').includes('ROTATION-MARKER'));
    assert.ok(existsSync(file + '.1'), 'the oversized log must be rotated');
    assert.deepEqual(readFileSync(file + '.1'), seeded);
    assert.deepEqual(readFileSync(file), Buffer.from(f.chunks.join('')));
    assert.equal(existsSync(file + '.lost'), replaceOlder);
    const tail = 32;
    const all = Buffer.concat([seeded, Buffer.from(f.chunks.join(''))]);
    assert.deepEqual(await f.call(id, tail), { text: all.subarray(-tail).toString('utf8'), bytes: all.length, truncated: true });
  });
}

test('the first real pty chunk crossing OUTPUT_LOG_MAX rotates immediately', { timeout: 15000 }, async (t) => {
  const f = fixture(t);
  const id = 'output-' + randomUUID();
  f.ids.push(id);
  const file = join(f.output, id + '.log');
  writeFileSync(file, Buffer.alloc(term.OUTPUT_LOG_MAX, 'b'));
  term.open(id, [process.execPath, '-e', "process.stdout.write('CROSSING-MARKER'); setTimeout(() => process.exit(0), 1500)"], f.home, f.env, 80, 24);
  await f.firstChunk;
  try {
    assert.ok(existsSync(file + '.1'), 'the chunk crossing 8 MiB must rotate without waiting for another chunk');
    assert.ok(existsSync(file), 'rotation must start a fresh current log');
    assert.ok(statSync(file).size <= term.OUTPUT_LOG_MAX);
  } finally {
    await until(() => term.ptyPid(id) === null, 10000);
  }
});

test('pruneScreens removes old output files and keeps new files at the requested age', (t) => {
  const f = fixture(t);
  const now = Date.UTC(2030, 0, 1);
  const day = 86400000;
  const days = 7;
  for (const suffix of ['.log', '.log.1', '.log.lost']) {
    for (const [id, age] of [['old', days * day + 1000], ['boundary', days * day], ['new', day]] as const) {
      const file = join(f.output, id + suffix);
      writeFileSync(file, id);
      utimesSync(file, new Date(now - age), new Date(now - age));
    }
  }
  term.pruneScreens(days, now);
  for (const suffix of ['.log', '.log.1', '.log.lost']) {
    assert.equal(existsSync(join(f.output, 'old' + suffix)), false, 'old ' + suffix);
    assert.equal(readFileSync(join(f.output, 'boundary' + suffix), 'utf8'), 'boundary');
    assert.equal(readFileSync(join(f.output, 'new' + suffix), 'utf8'), 'new');
  }
});
