import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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

/** The script's output, sent back as base64 of its UTF-8 bytes so the console codepage cannot change it. */
function powershell(script: string, stdin: string): string {
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
    input: `$out = & { ${script} }; [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes([string]$out))\n`,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, TROOP_SECRET_IN: stdin },
  });
  if (r.status !== 0) throw new Error(`powershell failed: ${(r.stderr || '').trim().split('\n')[0]}`);
  return Buffer.from(r.stdout.trim(), 'base64').toString('utf8');
}

function secretTool(args: string[], stdin = ''): string {
  const r = spawnSync('secret-tool', args, { input: stdin, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`secret-tool failed: ${(r.stderr || r.error?.message || '').trim().split('\n')[0]}`);
  return r.stdout;
}

function keyringAttrs(pluginId: string, name?: string, id?: string | null): string[] {
  return ['service', 'metatrooper', 'plugin', pluginId, ...(name ? ['name', name] : []), ...(id ? ['id', id] : [])];
}

/** The keyring entry id a stored blob names; null for other blobs, and for a blob saved before entries had ids. */
function keyringId(blob: string | null): string | null {
  return blob?.startsWith(KEYRING_PREFIX) ? blob.slice(KEYRING_PREFIX.length) || null : null;
}

/** Clears the keyring entry a blob names, if it names one; a failed clear leaves an orphan entry, never a broken secret. */
function dropKeyring(pluginId: string, name: string, blob: string | null): void {
  const id = keyringId(blob);
  if (id) try { secretTool(['clear', ...keyringAttrs(pluginId, name, id)]); } catch {}
}

/** Off Windows without secret-tool, secrets are kept in plain 0600 files; the plugin screen says so. */
export function secretStoreWarning(): string | null {
  if (process.platform === 'win32' || fakeDpapi() || resolve('secret-tool')) return null;
  return 'secret-tool (libsecret) was not found, so plugin secrets are stored unencrypted in files only you can read (~/.metatrooper/secrets).';
}

/** Linux: the value goes to the keyring through secret-tool when present, under a new entry id the file names, so a save never overwrites the entry the file still points at (D9); otherwise into the 0600 file itself. */
function linuxBlob(pluginId: string, name: string, value: string): string {
  if (secretStoreWarning()) return PLAIN_PREFIX + value;
  const id = randomUUID();
  secretTool(['store', `--label=MetaTrooper ${pluginId} ${name}`, ...keyringAttrs(pluginId, name, id)], value);
  return KEYRING_PREFIX + id;
}

export function secretPath(pluginId: string, name: string): string {
  return path.join(homeDir(), 'secrets', pluginId, `${name}.dpapi`);
}

/** Encrypts with DPAPI (current user); the value never appears on a command line. */
function encrypt(pluginId: string, name: string, value: string): string {
  return fakeDpapi()
    ? FAKE_PREFIX + Buffer.from(value, 'utf8').reverse().toString('base64')
    : process.platform === 'win32'
      ? powershell('$v = $env:TROOP_SECRET_IN; ConvertTo-SecureString -String $v -AsPlainText -Force | ConvertFrom-SecureString', value)
      : linuxBlob(pluginId, name, value);
}

/** Writes through a temp file and a rename, so a failed write leaves the old file whole (D9). */
function writePrivate(file: string, text: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
    if (process.platform !== 'win32') fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

function readBlob(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

/** Encrypts and stores the blob, replacing an older one only once the new one is written; the old keyring entry goes only after that. */
export function setSecret(db: DatabaseSync, pluginId: string, name: string, value: string): void {
  const file = secretPath(pluginId, name);
  const old = readBlob(file);
  const blob = encrypt(pluginId, name, value);
  try {
    writePrivate(file, blob);
  } catch (e) {
    dropKeyring(pluginId, name, blob);
    throw e;
  }
  dropKeyring(pluginId, name, old);
  if (pluginId !== 'core-notify' && pluginId !== BROWSER_SECRETS) db.prepare('INSERT OR REPLACE INTO plugin_secret (plugin_id, name, blob_path, set_at) VALUES (?, ?, ?, ?)').run(pluginId, name, file, nowIso());
  noteSaved(pluginId, name, value, file);
}

function noteSaved(pluginId: string, name: string, value: string, file: string): void {
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
    if (hit !== undefined) retired.add(hit);
    cache.delete(key);
    return null;
  }
  let value: string;
  if (fakeDpapi()) value = Buffer.from(fs.readFileSync(file, 'utf8').slice(FAKE_PREFIX.length), 'base64').reverse().toString('utf8');
  else if (process.platform !== 'win32') {
    const blob = fs.readFileSync(file, 'utf8');
    value = blob.startsWith(KEYRING_PREFIX) ? secretTool(['lookup', ...keyringAttrs(pluginId, name, keyringId(blob))]) : blob.slice(PLAIN_PREFIX.length);
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
  const key = `${pluginId}/${name}`;
  const hit = cache.get(key);
  if (hit !== undefined) retired.add(hit);
  cache.delete(key);
  if (keyringUsed(secretPath(pluginId, name))) secretTool(['clear', ...keyringAttrs(pluginId, name)]);
  fs.rmSync(secretPath(pluginId, name), { force: true });
}

/** Deletes every stored secret of a plugin, on disk, in the table and in memory. */
export function deleteSecrets(db: DatabaseSync, pluginId: string): void {
  for (const [key, value] of cache) if (key.startsWith(`${pluginId}/`)) {
    retired.add(value);
    cache.delete(key);
  }
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
  const file = secretPath(BROWSER_SECRETS, name);
  const oFile = originFile(name);
  const old = readBlob(file);
  const blob = encrypt(BROWSER_SECRETS, name, value);
  const next = `${oFile}.${process.pid}.new`;
  // both old files are held until both new ones are in place; no origin while the value changes, since a fill reads the origin before and after the value and needs both to agree
  const held = [file, oFile].map((f) => ({ f, h: `${f}.${process.pid}.old`, had: fs.existsSync(f), moved: false }));
  try {
    writePrivate(next, o);
    for (const x of held) if (x.had) { fs.renameSync(x.f, x.h); x.moved = true; }
    writePrivate(file, blob);
    fs.renameSync(next, oFile);
  } catch (e) {
    for (const x of held) {
      if (x.moved) fs.renameSync(x.h, x.f);
      else if (!x.had && x.f === file) fs.rmSync(file, { force: true });
    }
    fs.rmSync(next, { force: true });
    dropKeyring(BROWSER_SECRETS, name, blob);
    throw e;
  }
  for (const x of held) fs.rmSync(x.h, { force: true });
  dropKeyring(BROWSER_SECRETS, name, old);
  noteSaved(BROWSER_SECRETS, name, value, file);
}

/** Every secret value decrypted in this process, including values a later save replaced. */
export function knownSecretValues(): string[] {
  return [...cache.values(), ...retired];
}

/** The saved browser secret names, read again only when the folder's mtime changes (page text is scrubbed per line). */
let savedNames: { stamp: string; names: string[] } = { stamp: '', names: [] };

/** Every secret value decrypted in this process plus every saved browser secret, decrypted here when another process filled it; throws when one cannot be read. */
export function scrubSecretValues(): string[] {
  const dir = path.join(homeDir(), 'secrets', BROWSER_SECRETS);
  const stamp = `${dir}:${fs.statSync(dir, { throwIfNoEntry: false })?.mtimeMs ?? -1}`;
  if (savedNames.stamp !== stamp) {
    const names = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.dpapi')).map((f) => f.slice(0, -'.dpapi'.length)) : [];
    savedNames = { stamp, names };
  }
  for (const name of savedNames.names) {
    if (getSecret(BROWSER_SECRETS, name) === null) throw new Error('saved secret unavailable for scrubbing');
  }
  return knownSecretValues();
}
