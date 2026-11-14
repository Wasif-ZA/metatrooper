import test from 'node:test';
import assert from 'node:assert/strict';
import { scrub } from '../src/redact.ts';

const hidden: Array<[string, string]> = [
  ['PASSWORD=hunter2', 'hunter2'],
  ['export GITHUB_TOKEN="abc123def456"', 'abc123def456'],
  ['  "api_key": "plain-value-here",', 'plain-value-here'],
  ['DB_PASS: s3cr3t!', 's3cr3t!'],
  ["set AWS_SECRET_ACCESS_KEY='wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'", 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'],
  ['client_secret = 7c3f9a1e', '7c3f9a1e'],
  ['curl -H "Authorization: Bearer abc.def.ghi123"', 'abc.def.ghi123'],
  ['key sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz012345', 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz012345'],
  ['token ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
  ['aws AKIAIOSFODNN7EXAMPLE here', 'AKIAIOSFODNN7EXAMPLE'],
  ['-----BEGIN OPENSSH PRIVATE KEY-----', 'BEGIN OPENSSH PRIVATE KEY'],
  ['b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW', 'b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW'],
  ['generic a8f5k2m9q4w7e1r6t3y0u5i8o2p4s6d9 token', 'a8f5k2m9q4w7e1r6t3y0u5i8o2p4s6d9'],
  ['npm_9xK2p8QmW4vR7tL1nZ5cY3hB6jD0fGsA2eUo', 'npm_9xK2p8QmW4vR7tL1nZ5cY3hB6jD0fGsA2eUo'],
];

const kept = [
  'commit 0b6dbe7b3c1e5f0a9d8c7b6a5f4e3d2c1b0a9f8e merged',
  'HEAD is now at 0b6dbe7b README stats row',
  'session 01M454ZKZD9VF9BGKG54PMXM2S is idle',
  'request 3fa85f64-5717-4562-b3fc-2c963f66afa6 done',
  'C:/Users/User/teehee/projects/cc-pro/bin/tasks-mcp.mjs:42:7',
  'node_modules/@openai/codex/bin/codex.js',
  'ok 12 - test_tasks_list_shows_only_project_2026_11_15',
  'at 2026-11-15T06:25:00.000Z the build passed',
  'The password is wrong, try again',
  'Author: Ada Lovelace <ada@example.com>',
  'oauth_callback: http://127.0.0.1:8080/callback',
  'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
];

for (const [line, secret] of hidden) {
  test(`scrub hides: ${line.slice(0, 50)}`, () => {
    const out = scrub(line);
    assert.ok(!out.includes(secret), out);
    assert.match(out, /\[secret\]/, out);
  });
}

for (const line of kept) {
  test(`scrub keeps: ${line.slice(0, 50)}`, () => {
    assert.equal(scrub(line), line);
  });
}

test('scrub keeps the key name of a redacted assignment', () => {
  assert.equal(scrub('PASSWORD=hunter2'), 'PASSWORD=[secret]');
  assert.equal(scrub('DB_PASS: s3cr3t!'), 'DB_PASS: [secret]');
});
