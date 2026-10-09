import fs from 'node:fs';
import path from 'node:path';

/** Copies the user's rules file (VIPs, tone, never-draft senders) into the run folder as rules.md. */
export async function run(ctx) {
  const file = path.resolve(ctx.projectPath, ctx.inputs.rules || 'rules.md');
  const found = fs.existsSync(file);
  await ctx.writeFile('rules.md', found ? fs.readFileSync(file, 'utf8') : '');
  ctx.log(found ? `rules from ${file}` : `no rules file at ${file}, using none`);
  return { rules: 'rules.md', found };
}
