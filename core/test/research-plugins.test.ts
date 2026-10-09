import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { search, sources } from '../../plugins/agent-reach/bin/search.js';
import { check } from '../../plugins/cite-check/bin/cite-check.js';
import { crawl } from '../../plugins/seo/bin/seo.js';
import { run, checkState, listPrs } from '../../plugins/github/bin/github.js';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
  const pipe = JSON.parse(readFileSync(new URL('../../pipelines/preview/deep-research-cited.json', import.meta.url), 'utf8'));
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

test('github and deploy errors keep the end of a long error', { skip: process.platform !== 'win32' }, () => {
  assert.throws(() => run(process.execPath, ['-e', "process.stderr.write('x'.repeat(600) + 'REAL ERROR'); process.exit(1)"]), /x+REAL ERROR$/);
  const dir = tempDir();
  try {
    mkdirSync(join(dir, 'site', '.vercel'), { recursive: true });
    writeFileSync(join(dir, 'site', '.vercel', 'project.json'), '{}');
    mkdirSync(join(dir, 'bin'));
    writeFileSync(join(dir, 'bin', 'vercel.cmd'), `@"${process.execPath}" -e "process.stderr.write('x'.repeat(600) + 'REAL ERROR'); process.exit(1)"\r\n`);
    const deploy = fileURLToPath(new URL('../../plugins/deploy/bin/deploy.js', import.meta.url));
    const out = execFileSync(process.execPath, [deploy, 'preview'], { input: JSON.stringify({ input: { path: 'site' }, project: dir }), env: { ...process.env, TROOP_PROJECT_DIR: dir, PATH: `${join(dir, 'bin')};${process.env.PATH}` }, encoding: 'utf8' });
    assert.match(JSON.parse(out).error.message, /REAL ERROR$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('github checks treat skipped as done and cancelled as failing', () => {
  assert.equal(checkState([{ state: 'SUCCESS', bucket: 'pass' }, { state: 'SKIPPED', bucket: 'skipping' }, { state: 'NEUTRAL', bucket: 'pass' }]), 'passing');
  assert.equal(checkState([{ state: 'SUCCESS', bucket: 'pass' }, { state: 'CANCELLED', bucket: 'cancel' }]), 'failing');
  assert.equal(checkState([{ state: 'TIMED_OUT', bucket: 'fail' }]), 'failing');
  assert.equal(checkState([{ state: 'IN_PROGRESS', bucket: 'pending' }, { state: 'SKIPPED', bucket: 'skipping' }]), 'pending');
});

test('github list-prs accepts a tag that has no release', () => {
  const calls = [];
  const result = listPrs({ repo: 'o/r', since: 'v1.2.0' }, (args) => {
    calls.push(args.slice(0, 2).join(' '));
    if (args[0] === 'release') throw new Error('gh release failed: release not found');
    if (args[0] === 'api') return '2026-09-01T10:00:00Z\n';
    return '[]';
  });
  assert.deepEqual(calls, ['release view', 'api repos/o/r/commits/v1.2.0', 'pr list']);
  assert.equal(result.since_tag, 'v1.2.0');
  assert.equal(result.since_date, '2026-09-01');
});

test('docs-and-release-notes release tag is valid whether the agent answers v1.4.0 or 1.4.0', () => {
  const pipe = JSON.parse(readFileSync(new URL('../../pipelines/preview/docs-and-release-notes.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(readFileSync(new URL('../../plugins/github/troop-plugin.json', import.meta.url), 'utf8'));
  const pattern = new RegExp(manifest.actions.find((a) => a.id === 'release').input_schema.properties.tag.pattern);
  const tag = pipe.steps.find((s) => s.id === 'release').with.tag;
  for (const version of ['v1.4.0', '1.4.0']) assert.match(tag.replace('{{steps.changelog.outputs.version}}', version), pattern);
  assert.equal(pipe.inputs.base_branch.required, true);
});

test('data-to-dashboard serves the dashboard folder so the pane root is the page', () => {
  const pipe = JSON.parse(readFileSync(new URL('../../pipelines/preview/data-to-dashboard.json', import.meta.url), 'utf8'));
  const build = pipe.steps.find((s) => s.id === 'build');
  assert.match(build.dev_command, /http-server "\{\{run\.dir\}\}\/dashboard"/);
  assert.match(build.prompt, /\{\{run\.dir\}\}\/dashboard\/index\.html/);
  assert.deepEqual(pipe.steps.filter((s) => s.kind === 'agent' && s.uses).map((s) => s.id), []);
});

test('agent-reach sources writes index.json as pages arrive', async () => {
  const dir = tempDir();
  try {
    const out = join(dir, 'out');
    writeFileSync(join(dir, 'prospects.json'), JSON.stringify([{ name: 'A', site: 'https://a.example' }, { name: 'B', site: 'https://b.example' }]));
    let seen = null;
    const get = async (url) => {
      if (url.includes('b.example')) {
        seen = existsSync(join(out, 'index.json')) && JSON.parse(readFileSync(join(out, 'index.json'), 'utf8'));
        throw new Error('timed out');
      }
      return { html: '<p>hello</p>', url };
    };
    await sources({ prospects: join(dir, 'prospects.json'), out, max_pages: 1 }, get);
    assert.equal(seen && seen[0].pages.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Codex trust adds the table when the only matching header is commented out', async () => {
  const { trustFolder } = await import('../src/trust.ts');
  const { canonicalPath } = await import('../src/project.ts');
  const dir = tempDir();
  try {
    const toml = join(dir, 'config.toml');
    const header = `[projects.'${canonicalPath(dir)}']`;
    writeFileSync(toml, `# ${header}\n# trust_level = "trusted"\n`);
    const engines = [{ id: 'codex', trust: { kind: 'toml-table', file: toml, at: ['projects'], set: { trust_level: 'trusted' }, path_style: 'posix' } }];
    assert.deepEqual(trustFolder(dir, engines as never), ['codex']);
    assert.ok(readFileSync(toml, 'utf8').split('\n').includes(header));
    assert.equal(existsSync(`${toml}.troop-tmp`), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
