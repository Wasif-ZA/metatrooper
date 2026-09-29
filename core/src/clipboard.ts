import { spawnSync } from 'node:child_process';

/** Puts text on the Windows clipboard through PowerShell stdin; false elsewhere or on failure. */
export function writeClipboard(text: string): boolean {
  if (process.platform !== 'win32') return false;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', 'Set-Clipboard -Value ([Console]::In.ReadToEnd())'], {
    input: text,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
  return r.status === 0;
}
