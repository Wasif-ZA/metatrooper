import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { delimiter, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { root, until } from './helpers.ts';
import { git, revisionHarness } from './ui-revision-helpers.ts';

const { diffLineMap, scanDiff, scanWorktree } = await import(pathToFileURL(join(root, 'core/src/pipelines/secrets-scan.ts')).href);
const { resolveCommand } = await import(pathToFileURL(join(root, 'core/src/hook/resolve.ts')).href);

const keyTail = 'Z7Q3KX2M4PLWQRTN';
const plantedKey = `AKIA${keyTail}`;
const realGitleaks = resolveCommand('gitleaks');

function fakeGitleaksSource(exitCode: number, report: unknown[] = []) {
  return [
    "import { writeFileSync } from 'node:fs';",
    'const args = process.argv.slice(2);',
    "const reportAt = args.indexOf('--report-path');",
    `if (${exitCode} === 1 && reportAt >= 0) writeFileSync(args[reportAt + 1], JSON.stringify(${JSON.stringify(report)}));`,
    `process.exit(${exitCode});`,
  ].join('\n');
}

async function withFakeGitleaks<T>(exitCode: number, report: unknown[], run: (bin: string) => Promise<T>): Promise<T> {
  const bin = mkdtempSync(join(tmpdir(), 'fake-gitleaks-'));
  const oldPath = process.env.PATH;
  try {
    const script = fakeGitleaksSource(exitCode, report);
    writeFileSync(join(bin, 'fake-gitleaks.mjs'), script);
    if (process.platform === 'win32') {
      writeFileSync(join(bin, 'gitleaks.cmd'), `@node "%~dp0\\fake-gitleaks.mjs" %*\r\n`);
    } else {
      const shim = join(bin, 'gitleaks');
      writeFileSync(shim, `#!/bin/sh\nexec "${process.execPath}" "${join(bin, 'fake-gitleaks.mjs')}" "$@"\n`);
      execFileSync('chmod', ['+x', shim]);
    }
    process.env.PATH = `${bin}${delimiter}${oldPath ?? ''}`;
    return await run(bin);
  } finally {
    if (oldPath === undefined) delete process.env.PATH;
    else process.env.PATH = oldPath;
    rmSync(bin, { recursive: true, force: true });
  }
}

function pathWithoutGitleaks() {
  const dir = realGitleaks ? dirname(realGitleaks[realGitleaks.length - 1]).toLowerCase() : null;
  return (process.env.PATH ?? '').split(delimiter).filter((p) => !dir || p.toLowerCase() !== dir).join(delimiter);
}

function specToPrDef(buildFiles: Record<string, string>) {
  const def = JSON.parse(readFileSync(join(root, 'pipelines/spec-to-pr.json'), 'utf8'));
  for (const s of def.steps) {
    if (s.kind !== 'agent') continue;
    s.engine = 'fake';
    const d = s.id === 'spec' ? { outputs: { title: 'Add config' } } : s.id === 'build' ? { files: buildFiles, commit: 'Add config', outputs: { summary: 'Adds config.' } } : { outputs: { summary: s.id } };
    s.prompt = `FAKE ${JSON.stringify(d)}\n${s.prompt}`;
  }
  return def;
}

async function nextPause(h: Awaited<ReturnType<typeof revisionHarness>>, runId: string) {
  const status = await until(() => {
    const r = h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as { status: string };
    return r.status === 'paused' || r.status === 'done' || r.status === 'failed' ? r.status : null;
  }, 60000);
  const gate = status === 'paused' ? h.db.prepare("SELECT * FROM gate WHERE run_id = ? AND status = 'waiting'").get(runId) as { id: string; step_id: string; action_hash: string | null; scan: string | null; summary: string } : null;
  return { status, gate };
}

async function resumed(h: Awaited<ReturnType<typeof revisionHarness>>, runId: string) {
  await until(() => (h.db.prepare('SELECT status FROM run WHERE id = ?').get(runId) as { status: string }).status !== 'paused', 10000);
}

test('diffLineMap maps added lines to their new-side file and line', () => {
  const diff = [
    'diff --git a/src/old.js b/src/new.js',
    'index 1234567..abcdef0 100644',
    '--- a/src/old.js',
    '+++ b/src/new.js',
    '@@ -4,2 +7,3 @@',
    ' context',
    '-removed',
    '+added one',
    '+added two',
    '',
  ].join('\n');
  const lines = diffLineMap(diff);
  assert.deepEqual(lines[8], { file: 'src/new.js', line: 8 });
  assert.deepEqual(lines[9], { file: 'src/new.js', line: 9 });
});

test('scanDiff reports clean, findings, and unavailable for gitleaks exit codes 0, 1, and 2', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'scan-diff-'));
  try {
    await withFakeGitleaks(0, [], async () => {
      assert.deepEqual(await scanDiff('diff --git a/a b/a\n', runDir, 'clean'), { status: 'clean', count: 0 });
    });
    await withFakeGitleaks(1, [{ RuleID: 'aws-access-token', StartLine: 5 }], async () => {
      const diff = [
        'diff --git a/src/config.ts b/src/config.ts',
        '--- a/src/config.ts',
        '+++ b/src/config.ts',
        '@@ -1 +1 @@',
        `+const accessKey = '${plantedKey}';`,
        '',
      ].join('\n');
      assert.deepEqual(await scanDiff(diff, runDir, 'findings'), {
        status: 'findings',
        count: 1,
        items: [{ rule: 'aws-access-token', file: 'src/config.ts', line: 1 }],
      });
      assert.equal(existsSync(join(runDir, 'scan-findings.json')), false);
    });
    await withFakeGitleaks(2, [], async () => {
      const result = await scanDiff('diff --git a/a b/a\n', runDir, 'error');
      assert.equal(result.status, 'unavailable');
      assert.match(result.reason, /gitleaks exited 2/);
    });
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('M4-08 without gitleaks on PATH the publish gate scan is unavailable and approve needs no reason', async () => {
  const oldPath = process.env.PATH;
  let h: Awaited<ReturnType<typeof revisionHarness>>;
  process.env.PATH = pathWithoutGitleaks();
  try {
    assert.equal(resolveCommand('gitleaks'), null);
    const runDir = mkdtempSync(join(tmpdir(), 'scan-no-gitleaks-'));
    try {
      const result = await scanDiff('diff --git a/a b/a\n', runDir, 'missing');
      assert.equal(result.status, 'unavailable');
      assert.match(result.reason, /gitleaks is not on PATH/);
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
    h = await revisionHarness('spec-to-pr');
  } finally {
    process.env.PATH = oldPath;
  }
  try {
    const runId = await h.pipeline(specToPrDef({ 'config.js': `export const key = '${plantedKey}';\n` }), { idea: readFileSync(join(h.project, 'idea.md'), 'utf8'), repo: 'fake/repo' });
    for (;;) {
      const { status, gate } = await nextPause(h, runId);
      if (!gate) { assert.equal(status, 'done'); break; }
      if (gate.step_id === 'approve-pr') assert.equal(JSON.parse(gate.scan ?? 'null').status, 'unavailable');
      const resolved = await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined });
      assert.equal(resolved.error, undefined, JSON.stringify(resolved));
      await resumed(h, runId);
    }
  } finally {
    await h.close();
  }
});

test('M4-07 spec-to-pr approval requires an override reason and stores it without persisting the key', async (t) => {
  if (!realGitleaks) {
    console.log('Skipping M4-07: real gitleaks is not on PATH.');
    t.skip('real gitleaks is not on PATH');
    return;
  }
  const h = await revisionHarness('spec-to-pr');
  try {
    const runId = await h.pipeline(specToPrDef({ 'config.js': `export const key = '${plantedKey}';\n` }), { idea: readFileSync(join(h.project, 'idea.md'), 'utf8'), repo: 'fake/repo' });
    const reason = 'Reviewed the finding: a synthetic fixture key.';
    let sawPrGate = false;
    for (;;) {
      const { status, gate } = await nextPause(h, runId);
      if (!gate) { assert.equal(status, 'done'); break; }
      if (gate.step_id === 'approve-pr') {
        sawPrGate = true;
        assert.equal(JSON.parse(gate.scan ?? 'null').status, 'findings');
        const denied = await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined });
        assert.equal(denied.error?.code, -32602);
        const approved = await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined, override_reason: reason });
        assert.equal(approved.error, undefined, JSON.stringify(approved));
        const row = h.db.prepare('SELECT override_reason FROM gate WHERE id = ?').get(gate.id) as { override_reason: string | null };
        assert.equal(row.override_reason, reason);
      } else {
        const approved = await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined });
        assert.equal(approved.error, undefined, JSON.stringify(approved));
      }
      await resumed(h, runId);
    }
    assert.ok(sawPrGate, 'the approve-pr gate opened');

    const runDir = (h.db.prepare('SELECT run_dir FROM run WHERE id = ?').get(runId) as { run_dir: string }).run_dir;
    const leaks: string[] = [];
    for (const file of readdirSync(runDir, { recursive: true }) as string[]) {
      if (file === 'pipeline.json') continue; // holds the fake engine's FAKE directive, which carries the key
      try { if (readFileSync(join(runDir, file), 'utf8').includes(keyTail)) leaks.push(file); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EISDIR') throw e; }
    }
    for (const { name } of h.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>) {
      if (JSON.stringify(h.db.prepare(`SELECT * FROM "${name}"`).all()).includes(keyTail)) leaks.push(`table ${name}`);
    }
    assert.deepEqual(leaks, []);
  } finally {
    await h.close();
  }
});

test('M4-20 two-engine-review send-check waits for approval with a reason before engine reviews start', async (t) => {
  if (!realGitleaks) {
    console.log('Skipping M4-20: real gitleaks is not on PATH.');
    t.skip('real gitleaks is not on PATH');
    return;
  }
  const h = await revisionHarness();
  try {
    writeFileSync(join(h.project, 'reviewed.ts'), 'export const x = 1;\n');
    git(h.project, 'add', 'reviewed.ts');
    git(h.project, 'commit', '-qm', 'add reviewed file');
    writeFileSync(join(h.project, 'reviewed.ts'), `export const x = 1;\nexport const key = '${plantedKey}';\n`);

    const def = JSON.parse(readFileSync(join(root, 'pipelines/two-engine-review.json'), 'utf8'));
    for (const s of def.steps) {
      if (s.kind !== 'agent') continue;
      s.engine = 'fake';
      s.prompt = `FAKE ${JSON.stringify({ outputs: { verdict: 'approve', findings: '[]' } })}\n${s.prompt}`;
    }
    const runId = await h.pipeline(def);
    const { gate } = await nextPause(h, runId);
    assert.ok(gate, 'send-check gate opened');
    assert.equal(gate.step_id, 'send-check');
    assert.equal(JSON.parse(gate.scan ?? 'null').status, 'findings');
    const started = () => (h.db.prepare("SELECT COUNT(*) AS n FROM run_step WHERE run_id = ? AND step_id IN ('codex-review', 'gemini-review') AND status <> 'pending'").get(runId) as { n: number }).n;
    assert.equal(started(), 0);

    const denied = await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined });
    assert.equal(denied.error?.code, -32602);
    assert.equal(started(), 0);

    const approved = await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined, override_reason: 'Synthetic review fixture.' });
    assert.equal(approved.error, undefined, JSON.stringify(approved));
    await resumed(h, runId);
    const end = await nextPause(h, runId);
    assert.equal(end.status, 'done');
    assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM run_step WHERE run_id = ? AND step_id IN ('codex-review', 'gemini-review') AND status = 'done'").get(runId) as { n: number }).n, 2);
  } finally {
    await h.close();
  }
});

test('scanWorktree leaves the worktree index and git status unchanged', async () => {
  await withFakeGitleaks(0, [], async () => {
    const baseDir = mkdtempSync(join(tmpdir(), 'scan-worktree-'));
    const repo = join(baseDir, 'repo');
    const runDir = join(baseDir, 'run');
    mkdirSync(repo, { recursive: true });
    mkdirSync(runDir, { recursive: true });
    try {
      execFileSync('git', ['init', '-q', repo]);
      execFileSync('git', ['-C', repo, 'config', 'user.email', 'fixture@example.com']);
      execFileSync('git', ['-C', repo, 'config', 'user.name', 'fixture']);
      writeFileSync(join(repo, 'tracked.txt'), 'before\n');
      execFileSync('git', ['-C', repo, 'add', '-A']);
      execFileSync('git', ['-C', repo, 'commit', '-qm', 'initial']);
      const base = execFileSync('git', ['-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      writeFileSync(join(repo, 'tracked.txt'), 'after\n');
      writeFileSync(join(repo, 'untracked.txt'), 'also new\n');
      const before = execFileSync('git', ['-C', repo, 'status', '--short'], { encoding: 'utf8' });
      assert.match(before, /\?\? untracked\.txt/);
      assert.deepEqual(await scanWorktree(repo, base, runDir, 'worktree'), { status: 'clean', count: 0 });
      assert.equal(execFileSync('git', ['-C', repo, 'status', '--short'], { encoding: 'utf8' }), before);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});

test('scanDiff drops findings reported on removed and context lines, keeping only added lines', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'scan-diff-lines-'));
  const diff = [
    'diff --git a/config.ts b/config.ts',
    '--- a/config.ts',
    '+++ b/config.ts',
    '@@ -1,2 +1,2 @@',
    ' context line',
    '-removed secret',
    '+added secret',
    '',
  ].join('\n');
  try {
    await withFakeGitleaks(1, [
      { RuleID: 'removed-key', StartLine: 6 },
      { RuleID: 'context-key', StartLine: 5 },
    ], async () => {
      assert.deepEqual(await scanDiff(diff, runDir, 'removed-context'), { status: 'clean', count: 0 });
    });
    await withFakeGitleaks(1, [
      { RuleID: 'removed-key', StartLine: 6 },
      { RuleID: 'context-key', StartLine: 5 },
      { RuleID: 'added-key', StartLine: 7 },
    ], async () => {
      assert.deepEqual(await scanDiff(diff, runDir, 'mixed'), {
        status: 'findings',
        count: 1,
        items: [{ rule: 'added-key', file: 'config.ts', line: 2 }],
      });
    });
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('scanDiff keeps findings without numeric StartLine with an empty file', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'scan-diff-no-line-'));
  try {
    await withFakeGitleaks(1, [{ RuleID: 'unknown-location' }], async () => {
      assert.deepEqual(await scanDiff('diff --git a/config.ts b/config.ts\n', runDir, 'no-line'), {
        status: 'findings',
        count: 1,
        items: [{ rule: 'unknown-location', file: '', line: null }],
      });
    });
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('scanDiff removes its temp directory and does not write a report into runDir', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'scan-diff-temp-'));
  const before = readdirSync(tmpdir()).filter((name) => name.startsWith('troop-scan-')).sort();
  try {
    await withFakeGitleaks(1, [{ RuleID: 'added-key', StartLine: 1 }], async () => {
      await scanDiff('+x\n', runDir, 'temp-cleanup');
    });
    const after = readdirSync(tmpdir()).filter((name) => name.startsWith('troop-scan-')).sort();
    assert.deepEqual(after, before);
    assert.deepEqual(readdirSync(runDir).filter((name) => /^scan-.*\.json$/.test(name)), []);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('two-engine-review asks for approval when gitleaks is unavailable, then runs both reviews', async () => {
  const oldPath = process.env.PATH;
  let h: Awaited<ReturnType<typeof revisionHarness>>;
  process.env.PATH = pathWithoutGitleaks();
  try {
    assert.equal(resolveCommand('gitleaks'), null);
    h = await revisionHarness();
  } finally {
    process.env.PATH = oldPath;
  }
  try {
    writeFileSync(join(h.project, 'reviewed.ts'), 'export const x = 1;\n');
    git(h.project, 'add', 'reviewed.ts');
    git(h.project, 'commit', '-qm', 'add reviewed file');
    writeFileSync(join(h.project, 'reviewed.ts'), 'export const x = 1;\nexport const y = 2;\n');
    const def = JSON.parse(readFileSync(join(root, 'pipelines/two-engine-review.json'), 'utf8'));
    for (const s of def.steps) {
      if (s.kind !== 'agent') continue;
      s.engine = 'fake';
      s.prompt = `FAKE ${JSON.stringify({ outputs: { verdict: 'approve', findings: '[]' } })}\n${s.prompt}`;
    }
    const runId = await h.pipeline(def);
    const { gate } = await nextPause(h, runId);
    assert.ok(gate, 'send-check gate opened');
    assert.equal(gate.step_id, 'send-check');
    assert.equal(JSON.parse(gate.scan ?? 'null').status, 'unavailable');
    assert.match(gate.summary, /secret scan could not run/i);
    assert.equal((await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined })).error, undefined);
    await resumed(h, runId);
    const end = await nextPause(h, runId);
    assert.equal(end.status, 'done');
    assert.equal((h.db.prepare("SELECT COUNT(*) AS n FROM run_step WHERE run_id = ? AND step_id IN ('codex-review', 'gemini-review') AND status = 'done'").get(runId) as { n: number }).n, 2);
  } finally {
    await h.close();
  }
});

test('publish gate scans and merges findings from each worktree step', async (t) => {
  if (!realGitleaks) {
    console.log('Skipping publishScan aggregation: real gitleaks is not on PATH.');
    t.skip('real gitleaks is not on PATH');
    return;
  }
  const h = await revisionHarness();
  try {
    const worker = (id: string, files: Record<string, string>) => ({
      id, kind: 'agent', role: 'worker', engine: 'fake', worktree: true, outputs: ['summary'],
      prompt: `FAKE ${JSON.stringify({ files, commit: `Add ${id}`, outputs: { summary: id } })}\nCreate and commit the fixture.`,
    });
    const def = {
      schema: 1, id: 'publish-scan-aggregation', title: 'Publish scan aggregation', requires: ['github'],
      steps: [
        worker('first', { 'keys.ts': `export const key = '${plantedKey}';\n` }),
        worker('second', { 'clean.ts': 'export const clean = true;\n' }),
        { id: 'approve', kind: 'gate', gate: 'approve', title: 'Approve publish', gate_summary: 'Approve publishing the worktrees.' },
        { id: 'publish', kind: 'action', role: 'publish', uses: 'plugin:github/create-pr', title: 'Open pull request',
          with: { repo: 'fake/repo', branch: '{{steps.second.outputs.branch}}', base: 'main', title: 'Fixture', body: 'Fixture publish.', path: '{{steps.second.outputs.worktree}}' } },
      ],
    };
    const runId = await h.pipeline(def);
    const { gate, status } = await nextPause(h, runId);
    assert.ok(gate, 'approval gate opened before publish');
    assert.equal(status, 'paused');
    const scan = JSON.parse(gate.scan ?? 'null');
    assert.equal(scan.status, 'findings');
    assert.equal(scan.count, 1);
    assert.equal(scan.items[0].file, 'keys.ts');
    const approved = await h.pipe.request('gate.resolve', { gate_id: gate.id, decision: 'approve', action_hash: gate.action_hash ?? undefined, override_reason: 'Reviewed synthetic test key.' });
    assert.equal(approved.error, undefined, JSON.stringify(approved));
    await resumed(h, runId);
    assert.equal((await nextPause(h, runId)).status, 'done');
  } finally {
    await h.close();
  }
});
