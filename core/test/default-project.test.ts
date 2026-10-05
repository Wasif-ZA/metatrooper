import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { client, isolation, teardownCore, until } from './helpers.ts';

async function startWithDefault(defaultPath: string) {
  const isolated = isolation();
  writeFileSync(join(isolated.home, 'settings.json'), JSON.stringify({ projects: { default: defaultPath } }));
  const child = spawn(process.execPath, ['core/src/main.ts'], {
    cwd: resolve(import.meta.dirname, '../..'),
    env: isolated.env,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    await until(async () => {
      if (child.exitCode !== null) throw new Error(`core exited ${child.exitCode}: ${stderr}`);
      const connection = await client(isolated.prefix);
      try {
        const response = await connection.request('core.ping');
        return response.result?.ok === true && response.result?.schema_version === 2;
      } finally { connection.close(); }
    }, 5000);
  } catch (error) {
    child.kill();
    throw error;
  }
  return {
    isolated,
    child,
    stderr: () => stderr,
    async teardown() { await teardownCore(child, isolated); },
  };
}

test('projects.default opens the configured existing folder on fresh core start', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'metatrooper-default-project-'));
  const canonicalPath = resolve(folder).replaceAll('\\', '/').replace(/^([A-Z]):/, (_, drive) => `${drive.toLowerCase()}:`);
  const h = await startWithDefault(folder);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(join(h.isolated.home, 'troop.db'), { readOnly: true });
    const row = await until(() => db!.prepare('SELECT path FROM project ORDER BY last_opened DESC LIMIT 1').get(), 3000);
    assert.equal(row.path, canonicalPath);
  } finally {
    db?.close();
    await h.teardown();
    rmSync(folder, { recursive: true, force: true });
  }
});

test('projects.default refuses a folder containing work/ACU while core remains up', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'metatrooper-default-refused-'));
  mkdirSync(join(folder, 'work', 'ACU'), { recursive: true });
  const canonicalPath = resolve(folder).replaceAll('\\', '/').replace(/^([A-Z]):/, (_, drive) => `${drive.toLowerCase()}:`);
  const h = await startWithDefault(folder);
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(join(h.isolated.home, 'troop.db'), { readOnly: true });
    await until(() => db!.prepare("SELECT value FROM meta WHERE key = 'core_heartbeat'").get(), 5000);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM project WHERE path = ?').get(canonicalPath).n, 0);
    assert.match(h.stderr(), /projects\.default not opened/);
  } finally {
    db?.close();
    await h.teardown();
    rmSync(folder, { recursive: true, force: true });
  }
});
