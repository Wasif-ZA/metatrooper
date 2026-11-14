import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
  assert.deepEqual(plan.args.slice(0, 2), ['/d', '/k']);
  const line = plan.args[2];
  assert.ok(line.includes(`"${path.join(res, 'node', 'npm.cmd')}" install -g --prefix "${path.join(home, 'tools')}" @anthropic-ai/claude-code`), line);
  assert.ok(line.endsWith('&& claude'), line);
  assert.equal(plan.env.PATH, toolPath({ packaged: true, resourcesPath: res, home, path: 'C:\\Windows\\system32' }));
});

test('from source it uses the npm already on PATH; unknown engines get no plan', () => {
  const plan = installPlan('codex', { packaged: false, resourcesPath: res, home, path: 'X', comspec: 'cmd.exe' })!;
  assert.equal(plan.args[2], 'npm install -g @openai/codex && codex login');
  assert.equal(installPlan('agy', { packaged: true, resourcesPath: res, home, path: 'X', comspec: 'cmd.exe' }), null);
  assert.equal(installPlan('claude && calc', { packaged: true, resourcesPath: res, home, path: 'X', comspec: 'cmd.exe' }), null);
});

test('the core gets the tool PATH, the renderer has an install button, and main handles it', () => {
  const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /toolPath\(/);
  assert.match(main, /installPlan\(/);
  const app = readFileSync(new URL('../renderer/app.js', import.meta.url), 'utf8');
  assert.match(app, /data-action="install-engine"/);
  assert.match(app, /case 'install-engine'/);
});
