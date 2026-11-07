import { PRESETS, smallestPreset } from './grants.ts';

export const BATCH_TOOLS = ['navigate', 'back', 'click', 'type', 'key', 'select', 'scroll', 'wait_for'];
export const BATCH_MAX = 20;

/** Checks a batch call's steps and the session grant before any step runs; returns the error, or null when the batch may run. */
export function checkBatch(steps: unknown, grant: string | null): { code: number; message: string } | null {
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > BATCH_MAX) return { code: -32602, message: `steps must hold 1 to ${BATCH_MAX} steps` };
  for (const [i, s] of steps.entries()) {
    if (!s || typeof s !== 'object' || !BATCH_TOOLS.includes((s as { tool?: string }).tool as string)) return { code: -32602, message: `step ${i + 1}: tool must be one of ${BATCH_TOOLS.join(', ')}` };
    const a = (s as { args?: unknown }).args;
    if (a !== undefined && (!a || typeof a !== 'object' || Array.isArray(a))) return { code: -32602, message: `step ${i + 1}: args must be an object` };
  }
  if (!grant || !PRESETS[grant]) return null;
  const names = Object.keys(PRESETS);
  const needed = ['batch', ...steps.map((s) => s.tool as string)].filter((t) => !PRESETS[grant].includes(t)).map((t) => smallestPreset(t) ?? 'debug');
  if (!needed.length) return null;
  return { code: -32039, message: `needs grant ${needed.reduce((a, b) => (names.indexOf(b) > names.indexOf(a) ? b : a))}` };
}
