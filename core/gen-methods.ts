import fs from 'node:fs';
import { join } from 'node:path';
import { methodHelp, methodTable } from './src/methods.ts';
import { repoDir } from './src/paths.ts';

export const GENERATED = [
  { file: join(repoDir, 'contracts', 'pipe-protocol.md'), body: () => methodTable() },
  { file: join(repoDir, 'skills', 'troop', 'SKILL.md'), body: () => '```text\n' + methodHelp() + '\n```' },
];

export function block(text: string): string | null {
  const m = /<!-- methods:start -->\n([\s\S]*?)\n<!-- methods:end -->/.exec(text);
  return m ? m[1] : null;
}

if (import.meta.main) {
  for (const g of GENERATED) {
    const text = fs.readFileSync(g.file, 'utf8');
    if (block(text) === null) throw new Error(`no methods:start/end markers in ${g.file}`);
    fs.writeFileSync(g.file, text.replace(/(<!-- methods:start -->\n)[\s\S]*?(\n<!-- methods:end -->)/, (_, a, b) => a + g.body() + b));
  }
}
