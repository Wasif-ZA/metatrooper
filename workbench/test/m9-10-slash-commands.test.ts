import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { listCommands } from '../src/commands.ts';

function fixture(t: { after: (fn: () => void) => void }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm9-10-commands-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return { home: path.join(root, 'home'), project: path.join(root, 'project'), root };
}

function write(file: string, content: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function skill(root: string, folder: string, frontmatter = '') {
  write(path.join(root, '.claude', 'skills', folder, 'SKILL.md'), `---\n${frontmatter}---\nBody\n`);
}

function command(root: string, name: string, frontmatter = '') {
  write(path.join(root, '.claude', 'commands', `${name}.md`), `---\n${frontmatter}---\nBody\n`);
}

function plugins(home: string, installed: Record<string, string>, enabled: Record<string, boolean>) {
  write(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: enabled }));
  write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: Object.fromEntries(Object.entries(installed).map(([key, installPath]) => [key, [{ installPath }]])),
  }));
}

test('project skill wins a case-insensitive duplicate from the user and commands', (t) => {
  const { home, project } = fixture(t);
  skill(project, 'spec', 'description: Project spec\n');
  skill(home, 'other-folder', 'name: SPEC\ndescription: User spec\n');
  command(home, 'Spec', 'description: User command\n');
  assert.deepEqual(listCommands(home, project), [{ name: 'spec', description: 'Project spec', source: 'project' }]);
});

test('skill frontmatter name overrides its folder name', (t) => {
  const { home, project } = fixture(t);
  skill(project, 'gstack-spec', 'name: spec\ndescription: Write a specification\n');
  assert.deepEqual(listCommands(home, project), [{ name: 'spec', description: 'Write a specification', source: 'project' }]);
});

test('project skills precede project commands and project commands precede user skills', (t) => {
  const { home, project } = fixture(t);
  skill(project, 'alpha', 'description: Project skill\n');
  command(project, 'alpha', 'description: Project command\n');
  command(project, 'beta', 'description: Project command\n');
  skill(home, 'beta', 'description: User skill\n');
  assert.deepEqual(listCommands(home, project), [
    { name: 'alpha', description: 'Project skill', source: 'project' },
    { name: 'beta', description: 'Project command', source: 'project' },
  ]);
});

test('non-invocable skills are hidden', (t) => {
  const { home, project } = fixture(t);
  skill(project, 'internal', 'user-invocable: false\n');
  command(project, 'visible');
  assert.deepEqual(listCommands(home, project), [{ name: 'visible', description: '', source: 'project' }]);
});

test('only enabled plugin skills and commands appear with their plugin prefix', (t) => {
  const { home, project, root } = fixture(t);
  const enabledRoot = path.join(root, 'codex-install');
  const disabledRoot = path.join(root, 'memory-install');
  write(path.join(enabledRoot, 'skills', 'review', 'SKILL.md'), '---\nname: inspect\ndescription: Inspect code\n---\n');
  write(path.join(enabledRoot, 'commands', 'review.md'), '---\ndescription: Review code\n---\n');
  write(path.join(disabledRoot, 'skills', 'secret', 'SKILL.md'), '---\n---\n');
  write(path.join(disabledRoot, 'commands', 'secret.md'), '---\n---\n');
  plugins(home, { 'codex@openai-codex': enabledRoot, 'claude-mem@vendor': disabledRoot }, { 'codex@openai-codex': true, 'claude-mem@vendor': false });
  assert.deepEqual(listCommands(home, project), [
    { name: 'codex:inspect', description: 'Inspect code', source: 'plugin' },
    { name: 'codex:review', description: 'Review code', source: 'plugin' },
  ]);
});

for (const state of ['missing', 'invalid']) {
  test(`installed plugin JSON ${state} keeps project and user commands`, (t) => {
    const { home, project } = fixture(t);
    command(project, 'project');
    command(home, 'user');
    write(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'codex@openai-codex': true } }));
    if (state === 'invalid') write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), '{broken');
    assert.deepEqual(listCommands(home, project), [
      { name: 'project', description: '', source: 'project' },
      { name: 'user', description: '', source: 'user' },
    ]);
  });
}

test('long descriptions end at 100 characters with an ellipsis', (t) => {
  const { home, project } = fixture(t);
  skill(project, 'long', `description: ${'a'.repeat(150)}\n`);
  assert.deepEqual(listCommands(home, project), [{ name: 'long', description: `${'a'.repeat(99)}…`, source: 'project' }]);
});

test('folded description uses its first indented line', (t) => {
  const { home, project } = fixture(t);
  skill(project, 'folded', 'description: >\n  First line of description\n  Second line\n');
  assert.deepEqual(listCommands(home, project), [{ name: 'folded', description: 'First line of description', source: 'project' }]);
});

test('literal block description uses its first indented line', (t) => {
  const { home, project } = fixture(t);
  skill(project, 'block', 'description: |\n  First block line\n  Second block line\n');
  assert.deepEqual(listCommands(home, project), [{ name: 'block', description: 'First block line', source: 'project' }]);
});

test('frontmatter beyond 4096 bytes retains a description near the top', (t) => {
  const { home, project } = fixture(t);
  skill(project, 'large', `description: Found near top\nfiller: ${'x'.repeat(5000)}\n`);
  assert.deepEqual(listCommands(home, project), [{ name: 'large', description: 'Found near top', source: 'project' }]);
});

test('private entries and nested command files are skipped', (t) => {
  const { home, project } = fixture(t);
  skill(project, '.hidden');
  skill(project, '_private');
  command(project, '_private');
  command(project, '.hidden');
  command(project, 'public');
  write(path.join(project, '.claude', 'commands', 'nested', 'inside.md'), '---\n---\n');
  assert.deepEqual(listCommands(home, project), [{ name: 'public', description: '', source: 'project' }]);
});

test('null project root lists only user and enabled plugin entries', (t) => {
  const { home, project, root } = fixture(t);
  const pluginRoot = path.join(root, 'plugin-install');
  command(project, 'project-only');
  command(home, 'user-only');
  write(path.join(pluginRoot, 'commands', 'plugin-only.md'), '---\n---\n');
  plugins(home, { 'codex@openai-codex': pluginRoot }, { 'codex@openai-codex': true });
  assert.deepEqual(listCommands(home, null), [
    { name: 'codex:plugin-only', description: '', source: 'plugin' },
    { name: 'user-only', description: '', source: 'user' },
  ]);
});

test('plugin commands use only the first installed path', (t) => {
  const { home, root } = fixture(t);
  const first = path.join(root, 'first-install');
  const second = path.join(root, 'second-install');
  write(path.join(first, 'commands', 'first.md'), '---\n---\n');
  write(path.join(second, 'commands', 'second.md'), '---\n---\n');
  write(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'codex@openai-codex': true } }));
  write(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), JSON.stringify({
    version: 2,
    plugins: { 'codex@openai-codex': [{ installPath: first }, { installPath: second }] },
  }));
  assert.deepEqual(listCommands(home, null), [{ name: 'codex:first', description: '', source: 'plugin' }]);
});

function rankCommands() {
  const source = fs.readFileSync(new URL('../ui/src/composer.jsx', import.meta.url), 'utf8');
  const match = /^export function rankCommands\([^\n]*\n(?:.*\n)*?^\}/m.exec(source);
  assert.ok(match, 'rankCommands exists in composer source');
  return vm.runInNewContext(`${match[0].replace(/^export /, '')}\nrankCommands`, {});
}

test('rankCommands groups prefix, name substring, then description matches without changing tier order', () => {
  const rank = rankCommands();
  const list = [
    { name: 'unmatched', description: 'none' },
    { name: 'later', description: 'SPEC in description' },
    { name: 'inspect', description: '' },
    { name: 'SPEC', description: '' },
    { name: 'aspect', description: '' },
    { name: 'special', description: '' },
  ];
  assert.deepEqual(Array.from(rank(list, 'sPeC')).map((x: { name: string }) => x.name), ['SPEC', 'special', 'inspect', 'aspect', 'later']);
});

test('rankCommands applies explicit and default caps', () => {
  const rank = rankCommands();
  const list = ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9'].map((name) => ({ name, description: '' }));
  assert.deepEqual(Array.from(rank(list, 'a')).map((x: { name: string }) => x.name), ['a0', 'a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7']);
  assert.deepEqual(Array.from(rank(list, 'a', 2)).map((x: { name: string }) => x.name), ['a0', 'a1']);
  assert.deepEqual(Array.from(rank(list, 'a', 0)), []);
});

test('commandsList handler returns an empty list for Codex', () => {
  const source = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
  const start = source.indexOf("on('commandsList',");
  const end = source.indexOf("on('fsRead',", start);
  assert.ok(start >= 0 && end > start, 'commandsList registration exists in main source');
  let handler: ((projectId: unknown, engineId: unknown) => unknown) | undefined;
  const calls: unknown[] = [];
  vm.runInContext(stripTypeScriptTypes(source.slice(start, end)), vm.createContext({
    on: (name: string, fn: typeof handler) => { assert.equal(name, 'commandsList'); handler = fn; },
    app: { getPath: (name: string) => { calls.push(name); return '/synthetic/home'; } },
    projectRoot: (id: unknown) => { calls.push(id); return '/synthetic/project'; },
    listCommands: () => { calls.push('listCommands'); return [{ name: 'unexpected' }]; },
  }));
  assert.ok(handler);
  assert.deepEqual(Array.from(handler('p1', 'codex') as unknown[]), []);
  assert.deepEqual(calls, []);
});
