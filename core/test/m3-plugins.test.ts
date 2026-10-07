import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { check, normalise } from '../../plugins/cite-check/bin/cite-check.js';
import { search, queriesOf } from '../../plugins/agent-reach/bin/search.js';
import { parseCsv, load, query, render, kpiBlocks } from '../../plugins/data/bin/data.js';
import { listDeps, licenceReport } from '../../plugins/security/bin/security.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'm3-plugins-'));
}

function write(file, text) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, text);
}

function writeJson(file, value) {
  write(file, JSON.stringify(value, null, 2));
}

test('cite-check rejects a planted quote and accepts a curly quote with extra spaces', async () => {
  const dir = tempDir();
  try {
    write(join(dir, 'source.txt'), 'A real quote says the green roof reduced peak indoor temperature by eight degrees during summer.');
    writeJson(join(dir, 'sources.json'), [{ id: 's1', path: 'source.txt' }]);
    const report = join(dir, 'report.md');
    const out = join(dir, 'run');
    mkdirSync(out);
    write(report, 'The report claims “the roof reduced indoor temperature by 800 degrees” [s1].\n');
    const bad = await check({ report, sources: join(dir, 'sources.json') }, out);
    assert.equal(bad.passed, false);
    assert.equal(bad.unbound.length, 1);
    write(report, 'A real quote reads “the green roof  reduced peak indoor temperature by eight degrees during summer” [s1].\n');
    const good = await check({ report, sources: join(dir, 'sources.json') }, out);
    assert.equal(good.passed, true);
    assert.equal(good.bound, 1);
    assert.deepEqual(JSON.parse(readFileSync(join(out, 'cite-check.json'), 'utf8')), { passed: true, claims_total: 1, bound: 1, unbound: [], dead_links: [] });
    assert.equal(normalise('“A  real quote.”'), '"a real quote."');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cite-check marks uncited facts and unknown sources unbound and dead paths failed', async () => {
  const dir = tempDir();
  try {
    write(join(dir, 'report.md'), 'The team measured 42 samples.\nThis claim quotes “some absent words” [s9].\n');
    writeJson(join(dir, 'sources.json'), [{ id: 's1', path: 'missing.txt' }]);
    const result = await check({ report: join(dir, 'report.md'), sources: join(dir, 'sources.json') }, dir);
    assert.equal(result.passed, false);
    assert.deepEqual(result.unbound.map((entry) => entry.reason), ['uncited factual sentence', 'unknown source s9']);
    assert.equal(result.dead_links.length, 1);
    assert.equal(result.dead_links[0].id, 's1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent-reach extracts only search lines, deduplicates URLs and saves excerpts on fetch errors', async () => {
  const dir = tempDir();
  try {
    const plan = join(dir, 'plan.md');
    const out = join(dir, 'out');
    write(plan, '# Search plan\n- search: first query\nordinary search: ignored\nsearch: second query\n');
    assert.deepEqual(queriesOf(readFileSync(plan, 'utf8')), ['first query', 'second query']);
    const calls = [];
    const result = await search({ plan, out }, async (query) => {
      calls.push(query);
      return query === 'first query'
        ? [{ source_url: 'https://one.example', title: 'One', excerpt: 'saved excerpt' }]
        : [{ source_url: 'https://one.example', title: 'Duplicate' }, { source_url: 'https://two.example', title: 'Two' }];
    }, async (url) => {
      if (url.endsWith('one.example')) throw new Error('offline');
    });
    assert.deepEqual(calls, ['first query', 'second query']);
    const sources = JSON.parse(readFileSync(join(out, 'sources.json'), 'utf8'));
    assert.equal(result.count, 2);
    assert.deepEqual(sources.map((source) => source.id), ['s01', 's02']);
    assert.equal(sources[0].excerpt_only, true);
    assert.equal(readFileSync(join(out, 's01.txt'), 'utf8'), 'saved excerpt');
    assert.equal(sources[1].path, 's02.txt');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('agent-reach rejects plans without search lines', async () => {
  const dir = tempDir();
  try {
    const plan = join(dir, 'plan.md');
    write(plan, 'Search the web for this sentence.\n');
    await assert.rejects(search({ plan, out: join(dir, 'out') }, async () => [], async () => {}), /plan has no/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('data parses CSV quoting, CRLF, BOM and ragged rows and loads text columns with unique names', () => {
  const dir = tempDir();
  try {
    const csv = join(dir, 'data.csv');
    const db = join(dir, 'data.sqlite');
    write(csv, '\uFEFFname,name,note\r\n"Doe, Jane",Jane,"said ""hello"""\r\nSolo\r\n');
    assert.deepEqual(parseCsv(readFileSync(csv, 'utf8')), [['name', 'name', 'note'], ['Doe, Jane', 'Jane', 'said "hello"'], ['Solo']]);
    const result = load({ path: csv, db });
    assert.deepEqual(result.columns, ['name', 'name_2', 'note']);
    assert.equal(result.rows, 2);
    assert.equal(result.ragged, 1);
    assert.deepEqual(query({ db, sql: 'SELECT typeof(name) AS type, name_2, note FROM raw ORDER BY rowid' }).rows.map((row) => ({ ...row })), [
      { type: 'text', name_2: 'Jane', note: 'said "hello"' },
      { type: 'text', name_2: null, note: null },
    ]);
    assert.throws(() => query({ db, sql: 'DELETE FROM raw' }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('data renders each SQL block, captures one-cell values and names failed blocks', () => {
  const dir = tempDir();
  try {
    const csv = join(dir, 'data.csv');
    const db = join(dir, 'data.sqlite');
    const spec = join(dir, 'kpis.md');
    const out = join(dir, 'kpis.json');
    write(csv, 'n\n4\n');
    load({ path: csv, db });
    write(spec, '## Total rows\n```sql\nSELECT count(*) AS n FROM raw\n```\n## Broken query\n```sql\nSELECT missing FROM nope\n```\n');
    assert.deepEqual(kpiBlocks(readFileSync(spec, 'utf8')).map((block) => block.name), ['Total rows', 'Broken query']);
    const result = render({ db, spec, out });
    assert.deepEqual(result.failed, ['Broken query']);
    const blocks = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(blocks[0].value, 1);
    assert.ok(blocks[1].error);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('security lists scoped and nested dependencies, outdated and major versions', () => {
  const dir = tempDir();
  try {
    writeJson(join(dir, 'package.json'), { name: 'demo', license: 'MIT', dependencies: { '@scope/pkg': '^1.0.0', plain: '^2.0.0' } });
    writeJson(join(dir, 'node_modules/@scope/pkg/package.json'), { name: '@scope/pkg', version: '1.1.0', license: 'MIT' });
    writeJson(join(dir, 'node_modules/plain/package.json'), { name: 'plain', version: '2.1.0' });
    writeJson(join(dir, 'node_modules/plain/node_modules/nested/package.json'), { name: 'nested', version: '3.0.0', license: 'Apache-2.0' });
    const out = join(dir, 'deps.json');
    const result = listDeps({ path: dir, out }, () => ({ plain: { current: '2.1.0', wanted: '2.4.0', latest: '3.0.0' } }));
    assert.equal(result.total, 2);
    assert.equal(result.outdated, 1);
    assert.equal(result.major, 1);
    const deps = JSON.parse(readFileSync(out, 'utf8')).deps;
    assert.equal(deps.find((dep) => dep.name === 'plain').major, true);
    assert.equal(deps.find((dep) => dep.name === '@scope/pkg').licence, 'MIT');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('security reports copyleft conflict, optional licence review and missing licence', () => {
  const dir = tempDir();
  try {
    writeJson(join(dir, 'package.json'), { name: 'demo', license: 'MIT' });
    writeJson(join(dir, 'node_modules/gpl/package.json'), { name: 'gpl', version: '1.0.0', license: 'GPL-3.0' });
    writeJson(join(dir, 'node_modules/choice/package.json'), { name: 'choice', version: '1.0.0', license: 'MIT OR GPL-3.0' });
    writeJson(join(dir, 'node_modules/no-license/package.json'), { name: 'no-license', version: '1.0.0' });
    const result = licenceReport({ path: dir });
    assert.equal(result.licence_conflict, true);
    assert.equal(result.review, 1);
    assert.equal(result.unknown, 1);

    const agpl = tempDir();
    try {
      writeJson(join(agpl, 'package.json'), { name: 'copyleft-app', license: 'AGPL-3.0' });
      writeJson(join(agpl, 'node_modules/gpl/package.json'), { name: 'gpl', version: '1.0.0', license: 'GPL-3.0' });
      assert.equal(licenceReport({ path: agpl }).licence_conflict, false);
    } finally {
      rmSync(agpl, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});