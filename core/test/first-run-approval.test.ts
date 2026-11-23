import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULTS, setSetting, settings, settingsFile } from '../src/settings.ts';
import { withEnv } from './helpers.ts';

test('fresh METATROOPER_HOME defaults sessions.approval to contained', () => {
  const home = mkdtempSync(join(tmpdir(), 'first-run-appr-'));
  try {
    withEnv({ METATROOPER_HOME: home }, () => {
      assert.equal(settings().sessions.approval, 'contained');
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('settings.json that exists but does not parse keeps defaults with sessions.approval contained', () => {
  const home = mkdtempSync(join(tmpdir(), 'first-run-appr-'));
  try {
    withEnv({ METATROOPER_HOME: home }, () => {
      writeFileSync(join(home, 'settings.json'), '{"broken json');
      // protects= D89: broken JSON retains all defaults, including contained approval.
      assert.deepEqual(settings(), DEFAULTS);
      assert.equal(settings().sessions.approval, 'contained');
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('setSetting on fresh home preserves approval contained and writes contained to file', () => {
  const home = mkdtempSync(join(tmpdir(), 'first-run-appr-'));
  try {
    withEnv({ METATROOPER_HOME: home }, () => {
      setSetting('ui', 'theme', 'light');
      assert.equal(settings().sessions.approval, 'contained');
      const saved = JSON.parse(readFileSync(settingsFile(), 'utf8'));
      assert.equal(saved.sessions?.approval, 'contained');
      assert.equal(saved.ui?.theme, 'light');
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('existing settings.json with sessions.approval ask stays ask', () => {
  const home = mkdtempSync(join(tmpdir(), 'first-run-appr-'));
  try {
    withEnv({ METATROOPER_HOME: home }, () => {
      const file = join(home, 'settings.json');
      writeFileSync(file, JSON.stringify({ sessions: { approval: 'ask' } }));
      assert.equal(settings().sessions.approval, 'ask');
      setSetting('ui', 'theme', 'light');
      assert.equal(settings().sessions.approval, 'ask');
      const saved = JSON.parse(readFileSync(settingsFile(), 'utf8'));
      assert.equal(saved.sessions?.approval, 'ask');
      assert.equal(saved.ui?.theme, 'light');
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
