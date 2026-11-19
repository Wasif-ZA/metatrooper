import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { isolation } from './helpers.ts';

process.env.METATROOPER_HOME = isolation().home;
const { openCoreDb } = await import('../src/store/db.ts');
const { shippedEngines } = await import('../src/engines/registry.ts');
const { mcpAttachArgs } = await import('../src/plugins/mcp.ts');

const db = openCoreDb();
const claude = shippedEngines().find((e) => e.id === 'claude')!;
function hasBrowser(browser: boolean, ctx: { approval?: string; pipeline?: boolean }): boolean {
  const flag = mcpAttachArgs(db, claude, 'browser-attach', browser, ctx).find((a) => a.startsWith('--mcp-config='));
  return Boolean(flag) && 'metatrooper-browser' in JSON.parse(readFileSync(flag!.slice('--mcp-config='.length), 'utf8')).mcpServers;
}

test.after(() => { db.close(); rmSync(process.env.METATROOPER_HOME!, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });

test('a window launch with no browser flag gets the browser tools in ask, edits and contained', () => {
  for (const approval of ['ask', 'edits', 'contained']) assert.ok(hasBrowser(false, { approval }), approval);
});

test('isolated sessions and pipeline steps do not get the browser tools unless the launch asks for them', () => {
  assert.equal(hasBrowser(false, { approval: 'isolated' }), false);
  assert.equal(hasBrowser(false, { approval: 'ask', pipeline: true }), false);
});

test('browser: true on the launch still attaches the browser tools', () => {
  assert.ok(hasBrowser(true, { approval: 'isolated' }));
  assert.ok(hasBrowser(true, { approval: 'ask' }));
});
