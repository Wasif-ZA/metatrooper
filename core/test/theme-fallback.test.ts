import test from 'node:test';
import assert from 'node:assert/strict';
import { activeTheme, DEFAULTS } from '../src/settings.ts';

const withTheme = (theme: string) => ({ ...DEFAULTS, ui: { ...DEFAULTS.ui, theme } }) as typeof DEFAULTS;

test('a light theme fills missing keys from the built-in light theme, not the dark default', () => {
  const t = activeTheme(withTheme('light'));
  assert.equal(t.body_strong, undefined);
  assert.equal(t.faint, undefined);
  assert.equal(t.text, '#1f2328');
});

test('a dark theme still fills missing keys from the dark default', () => {
  const t = activeTheme(withTheme('graphite'));
  assert.equal(t.body_strong, DEFAULTS.ui.themes[DEFAULTS.ui.theme].body_strong);
});
