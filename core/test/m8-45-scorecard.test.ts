import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('M8-45b groups, calculates, and orders the complete scorecard', async () => {
  const { scorecard, MIN_RUNS, RECENT_RUNS, WORSE_DROP } = await import('../src/scorecard.ts');
  assert.equal(MIN_RUNS, 5);
  assert.equal(RECENT_RUNS, 5);
  assert.equal(WORSE_DROP, 0.2);
  const run = (repo: string, engine: string, day: number, checksPassed: boolean, repairTries: number, undone: boolean, usd: number | null) =>
    ({ repo, engine, at: '2026-01-' + String(day).padStart(2, '0') + 'T00:00:00Z', checksPassed, repairTries, undone, usd });
  const records = [
    run('beta', 'C', 1, true, 1, false, null),
    run('alpha', 'B', 1, true, 0, false, 2),
    run('alpha', 'C', 1, true, 1, true, 0),
    run('alpha', 'A', 1, true, 0, false, 0),
    run('beta', 'A', 1, false, 0, true, 2),
    run('alpha', 'B', 2, true, 2, true, 2),
    run('alpha', 'A', 2, false, 1, true, 2),
    run('alpha', 'C', 2, false, 1, false, 0),
    run('beta', 'C', 2, false, 1, false, null),
    run('alpha', 'A', 3, true, 2, false, 4),
    run('alpha', 'B', 3, true, 0, false, 2),
    run('alpha', 'C', 3, true, 1, true, 0),
    run('beta', 'A', 2, true, 3, false, null),
    run('alpha', 'B', 4, false, 2, true, 2),
    run('alpha', 'C', 4, false, 1, false, 0),
    run('alpha', 'A', 4, true, 1, false, null),
    run('beta', 'C', 3, true, 1, false, null),
    run('alpha', 'C', 5, true, 1, true, 0),
    run('alpha', 'A', 5, true, 1, false, null),
    run('alpha', 'B', 5, true, 1, false, 2),
    run('beta', 'A', 3, true, 0, false, 4),
    run('beta', 'C', 4, false, 1, false, null),
  ];
  assert.deepEqual(scorecard(records), [
    { repo: 'alpha', note: null, rows: [
      { engine: 'A', repo: 'alpha', runs: 5, passRate: 0.8, repairTriesPerRun: 1, undoRate: 0.2, usdPerRun: 2, pricedRuns: 3, enough: true, rank: 1, worse: false, recentPassRate: null, earlierPassRate: null },
      { engine: 'B', repo: 'alpha', runs: 5, passRate: 0.8, repairTriesPerRun: 1, undoRate: 0.4, usdPerRun: 2, pricedRuns: 5, enough: true, rank: 2, worse: false, recentPassRate: null, earlierPassRate: null },
      { engine: 'C', repo: 'alpha', runs: 5, passRate: 0.6, repairTriesPerRun: 1, undoRate: 0.6, usdPerRun: 0, pricedRuns: 5, enough: true, rank: 3, worse: false, recentPassRate: null, earlierPassRate: null },
    ] },
    { repo: 'beta', note: 'not enough runs', rows: [
      { engine: 'A', repo: 'beta', runs: 3, passRate: 2 / 3, repairTriesPerRun: 1, undoRate: 1 / 3, usdPerRun: 3, pricedRuns: 2, enough: false, rank: null, worse: false, recentPassRate: null, earlierPassRate: null },
      { engine: 'C', repo: 'beta', runs: 4, passRate: 0.5, repairTriesPerRun: 1, undoRate: 0, usdPerRun: null, pricedRuns: 0, enough: false, rank: null, worse: false, recentPassRate: null, earlierPassRate: null },
    ] },
  ]);
});

test('M8-45c flags deterioration by time, including an exact 0.2 drop, with enough history', async () => {
  const { scorecard } = await import('../src/scorecard.ts');
  const runs = (engine: string, passes: boolean[]) => passes.map((checksPassed, i) => ({
    engine, repo: 'repo', at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), checksPassed, repairTries: 0, undone: false, usd: null,
  }));
  const records = [
    ...runs('A', [true, true, true, true, true, true, true, false, false, false]),
    ...runs('B', [true, true, true, true, false, true, true, true, true, false]),
  ].reverse();
  const rows = scorecard(records)[0].rows;
  assert.deepEqual(rows.map(({ engine, worse, earlierPassRate, recentPassRate }) => ({ engine, worse, earlierPassRate, recentPassRate })), [
    { engine: 'B', worse: false, earlierPassRate: 0.8, recentPassRate: 0.8 },
    { engine: 'A', worse: true, earlierPassRate: 1, recentPassRate: 0.4 },
  ]);
  const boundary = scorecard(runs('A', [true, true, true, true, true, true, true, true, true, false]))[0].rows[0];
  assert.equal(boundary.earlierPassRate, 1);
  assert.equal(boundary.recentPassRate, 0.8);
  assert.equal(boundary.worse, true);
  const shortHistory = scorecard(runs('A', [true, true, true, true, false, false, false, false, false]))[0].rows[0];
  assert.equal(shortHistory.earlierPassRate, null);
  assert.equal(shortHistory.recentPassRate, null);
  assert.equal(shortHistory.worse, false);
});

test('M8-45d ranks only eligible engines and reports repos with insufficient runs', async () => {
  const { scorecard } = await import('../src/scorecard.ts');
  const runs = (repo: string, engine: string, count: number, usd: number | null) => Array.from({ length: count }, (_, i) => ({
    repo, engine, at: new Date(Date.UTC(2026, 0, i + 1)).toISOString(), checksPassed: true, repairTries: 0, undone: false, usd,
  }));
  const cards = scorecard([
    ...runs('short', 'B', 4, 0), ...runs('short', 'A', 4, null),
    ...runs('mixed', 'A', 5, null), ...runs('mixed', 'C', 4, 0),
    ...runs('mixed', 'D', 4, 0), ...runs('mixed', 'B', 5, 2),
    ...runs('mixed', 'E', 5, 1),
  ]);
  assert.deepEqual(cards.map(({ repo, note, rows }) => ({ repo, note, rows: rows.map(({ engine, enough, rank }) => ({ engine, enough, rank })) })), [
    { repo: 'mixed', note: null, rows: [
      { engine: 'E', enough: true, rank: 1 },
      { engine: 'B', enough: true, rank: 2 },
      { engine: 'A', enough: true, rank: 3 },
      { engine: 'C', enough: false, rank: null },
      { engine: 'D', enough: false, rank: null },
    ] },
    { repo: 'short', note: 'not enough runs', rows: [
      { engine: 'A', enough: false, rank: null },
      { engine: 'B', enough: false, rank: null },
    ] },
  ]);
});

test('M8-45e preserves each row record count and counts only valid prices', async () => {
  const { scorecard } = await import('../src/scorecard.ts');
  const runs = (repo: string, engine: string, prices: (number | null)[]) => prices.map((usd) => ({
    repo, engine, at: '2026-01-01T00:00:00Z', checksPassed: true, repairTries: 0, undone: false, usd,
  }));
  const rows = scorecard([
    ...runs('alpha', 'A', [0, 2, null, NaN, -1, Infinity, -Infinity]),
    ...runs('alpha', 'B', [null, NaN, -1]),
    ...runs('beta', 'A', [4, 8, 0, null]),
  ]).flatMap(({ rows }) => rows);
  assert.deepEqual(rows.map(({ repo, engine, runs, pricedRuns, usdPerRun }) => ({ repo, engine, runs, pricedRuns, usdPerRun })), [
    { repo: 'alpha', engine: 'A', runs: 7, pricedRuns: 2, usdPerRun: 1 },
    { repo: 'alpha', engine: 'B', runs: 3, pricedRuns: 0, usdPerRun: null },
    { repo: 'beta', engine: 'A', runs: 4, pricedRuns: 3, usdPerRun: 4 },
  ]);
});

test('M8-45f has no external dependencies or network access and works with fetch disabled', async () => {
  const source = fs.readFileSync(new URL('../src/scorecard.ts', import.meta.url), 'utf8');
  for (const forbidden of [/\bimport\b/, /\brequire\s*\(/, /\bfetch\s*\(/, /http/i, /\bnet\b/, /WebSocket/]) {
    assert.doesNotMatch(source, forbidden);
  }
  const previousFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('scorecard must work offline'); };
  try {
    const { scorecard } = await import('../src/scorecard.ts');
    assert.deepEqual(scorecard([]), []);
    const cards = scorecard([{ engine: 'A', repo: 'repo', at: '2026-01-01T00:00:00Z', checksPassed: true, repairTries: 0, undone: false, usd: 0 }]);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].repo, 'repo');
    assert.equal(cards[0].rows[0].passRate, 1);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('M8-45 hostile input skips invalid identifiers and dates, normalizes numbers, and is not mutated', async () => {
  const { scorecard } = await import('../src/scorecard.ts');
  const base = { engine: 'A', repo: 'repo', at: '2026-01-01T00:00:00Z', checksPassed: true, repairTries: 2, undone: false, usd: 2 };
  const records = [
    { ...base, at: '2026-01-05T00:00:00Z', repairTries: -3, usd: NaN },
    { ...base, engine: null }, { ...base, engine: '' }, { ...base, engine: 42 },
    { ...base, repo: null }, { ...base, repo: '' }, { ...base, repo: 42 },
    { ...base, at: 'not-a-date' }, { ...base, at: '' },
    { ...base, at: '2026-01-04T00:00:00Z', repairTries: NaN, usd: -1, checksPassed: false, undone: true },
    { ...base, at: '2026-01-03T00:00:00Z', repairTries: Infinity, usd: Infinity },
    { ...base, at: '2026-01-02T00:00:00Z', repairTries: -Infinity, usd: null },
    base,
  ];
  const before = structuredClone(records);
  // Deliberately malformed identifiers exercise runtime validation beyond the public type.
  const result = scorecard(records as Parameters<typeof scorecard>[0]);
  assert.deepEqual(records, before);
  assert.deepEqual(result, [{ repo: 'repo', note: null, rows: [
    { engine: 'A', repo: 'repo', runs: 5, passRate: 0.8, repairTriesPerRun: 0.4, undoRate: 0.2, usdPerRun: 2, pricedRuns: 1, enough: true, rank: 1, worse: false, recentPassRate: null, earlierPassRate: null },
  ] }]);
});
