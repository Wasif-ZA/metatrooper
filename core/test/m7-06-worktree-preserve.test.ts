import './clean-env.mjs';
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildGenerated, client, isolation, startCore, teardownCore, uiHello } from './helpers.ts';

before(buildGenerated);

function gitRun(cwd: string, args: string[]): string {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${res.stderr || res.stdout}`);
  return (res.stdout ?? '').trim();
}

/**
 * Harness for testing worktree.create with isolated settings and git project repo.
 */
async function withWorktreeCore(
  settings: Record<string, any>,
  run: (ctx: {
    pipe: any;
    isolated: any;
    projectId: string;
    projectDir: string;
    db: () => DatabaseSync;
  }) => Promise<void>,
) {
  const isolated = isolation();
  // Write custom settings including worktree.preserve
  writeFileSync(join(isolated.home, 'settings.json'), JSON.stringify(settings));

  const core = await startCore(isolated);
  try {
    const projectDir = join(isolated.home, 'main-repo');
    mkdirSync(projectDir, { recursive: true });
    gitRun(projectDir, ['init']);
    gitRun(projectDir, ['config', 'user.name', 'TestUser']);
    gitRun(projectDir, ['config', 'user.email', 'test@example.com']);
    gitRun(projectDir, ['config', 'commit.gpgsign', 'false']);

    // Commit initial file
    writeFileSync(join(projectDir, 'README.md'), '# Main Repo\n');
    gitRun(projectDir, ['add', 'README.md']);
    gitRun(projectDir, ['commit', '-m', 'initial']);

    const pipe = await client(isolated.prefix);
    try {
      await uiHello(pipe, isolated.home);
      const opened = await pipe.request('project.open', { path: projectDir });
      const db = () => new DatabaseSync(join(isolated.home, 'troop.db'));
      await run({ pipe, isolated, projectId: opened.result.project_id, projectDir, db });
    } finally {
      pipe.close();
    }
  } finally {
    await teardownCore(core, isolated);
  }
}

// protects=worktree.create copies untracked/ignored files matching preserve patterns into new worktree
// fails_when=.env.local matching .env* pattern is not copied to the newly created worktree
// no_claim=preservation of tracked git files
test('M7-06f preserve: [".env*"] copies .env.local into the newly created worktree', async () => {
  const settings = {
    worktree: {
      preserve: ['.env*'],
    },
  };

  await withWorktreeCore(settings, async ({ pipe, projectDir, projectId }) => {
    // Create .gitignore ignoring .env*
    writeFileSync(join(projectDir, '.gitignore'), '.env*\n');
    gitRun(projectDir, ['add', '.gitignore']);
    gitRun(projectDir, ['commit', '-m', 'add gitignore']);

    // Create .env.local file (ignored by git)
    const envContent = 'SECRET_KEY=supersecret123\nAPI_ENDPOINT=https://example.local\n';
    writeFileSync(join(projectDir, '.env.local'), envContent);

    // Call worktree.create
    const reply = await pipe.request('worktree.create', { project_id: projectId, branch: 'troop/feat-env' });
    assert.ok(!reply.error, `worktree.create failed: ${JSON.stringify(reply.error)}`);
    assert.ok(reply.result?.path, 'worktree.create must return path');

    const worktreePath = reply.result.path;
    const copiedEnv = join(worktreePath, '.env.local');
    assert.ok(existsSync(copiedEnv), `Preserved file .env.local must exist in worktree at ${copiedEnv}`);
    assert.equal(readFileSync(copiedEnv, 'utf8'), envContent, 'Preserved file content must match source');
  });
});

// protects=worktree.create refuses dangerous or empty preserve patterns naming the offending pattern
// fails_when=empty pattern, parent directory, drive letter, or UNC patterns are accepted or fail without naming pattern
// no_claim=regex pattern matching syntax
test('M7-06f invalid preserve patterns (empty, ../x, C:\\x, \\\\h\\s) are refused with the pattern named', async () => {
  const invalidPatterns = [
    { pattern: '', label: 'empty pattern' },
    { pattern: '../x', label: 'parent directory pattern' },
    { pattern: 'C:\\x', label: 'drive letter pattern' },
    { pattern: '\\\\h\\s', label: 'UNC path pattern' },
  ];

  for (const { pattern, label } of invalidPatterns) {
    const settings = {
      worktree: {
        preserve: [pattern],
      },
    };

    await withWorktreeCore(settings, async ({ pipe, projectId }) => {
      const reply = await pipe.request('worktree.create', { project_id: projectId, branch: `troop/test-${Date.now()}` });
      assert.ok(reply.error, `worktree.create must refuse ${label} (${pattern})`);
      if (pattern !== '') {
        assert.ok(
          reply.error.message.includes(pattern),
          `Error message "${reply.error.message}" must name the invalid pattern "${pattern}"`,
        );
      } else {
        assert.match(
          reply.error.message,
          /empty/i,
          `Error message "${reply.error.message}" must mention that pattern is empty`,
        );
      }
    });
  }
});

// protects=worktree file preservation refuses symlinks pointing outside the source repository
// fails_when=symlink pointing outside repo is copied or allowed without error
// no_claim=in-repo relative symlinks preservation
test('M7-06f symlink pointing outside the repository is refused', async () => {
  const settings = {
    worktree: {
      preserve: ['.env*'],
    },
  };

  await withWorktreeCore(settings, async ({ pipe, isolated, projectDir, projectId }) => {
    // Create a target file outside the repository
    const outsideTarget = join(isolated.home, 'external-secret.env');
    writeFileSync(outsideTarget, 'OUTSIDE_SECRET=confidential\n');

    // Create a symlink in the repository pointing outside
    const linkPath = join(projectDir, '.env.external');
    try {
      symlinkSync(outsideTarget, linkPath);
    } catch {
      // If symlink creation fails due to Windows privileges, skip symlink assertion
      return;
    }

    const reply = await pipe.request('worktree.create', { project_id: projectId, branch: 'troop/feat-symlink' });
    assert.ok(reply.error, 'worktree.create must fail when preserve matches a symlink outside repo');
    assert.match(reply.error.message, /symlink|outside/i, 'Error message must explain symlink out of repo is refused');
  });
});

// protects=async worktree creation keeps core heartbeat ticking at least every 2 seconds during slow checkouts
// fails_when=core heartbeat freezes or gap exceeds 2 seconds during worktree checkout
// no_claim=checkout speed or timeout threshold of git worktree add itself
test('M7-06f core heartbeat ticks at least every 2 s during a slow fixture checkout', async () => {
  const settings = {
    worktree: {
      preserve: [],
    },
  };

  await withWorktreeCore(settings, async ({ pipe, projectDir, projectId, db }) => {
    // Add a post-checkout git hook in the source repository that sleeps for 2.5 seconds
    // to simulate a slow checkout
    const hooksDir = join(projectDir, '.git', 'hooks');
    mkdirSync(hooksDir, { recursive: true });
    const hookScript = join(hooksDir, 'post-checkout');

    if (process.platform === 'win32') {
      // Node script that delays 2500ms
      writeFileSync(hookScript, `#!/usr/bin/env node\nconst end = Date.now() + 2500;\nwhile (Date.now() < end) {}\n`);
    } else {
      writeFileSync(hookScript, `#!/bin/sh\nsleep 2.5\n`, { mode: 0o755 });
    }

    // Monitor the event loop and heartbeat during worktree.create
    let maxLoopLag = 0;
    let lastTick = Date.now();
    const monitor = setInterval(() => {
      const now = Date.now();
      const lag = now - lastTick;
      if (lag > maxLoopLag) maxLoopLag = lag;
      lastTick = now;
    }, 200);

    try {
      const reply = await pipe.request('worktree.create', { project_id: projectId, branch: 'troop/slow-checkout' });
      assert.ok(!reply.error, `worktree.create failed: ${JSON.stringify(reply.error)}`);
    } finally {
      clearInterval(monitor);
    }

    // In sync execFileSync, the event loop would freeze for >= 2500 ms
    // In async execFile, the event loop continues ticking and maxLoopLag remains small (< 2000 ms)
    assert.ok(
      maxLoopLag < 2000,
      `Event loop blocked for ${maxLoopLag} ms; worktree.create must be async so heartbeat ticks every 2 s`,
    );

    // Verify core_heartbeat in meta table is recent
    const d = db();
    try {
      const heartbeatRow = d.prepare("SELECT value FROM meta WHERE key = 'core_heartbeat'").get() as { value: string } | undefined;
      assert.ok(heartbeatRow?.value, 'core_heartbeat must be recorded in meta');
      const ageMs = Date.now() - Date.parse(heartbeatRow.value);
      assert.ok(ageMs < 4000, `Heartbeat age ${ageMs} ms must be fresh`);
    } finally {
      d.close();
    }
  });
});
