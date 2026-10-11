import os from 'node:os';

/** The Windows build number xterm.js needs for ConPTY reflow, or 0 off Windows. */
export function windowsBuild(): number {
  return process.platform === 'win32' ? Number(os.release().split('.')[2]) || 0 : 0;
}
