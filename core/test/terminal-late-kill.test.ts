import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { isolation, sleep, until } from './helpers.ts';

const home = isolation();
const prior = { METATROOPER_HOME: process.env.METATROOPER_HOME, METATROOPER_PIPE_PREFIX: process.env.METATROOPER_PIPE_PREFIX, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
let term: typeof import('../src/terminal/index.ts');

before(async () => {
  if (process.platform !== 'win32') return;
  Object.assign(process.env, { METATROOPER_HOME: home.home, METATROOPER_PIPE_PREFIX: home.prefix, HOME: home.home, USERPROFILE: home.home });
  term = await import('../src/terminal/index.ts');
});

after(async () => {
  try {
    term?.killAll();
    if (term) await until(() => !term.anyOpen(), 5000);
  } finally {
    rmSync(home.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    for (const [k, v] of Object.entries(prior)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});

test('killing a terminal never signals its pid after it has exited', { skip: process.platform !== 'win32' }, async t => {
  const calls: Array<{ pid: number; at: number }> = [];
  const original = process.kill;
  t.after(() => { process.kill = original; });
  process.kill = (pid, signal) => {
    calls.push({ pid, at: performance.now() });
    return original.call(process, pid, signal);
  };

  const id = 'terminal-late-kill';
  const pid = term.open(id, [process.execPath, '-e', 'setInterval(()=>{},1000)'], home.home, process.env, 80, 10);
  await sleep(500);
  assert.ok(term.has(id));
  term.kill(id);
  await until(() => !term.has(id), 5000);
  const exitedAt = performance.now();

  await sleep(6500);
  await until(() => !term.anyOpen(), 5000);
  assert.deepEqual(calls.filter(call => call.pid === pid && call.at > exitedAt), [], 'process.kill must not target the terminal pid after exit');
});
