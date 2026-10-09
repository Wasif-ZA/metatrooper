import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { homeDir } from './paths.ts';
import { nowIso } from './time.ts';

const cache = new Map<string, string>();
const FAKE_PREFIX = 'fake-dpapi:';

function fakeDpapi(): boolean {
  return process.platform !== 'win32' && process.env.METATROOPER_FAKE_DPAPI === '1';
}

function powershell(script: string, stdin: string): string {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
    input: `${script}\n`,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, TROOP_SECRET_IN: stdin },
  });
  if (r.status !== 0) throw new Error(`powershell failed: ${(r.stderr || '').trim().split('\n')[0]}`);
  return r.stdout.trim();
}

export function secretPath(pluginId: string, name: string): string {
  return path.join(homeDir(), 'secrets', pluginId, `${name}.dpapi`);
}

/** Encrypts with DPAPI (current user) and stores the blob; the value never appears on a command line. */
export function setSecret(db: DatabaseSync, pluginId: string, name: string, value: string): void {
  const blob = fakeDpapi()
    ? FAKE_PREFIX + Buffer.from(value, 'utf8').reverse().toString('base64')
    : powershell('$v = $env:TROOP_SECRET_IN; ConvertTo-SecureString -String $v -AsPlainText -Force | ConvertFrom-SecureString', value);
  const file = secretPath(pluginId, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, blob, 'utf8');
  if (pluginId !== 'core-notify') db.prepare('INSERT OR REPLACE INTO plugin_secret (plugin_id, name, blob_path, set_at) VALUES (?, ?, ?, ?)').run(pluginId, name, file, nowIso());
  cache.set(`${pluginId}/${name}`, value);
}

/** Decrypts a stored secret into memory, cached for the life of the core process; null if absent. */
export function getSecret(pluginId: string, name: string): string | null {
  const key = `${pluginId}/${name}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const file = secretPath(pluginId, name);
  if (!fs.existsSync(file)) return null;
  if (fakeDpapi()) {
    const value = Buffer.from(fs.readFileSync(file, 'utf8').slice(FAKE_PREFIX.length), 'base64').reverse().toString('utf8');
    cache.set(key, value);
    return value;
  }
  const script =
    `$s = Get-Content -Raw -LiteralPath $env:TROOP_SECRET_IN | ConvertTo-SecureString; ` +
    `[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))`;
  const value = powershell(script, file);
  cache.set(key, value);
  return value;
}

export function hasSecret(pluginId: string, name: string): boolean {
  return cache.has(`${pluginId}/${name}`) || fs.existsSync(secretPath(pluginId, name));
}

/** Deletes one stored secret from disk and memory. */
export function deleteSecret(pluginId: string, name: string): void {
  cache.delete(`${pluginId}/${name}`);
  fs.rmSync(secretPath(pluginId, name), { force: true });
}

/** Deletes every stored secret of a plugin, on disk, in the table and in memory. */
export function deleteSecrets(db: DatabaseSync, pluginId: string): void {
  for (const key of [...cache.keys()]) if (key.startsWith(`${pluginId}/`)) cache.delete(key);
  fs.rmSync(path.join(homeDir(), 'secrets', pluginId), { recursive: true, force: true });
  db.prepare('DELETE FROM plugin_secret WHERE plugin_id = ?').run(pluginId);
}

/** Every secret value decrypted in this process. */
export function knownSecretValues(): string[] {
  return [...cache.values()];
}
