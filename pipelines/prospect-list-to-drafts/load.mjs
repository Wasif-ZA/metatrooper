import fs from 'node:fs';
import path from 'node:path';

const rowsOf = (text) => {
  const [head, ...lines] = text.split(/\r?\n/).filter((l) => l.trim());
  const cols = head.split(',').map((c) => c.trim().toLowerCase());
  // Splits on every comma; quoted commas are not handled.
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v.trim()])));
};

/** Reads the prospect CSV, drops rows with no email, duplicates and do-not-contact addresses, writes prospects.json. */
export async function run(ctx) {
  const read = (rel) => fs.readFileSync(path.resolve(ctx.projectPath, rel), 'utf8');
  const blocked = new Set(ctx.inputs.do_not_contact ? read(ctx.inputs.do_not_contact).split(/\r?\n/).map((l) => l.trim().toLowerCase()).filter(Boolean) : []);
  const seen = new Set();
  const dropped = [];
  const kept = rowsOf(read(ctx.inputs.list)).filter((row) => {
    const email = String(row.email || '').toLowerCase();
    const why = !email ? 'no email' : seen.has(email) ? 'duplicate' : blocked.has(email) ? 'do not contact' : '';
    seen.add(email);
    if (why) dropped.push({ email, why });
    return !why;
  });
  await ctx.writeFile('prospects.json', JSON.stringify(kept, null, 2));
  return { prospects: 'prospects.json', kept: kept.length, dropped };
}
