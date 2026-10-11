import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { buildGenerated, isolation, sleep, until } from './helpers.ts';

const home = isolation();
const prior = { ...process.env };
let term: typeof import('../src/terminal/index.ts');

before(async () => {
  await buildGenerated();
  Object.assign(process.env, home.env);
  term = await import('../src/terminal/index.ts');
});

after(async () => {
  term?.killAll();
  await sleep(100);
  rmSync(home.home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
  Object.assign(process.env, prior);
});

const printer = (lines: string[]) => [process.execPath, '-e', `for (const l of ${JSON.stringify(lines)}) console.log(l); setInterval(() => {}, 1000)`];

test('M6-19a a unique marker printed in one of 4 terminals is found case insensitively within 1 s', async () => {
  const marker = `Marker-${randomUUID()}`;
  const ids = [0, 1, 2, 3].map((n) => `search-${n}-${randomUUID()}`);
  ids.forEach((id, n) => term.open(id, printer([...Array.from({ length: 200 }, (_, i) => `filler ${n} ${i}`), ...(n === 2 ? [marker] : []), `done-${n}`]), home.home, process.env));
  try {
    for (const [n, id] of ids.entries()) await until(async () => (await term.snapshot(id))?.includes(`done-${n}`), 15_000);
    const start = performance.now();
    const hits = await term.search(marker.toLowerCase(), 50);
    assert.ok(performance.now() - start < 1000);
    assert.equal(hits.length, 1, JSON.stringify(hits));
    assert.equal(hits[0].session_id, ids[2]);
    assert.equal(hits[0].text, marker);
    assert.ok(hits[0].line > 0);
  } finally {
    for (const id of ids) term.kill(id);
    await until(() => ids.every((id) => !term.has(id)));
  }
});

test('M6-19 search keeps at most 50 hits, newest first', async () => {
  const id = `search-many-${randomUUID()}`;
  term.open(id, printer([...Array.from({ length: 80 }, (_, i) => `ROW-${i}`), 'ROWS-DONE']), home.home, process.env);
  try {
    await until(async () => (await term.snapshot(id))?.includes('ROWS-DONE'), 15_000);
    const hits = (await term.search('row-', 50)).filter((h) => h.session_id === id);
    assert.equal(hits.length, 50);
    assert.equal(hits[0].text, 'ROW-79');
    assert.equal(hits[49].text, 'ROW-30');
  } finally {
    term.kill(id);
    await until(() => !term.has(id));
  }
});

test('M6-19 session.search is never queued, so scrollback text stays out of the command table', async () => {
  const { isQueueable } = await import('../src/pipe/commands.ts');
  assert.equal(isQueueable('session.search'), false);
});
