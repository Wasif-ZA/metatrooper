import fs from 'node:fs';
import path from 'node:path';

/** Copies the approved picks and the first review into step outputs, which later agent steps cannot edit. */
export async function run(ctx) {
  const buckets = JSON.parse(fs.readFileSync(String(ctx.steps.review?.buckets_abs), 'utf8'));
  const pick = JSON.parse(fs.readFileSync(path.join(ctx.runDir, 'picks.json'), 'utf8')).pick;
  if (!Array.isArray(pick)) throw new Error('picks.json needs a "pick" list of finding ids');
  return { pick, buckets };
}
