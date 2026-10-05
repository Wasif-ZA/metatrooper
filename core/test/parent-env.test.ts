import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isolation, sleep, until } from './helpers.ts';

const moduleHome = isolation();
const term = await import('../src/terminal/index.ts');

test('terminal pty drops parent Claude session environment and preserves other variables', async () => {
  const id = `parent-env-${randomUUID()}`;
  const env = {
    ...moduleHome.env,
    CLAUDECODE: 'parent',
    CLAUDE_CODE_CHILD_SESSION: 'child',
    CLAUDE_CODE_MESSAGING_TOKEN: 'secret',
    CLAUDE_CODE_USE_BEDROCK: '1',
    PATH: process.env.PATH ?? '',
  };
  const code = "for (const k of ['CLAUDECODE','CLAUDE_CODE_CHILD_SESSION','CLAUDE_CODE_MESSAGING_TOKEN','CLAUDE_CODE_USE_BEDROCK','PATH']) console.log('ENV:'+k+'='+(k in process.env ? 'set' : 'unset'))";  term.open(id, [process.execPath, '-e', code], moduleHome.home, env, 100, 10);
  try {
    const output = await until(async () => {
      const value = (await term.snapshot(id))?.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
      const lines = value?.match(/^ENV:(?:CLAUDECODE|CLAUDE_CODE_CHILD_SESSION|CLAUDE_CODE_MESSAGING_TOKEN|CLAUDE_CODE_USE_BEDROCK|PATH)=(?:set|unset)$/gm);
      return lines?.length === 5 ? lines.join('\n') : null;
    });
    const childEnv = Object.fromEntries([...output.matchAll(/^ENV:(\w+)=(set|unset)$/gm)].map(([, key, state]) => [key, state]));
    assert.deepEqual(
      ['CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_MESSAGING_TOKEN'].filter((key) => childEnv[key] === 'set'),
      [],
    );
    assert.equal(childEnv.CLAUDE_CODE_USE_BEDROCK, 'set');
    assert.equal(childEnv.PATH, 'set');
  } finally {
    term.kill(id);
    await until(() => !term.has(id));
    await sleep(100);
  }
});
