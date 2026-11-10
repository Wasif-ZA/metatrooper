import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const app = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
function declaration(name: string) {
  const start = app.indexOf('function ' + name + '(');
  assert.notEqual(start, -1);
  const end = app.indexOf('\n}', start);
  assert.notEqual(end, -1);
  return app.slice(start, end + 2);
}

test('M8-S4b lent pane and signed_in server contracts with fake Electron', t => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--experimental-test-module-mocks', '--no-warnings', '--test', '--test-reporter=tap', fileURLToPath(new URL('./fixtures/m8-s4b-lent-pane.ts', import.meta.url))], { env, encoding: 'utf8', timeout: 30000 });
  const output = result.stdout + result.stderr;
  t.diagnostic(output);
  assert.ifError(result.error);
  assert.equal(result.status, 0, output);
  assert.match(output, /^# pass 17$/m);
  assert.match(output, /^# fail 0$/m);
  assert.match(output, /^# todo 0$/m);
});

test('the lend-set renderer action sends literal lend.set parameters', async () => {
  const calls: unknown[] = [];
  const onClick = runInNewContext('(async ' + declaration('onClick') + ')', { rpc: async (...args: unknown[]) => { calls.push(args); } });
  await onClick({ stopPropagation() {}, target: { closest: () => ({ tagName: 'BUTTON', dataset: { action: 'lend-set', project: 'A', origin: 'https://shop.example' }, closest: () => null }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [['lend.set', { project_id: 'A', origin: 'https://shop.example', on: true }]]);
});
