import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
const fn = (name: string) => source.match(new RegExp(`^(?:async )?function ${name}\\([^]*?\\n}\\n`, 'm'))![0];
const line = (start: string) => source.split('\n').find((l) => l.startsWith(start))!;

test('a second Launch click while the first is pending is ignored', async () => {
  let release!: () => void;
  let calls = 0;
  const api = { call: () => { calls++; return new Promise((r) => { release = () => r({ kind: 'reply', reply: { result: { session_id: 's' } } }); }); } };
  const toasts: string[] = [];
  const ui: any = {};
  const rpc = new Function('api', 'ui', 'toast', `${line('const ONE_AT_A_TIME')}\n${fn('rpc')}\n${fn('rpcOnce')}; return rpc;`)(api, ui, (t: string) => toasts.push(t));
  const first = rpc('session.launch', {});
  const second = await rpc('session.launch', {});
  assert.equal(calls, 1);
  assert.ok(second.error);
  release();
  assert.deepEqual(await first, { result: { session_id: 's' } });
  const third = rpc('session.launch', {});
  assert.equal(calls, 2);
  release();
  await third;
});
