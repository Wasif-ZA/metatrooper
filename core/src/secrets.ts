import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import type { DatabaseSync } from 'node:sqlite';
import { homeDir } from './paths.ts';
import { nowIso } from './time.ts';
import { resolve } from './terminal/shells.ts';
import { MIN_SECRET_LENGTH } from './redact.ts';
import { BROWSER_SECRETS, normalOrigin, originFile, SECRET_NAME } from './browser/secret-origin.ts';

const cache = new Map<string, string>();
/** The file stamp each cached value was read from. */
const stamps = new Map<string, string | null>();
/** Values replaced by a newer save: a page may still show them, so they stay in the scrub list. */
const retired = new Set<string>();
const FAKE_PREFIX = 'fake-dpapi:';
const KEYRING_PREFIX = 'secret-tool:';
const PLAIN_PREFIX = 'plain:';

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

function secretTool(args: string[], stdin = ''): string {
  const r = spawnSync('secret-tool', args, { input: stdin, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`secret-tool failed: ${(r.stderr || r.error?.message || '').trim().split('\n')[0]}`);
  return r.stdout;
}

function keyringAttrs(pluginId: string, name?: string): string[] {
  return ['service', 'metatrooper', 'plugin', pluginId, ...(name ? ['name', name] : [])];
}

/** Off Windows without secret-tool, secrets are kept in plain 0600 files; the plugin screen says so. */
export function secretStoreWarning(): string | null {
  if (process.platform === 'win32' || fakeDpapi() || resolve('secret-tool')) return null;
  return 'secret-tool (libsecret) was not found, so plugin secrets are stored unencrypted in files only you can read (~/.metatrooper/secrets).';
}

/** Linux: the value goes to the keyring through secret-tool when present, otherwise into the 0600 file itself. */
function linuxBlob(pluginId: string, name: string, value: string): string {
  if (secretStoreWarning()) return PLAIN_PREFIX + value;
  secretTool(['store', `--label=MetaTrooper ${pluginId} ${name}`, ...keyringAttrs(pluginId, name)], value);
  return KEYRING_PREFIX;
}

export function secretPath(pluginId: string, name: string): string {
  return path.join(homeDir(), 'secrets', pluginId, `${name}.dpapi`);
}

/** Encrypts with DPAPI (current user) and stores the blob; the value never appears on a command line. */
export function setSecret(db: DatabaseSync, pluginId: string, name: string, value: string): void {
  const blob = fakeDpapi()
    ? FAKE_PREFIX + Buffer.from(value, 'utf8').reverse().toString('base64')
    : process.platform === 'win32'
      ? powershell('$v = $env:TROOP_SECRET_IN; ConvertTo-SecureString -String $v -AsPlainText -Force | ConvertFrom-SecureString', value)
      : linuxBlob(pluginId, name, value);
  const file = secretPath(pluginId, name);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, blob, { encoding: 'utf8', mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  if (pluginId !== 'core-notify' && pluginId !== BROWSER_SECRETS) db.prepare('INSERT OR REPLACE INTO plugin_secret (plugin_id, name, blob_path, set_at) VALUES (?, ?, ?, ?)').run(pluginId, name, file, nowIso());
  const prev = cache.get(`${pluginId}/${name}`);
  if (prev !== undefined && prev !== value) retired.add(prev);
  cache.set(`${pluginId}/${name}`, value);
  stamps.set(`${pluginId}/${name}`, fileStamp(file));
}

/** The stored file's mtime and size, or null when it is gone; another process saving the secret again changes it. */
function fileStamp(file: string): string | null {
  const s = fs.statSync(file, { throwIfNoEntry: false });
  return s ? `${s.mtimeMs}:${s.size}` : null;
}

/** Decrypts a stored secret into memory, cached until its file changes (another process, such as the core or the workbench, may save it again); null if absent. */
export function getSecret(pluginId: string, name: string): string | null {
  const key = `${pluginId}/${name}`;
  const file = secretPath(pluginId, name);
  const stamp = fileStamp(file);
  const hit = cache.get(key);
  if (hit !== undefined && stamp === stamps.get(key)) return hit;
  if (!stamp) {
    cache.delete(key);
    return null;
  }
  let value: string;
  if (fakeDpapi()) value = Buffer.from(fs.readFileSync(file, 'utf8').slice(FAKE_PREFIX.length), 'base64').reverse().toString('utf8');
  else if (process.platform !== 'win32') {
    const blob = fs.readFileSync(file, 'utf8');
    value = blob.startsWith(KEYRING_PREFIX) ? secretTool(['lookup', ...keyringAttrs(pluginId, name)]) : blob.slice(PLAIN_PREFIX.length);
  } else {
    const script =
      `$s = Get-Content -Raw -LiteralPath $env:TROOP_SECRET_IN | ConvertTo-SecureString; ` +
      `[Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))`;
    value = powershell(script, file);
  }
  if (hit !== undefined && hit !== value) retired.add(hit);
  cache.set(key, value);
  stamps.set(key, stamp);
  return value;
}

export function hasSecret(pluginId: string, name: string): boolean {
  return cache.has(`${pluginId}/${name}`) || fs.existsSync(secretPath(pluginId, name));
}

function keyringUsed(file: string): boolean {
  return process.platform !== 'win32' && fs.existsSync(file) && fs.readFileSync(file, 'utf8').startsWith(KEYRING_PREFIX);
}

/** Deletes one stored secret from disk and memory. */
export function deleteSecret(pluginId: string, name: string): void {
  cache.delete(`${pluginId}/${name}`);
  if (keyringUsed(secretPath(pluginId, name))) secretTool(['clear', ...keyringAttrs(pluginId, name)]);
  fs.rmSync(secretPath(pluginId, name), { force: true });
}

/** Deletes every stored secret of a plugin, on disk, in the table and in memory. */
export function deleteSecrets(db: DatabaseSync, pluginId: string): void {
  for (const key of [...cache.keys()]) if (key.startsWith(`${pluginId}/`)) cache.delete(key);
  if (process.platform !== 'win32' && !fakeDpapi() && resolve('secret-tool')) spawnSync('secret-tool', ['clear', ...keyringAttrs(pluginId)]);
  fs.rmSync(path.join(homeDir(), 'secrets', pluginId), { recursive: true, force: true });
  db.prepare('DELETE FROM plugin_secret WHERE plugin_id = ?').run(pluginId);
}

/** Saves a browser secret: the value in the DPAPI store under plugin id `core-browser`, its origin in plain text beside it. */
export function setBrowserSecret(db: DatabaseSync, name: string, origin: string, value: string): void {
  const o = normalOrigin(origin);
  if (!SECRET_NAME.test(name)) throw new Error('name must be letters, digits and _, starting with a letter');
  if (!o) throw new Error('origin must be an http or https URL');
  if (!value) throw new Error('value is required');
  if (value.length < MIN_SECRET_LENGTH) throw new Error(`value must be at least ${MIN_SECRET_LENGTH} characters, or output scrubbing cannot catch it`);
  // no origin while the value changes: a fill reads the origin before and after the value and needs both to agree
  fs.rmSync(originFile(name), { force: true });
  setSecret(db, BROWSER_SECRETS, name, value);
  fs.writeFileSync(originFile(name), o, { encoding: 'utf8', mode: 0o600 });
}

/** Every secret value decrypted in this process, including values a later save replaced. */
export function knownSecretValues(): string[] {
  return [...cache.values(), ...retired];
}

/** Every secret value decrypted in this process plus every saved browser secret, decrypted here when another process filled it; throws when one cannot be read. */
export function scrubSecretValues(): string[] {
  const dir = path.join(homeDir(), 'secrets', BROWSER_SECRETS);
  const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.dpapi')).map((f) => f.slice(0, -'.dpapi'.length)) : [];
  for (const name of names) getSecret(BROWSER_SECRETS, name);
  return knownSecretValues();
}
