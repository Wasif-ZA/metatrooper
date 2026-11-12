import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS } from '../src/settings.ts';

test('the shell list offers WSL on Windows and nowhere else', () => {
  const wsl = DEFAULTS.terminal.shells.wsl;
  if (process.platform === 'win32') assert.deepEqual(wsl, { label: 'WSL', command: ['wsl.exe'], fallback: [] });
  else assert.equal(wsl, undefined);
});
