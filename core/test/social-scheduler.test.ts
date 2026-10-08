import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { schedulePost, ApiError } from '../../plugins/social-scheduler/bin/social-scheduler.js';
import { validateManifest } from '../src/plugins/manifest.ts';
import { root } from './helpers.ts';

function tempDir() {
  return mkdtempSync(join(tmpdir(), 'social-scheduler-'));
}

const now = new Date('2030-01-01T00:00:00.000Z');
const future = '2030-01-02T12:00:00+11:00';

function post(overrides = {}) {
  return {
    clip: 'shared.mp4', platform: 'tiktok', slot: future,
    caption: '  A launch update  ', hashtags: ['launch', '#video'],
    ...overrides,
  };
}

function fixture(dir, posts) {
  writeFileSync(join(dir, 'shared.mp4'), Buffer.from('video'));
  writeFileSync(join(dir, 'other.mp4'), Buffer.from('video'));
  writeFileSync(join(dir, 'posts.json'), JSON.stringify(posts));
}

test('schedules a valid mixed batch, reuses uploads, converts slots and formats platform content/settings', async () => {
  const dir = tempDir();
  try {
    const posts = [
      post(),
      post({ platform: 'youtube-shorts', title: 'A short title', caption: '  YouTube caption ' }),
      post({ platform: 'instagram-reels', caption: ' Instagram caption ' }),
    ];
    fixture(dir, posts);
    const calls = [];
    const api = async (method, route, body) => {
      calls.push({ method, route, body });
      if (route === 'integrations') return [
        { id: 'tt', identifier: 'tiktok' },
        { id: 'yt', identifier: 'youtube' },
        { id: 'ig', identifier: 'instagram-standalone' },
      ];
      if (route === 'upload') return { id: 'upload-id', path: '/uploads/shared.mp4' };
      if (route === 'posts') return [{ postId: `post-${calls.filter((c) => c.route === 'posts').length}` }];
      throw new Error(`unexpected API route ${route}`);
    };

    const result = await schedulePost({ posts: 'posts.json' }, api, dir, now);

    assert.equal(result.count, 3);
    assert.deepEqual(result.posts.map((p) => p.post_id), ['post-1', 'post-2', 'post-3']);
    assert.equal(calls.filter((c) => c.route === 'upload').length, 1);
    const scheduled = calls.filter((c) => c.route === 'posts');
    assert.equal(scheduled.length, 3);
    for (const { body } of scheduled) {
      assert.equal(body.type, 'schedule');
      assert.equal(body.date, '2030-01-02T01:00:00.000Z');
      assert.deepEqual(body.posts[0].value[0].image, [{ id: 'upload-id', path: '/uploads/shared.mp4' }]);
    }
    assert.deepEqual(scheduled.map((c) => c.body.posts[0].settings.__type), ['tiktok', 'youtube', 'instagram-standalone']);
    assert.deepEqual(scheduled.map((c) => c.body.posts[0].value[0].content), [
      'A launch update\n\n#launch #video',
      'YouTube caption\n\n#launch #video',
      'Instagram caption\n\n#launch #video',
    ]);
    assert.equal(scheduled[1].body.posts[0].settings.title, 'A short title');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses the whole batch before uploading or scheduling when any post is invalid', async () => {
  const dir = tempDir();
  try {
    const invalidPosts = [
      post({ platform: 'mastodon' }),
      post({ clip: 'missing.mp4' }),
      post({ slot: '2030-01-02T12:00:00' }),
      post({ slot: '2029-12-31T23:59:00+00:00' }),
      post({ platform: 'youtube-shorts', title: 'X' }),
      post({ platform: 'youtube-shorts', title: 'x'.repeat(101) }),
      post({ caption: 'contains {{placeholder}}' }),
      post({ caption: '  ' }),
    ];
    for (const p of invalidPosts) p.clip = 'shared.mp4';
    invalidPosts[1].clip = 'missing.mp4';
    fixture(dir, invalidPosts);
    const calls = [];
    const api = async (method, route) => {
      calls.push({ method, route });
      if (route === 'integrations') return [
        { id: 'tt', identifier: 'tiktok' }, { id: 'yt', identifier: 'youtube' },
      ];
      throw new Error(`unexpected API route ${route}`);
    };
    await assert.rejects(schedulePost({ posts: 'posts.json' }, api, dir, now), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.retryable, false);
      assert.match(error.message, /refused, nothing scheduled:/);
      return true;
    });
    assert.deepEqual(calls, [{ method: 'GET', route: 'integrations' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('refuses a platform when its only integration is disabled', async () => {
  const dir = tempDir();
  try {
    fixture(dir, [post()]);
    const calls = [];
    const api = async (method, route) => {
      calls.push({ method, route });
      return [{ id: 'disabled-tt', identifier: 'tiktok', disabled: true }];
    };
    await assert.rejects(schedulePost({ posts: 'posts.json' }, api, dir, now), /no connected tiktok account in Postiz/);
    assert.deepEqual(calls, [{ method: 'GET', route: 'integrations' }]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports the already scheduled post id as non-retryable when a later post fails', async () => {
  const dir = tempDir();
  try {
    fixture(dir, [post(), post({ platform: 'youtube-shorts', title: 'A title' })]);
    let postsCall = 0;
    const api = async (_method, route) => {
      if (route === 'integrations') return [{ id: 'tt', identifier: 'tiktok' }, { id: 'yt', identifier: 'youtube' }];
      if (route === 'upload') return { id: 'upload-id', path: '/uploads/shared.mp4' };
      if (route === 'posts' && ++postsCall === 1) return [{ postId: 'already-created-42' }];
      if (route === 'posts') throw new ApiError('second post failed', true);
      throw new Error(`unexpected API route ${route}`);
    };
    await assert.rejects(schedulePost({ posts: 'posts.json' }, api, dir, now), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.retryable, false);
      assert.match(error.message, /Already scheduled, delete these in Postiz before a rerun: shared\.mp4 tiktok already-created-42/);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('preserves the original first post error and retryable flag', async () => {
  const dir = tempDir();
  try {
    fixture(dir, [post()]);
    const original = new ApiError('temporary Postiz failure', true);
    const api = async (_method, route) => {
      if (route === 'integrations') return [{ id: 'tt', identifier: 'tiktok' }];
      if (route === 'upload') return { id: 'upload-id', path: '/uploads/shared.mp4' };
      if (route === 'posts') throw original;
      throw new Error(`unexpected API route ${route}`);
    };
    await assert.rejects(schedulePost({ posts: 'posts.json' }, api, dir, now), (error) => {
      assert.equal(error, original);
      assert.equal(error.retryable, true);
      return true;
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('social-scheduler manifest validates without warnings', () => {
  const pluginDir = resolve(root, 'plugins/social-scheduler');
  const manifest = JSON.parse(readFileSync(join(pluginDir, 'troop-plugin.json'), 'utf8'));
  assert.deepEqual(validateManifest(manifest, pluginDir), []);
});
