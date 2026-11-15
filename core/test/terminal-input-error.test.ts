import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { isolation, until } from './helpers.ts';

const home = isolation();
const prior = { METATROOPER_HOME: process.env.METATROOPER_HOME, METATROOPER_PIPE_PREFIX: process.env.METATROOPER_PIPE_PREFIX, HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
let term: typeof import('../src/terminal/index.ts');

before(async () => {
  Object.assign(process.env, { METATROOPER_HOME: home.home, METATROOPER_PIPE_PREFIX: home.prefix, HOME: home.home, USERPROFILE: home.home });
  term = await import('../src/terminal/index.ts');
});

after(() => {
  term?.killAll();
  rmSync(home.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  for (const [k, v] of Object.entries(prior)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

const ECHO = "process.stdin.setEncoding('utf8');process.stdin.on('data',d=>process.stdout.write('GOT:'+d));setInterval(()=>{},1000)";

test('Windows terminal input survives an EAGAIN socket error', { skip: process.platform !== 'win32' }, async t => {
  const id = 'input-error';
  const uncaught: Error[] = [];
  const onUncaught = (error: Error) => uncaught.push(error);
  process.on('uncaughtException', onUncaught);
  t.after(() => process.off('uncaughtException', onUncaught));
  term.open(id, [process.execPath, '-e', ECHO], home.home, process.env, 400, 10);
  try {
    const socket = term.inputSocketOf(id);
    assert.ok(socket, 'the Windows terminal has an input socket');
    const error = Object.assign(new Error('write EAGAIN'), { code: 'EAGAIN', errno: -4088, syscall: 'write' });
    assert.doesNotThrow(() => socket.emit('error', error));
    assert.equal(term.write(id, 'ping\r'), true);
    await until(async () => (await term.screenText(id))?.includes('GOT:ping'), 5000);
  } finally {
    term.kill(id);
    await until(() => !term.has(id), 5000);
  }
  assert.deepEqual(uncaught, []);
});
