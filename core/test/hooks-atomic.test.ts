import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const core = fileURLToPath(new URL('..', import.meta.url));

/** Runs `call` with every fs.writeFileSync writing half its data and then throwing, as a crash mid-write would leave it. */
function crashMidWrite(home: string, call: string): void {
  const script = `
    const fs = (await import('node:fs')).default;
    const real = fs.writeFileSync;
    fs.writeFileSync = (f, d) => { const s = String(d); real(f, s.slice(0, s.length >> 1)); throw new Error('crash'); };
    const m = await import(${JSON.stringify(new URL('../src/hooks/install.ts', import.meta.url).href)});
    try { m.${call}; } catch {}
  `;
  const env = { ...process.env, METATROOPER_HOME: join(home, 'mt'), METATROOPER_CLAUDE_SETTINGS: join(home, 'settings.json'), METATROOPER_CODEX_CONFIG: join(home, 'config.toml') };
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: core, encoding: 'utf8', env });
  assert.equal(r.status, 0, r.stderr);
}

test('a crash while installing hooks leaves the user\'s Claude settings and Codex config whole', () => {
  const home = mkdtempSync(join(tmpdir(), 'troop-hooks-atomic-'));
  try {
    const settings = JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'mine' }] }] } }, null, 2);
    const config = 'model = "fixture"\nnotify = ["orig.exe"]\n';
    writeFileSync(join(home, 'settings.json'), settings);
    writeFileSync(join(home, 'config.toml'), config);
    crashMidWrite(home, 'installClaude()');
    crashMidWrite(home, 'installCodex()');
    assert.equal(readFileSync(join(home, 'settings.json'), 'utf8'), settings);
    assert.equal(readFileSync(join(home, 'config.toml'), 'utf8'), config);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
