import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'm5-04-logs-'));
process.env.METATROOPER_HOME = home;
process.env.METATROOPER_FAKE_DPAPI = '1';
const { appendLog, LOG_MAX_BYTES } = await import('../src/log.ts');
const { setSecret } = await import('../src/secrets.ts');
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE plugin_secret (plugin_id TEXT, name TEXT, blob_path TEXT, set_at TEXT, PRIMARY KEY(plugin_id, name))');

before(() => fs.mkdirSync(path.join(home, 'logs'), { recursive: true }));
after(() => fs.rmSync(home, { recursive: true, force: true }));

test('M5-04a: uncaught core exception writes its stack to core.log', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const childHome = fs.mkdtempSync(path.join(os.tmpdir(), 'm5-04-core-crash-'));
  try {
    const logModule = new URL('../src/log.ts', import.meta.url).href;
    const source = `process.env.METATROOPER_HOME = ${JSON.stringify(childHome)};\nconst { captureProcessLog } = await import(${JSON.stringify(logModule)});\ncaptureProcessLog('core');\nsetTimeout(() => { throw new Error('m5-04 crash sentinel'); }, 5);`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: root,
      env: { ...process.env, METATROOPER_HOME: childHome, METATROOPER_FAKE_DPAPI: '1' },
      encoding: 'utf8',
    });
    assert.notEqual(child.status, 0, 'thrown core error should terminate with a failure status');
    assert.ok(fs.existsSync(path.join(childHome, 'logs', 'core.log')), `child stderr: ${child.stderr}`);
    const log = fs.readFileSync(path.join(childHome, 'logs', 'core.log'), 'utf8');
    assert.match(log, /m5-04 crash sentinel/);
    assert.match(log, /Error: m5-04 crash sentinel/);
    assert.match(log, /uncaughtException/);
    const sentinelLines = log.split('\n').filter((line) => line.includes('m5-04 crash sentinel'));
    assert.ok(sentinelLines.length > 0);
    for (const line of sentinelLines) assert.match(line, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z /);
  } finally {
    fs.rmSync(childHome, { recursive: true, force: true });
  }
});

test('M5-04b: values saved in the secret store are redacted from plugin output', () => {
  const secret = `secret-${Math.random().toString(36).slice(2)}-value`;
  setSecret(db, 'm5-04-test-plugin', 'TOKEN', secret);
  appendLog('plugin-output', `plugin printed ${secret} twice: ${secret}\n`);
  const files = fs.readdirSync(path.join(home, 'logs'));
  assert.ok(files.length > 0);
  for (const file of files) {
    const content = fs.readFileSync(path.join(home, 'logs', file), 'utf8');
    assert.equal(content.includes(secret), false, `${file} leaked the stored secret`);
  }
  assert.match(fs.readFileSync(path.join(home, 'logs', 'plugin-output.log'), 'utf8'), /\[secret\].*\[secret\]/);
});

test('M5-04c: 6 MB of writes retain at most three files, each no larger than 5 MB', () => {
  const line = 'x'.repeat(1024 * 1024);
  for (let index = 0; index < 6; index++) appendLog('rotate', line);
  const files = fs.readdirSync(path.join(home, 'logs')).filter((name) => /^rotate\.log(?:\.\d)?$/.test(name));
  assert.ok(files.length <= 3, `found ${files.length} rotation files`);
  for (const file of files) {
    assert.ok(fs.statSync(path.join(home, 'logs', file)).size <= LOG_MAX_BYTES, `${file} exceeds 5 MB`);
  }
  assert.equal(files.length, 2);
});

test('M5-04b: three-character secret values stay visible in logs', () => {
  setSecret(db, 'm5-04-short-secret', 'TOKEN', 'abc');
  appendLog('short-secret', 'value abc remains visible\n');
  assert.equal(fs.readFileSync(path.join(home, 'logs', 'short-secret.log'), 'utf8'), 'value abc remains visible\n');
});

test('M5-04a: unhandled rejections are logged before the child exits', () => {
  const root = path.resolve(import.meta.dirname, '../..');
  const childHome = fs.mkdtempSync(path.join(os.tmpdir(), 'm5-04-rejection-'));
  try {
    const logModule = new URL('../src/log-core.ts', import.meta.url).href;
    const source = `process.env.METATROOPER_HOME = ${JSON.stringify(childHome)};\nawait import(${JSON.stringify(logModule)});\nPromise.reject(new Error('m5-04 rejection sentinel'));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], {
      cwd: root,
      env: { ...process.env, METATROOPER_HOME: childHome, METATROOPER_FAKE_DPAPI: '1' },
      encoding: 'utf8',
    });
    assert.equal(child.status, 1, `child stderr: ${child.stderr}`);
    const log = fs.readFileSync(path.join(childHome, 'logs', 'core.log'), 'utf8');
    assert.match(log, /unhandledRejection/);
    assert.match(log, /m5-04 rejection sentinel/);
  } finally {
    fs.rmSync(childHome, { recursive: true, force: true });
  }
});

test('M5-04c: rotation never creates a fourth retained file', () => {
  const line = 'y'.repeat(1024 * 1024);
  for (let index = 0; index < 20; index++) appendLog('many-rotations', line);
  const files = fs.readdirSync(path.join(home, 'logs')).filter((name) => /^many-rotations\.log(?:\.\d+)?$/.test(name));
  assert.ok(files.length <= 3, `found ${files.length} rotation files: ${files.join(', ')}`);
  assert.equal(fs.existsSync(path.join(home, 'logs', 'many-rotations.log.3')), false);
});
