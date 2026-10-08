import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { isPrivate, checkUrl, safeFetch } from '../../plugins/agent-reach/bin/safe-fetch.js';
import { check, normalise } from '../../plugins/cite-check/bin/cite-check.js';
import { search, queriesOf } from '../../plugins/agent-reach/bin/search.js';
import { parseCsv, load, query, render, kpiBlocks } from '../../plugins/data/bin/data.js';
import { cut, captions } from '../../plugins/media/bin/media.js';
import { listDeps, licenceReport } from '../../plugins/security/bin/security.js';
import { exportPdf } from '../../plugins/docs-export/bin/docs-export.js';

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

test('safe-fetch blocks private address ranges and allows public addresses', async () => {
  for (const ip of ['0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.1.1', '172.16.0.1', '172.31.255.255', '192.168.1.1', '224.0.0.1', '255.255.255.255', '::', '::1', 'fc00::1', 'fdff::1', 'fe80::1', 'febf::1', 'ff02::1', '::ffff:127.0.0.1']) assert.equal(isPrivate(ip), true, ip);
  for (const ip of ['172.32.0.1', '8.8.8.8', '2606:4700::1111']) assert.equal(isPrivate(ip), false, ip);
  await assert.rejects(checkUrl('file:///tmp/x'), /refused file:/);
  await assert.rejects(checkUrl('ftp://example.test/file'), /refused ftp:/);
  await assert.rejects(checkUrl('http://127.0.0.1/'), /private address/);
  await assert.rejects(checkUrl('https://private.example/', async (host, options) => {
    assert.equal(host, 'private.example'); assert.deepEqual(options, { all: true }); return [{ address: '10.0.0.4' }];
  }), /private address/);
  const resolved = await checkUrl('https://public.example/', async (host, options) => {
    assert.equal(host, 'public.example'); assert.deepEqual(options, { all: true }); return [{ address: '8.8.8.8' }];
  });
  assert.equal(resolved.hostname, 'public.example');
  for (const name of ['seo', 'cite-check', 'media']) {
    assert.deepEqual(readFileSync(new URL(`../../plugins/${name}/bin/safe-fetch.js`, import.meta.url)), readFileSync(new URL('../../plugins/agent-reach/bin/safe-fetch.js', import.meta.url)));
  }
  assert.equal(typeof safeFetch, 'function');
});

test('cite-check rejects source paths escaping the sources folder', async () => {
  const dir = tempDir();
  try {
    const sources = join(dir, 'refs', 'sources.json');
    write(join(dir, 'outside.txt'), 'secret text');
    writeJson(sources, [{ id: 's1', path: '../outside.txt' }]);
    write(join(dir, 'report.md'), 'A claim [s1].\n');
    const result = await check({ report: join(dir, 'report.md'), sources }, dir);
    assert.equal(result.passed, false);
    assert.equal(result.dead_links.length, 1);
    assert.match(result.dead_links[0].error, /sources folder/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('media validates cut and caption moment ids before invoking ffmpeg or writing files', () => {
  const dir = tempDir();
  try {
    const out = join(dir, 'out');
    for (const id of ['../x', 'a b']) {
      assert.throws(() => cut({ moments: [{ id, src_start: 0, src_end: 1 }], video: 'unused.mp4', out }), /moment id/);
      assert.deepEqual(readdirSync(out), []);
    }
    const clip = join(dir, 'clip.mp4');
    writeJson(`${clip}.json`, { id: '../x', source: 'source.mp4', src_start: 0, src_end: 1 });
    writeJson(join(dir, 'words.json'), { words: [] });
    assert.throws(() => captions({ clip, words: join(dir, 'words.json'), out }), /moment id/);
    assert.deepEqual(existsSync(out) ? readdirSync(out) : [], []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('data load and empty query preserve duplicate case-insensitive column names', () => {
  const dir = tempDir();
  try {
    const csv = join(dir, 'data.csv'); const db = join(dir, 'data.sqlite');
    write(csv, 'count,count_2,count,Count\n');
    assert.deepEqual(load({ path: csv, db }).columns, ['count', 'count_2', 'count_3', 'Count_4']);
    const result = query({ db, sql: 'SELECT * FROM raw WHERE 0' });
    assert.deepEqual(result.columns, ['count', 'count_2', 'count_3', 'Count_4']);
    assert.deepEqual(result.rows, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('security report writers create missing output parents', () => {
  const dir = tempDir();
  try {
    const project = join(dir, 'project'); mkdirSync(project);
    writeJson(join(project, 'package.json'), { name: 'empty', license: 'MIT' });
    const licenceOut = join(dir, 'new', 'nested', 'licence.md');
    const depsOut = join(dir, 'other', 'nested', 'deps.json');
    licenceReport({ path: project, out: licenceOut });
    listDeps({ path: project, out: depsOut }, () => ({}));
    assert.equal(readFileSync(licenceOut, 'utf8').startsWith('# Licence report'), true);
    assert.deepEqual(JSON.parse(readFileSync(depsOut, 'utf8')).deps, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('GitHub release tag pattern rejects command text and accepts semver tags', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../plugins/github/troop-plugin.json', import.meta.url), 'utf8'));
  const pattern = manifest.actions.find((action) => action.id === 'release').input_schema.properties.tag.pattern;
  const regex = new RegExp(pattern);
  assert.equal(regex.test('v1.0.0 --draft'), false);
  assert.equal(regex.test('v1.2.3'), true);
  assert.equal(regex.test('1.2.3-rc.1'), true);
  assert.doesNotMatch(readFileSync(new URL('../../plugins/github/bin/github.js', import.meta.url), 'utf8'), /shell:/);
});

test.skip('docs-export exportPdf fake Chrome receives Chrome flags', () => {}); // exportPdf receives Chrome flags, so fake Chrome cannot test it.

test('docs-export keeps a written PDF when the browser profile cannot be removed', { skip: process.platform !== 'win32' }, () => {
  const dir = tempDir();
  const rmSync = fs.rmSync;
  try {
    write(join(dir, 'a.md'), '# A\n');
    write(join(dir, 'a.pdf'), '%PDF /Type /Page');
    fs.rmSync = (p, o) => {
      if (String(p).includes('troop-pdf-')) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' });
      return rmSync(p, o);
    };
    const r = exportPdf({ path: join(dir, 'a.md'), out: join(dir, 'a.pdf') }, () => process.env.COMSPEC);
    assert.equal(r.pages, 1);
  } finally {
    fs.rmSync = rmSync;
    rmSync(dir, { recursive: true, force: true });
  }
});
