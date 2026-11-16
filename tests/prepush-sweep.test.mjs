import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { posix } from 'node:path';
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Exercise the CLI's report with synthetic Git output: no Git process is spawned.
const scriptUrl = new URL('./prepush-sweep.mjs', import.meta.url);
const source = readFileSync(scriptUrl, 'utf8').replace(/^import .*;\r?\n/gm, '')
  .replaceAll('import.meta.url', JSON.stringify(scriptUrl.href));
const library = source.slice(0, source.lastIndexOf('\ntry {')) + '\n({ sweep, junkPath, wordPattern });';
const newest = 'a'.repeat(40);
const older = 'b'.repeat(40);

async function report(files, message = '', status = '', options = {}) {
  const commits = [newest, older];
  const fields = commits.flatMap(sha => [sha, 'User', 'u@example.com', 'User', 'u@example.com', message]).join('\0') + '\0';
  const patch = commits.flatMap(sha => [`\x1e${sha}`, ...Object.entries(files).flatMap(([file, lines]) => [
    `diff --git a/${file} b/${file}`, `+++ b/${file}`, '@@ -0,0 +1 @@', ...lines.map(line => `+${line}`),
  ])]).join('\n') + '\n';
  const api = runInNewContext(library, {
    process, URL, createInterface, posix,
    readFileSync: options.allowlist ? () => JSON.stringify(options.allowlist) : readFileSync,
    spawnSync(_exe, args) {
      const command = args[5];
      let stdout = '';
      if (command === 'rev-parse') stdout = args.at(-1).startsWith('origin/main') ? 'c'.repeat(40) : newest;
      else if (command === 'log') stdout = fields;
      else if (command === 'diff-tree') stdout = Object.keys(files).map(file => `:100644 100644 ${'d'.repeat(40)} ${'e'.repeat(40)} M\0${file}\0`).join('');
      else if (command === 'cat-file') stdout = `${'e'.repeat(40)} blob ${options.blobSize ?? 100}\n`;
      else if (command === 'status') stdout = status;
      else if (!['diff', 'rev-list', 'merge-base'].includes(command)) throw new Error(`Unexpected command ${command}`);
      return { status: 0, stdout, stderr: '' };
    },
    spawn() {
      const child = new EventEmitter();
      child.stdout = Readable.from([patch]);
      child.stderr = Readable.from([]);
      child.stdout.on('end', () => setImmediate(() => child.emit('close', 0)));
      return child;
    },
  });
  return api.sweep({ base: 'origin/main', head: 'HEAD' });
}

test('common product words require capitalisation and whole words', async () => {
  const result = await report({}, 'agent cursor warp zed conductor superset Cursor Warp Zed Conductor Superset Cursorish T3CODE T3 CODE paperclip HERDR CONDUCTOR.BUILD');
  assert.equal(result.findings.length, 10);
  assert.ok(result.findings.every(f => f.commitCount === 2 && f.commit === newest.slice(0, 8)));
});

test('dedupes masked findings across commits and repeated lines', async () => {
  const result = await report({ 'issues/example.txt': ["token='abcdefghijklmnop'", "token='abcdefghijklxxxx'"] });
  assert.equal(result.failures, 1);
  assert.equal(result.findings[0].commitCount, 2);
  assert.equal(result.findings[0].commit, newest.slice(0, 8));
  assert.equal(result.findings[0].text, 'abcd[REDACTED]');
});

test('only root dist is junk, including for untracked warnings', async () => {
  const result = await report({ 'core/dist/main.js': [], 'dist/main.js': [] }, '', '?? core/dist/local.js\0?? dist/local.js\0');
  assert.equal(result.failures, 1);
  assert.equal(result.warnings, 1);
  assert.equal(result.findings.find(f => f.severity === 'fail').commitCount, 2);
});

test('fixture allowlist is visible and bundle tokens still fail', async () => {
  const token = 'ghp_' + 'a'.repeat(36);
  const result = await report({
    'core/test/redact-wide.test.ts': [`token='${token}'`, '/home/alice/file'],
    'core/test/packaged-node-hooks.test.ts': ['/home/alice/file'],
    'workbench/renderer/ui.bundle.js': ["token='abcdefghijklmnop'", `token='${token}'`, 'sk-' + 'a'.repeat(20), 'AKIA' + 'A'.repeat(16)],
    'issues/example.txt': ["token='abcdefghijklmnop'", '/home/alice/file'],
    'router/tests/example.ts': ["token='abcdefghijklmnop'", '/home/alice/file'],
  });
  assert.equal(result.allowed, 4);
  assert.equal(result.failures, 7);
  assert.ok(result.findings.filter(f => f.severity === 'allowed').every(f => f.reason && f.commitCount === 2));
  assert.equal(result.groupedCounts.secrets.allowed, 2);
  assert.equal(result.groupedCounts['personal-paths'].allowed, 2);
  assert.equal(result.exitCode, 1);
  assert.equal((await report({ 'core/test/redact-wide.test.ts': [token] })).exitCode, 0);
});

test('large blobs retain each path and count distinct commits', async () => {
  const result = await report({ 'one.bin': [], 'two.bin': [] }, '', '', { blobSize: 6 * 1024 * 1024 });
  assert.equal(result.failures, 2);
  assert.ok(result.findings.every(f => f.check === 'big-files' && f.commitCount === 2 && f.commit === newest.slice(0, 8)));
});

test('allowlist globs match whole repository-relative paths', async () => {
  const result = await report({ 'core/test/fixture.ts': ['/home/alice/file'], 'issues/fixture.ts': ['/home/alice/file'] }, '', '', {
    allowlist: [{ check: 'personal-paths', path: 'core/test/*.ts', reason: 'Fixture paths' }],
  });
  assert.equal(result.allowed, 1);
  assert.equal(result.failures, 1);
  assert.equal(result.findings.find(f => f.severity === 'allowed').reason, 'Fixture paths');
});

test('malformed allowlist is an error rather than an implicit exemption', async () => {
  await assert.rejects(report({}, '', '', { allowlist: [{ check: 'secrets', path: '**' }] }), /Invalid.*allow.json/);
});
