// protects=M8-46c raised-surface text contrast across all built-in themes
// fails_when=raised text uses muted tokens, falls below 4.5:1, or selected tree tokens regress
// no_claim=inherited colours, full selector cascade, or non-text control contrast
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS } from '../../core/src/settings.ts';

const renderer = fileURLToPath(new URL('../renderer/', import.meta.url));
const ui = fileURLToPath(new URL('../ui/src/', import.meta.url));
type Rule = { file: string; selector: string; scope: string; declarations: Record<string, string> };

function cssFiles(directory: string, recursive: boolean): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return recursive ? cssFiles(file, true) : [];
    return entry.isFile() && entry.name.endsWith('.css') && entry.name !== 'ui.bundle.css' ? [file] : [];
  }).sort();
}

function declarations(source: string): Record<string, string> {
  return Object.fromEntries(source.split(';').flatMap(part => {
    const match = /^\s*([\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(part);
    return match ? [[match[1], match[2].replace(/\s*!important\s*$/i, '').trim()]] : [];
  }));
}

// Walk blocks so media/layer wrappers never acquire their children's declarations.
// Keep identical selectors in different scopes separate.
function parseRules(file: string): Rule[] {
  const source = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  function walk(start: number, end: number, scope: string): void {
    let cursor = start;
    while (cursor < end) {
      const open = source.indexOf('{', cursor);
      if (open < 0 || open >= end) break;
      let close = open + 1;
      let depth = 1;
      while (close < end && depth) {
        if (source[close] === '{') depth++;
        if (source[close] === '}') depth--;
        close++;
      }
      assert.equal(depth, 0, `${file}: balanced CSS blocks`);
      // Discard statement at-rules such as @import and @layer before a selector.
      const selector = source.slice(cursor, open).split(';').at(-1)!.trim();
      if (selector.startsWith('@')) walk(open + 1, close - 1, `${scope}/${selector}`);
      else rules.push({ file, selector, scope, declarations: declarations(source.slice(open + 1, close - 1)) });
      cursor = close;
    }
  }
  walk(0, source.length, '');
  return rules;
}

const rules = [...cssFiles(renderer, false), ...cssFiles(ui, true)].flatMap(parseRules);
const variable = (value: string | undefined) => /^var\(\s*(--[\w-]+)\s*\)$/.exec(value ?? '')?.[1];
const dynamicColor = (value: string | undefined) => /(?:light-dark|color-mix)\s*\(/i.test(value ?? '');

function raisedRules(): Rule[] {
  return rules.filter((rule, index) => {
    const { color, background, 'background-color': backgroundColor } = rule.declarations;
    if (dynamicColor(color) || dynamicColor(background) || dynamicColor(backgroundColor)) return false;
    // The send icon has an earlier static declaration and a later functional
    // override with identical selectors. Exclude that non-text control too.
    if (rules.slice(index + 1).some(later => later.file === rule.file && later.scope === rule.scope
      && later.selector === rule.selector && (dynamicColor(later.declarations.color)
        || dynamicColor(later.declarations.background) || dynamicColor(later.declarations['background-color'])))) return false;
    return [background, backgroundColor].some(value => ['--canvas-soft', '--hairline-strong'].includes(variable(value) ?? ''))
      && variable(color) !== undefined;
  });
}

// Read the actual mapping, preserving insertion order (line before line_strong,
// text before body/body_strong, and muted before faint), just like applyLook.
function themeVariables(): [string, string[]][] {
  const app = readFileSync(path.join(renderer, 'app.js'), 'utf8');
  const mapping = /const THEME_VARS\s*=\s*\{([\s\S]*?)\};/.exec(app);
  assert.ok(mapping, 'app.js declares THEME_VARS');
  const entries = Array.from(mapping[1].matchAll(/(\w+)\s*:\s*\[([^\]]+)\]/g), match =>
    [match[1], Array.from(match[2].matchAll(/['"](--[\w-]+)['"]/g), value => value[1])] as [string, string[]]);
  assert.ok(entries.length > 0, 'THEME_VARS mapping is nonempty');
  return entries;
}

function luminance(color: string): number {
  assert.match(color, /^#(?:[\da-f]{3}|[\da-f]{6})$/i, `expected an opaque hex colour: ${color}`);
  const hex = color.length === 4 ? color.slice(1).split('').map(c => c + c).join('') : color.slice(1);
  const channels = [0, 2, 4].map(offset => {
    const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function resolve(name: string, tokens: Record<string, string>, seen: string[] = []): string {
  assert.ok(!seen.includes(name), `cyclic CSS variable: ${[...seen, name].join(' -> ')}`);
  assert.ok(tokens[name], `unresolved CSS variable: ${name}`);
  const next = variable(tokens[name]);
  return next ? resolve(next, tokens, [...seen, name]) : tokens[name];
}

test('raised-surface text has WCAG contrast of at least 4.5:1 in every built-in theme', () => {
  const raised = raisedRules();
  assert.ok(raised.length > 0, 'found raised-surface rules with their own text colour');
  const root = rules.find(rule => rule.file === path.join(renderer, 'wall.css') && rule.selector === ':root');
  assert.ok(root, 'wall.css has default root tokens');
  const mapping = themeVariables();
  const themes = Object.entries(DEFAULTS.ui.themes);
  assert.ok(themes.length > 0, 'built-in themes are nonempty');
  const failures: string[] = [];
  for (const [themeName, theme] of themes) {
    const tokens = { ...root.declarations };
    for (const [key, variables] of mapping) {
      if (theme[key]) for (const name of variables) tokens[name] = theme[key];
    }
    for (const rule of raised) {
      for (const property of ['background', 'background-color']) {
        const background = variable(rule.declarations[property]);
        if (background !== '--canvas-soft' && background !== '--hairline-strong') continue;
        const foreground = variable(rule.declarations.color)!;
        const fg = resolve(foreground, tokens);
        const bg = resolve(background, tokens);
        const a = luminance(fg), b = luminance(bg);
        const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        if (ratio < 4.5) failures.push(`${themeName}: ${rule.file} ${rule.selector}: ${foreground} (${fg}) on ${background} (${bg}) = ${ratio.toFixed(3)}:1`);
      }
    }
  }
  assert.deepEqual(failures, [], 'raised-surface contrast failures');
});

test('raised-surface text never uses the mute or faint token', () => {
  const raised = raisedRules();
  assert.ok(raised.length > 0, 'found raised-surface text rules');
  for (const rule of raised) {
    assert.ok(!['--mute', '--faint'].includes(variable(rule.declarations.color)!),
      `${rule.file} ${rule.selector}: raised text uses ${rule.declarations.color}`);
  }
});

test('selected IDE tree rows promote both secondary text tokens to body', () => {
  const selected = '.ou-ide-tree [aria-selected="true"] > * > .astryx-tree-list-item';
  const matches = rules.filter(rule => rule.file === path.join(ui, 'ide-side.css')
    && rule.selector.split(',').some(selector => selector.trim().replace(/\s+/g, ' ') === selected));
  assert.ok(matches.some(rule => rule.declarations['--mute'] === 'var(--body)'
    && rule.declarations['--color-text-secondary'] === 'var(--body)'),
  'selected tree row has one rule setting --mute and --color-text-secondary to var(--body)');
});
