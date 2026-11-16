import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkUrl, type PolicyContext } from '../../core/src/browser/policy.ts';
import { DEFAULTS, setSetting, settings } from '../../core/src/settings.ts';

test('checkUrl allows private hosts when listed in allowHosts policy context', async () => {
  // Evaluates private url access with and without allowHosts set.
  const allowedCtx: PolicyContext = {
    ownedPorts: new Set(),
    allowHosts: new Set(['allowed.lan', '192.168.1.50']),
  };
  const blockedCtx: PolicyContext = {
    ownedPorts: new Set(),
    allowHosts: new Set(),
  };

  const allowedVerdict = await checkUrl('http://192.168.1.50/dashboard', allowedCtx);
  assert.equal(allowedVerdict.allow, true);

  const blockedVerdict = await checkUrl('http://192.168.1.50/dashboard', blockedCtx);
  assert.equal(blockedVerdict.allow, false);
});

test('panes.ts references settings().browser.allow_hosts and not .troop/config.json', () => {
  // Checks panes.ts source code for settings reference and absence of legacy config path.
  const panesSource = readFileSync(new URL('../src/browser/panes.ts', import.meta.url), 'utf8');
  assert.ok(!panesSource.includes('.troop/config.json'));
  assert.ok(!panesSource.includes('.troop/'));
  assert.match(panesSource, /allowHosts\(\)[\s\S]*?settings\(\)\.browser\.allow_hosts/);
});

test('browser.allow_hosts defaults to empty array and round-trips via settings', () => {
  // Checks default value and persists new allow_hosts entries.
  assert.deepEqual(DEFAULTS.browser.allow_hosts, []);

  const dir = mkdtempSync(join(tmpdir(), 'c3-settings-'));
  const prevHome = process.env.METATROOPER_HOME;
  try {
    process.env.METATROOPER_HOME = dir;
    setSetting('browser', 'allow_hosts', ['example.local', '10.0.0.5']);
    const loaded = settings().browser.allow_hosts;
    assert.deepEqual(loaded, ['example.local', '10.0.0.5']);
  } finally {
    if (prevHome === undefined) delete process.env.METATROOPER_HOME;
    else process.env.METATROOPER_HOME = prevHome;
    rmSync(dir, { recursive: true, force: true });
  }
});
