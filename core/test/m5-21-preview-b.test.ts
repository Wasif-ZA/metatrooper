import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cut } from '../../plugins/media/bin/media.js';
import { check } from '../../plugins/cite-check/bin/cite-check.js';
import { load } from '../../plugins/data/bin/data.js';
import { crawl } from '../../plugins/seo/bin/seo.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'm5-21-preview-b-'));
}

function serve(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address() as any;
    resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
  }));
}

test('media cut throws when every moment is dropped and skips an unavailable later index', () => {
  const dir = tempDir();
  try {
    const allDropped = join(dir, 'all-dropped.json');
    writeFileSync(allDropped, JSON.stringify([{ id: 'm1', status: 'dropped', src_start: 0, src_end: 1 }]));
    assert.throws(() => cut({ moments: allDropped, index: 0, video: 'unused.mp4', out: join(dir, 'clips') }), /no moment left to cut/);
    assert.deepEqual(cut({ moments: allDropped, index: 1, video: 'unused.mp4', out: join(dir, 'clips') }), { path: null, skipped: true });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('clips pipeline limits TikTok privacy to the two supported choices', () => {
  const pipeline = JSON.parse(readFileSync(fileURLToPath(new URL('../../pipelines/preview/clips-to-scheduled-posts.json', import.meta.url)), 'utf8'));
  assert.deepEqual(pipeline.inputs.tiktok_privacy.choices, ['PUBLIC_TO_EVERYONE', 'SELF_ONLY']);
});

test('SEO crawl rejects a 404 start page and a robots-blocked start page', async () => {
  const dir = tempDir();
  const missing = await serve((_req, res) => { res.writeHead(404); res.end('missing'); });
  try {
    await assert.rejects(crawl({ url: missing.url }, dir), /did not load/);
  } finally { await missing.close(); }

  const blocked = await serve((req, res) => {
    if (req.url === '/robots.txt') { res.end('User-agent: *\nDisallow: /\n'); return; }
    res.end('<html><body>home</body></html>');
  });
  try {
    await assert.rejects(crawl({ url: blocked.url }, dir), /robots\.txt disallows/);
  } finally { await blocked.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('SEO crawl reports linked pages left beyond its page limit', async () => {
  const dir = tempDir();
  const site = await serve((req, res) => {
    if (req.url === '/robots.txt') { res.end('User-agent: *\nAllow: /\n'); return; }
    res.setHeader('Content-Type', 'text/html');
    if (req.url === '/two') res.end('<html><body><a href="/three">three</a></body></html>');
    else if (req.url === '/three') res.end('<html><body>three</body></html>');
    else res.end('<html><body><a href="/two">two</a><a href="/three">three</a></body></html>');
  });
  try {
    const result = await crawl({ url: site.url, limit: 1 }, dir);
    assert.ok(result.not_crawled >= 1);
  } finally { await site.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('cite-check fails reports with no citations and fabricated table quotes, while accepting a real block quote', async () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, 'source.txt'), 'The source describes a verified green roof reducing temperatures in summer.');
    writeFileSync(join(dir, 'sources.json'), JSON.stringify([{ id: 's01', path: 'source.txt' }]));
    const report = join(dir, 'report.md');
    writeFileSync(report, 'The report contains nothing numeric.');
    assert.equal((await check({ report, sources: join(dir, 'sources.json') }, dir)).passed, false);
    writeFileSync(report, '| X | "fabricated quote" [s01] |');
    assert.equal((await check({ report, sources: join(dir, 'sources.json') }, dir)).passed, false);
    writeFileSync(report, '> "verified green roof reducing temperatures" [s01]');
    assert.equal((await check({ report, sources: join(dir, 'sources.json') }, dir)).passed, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('data load rejects semicolon, tab and pipe separators while loading comma separated data', () => {
  const dir = tempDir();
  try {
    for (const [name, contents] of [['semicolon.csv', 'a;b\n1;2\n'], ['tab.tsv', 'a\tb\n1\t2\n'], ['pipe.psv', 'a|b\n1|2\n']]) {
      const path = join(dir, name);
      writeFileSync(path, contents);
      assert.throws(() => load({ path, db: join(dir, `${name}.sqlite`) }), /separated/);
    }
    const csv = join(dir, 'comma.csv');
    writeFileSync(csv, 'a,b\n1,2\n');
    assert.equal(load({ path: csv, db: join(dir, 'comma.sqlite') }).rows, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('data-to-dashboard repeats clean and QA until QA passes, with a maximum of two attempts', () => {
  const pipeline = JSON.parse(readFileSync(fileURLToPath(new URL('../../pipelines/preview/data-to-dashboard.json', import.meta.url)), 'utf8'));
  const qa = pipeline.steps.find((step: any) => step.id === 'qa');
  assert.deepEqual(qa.loop, { steps: ['clean', 'qa'], until: 'steps.qa.passed', max: 2 });
});
