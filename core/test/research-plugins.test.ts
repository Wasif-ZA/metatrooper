import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { search } from '../../plugins/agent-reach/bin/search.js';
import { check } from '../../plugins/cite-check/bin/cite-check.js';
import { crawl } from '../../plugins/seo/bin/seo.js';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'research-plugins-'));
}

test('agent-reach search fails when every search fails and nothing was found', async () => {
  const dir = tempDir();
  try {
    const plan = join(dir, 'plan.md');
    writeFileSync(plan, 'search: one\nsearch: two\n');
    await assert.rejects(search({ plan, out: join(dir, 'out') }, async () => { throw new Error('mcporter not found'); }, async () => {}), /no sources found: one: mcporter not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('cite-check passes when only an uncited source is dead', async () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, 's01.txt'), 'The survey found that most teams ship weekly.');
    writeFileSync(join(dir, 'sources.json'), JSON.stringify([{ id: 's01', path: 's01.txt' }, { id: 's02', path: 'missing.txt' }]));
    writeFileSync(join(dir, 'report.md'), 'It says "most teams ship weekly" [s01].\n');
    const result = await check({ report: join(dir, 'report.md'), sources: dir }, dir);
    assert.equal(result.dead_links.length, 1);
    assert.equal(result.passed, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('deep-research draft prompt asks for the source id form search writes', () => {
  const pipe = JSON.parse(readFileSync(new URL('../../pipelines/deep-research-cited.json', import.meta.url), 'utf8'));
  const draft = pipe.steps.find((s) => s.id === 'draft').prompt;
  assert.doesNotMatch(draft, /\[s#\]/);
  assert.match(draft, /\[s01\]/);
});

test('seo crawl follows a start URL that redirects to another origin', async () => {
  const pages = {
    'https://a.example/': ['https://www.a.example/', '<a href="/about">About</a>'],
    'https://www.a.example/about': ['https://www.a.example/about', '<h1>About</h1>'],
  };
  const get = async (url) => {
    const [final, body] = pages[url] ?? [url, ''];
    return { res: { ok: Boolean(pages[url]), status: pages[url] ? 200 : 404, url: final, headers: new Headers({ 'content-type': 'text/html' }) }, body, ms: 1 };
  };
  const result = await crawl({ url: 'https://a.example/' }, null, get);
  assert.deepEqual(result.data.pages.map((p) => p.url), ['https://a.example/', 'https://www.a.example/about']);
});
