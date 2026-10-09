import fs from 'node:fs';
import path from 'node:path';

/** Writes picks.json with every `both` finding ticked, unless it already exists. */
export async function run(ctx) {
  const file = path.join(ctx.runDir, 'picks.json');
  if (!fs.existsSync(file)) {
    let buckets = {};
    try { buckets = JSON.parse(fs.readFileSync(String(ctx.steps.review?.buckets_abs), 'utf8')); } catch {}
    await ctx.writeFile('picks.json', JSON.stringify({ pick: (buckets.both ?? []).map((f) => f.id) }, null, 2));
  }
  return { picks: JSON.parse(fs.readFileSync(file, 'utf8')).pick.length, picks_abs: file.replaceAll(path.sep, '/') };
}
