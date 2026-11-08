import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const bin = path.resolve(repo, 'router/bin');

// protects=both troop shims exist beside the metarouter shims in router/bin
// fails_when=any troop or metarouter shim is missing or is not a file
// no_claim=the shim targets or runtime behavior (the following tests check those)
test('M7-18d troop shims exist beside metarouter', () => {
  for (const name of ['troop', 'troop.cmd', 'metarouter', 'metarouter.cmd']) {
    const shim = path.join(bin, name);
    assert.ok(fs.existsSync(shim), 'missing ' + name);
    assert.ok(fs.statSync(shim).isFile(), name + ' must be a file');
  }
});

// protects=each troop shim names the existing core/cli.ts relative to router/bin
// fails_when=a parsed target is missing or resolves to a different file
// no_claim=execution on the other platform (the runtime test runs the current platform)
test('M7-18d both troop shim targets resolve to core/cli.ts', () => {
  const targets = [
    { name: 'troop', pattern: /exec node "\$\(dirname "\$0"\)([^"\r\n]+)" "\$@"/ },
    { name: 'troop.cmd', pattern: /@node "%~dp0([^"\r\n]+)" %\*/ },
  ];
  for (const { name, pattern } of targets) {
    const text = fs.readFileSync(path.join(bin, name), 'utf8');
    const match = text.match(pattern);
    assert.ok(match, name + ' must name a relative Node entrypoint');
    const relative = match[1].replaceAll('\\', '/').replace(/^\//, '');
    const target = path.resolve(bin, relative);
    assert.ok(fs.existsSync(target), name + ' target does not exist: ' + target);
    assert.equal(target, path.resolve(repo, 'core/cli.ts'), name + ' must target core/cli.ts');
  }
});

// protects=the current platform troop shim exits successfully and prints troop help with router/bin on the child PATH
// fails_when=the shim errors, times out, exits nonzero, or omits usage: troop
// no_claim=registry installation, changes to the parent PATH, or execution on the other platform
test('M7-18d the current platform troop shim prints help', { timeout: 30_000 }, () => {
  const env = { ...process.env };
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
  env[pathKey] = bin + path.delimiter + (env[pathKey] ?? '');
  const windows = process.platform === 'win32';
  const result = spawnSync(
    windows ? 'cmd.exe' : 'sh',
    windows ? ['/d', '/s', '/c', 'router\\bin\\troop.cmd --help'] : ['router/bin/troop', '--help'],
    { cwd: repo, env, encoding: 'utf8', timeout: 30_000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /usage: troop/);
});
