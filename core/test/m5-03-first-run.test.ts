import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { checkEngine } from '../src/engines/health.ts';

function checkDb() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE engine_check (
      engine_id TEXT PRIMARY KEY,
      checked_at TEXT,
      installed INTEGER,
      version TEXT,
      auth TEXT,
      detail TEXT
    )
  `);
  return db;
}

function result(db: DatabaseSync) {
  const row = db.prepare('SELECT installed, version, auth, detail FROM engine_check').get() as
    { installed: number; version: string | null; auth: string; detail: string | null } | undefined;
  return row && { ...row };
}

function engine(id: string, versionCmd: string[], extra: Record<string, unknown> = {}) {
  return {
    id,
    command: process.execPath,
    args: [],
    prompt_arg: 'positional',
    state_source: 'process',
    roles: ['worker'],
    cost_rank: 1,
    usage_source: 'none',
    provider: 'local-cli',
    version_cmd: versionCmd,
    ...extra,
  } as Parameters<typeof checkEngine>[1];
}

test('M5-03 missing engine records the missing detail', async () => {
  const db = checkDb();
  try {
    await checkEngine(db, engine('fake', [join(tmpdir(), 'metatrooper-no-such-engine')]));
    assert.deepEqual(result(db), {
      installed: 0,
      version: null,
      auth: 'missing',
      detail: 'missing',
    });
  } finally {
    db.close();
  }
});

test('M5-03 version below min_version records too-old', async () => {
  const db = checkDb();
  try {
    await checkEngine(db, engine('fake', [
      process.execPath,
      '-e',
      'process.stdout.write("1.9.9\\n")',
    ], { min_version: '1.10.0' }));
    assert.deepEqual(result(db), {
      installed: 0,
      version: '1.9.9',
      auth: 'missing',
      detail: 'too-old',
    });
  } finally {
    db.close();
  }
});

test('M5-03 fake Codex login status failure records not-logged-in', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'metatrooper-m5-03-'));
  const script = join(dir, 'fake-codex.mjs');
  const db = checkDb();
  writeFileSync(script, [
    'if (process.argv[2] === "--version") process.stdout.write("1.0.0\\n");',
    'else if (process.argv[2] === "login" && process.argv[3] === "status") process.exit(1);',
  ].join('\n'));
  try {
    await checkEngine(db, engine('codex', [process.execPath, script, '--version'], {
      auth_cmd: [process.execPath, script, 'login', 'status'],
    }));
    assert.deepEqual(result(db), {
      installed: 1,
      version: '1.0.0',
      auth: 'missing',
      detail: 'not-logged-in',
    });
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('M5-03 version command timeout records timeout', async () => {
  const db = checkDb();
  try {
    await checkEngine(db, engine('fake', [
      process.execPath,
      '-e',
      'setTimeout(() => {}, 15000)',
    ]));
    assert.deepEqual(result(db), {
      installed: 0,
      version: null,
      auth: 'missing',
      detail: 'timeout',
    });
  } finally {
    db.close();
  }
});

test('M5-03 new settings file defaults to ask and existing approval values are retained', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'metatrooper-settings-'));
  const oldHome = process.env.METATROOPER_HOME;
  process.env.METATROOPER_HOME = dir;
  try {
    const settingsUrl = new URL('../src/settings.ts', import.meta.url);
    settingsUrl.searchParams.set('case', 'missing');
    const missingSettings = await import(settingsUrl.href);
    assert.equal(missingSettings.settings().sessions.approval, 'ask');

    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sessions: {} }));
    settingsUrl.searchParams.set('case', 'legacy');
    const legacySettings = await import(settingsUrl.href);
    assert.equal(legacySettings.settings().sessions.approval, 'contained');

    writeFileSync(join(dir, 'settings.json'), JSON.stringify({ sessions: { approval: 'isolated' } }));
    settingsUrl.searchParams.set('case', 'explicit');
    const explicitSettings = await import(settingsUrl.href);
    assert.equal(explicitSettings.settings().sessions.approval, 'isolated');
  } finally {
    if (oldHome === undefined) delete process.env.METATROOPER_HOME;
    else process.env.METATROOPER_HOME = oldHome;
    rmSync(dir, { recursive: true, force: true });
  }
});
