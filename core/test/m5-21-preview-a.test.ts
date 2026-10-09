import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listPrs } from '../../plugins/github/bin/github.js';
import { listDeps } from '../../plugins/security/bin/security.js';
import { probe } from '../../plugins/media/bin/media.js';

const root = fileURLToPath(new URL('../..', import.meta.url));

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'm5-21-preview-a-'));
}

test('website-build and design-variants agent steps declare an approval profile', () => {
  for (const id of ['website-build', 'design-variants']) {
    const pipeline = JSON.parse(readFileSync(join(root, 'pipelines/preview', `${id}.json`), 'utf8'));
    for (const step of pipeline.steps.filter((item: any) => item.kind === 'agent')) {
      assert.ok(['edits', 'contained'].includes(step.approval), `${id}.${step.id} approval should be edits or contained`);
    }
  }
});

test('deploy check requires a Vercel link and succeeds when one exists', () => {
  const dir = tempDir();
  try {
    const script = join(root, 'plugins/deploy/bin/deploy.js');
    const run = () => spawnSync(process.execPath, [script, 'check'], {
      input: JSON.stringify({ input: { path: dir } }), encoding: 'utf8',
      env: { ...process.env, TROOP_PROJECT_DIR: dir },
    });

    const unlinked = run();
    assert.equal(JSON.parse(unlinked.stdout).ok, false);
    assert.match(JSON.parse(unlinked.stdout).error.message, /link the project first/);

    mkdirSync(join(dir, '.vercel'));
    writeFileSync(join(dir, '.vercel/project.json'), JSON.stringify({ projectId: 'test-project' }));
    const linked = run();
    assert.equal(JSON.parse(linked.stdout).ok, true, linked.stdout);

    const websiteBuild = JSON.parse(readFileSync(join(root, 'pipelines/preview/website-build.json'), 'utf8'));
    assert.equal(websiteBuild.steps[0].id, 'link');
    assert.equal(websiteBuild.steps[0].uses, 'plugin:deploy/check');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listPrs rejects last-tag lookup without a release', () => {
  assert.throws(() => listPrs({ repo: 'owner/repo', since: 'last tag' }, (args) => {
    if (args[0] === 'release' && args[1] === 'view') throw new Error('no release found');
    if (args[0] === 'api' && args[1] === 'repos/owner/repo/tags?per_page=1') return '[{"name":"v1.0.0"}]';
    throw new Error(`unexpected gh args: ${args.join(' ')}`);
  }), /has tags but no release/);
});

test('listPrs searches from the published timestamp of the latest release', () => {
  let prSearch = '';
  const result = listPrs({ repo: 'owner/repo', since: 'last tag' }, (args) => {
    if (args[0] === 'release' && args[1] === 'view') return JSON.stringify({ tagName: 'v1.2.0', publishedAt: '2026-09-01T10:00:00Z' });
    if (args[0] === 'api' && args[1] === 'repos/owner/repo/tags?per_page=1') return '[{"name":"v1.2.0"}]';
    if (args[0] === 'pr' && args[1] === 'list') {
      prSearch = args[args.indexOf('--search') + 1];
      return '[]';
    }
    throw new Error(`unexpected gh args: ${args.join(' ')}`);
  });
  assert.equal(prSearch, 'merged:>=2026-09-01T10:00:00Z');
  assert.equal(result.count, 0);
});

test('listDeps fails when npm outdated returns an error', () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test', dependencies: { x: '^1' } }));
    assert.throws(() => listDeps({ path: dir }, () => ({ error: { code: 'ENOTFOUND' } } as any)), /npm outdated failed: ENOTFOUND/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('listDeps includes optional dependencies and reports major updates', () => {
  const dir = tempDir();
  try {
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'test', optionalDependencies: { x: '^1' } }));
    const out = join(dir, 'deps.json');
    const result = listDeps({ path: dir, out }, () => ({ x: { current: '1.0.0', latest: '2.0.0' } }));
    const report = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(result.total, 1);
    assert.equal(result.outdated, 1);
    assert.equal(result.major, 1);
    assert.equal(report.deps.length, 1);
    assert.equal(report.deps[0].name, 'x');
    assert.equal(report.deps[0].outdated, true);
    assert.equal(report.deps[0].major, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('media probe fails on directories with no media files, including dot files', () => {
  const dir = tempDir();
  try {
    assert.throws(() => probe({ path: dir }), /no media files/);
    writeFileSync(join(dir, '._a.mov'), '');
    assert.throws(() => probe({ path: dir }), /no media files/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('footage-to-edit edit prompt always renders out/final.mp4', () => {
  const pipeline = JSON.parse(readFileSync(join(root, 'pipelines/preview/footage-to-edit.json'), 'utf8'));
  const edit = pipeline.steps.find((step: any) => step.id === 'edit');
  assert.match(edit.prompt, /out\/final\.mp4/);
});

test('design-variants missing-direction prompt marks the variant failed', () => {
  const pipeline = JSON.parse(readFileSync(join(root, 'pipelines/preview/design-variants.json'), 'utf8'));
  const variants = pipeline.steps.find((step: any) => step.id === 'variants');
  assert.match(variants.prompt, /direction-\{\{index\}\}\.md[\s\S]*write status: failed/i);
});
