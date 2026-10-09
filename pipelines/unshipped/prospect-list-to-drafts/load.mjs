import fs from 'node:fs';
import path from 'node:path';

const cellsOf = (raw) => {
  const line = raw.trim();
  const cells = [...line.matchAll(/\s*(?:"((?:[^"]|"")*)"|([^,]*))\s*(?:,|$)/g)];
  if (!line.endsWith(',')) cells.pop();
  return cells.map((m) => (m[1] !== undefined ? m[1].replace(/""/g, '"') : m[2].trim()));
};

// Quoted fields may hold commas; a quoted field spanning lines is not handled.
const rowsOf = (text) => {
  const [head, ...lines] = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!head) return [];
  const cols = cellsOf(head).map((c) => c.toLowerCase());
  return lines.map((l) => Object.fromEntries(cellsOf(l).map((v, i) => [cols[i], v])));
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
