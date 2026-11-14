import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { INSTALLABLE, installPlan, toolPath } from '../src/agent-install.ts';

const res = 'C:\\Apps\\cc\\resources';
const home = 'C:\\Users\\sam\\.cc';

test('only Claude Code and Codex install from npm, each with its own sign-in command', () => {
  assert.deepEqual(Object.keys(INSTALLABLE).sort(), ['claude', 'codex']);
  assert.equal(INSTALLABLE.claude.pkg, '@anthropic-ai/claude-code');
  assert.equal(INSTALLABLE.claude.bin, 'claude');
  assert.equal(INSTALLABLE.codex.pkg, '@openai/codex');
  assert.equal(INSTALLABLE.codex.bin, 'codex login');
});

test('the packaged app puts its bundled node and its own npm folder first on PATH', () => {
  const p = toolPath({ packaged: true, resourcesPath: res, home, path: 'C:\\Windows\\system32' });
  assert.equal(p, [path.join(res, 'node'), path.join(home, 'tools'), 'C:\\Windows\\system32'].join(';'));
  assert.equal(toolPath({ packaged: false, resourcesPath: res, home, path: 'X' }), 'X');
});

test('a packaged install runs the bundled npm into cc\'s own folder, then starts the CLI so the user signs in', () => {
  const plan = installPlan('claude', { packaged: true, resourcesPath: res, home, path: 'C:\\Windows\\system32', comspec: 'C:\\Windows\\system32\\cmd.exe' })!;
  assert.equal(plan.command, 'C:\\Windows\\system32\\cmd.exe');
  assert.deepEqual(plan.args.slice(0, 3), ['/d', '/s', '/k']);
  assert.ok(plan.args[3].startsWith('"') && plan.args[3].endsWith('"'), 'one outer pair of quotes for cmd /s');
  const line = plan.args[3].slice(1, -1);
  assert.ok(line.includes(`"${path.join(res, 'node', 'npm.cmd')}" install -g --prefix "${path.join(home, 'tools')}" @anthropic-ai/claude-code`), line);
  assert.ok(line.endsWith('&& claude'), line);
  assert.equal(plan.env.PATH, toolPath({ packaged: true, resourcesPath: res, home, path: 'C:\\Windows\\system32' }));
});

test('from source it uses the npm already on PATH; unknown engines get no plan', () => {
  const plan = installPlan('codex', { packaged: false, resourcesPath: res, home, path: 'X', comspec: 'cmd.exe' })!;
  assert.equal(plan.args[3], '"npm install -g @openai/codex && codex login"');
  assert.equal(installPlan('agy', { packaged: true, resourcesPath: res, home, path: 'X', comspec: 'cmd.exe' }), null);
  assert.equal(installPlan('claude && calc', { packaged: true, resourcesPath: res, home, path: 'X', comspec: 'cmd.exe' }), null);
});

test('the portable zip ships npm next to the bundled node', () => {
  const script = readFileSync(new URL('../scripts/package-win.ps1', import.meta.url), 'utf8');
  const line = script.split('\n').find((l) => l.includes("'resources/node'"));
  assert.ok(line, 'a copy into resources/node');
  for (const name of ['node.exe', 'npm.cmd', 'node_modules']) assert.ok(line.includes(`'${name}'`), name);
});

test('cmd.exe hands the bundled npm its arguments intact, even under a folder with spaces', { skip: process.platform !== 'win32' }, () => {
  const root = mkdtempSync(path.join(tmpdir(), 'cc install '));
  try {
    const resources = path.join(root, 'app files', 'resources');
    mkdirSync(path.join(resources, 'node'), { recursive: true });
    writeFileSync(path.join(resources, 'node', 'npm.cmd'), '@echo NPM %*\r\n@exit /b 0\r\n');
    const home = path.join(root, 'cc home');
    const plan = installPlan('claude', { packaged: true, resourcesPath: resources, home, path: process.env.PATH ?? '', comspec: process.env.ComSpec ?? 'cmd.exe' })!;
    const args = plan.args.map((a) => (a === '/k' ? '/c' : a.replace(/ && claude"$/, '"')));
    const out = execFileSync(plan.command, args, { encoding: 'utf8', windowsVerbatimArguments: true, env: { ...process.env, ...plan.env } });
    assert.equal(out.trim(), `NPM install -g --prefix "${path.join(home, 'tools')}" @anthropic-ai/claude-code`);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the core gets the tool PATH, the renderer has an install button, and main handles it', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /toolPath\(/);
  assert.match(main, /installPlan\(/);
  const app = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-action="install-engine"/);
  assert.match(app, /case 'install-engine'/);
});
