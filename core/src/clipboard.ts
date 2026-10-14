import { spawnSync } from 'node:child_process';

/** PowerShell expression for all of stdin, read as UTF-8. */
export const READ_STDIN = '$([Console]::InputEncoding = [Text.Encoding]::UTF8; [Console]::In.ReadToEnd())';

/** Puts text on the Windows clipboard through PowerShell stdin; false elsewhere or on failure. */
export function writeClipboard(text: string): boolean {
  if (process.platform !== 'win32') return false;
  const r = spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', `Set-Clipboard -Value ${READ_STDIN}`], {
    input: text,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 10_000,
  });
  return r.status === 0;
}
