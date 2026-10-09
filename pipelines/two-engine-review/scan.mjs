import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** Secret-scans review.diff before either engine reads it. */
export async function run(ctx) {
  const { scanDiff } = await import(pathToFileURL(path.join(ctx.coreDir, 'src', 'pipelines', 'secrets-scan.ts')).href);
  const diff = fs.readFileSync(String(ctx.steps.diff.diff_file), 'utf8');
  const scan = await scanDiff(diff, ctx.runDir, 'send');
  const list = scan.status === 'findings' ? scan.items.map((i) => `- ${i.rule} in ${i.file || 'unknown file'}${i.line ? ` line ${i.line}` : ''}`).join('\n') : '';
  const message = scan.status === 'findings'
    ? `The diff has ${scan.count} possible secret${scan.count === 1 ? '' : 's'}. Codex and Gemini read it next.\n${list}`
    : scan.status === 'unavailable' ? `The secret scan could not run (${scan.reason}). Codex and Gemini read the diff next.` : '';
  return { status: scan.status, count: scan.status === 'findings' ? scan.count : 0, findings: list, ask: scan.status === 'clean' ? 'no' : 'yes', message, scan };
}
