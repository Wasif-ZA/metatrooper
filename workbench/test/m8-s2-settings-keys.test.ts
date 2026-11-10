import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { runInNewContext } from 'node:vm';
import { DEFAULTS } from '../../core/src/settings.ts';

const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const pageMatch = /const PAGE_KEYS\s*=\s*new Set\((\[[\s\S]*?\])\)/.exec(main);
assert.ok(pageMatch, 'PAGE_KEYS array found');
const pageKeys: string[] = Array.from(runInNewContext(pageMatch[1]));

test('every PAGE_KEYS entry names a scalar default', () => {
  assert.ok(pageKeys.length > 0, 'PAGE_KEYS is nonempty');
  for (const key of pageKeys) {
    assert.match(key, /^[a-z_]+\.[a-z_]+$/);
    const [section, name] = key.split('.');
    assert.ok(Object.hasOwn(DEFAULTS, section), key);
    const defaults = (DEFAULTS as Record<string, Record<string, unknown>>)[section];
    assert.ok(Object.hasOwn(defaults, name), key);
    assert.ok(['boolean', 'number', 'string'].includes(typeof defaults[name]), key);
  }
});

test('setSetting IPC writes only PAGE_KEYS without importing main', async () => {
  const match = /on\('setSetting', (async \([\s\S]*?\n  \})\);/.exec(main);
  assert.ok(match, 'setSetting handler found');
  const writes: unknown[] = [];
  const handler = runInNewContext(stripTypeScriptTypes('(' + match[1] + ')'), {
    PAGE_KEYS: new Set(pageKeys),
    writeSetting: async (key: string, value: unknown) => { writes.push([key, value]); return null; },
  });
  for (const key of [undefined, null, 42, {}, ['terminal.font_size'], 'sessions.approval', '', 'terminal.shells', 'browser.allow_origins', 'ui.themes', '__proto__.polluted', 'sessions.approval.extra']) {
    assert.equal((await handler(key, 'synthetic')).error, 'not a Settings page key');
  }
  assert.deepEqual(writes, []);
  for (const key of pageKeys) assert.equal((await handler(key, 'synthetic')).ok, true);
  assert.deepEqual(writes, pageKeys.map((key) => [key, 'synthetic']));
});

test('sessions.approval is excluded from PAGE_KEYS', () => {
  assert.equal(pageKeys.includes('sessions.approval'), false);
});

test('setApproval accepts exactly ask and contained without importing main', async () => {
  const match = /on\('setApproval', (async \([\s\S]*?\n  \})\);/.exec(main);
  assert.ok(match, 'setApproval handler found');
  const writes: unknown[] = [];
  const handler = runInNewContext(stripTypeScriptTypes('(' + match[1] + ')'), {
    writeSetting: async (key: string, value: unknown) => { writes.push([key, value]); return null; },
  });
  for (const value of [undefined, null, true, false, 0, 1, {}, [], ['ask'], '', 'ASK', 'ask ', ' contained', 'auto', 'never', 'always']) {
    assert.equal((await handler(value)).error, 'approval must be ask or contained');
  }
  assert.deepEqual(writes, []);
  assert.equal((await handler('ask')).ok, true);
  assert.equal((await handler('contained')).ok, true);
  assert.deepEqual(writes, [['sessions.approval', 'ask'], ['sessions.approval', 'contained']]);
});
