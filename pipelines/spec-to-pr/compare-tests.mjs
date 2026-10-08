import fs from 'node:fs';
import path from 'node:path';

/** New and old failures between a baseline and a later run, by exact test name; unknown when either side is unknown. */
export function compareFailures(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after)) return { new_failures: 'unknown', old_failures: 'unknown' };
  const was = new Set(before);
  return { new_failures: after.filter((n) => !was.has(n)), old_failures: after.filter((n) => was.has(n)) };
}

export function summaryLine(r) {
  if (!Array.isArray(r.new_failures)) return 'new failures: unknown (test output not parsed)';
  return `${r.new_failures.length} new failures (${r.old_failures.length} old)`;
}

export async function run(ctx) {
  let before = 'unknown';
  try { before = JSON.parse(fs.readFileSync(path.join(ctx.runDir, 'build-0.baseline.json'), 'utf8')).failing; } catch {}
  const r = compareFailures(before, ctx.steps.verify?.failing);
  return { ...r, summary: summaryLine(r) };
}
